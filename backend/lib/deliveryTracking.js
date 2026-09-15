const DEFAULT_ROUTER = 'https://routing.openstreetmap.de/routed-car';
const { distanceMeters, STALE_LOCATION_SECONDS } = require('./locationPolicy');
const ROUTE_MOVEMENT_METERS = 50;
const ROUTE_OFF_ROUTE_METERS = 75;
function formatEta(seconds) {
  const total = Math.max(0, Math.ceil(seconds / 60));
  const hours = Math.floor(total / 60), minutes = total % 60;
  return hours ? `${hours} hr${minutes ? ` ${minutes} min` : ''}` : `${minutes} min`;
}
function coordinate(value) {
  if (!value || value.latitude == null || value.longitude == null || value.latitude === '' || value.longitude === '') return null;
  const latitude = Number(value.latitude), longitude = Number(value.longitude);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}
const normalized = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
function destinationFor(order, retailer, addresses = []) {
  const snapshot = coordinate({ latitude: order.delivery_latitude, longitude: order.delivery_longitude });
  const addressKey = normalized(order.delivery_address);
  const matches = addressKey ? addresses.filter(address => normalized(address.address) === addressKey).map(coordinate).filter(Boolean) : [];
  const unique = [...new Map(matches.map(point => [`${point.latitude},${point.longitude}`, point])).values()];
  const saved = unique.length === 1 ? unique[0] : null;
  // Ambiguous legacy address pins are unsafe to guess, including a store fallback.
  const store = unique.length < 2 && addressKey && addressKey === normalized(retailer?.store_location) ? coordinate(retailer) : null;
  const coords = snapshot || saved || store;
  return { ...coords, latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null,
    coordinate_source: snapshot ? 'order_snapshot' : saved ? 'saved_address' : store ? 'retailer_store' : 'unavailable',
    name: retailer?.full_name ? `${retailer.full_name}'s store` : 'Retailer destination',
    address: order.delivery_address || retailer?.store_location || '', contact: retailer?.phone || '' };
}
async function loadDestination(db, order) {
  // A snapshot is authoritative and does not depend on today's mutable address book.
  if (coordinate({ latitude: order.delivery_latitude, longitude: order.delivery_longitude })) return destinationFor(order, null);
  const [retailer, addresses] = await Promise.all([
    db.from('users').select('full_name, phone, store_location, latitude, longitude').eq('id', order.retailer_id).single(),
    db.from('delivery_addresses').select('address, latitude, longitude').eq('user_id', order.retailer_id),
  ]);
  if (retailer.error || addresses.error) throw new Error('Unable to load delivery destination. Retry.');
  return destinationFor(order, retailer.data, addresses.data || []);
}
function offRouteMeters(point, geometry) {
  if (!geometry?.coordinates?.length) return Infinity;
  const scaleY = Math.PI * 6371000 / 180, scaleX = scaleY * Math.cos(point.latitude * Math.PI / 180);
  let best = Infinity;
  for (let i = 1; i < geometry.coordinates.length; i++) {
    const a = geometry.coordinates[i - 1], b = geometry.coordinates[i];
    const ax = (a[0] - point.longitude) * scaleX, ay = (a[1] - point.latitude) * scaleY;
    const bx = (b[0] - point.longitude) * scaleX, by = (b[1] - point.latitude) * scaleY;
    const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
function instructionFor(step) {
  const maneuver = step.maneuver || {}, road = step.name ? ` onto ${step.name}` : '';
  if (maneuver.type === 'depart') return `Head ${maneuver.modifier || 'along the road'}${road}`;
  if (maneuver.type === 'arrive') return 'Arrive at the destination';
  if (['roundabout', 'rotary'].includes(maneuver.type)) return `Enter the roundabout${maneuver.exit ? ` and take exit ${maneuver.exit}` : ''}${road}`;
  if (maneuver.type === 'merge') return `Merge ${maneuver.modifier || 'ahead'}${road}`;
  if (maneuver.type === 'fork') return `Keep ${maneuver.modifier || 'straight'}${road}`;
  if (maneuver.modifier === 'uturn') return `Make a U-turn${road}`;
  return `${maneuver.type === 'continue' || maneuver.type === 'new name' ? 'Continue' : 'Turn'} ${maneuver.modifier || 'straight'}${road}`;
}
// One queue per backend process: never exceed one public routing request/second.
// Production instances can share a self-hosted OSRM endpoint via OSRM_BASE_URL.
function createRouteService({ fetchImpl = global.fetch, env = process.env, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const cache = new Map(), pending = new Map();
  let queue = Promise.resolve(), lastStart = 0;
  async function getRoute(points, identity, ttl = 60000) {
    if (points.length < 2 || points.some(p => !coordinate(p))) return null;
    const endpoint = (env.OSRM_BASE_URL || DEFAULT_ROUTER).replace(/\/$/, '');
    if (endpoint === 'disabled') return null;
    // Target changes, meaningful movement, stale routes and off-route deviations refresh.
    const key = `${endpoint}:${identity}:${points.slice(1).map(p => `${p.longitude},${p.latitude}`).join(';')}`;
    const hit = cache.get(key);
    if (hit && now() - hit.time < (hit.value ? ttl : 15000) &&
      (!hit.value || (distanceMeters(hit.origin, points[0]) < ROUTE_MOVEMENT_METERS &&
        offRouteMeters(points[0], hit.value.geometry) <= ROUTE_OFF_ROUTE_METERS))) return hit.value;
    if (pending.has(key)) {
      const value = await pending.get(key);
      const latest = cache.get(key);
      if (latest?.value && distanceMeters(latest.origin, points[0]) >= ROUTE_MOVEMENT_METERS) return getRoute(points, identity, ttl);
      return value;
    }
    if (pending.size >= 20) return null;
    const operation = queue.then(async () => {
      await wait(Math.max(0, 1100 - (now() - lastStart)));
      lastStart = now();
      let value = null;
      try {
        const locations = points.map(p => `${p.longitude},${p.latitude}`).join(';');
        const response = await fetchImpl(`${endpoint}/route/v1/driving/${locations}?overview=full&geometries=geojson&steps=true`, {
          headers: { 'User-Agent': env.MAPS_USER_AGENT || 'VeggieTrack/1.0 (delivery navigation)', Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const body = await response.json(), route = body.routes?.[0];
          if (body.code === 'Ok' && Number.isFinite(route?.duration) && route.duration >= 0 && Number.isFinite(route.distance) && route.distance >= 0 && route?.geometry?.type === 'LineString' && route.geometry.coordinates?.length > 1 &&
              route.geometry.coordinates.every(p => Array.isArray(p) && coordinate({ longitude: p[0], latitude: p[1] }))) {
            const steps = (route.legs || []).flatMap((leg, legIndex) => (leg.steps || []).map(step => ({
              instruction: step.maneuver?.type === 'arrive' && legIndex < route.legs.length - 1 ? 'Arrive at the dispatch hub' : instructionFor(step), distance: step.distance, duration: step.duration,
              location: step.maneuver?.location, modifier: step.maneuver?.modifier || null,
              type: step.maneuver?.type, leg: legIndex,
            })));
            value = { geometry: route.geometry, distance: route.distance, duration: route.duration, steps, fetched_at: new Date(now()).toISOString() };
          }
        }
      } catch { /* Keep GPS available when the routing service is unavailable. */ }
      if (cache.size >= 512) cache.delete(cache.keys().next().value);
      cache.set(key, { time: now(), value, origin: coordinate(points[0]) });
      return value;
    });
    queue = operation.catch(() => {});
    pending.set(key, operation);
    try { return await operation; } finally { pending.delete(key); }
  }
  return { getRoute };
}

function createTrackingHandler({ db, routes = createRouteService(), env = process.env, now = Date.now }) {
  return async (req, res) => {
    try {
      const { data: order, error } = await db.from('orders').select('*, order_items(vegetable_name, quantity_kg)').eq('id', req.params.orderId).single();
      if (error || !order) return res.status(404).json({ error: 'Order not found' });
      const ids = { retailer: order.retailer_id, distributor: order.distributor_id, delivery_personnel: order.delivery_personnel_id };
      if (!ids[req.user.role] || ids[req.user.role] !== req.user.userId) return res.status(403).json({ error: 'Access denied for this delivery' });
      const [hubResult, retailerResult, addressResult, riderResult] = await Promise.all([
        db.from('users').select('full_name, warehouse_location, latitude, longitude').eq('id', order.distributor_id).single(),
        db.from('users').select('full_name, phone, store_location, latitude, longitude').eq('id', order.retailer_id).single(),
        db.from('delivery_addresses').select('address, latitude, longitude').eq('user_id', order.retailer_id),
        order.delivery_personnel_id ? db.from('users').select('*').eq('id', order.delivery_personnel_id).single() : Promise.resolve({ data: null }),
      ]);
      const hub = hubResult.data, person = riderResult.data;
      const originCoords = coordinate(hub);
      const origin = { latitude: originCoords?.latitude ?? null, longitude: originCoords?.longitude ?? null,
        name: hub?.full_name ? `${hub.full_name} · Dispatch hub` : 'Central Laguna Vegetable Hub',
        address: hub?.warehouse_location || '' };
      const destination = destinationFor(order, retailerResult.data, addressResult.data || []);
      // Order-level legacy coordinates have no rider identity and may belong to
      // a previous assignee. Only use GPS saved for the assigned rider.
      const riderCoords = coordinate({ latitude: person?.current_latitude,
        longitude: person?.current_longitude });
      const rider = { ...riderCoords, name: person?.full_name || 'No rider assigned yet',
        accuracy: person?.current_location_accuracy ?? null, last_updated: person?.last_location_update || null };
      const locationAge = now() - Date.parse(rider.last_updated);
      rider.live = !!riderCoords && Number.isFinite(locationAge) && locationAge <= STALE_LOCATION_SECONDS * 1000 && locationAge >= -30000;
      const isFinal = ['delivered', 'cancelled'].includes(order.status);
      const corridor = originCoords && coordinate(destination) ? await routes.getRoute([originCoords, destination], `corridor:${order.id}:${originCoords.latitude},${originCoords.longitude}`, 300000) : null;
      // Navigate one leg at a time. Reaching the hub does not imply collection:
      // the rider must mark picked_up (the status API also advances orders to in_transit).
      const needsPickup = !['picked_up', 'in_transit', 'delivered'].includes(order.status);
      const navigationTarget = needsPickup ? origin : destination;
      const navigationPhase = needsPickup ? 'pickup' : 'delivery';
      const navigationPoints = riderCoords && coordinate(navigationTarget) ? [riderCoords, navigationTarget] : [];
      const navigation = !isFinal && rider.live && navigationPoints.length > 1 ?
        await routes.getRoute(navigationPoints, `navigation:${order.id}:${navigationPhase}`, 30000) : null;
      const navigationError = isFinal ? 'Delivery is no longer active.' : !coordinate(navigationTarget) ?
        (needsPickup ? 'Distributor warehouse needs a saved map pin.' : 'Delivery location coordinates are unavailable. Contact the distributor.') :
        !rider.live ? 'Waiting for fresh rider GPS.' : !navigation ? 'Road guidance is currently unavailable.' : null;
      const routeError = !originCoords ? 'Distributor warehouse needs a saved map pin.' : !coordinate(destination) ?
        'Delivery location coordinates are unavailable. Contact the distributor.' : !navigation ? 'Road routing is temporarily unavailable. Live GPS is still shown.' : null;
      return res.json({
        order_id: order.id, delivery_personnel_id: order.delivery_personnel_id, status: order.status,
        map_config: { url: env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: env.MAP_TILE_ATTRIBUTION || '' },
        rider_view: { route_steps: (navigation?.steps || []).map(step => step.type === 'arrive' ?
            { ...step, instruction: needsPickup ? 'Arrive at the dispatch hub' : 'Arrive at the retailer' } : step),
          route_summary: '', full_route: navigation?.geometry || null,
          eta_seconds: navigation?.duration ?? null, distance_km: navigation ? navigation.distance / 1000 : null,
          current_location: rider, pickup_location: origin, delivery_location: destination,
          navigation_phase: navigationPhase, navigation_target: navigationTarget,
          route_updated_at: navigation?.fetched_at, navigation_error: navigationError },
        retailer_view: { rider, pickup: origin, delivery: destination,
          tracking: { route: navigation?.geometry || null, eta_seconds: navigation?.duration ?? null,
            distance_km: navigation ? navigation.distance / 1000 : null, eta_minutes: navigation ? Math.ceil(navigation.duration / 60) : null,
            eta_formatted: navigation ? formatEta(navigation.duration) : null,
            navigation_phase: navigationPhase, navigation_target: navigationTarget,
            estimated_route: corridor?.geometry || null, estimated_route_seconds: corridor?.duration ?? null,
            estimated_route_formatted: corridor ? formatEta(corridor.duration) : null,
            has_location: !!riderCoords, has_live_location: rider.live, route_error: routeError, route_updated_at: navigation?.fetched_at },
          items: order.order_items || [], timeline: { order_placed: order.created_at,
            rider_assigned: order.assigned_at || null, in_transit: order.in_transit_at || null, delivered: order.delivered_at || null } },
      });
    } catch (error) { console.error('Tracking lookup failed:', error.message); return res.status(500).json({ error: 'Failed to get tracking info' }); }
  };
}
function missingColumn(error, names) {
  return !!error && ['PGRST204', '42703'].includes(error.code) && names.some(name => String(error.message).includes(name));
}
module.exports = { coordinate, destinationFor, loadDestination, instructionFor, createRouteService, createTrackingHandler, missingColumn,
  ROUTE_MOVEMENT_METERS, ROUTE_OFF_ROUTE_METERS, offRouteMeters };
