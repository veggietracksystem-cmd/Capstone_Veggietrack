// Farm pickup tracking. Returns the same response shape as
// GET /api/delivery/tracking/:orderId: retailer_view drives the farmer's
// DeliveryTrackingMap (pickup = distributor hub, delivery = the farm, phase fixed
// to 'delivery'), and rider_view drives the rider's turn-by-turn navigation to the farm.
const { coordinate, createRouteService, riderLegRoute, riderNavigationView } = require('./deliveryTracking');
const { STALE_LOCATION_SECONDS } = require('./locationPolicy');

function createPickupTrackingHandler({ db, routes = createRouteService(), env = process.env, now = Date.now }) {
  return async (req, res) => {
    try {
      const { data: pickup, error } = await db.from('pickup_requests')
        .select('id, status, farmer_id, delivery_personnel_id, received_by, requested_at, received_at')
        .eq('id', req.params.id).single();
      if (error || !pickup) return res.status(404).json({ error: 'Pickup request not found' });
      const allowed = req.user.role === 'farmer' ? pickup.farmer_id === req.user.userId
        : req.user.role === 'distributor' ? true
        : req.user.role === 'delivery_personnel' ? pickup.delivery_personnel_id === req.user.userId
        : false;
      if (!allowed) return res.status(403).json({ error: 'Access denied for this pickup' });

      const [farmerResult, hubResult, riderResult] = await Promise.all([
        db.from('users').select('full_name, phone, farm_location, latitude, longitude').eq('id', pickup.farmer_id).single(),
        pickup.received_by ? db.from('users').select('full_name, warehouse_location, latitude, longitude').eq('id', pickup.received_by).single() : Promise.resolve({ data: null }),
        pickup.delivery_personnel_id ? db.from('users').select('*').eq('id', pickup.delivery_personnel_id).single() : Promise.resolve({ data: null }),
      ]);
      const farmer = farmerResult.data, hub = hubResult.data, person = riderResult.data;

      const originCoords = coordinate(hub);
      const origin = { latitude: originCoords?.latitude ?? null, longitude: originCoords?.longitude ?? null,
        name: hub?.full_name ? `${hub.full_name} · Dispatch hub` : 'Distributor hub', address: hub?.warehouse_location || '' };
      const destCoords = coordinate(farmer);
      const destination = { latitude: destCoords?.latitude ?? null, longitude: destCoords?.longitude ?? null,
        name: farmer?.full_name ? `${farmer.full_name}'s farm` : 'Farm pickup location', address: farmer?.farm_location || '', contact: farmer?.phone || '' };

      const riderCoords = coordinate({ latitude: person?.current_latitude, longitude: person?.current_longitude });
      const rider = { ...riderCoords, name: person?.full_name || 'No rider assigned yet',
        accuracy: person?.current_location_accuracy ?? null, last_updated: person?.last_location_update || null };
      const locationAge = now() - Date.parse(rider.last_updated);
      rider.live = !!riderCoords && Number.isFinite(locationAge) && locationAge <= STALE_LOCATION_SECONDS * 1000 && locationAge >= -30000;

      const isFinal = pickup.status === 'picked_up';
      const corridor = originCoords && destCoords && !isFinal
        ? await routes.getRoute([originCoords, destCoords], `pickup-corridor:${pickup.id}`, 300000) : null;
      const navigation = await riderLegRoute(routes, { active: !isFinal, rider, target: destination, identity: `pickup-navigation:${pickup.id}` });
      const routeError = isFinal ? null : !originCoords ? 'Distributor warehouse needs a saved map pin.' :
        !destCoords ? 'Farm location coordinates are unavailable. Ask the farmer to update their profile location.' :
        !navigation ? 'Road routing is temporarily unavailable. Live GPS is still shown.' : null;

      return res.json({
        order_id: pickup.id, delivery_personnel_id: pickup.delivery_personnel_id, status: pickup.status,
        map_config: { url: env.MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: env.MAP_TILE_ATTRIBUTION || '' },
        retailer_view: { rider, pickup: origin, delivery: destination,
          tracking: { route: navigation?.geometry || null, eta_seconds: navigation?.duration ?? null,
            distance_km: navigation ? navigation.distance / 1000 : null, eta_minutes: navigation ? Math.ceil(navigation.duration / 60) : null,
            navigation_phase: 'delivery', navigation_target: destination,
            estimated_route: corridor?.geometry || null, estimated_route_seconds: corridor?.duration ?? null,
            has_location: !!riderCoords, has_live_location: rider.live, route_error: routeError, route_updated_at: navigation?.fetched_at },
          timeline: { requested_at: pickup.requested_at, received_at: pickup.received_at } },
        rider_view: riderNavigationView({ navigation, rider, target: destination, phase: 'farm', arriveInstruction: 'Arrive at the farm',
          pickupLocation: destination, deliveryLocation: origin,
          inactiveMessage: ['assigned', 'otw'].includes(pickup.status) ? null : 'Pickup is no longer active.',
          missingTargetMessage: 'Farm location coordinates are unavailable. Ask the farmer to update their profile location.' }),
      });
    } catch (err) { console.error('Pickup tracking lookup failed:', err.message); return res.status(500).json({ error: 'Failed to get pickup tracking info' }); }
  };
}
module.exports = { createPickupTrackingHandler };
