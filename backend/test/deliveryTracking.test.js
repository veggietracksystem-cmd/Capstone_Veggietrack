const test = require('node:test');
const assert = require('node:assert/strict');
const { coordinate, destinationFor, instructionFor, createRouteService, createTrackingHandler } = require('../lib/deliveryTracking');
const geometry = require('../../mobile/src/lib/trackingGeometry');
const { formatEta } = require('../../mobile/src/lib/formatEta');

test('ETA splits rounded minutes into hours and minutes', () => {
  for (const [seconds, expected] of [[0, '0 min'], [1, '1 min'], [3540, '59 min'], [3599, '1 hr'], [4500, '1 hr 15 min'], [11760, '3 hr 16 min'], [7200, '2 hr']]) {
    assert.equal(formatEta(seconds), expected);
  }
  for (const value of [null, undefined, '', -1, NaN, Infinity]) assert.equal(formatEta(value), null);
});

test('missing assigned rider GPS never falls back to legacy order or retailer coordinates', async () => {
  const res = response();
  await createTrackingHandler({ db: fakeDb({ ...order, rider_last_latitude: 14.069, rider_last_longitude: 121.326 }, { rider: { full_name: 'New rider' } }),
    routes: { getRoute: async () => ({ ...route, duration: 11760, steps: [] }) }, env: {} })({ params: { orderId: 'o' }, user: { role: 'delivery_personnel', userId: 'rider' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.retailer_view.tracking.has_location, false);
  assert.equal(res.body.rider_view.current_location.latitude, undefined);
  assert.equal(res.body.rider_view.full_route, null);
  assert.equal(res.body.retailer_view.tracking.eta_formatted, '~3 hr 16 min');
});

test('coordinates accept zero and reject missing, non-finite, and out-of-range values', () => {
  for (const parse of [coordinate, geometry.coordinate]) {
    assert.deepEqual(parse({ latitude: '0', longitude: '0' }), { latitude: 0, longitude: 0 });
    for (const value of [{ latitude: null, longitude: 0 }, { latitude: '', longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 1, longitude: Infinity }]) assert.equal(parse(value), null);
  }
});
test('destination uses order pin first, then matching saved address, never an unrelated store pin', () => {
  const retailer = { full_name: 'Store', phone: 'sample', store_location: 'Main store', latitude: 10, longitude: 20 };
  const order = { delivery_address: 'Branch' }, saved = [{ address: ' branch ', latitude: 11, longitude: 21 }];
  assert.equal(destinationFor(order, retailer, saved).latitude, 11);
  assert.equal(destinationFor({ ...order, delivery_latitude: 12, delivery_longitude: 22 }, retailer, saved).latitude, 12);
  assert.equal(destinationFor(order, retailer, []).latitude, null);
  assert.equal(destinationFor({ delivery_address: 'Main store' }, retailer, []).latitude, 10);
});
test('turn guidance handles turns, roundabouts, U-turns and arrival', () => {
  assert.equal(instructionFor({ name: 'Rizal Avenue', maneuver: { type: 'turn', modifier: 'left' } }), 'Turn left onto Rizal Avenue');
  assert.match(instructionFor({ maneuver: { type: 'roundabout', exit: 2 } }), /exit 2/);
  assert.match(instructionFor({ maneuver: { modifier: 'uturn' } }), /U-turn/);
  assert.match(instructionFor({ maneuver: { type: 'arrive' } }), /Arrive/);
});
const route = { geometry: { type: 'LineString', coordinates: [[121.325, 14.068], [121.326, 14.069]] }, distance: 155, duration: 30, legs: [{ steps: [{ name: 'Road', distance: 155, duration: 30, maneuver: { type: 'depart', location: [121.325, 14.068] } }] }] };
test('routing caches and deduplicates polling, then refreshes moving GPS after TTL', async () => {
  let calls = 0, clock = 10000; const waits = [];
  const service = createRouteService({ fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ code: 'Ok', routes: [route] }) }; }, env: {}, now: () => clock, wait: async ms => { waits.push(ms); clock += ms; } });
  const points = [{ latitude: 14.068, longitude: 121.325 }, { latitude: 14.069, longitude: 121.326 }];
  const result = await Promise.all([service.getRoute(points, 'order', 30000), service.getRoute(points, 'order', 30000)]);
  assert.equal(calls, 1); assert.equal(result[0].steps.length, 1);
  await service.getRoute([{ latitude: 14.0681, longitude: 121.3251 }, points[1]], 'order', 30000);
  assert.equal(calls, 1);
  clock += 31000; await service.getRoute(points, 'order', 30000); assert.equal(calls, 2);
  await service.getRoute(points, 'other-order', 30000); assert.ok(waits.at(-1) >= 1100);
});
test('routing failures are cached briefly and do not masquerade as road routes', async () => {
  let calls = 0;
  const service = createRouteService({ fetchImpl: async () => { calls++; throw Error('offline'); }, env: {}, wait: async () => {} });
  const points = [{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 1 }];
  assert.equal(await service.getRoute(points, 'a'), null);
  assert.equal(await service.getRoute(points, 'a'), null); assert.equal(calls, 1);
});
function fakeDb(order, overrides = {}) {
  const users = { hub: { full_name: 'Distributor', warehouse_location: 'Warehouse', latitude: 14.068, longitude: 121.325 },
    shop: { full_name: 'Retailer', phone: 'sample', store_location: 'Store', latitude: 14.069, longitude: 121.326 },
    rider: { full_name: 'Rider', current_latitude: 14.0682, current_longitude: 121.3252, current_location_accuracy: 7, last_location_update: new Date().toISOString() }, ...overrides };
  return { from(table) { let id; return { select() { return this; }, eq(_, value) { id = value; return this; },
    single() { return Promise.resolve({ data: table === 'orders' ? order : users[id] }); },
    then(resolve) { return Promise.resolve({ data: [] }).then(resolve); } }; } };
}
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
const order = { id: 'o', distributor_id: 'hub', retailer_id: 'shop', delivery_personnel_id: 'rider', status: 'in_transit', delivery_address: 'Store', order_items: [] };
test('retailer and distributor receive their own hub-to-store corridor and rider accuracy', async () => {
  for (const [role, userId] of [['retailer', 'shop'], ['distributor', 'hub']]) {
    const calls = [], res = response();
    await createTrackingHandler({ db: fakeDb(order), routes: { getRoute: async points => { calls.push(points); return { ...route, steps: [] }; } }, env: {} })({ params: { orderId: 'o' }, user: { role, userId } }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.retailer_view.rider.accuracy, 7);
    assert.equal(calls.length, 1); assert.equal(calls[0][1].latitude, 14.069);
    assert.equal(res.body.retailer_view.delivery.contact, 'sample');
  }
});
test('rider navigation uses only rider-to-hub before pickup and rider-to-retailer after pickup', async () => {
  for (const status of ['pending', 'approved', 'assigned', 'picked_up', 'in_transit']) {
    const pickedUp = ['picked_up', 'in_transit'].includes(status);
    const calls = [], res = response();
    await createTrackingHandler({ db: fakeDb({ ...order, status }), routes: { getRoute: async points => {
      calls.push(points); return { ...route, duration: calls.length === 1 ? 200 : 30, steps: [{ type: 'arrive' }] };
    } } })({ params: { orderId: 'o' }, user: { role: 'delivery_personnel', userId: 'rider' } }, res);
    assert.equal(calls[1].length, 2);
    assert.deepEqual(calls[1][0], { latitude: 14.0682, longitude: 121.3252 });
    assert.equal(calls[1][1].latitude, pickedUp ? 14.069 : 14.068);
    assert.equal(res.body.rider_view.navigation_phase, pickedUp ? 'delivery' : 'pickup');
    assert.equal(res.body.rider_view.navigation_target.address, pickedUp ? 'Store' : 'Warehouse');
    assert.equal(res.body.rider_view.eta_seconds, 30);
    assert.equal(res.body.rider_view.route_steps[0].instruction, pickedUp ? 'Arrive at the retailer' : 'Arrive at the dispatch hub');
  }
});

test('pickup navigation works without a retailer pin and never skips a missing hub', async () => {
  for (const missing of ['hub', 'shop']) {
    const calls = [], res = response();
    await createTrackingHandler({ db: fakeDb({ ...order, status: 'assigned' }, { [missing]: {} }),
      routes: { getRoute: async points => { calls.push(points); return { ...route, steps: [] }; } } })({ params: { orderId: 'o' }, user: { role: 'delivery_personnel', userId: 'rider' } }, res);
    assert.equal(calls.length, missing === 'hub' ? 0 : 1);
    if (missing === 'hub') {
      assert.equal(res.body.rider_view.full_route, null);
      assert.match(res.body.rider_view.navigation_error, /warehouse/);
    } else assert.equal(calls[0][1].latitude, 14.068);
  }
});

test('unavailable rider routing never falls back to the warehouse-to-retailer corridor', async () => {
  const res = response();
  await createTrackingHandler({ db: fakeDb(order), routes: { getRoute: async (_, identity) => identity.startsWith('corridor:') ? route : null } })({ params: { orderId: 'o' }, user: { role: 'delivery_personnel', userId: 'rider' } }, res);
  assert.equal(res.body.rider_view.full_route, null);
  assert.equal(res.body.rider_view.eta_seconds, null);
  assert.ok(res.body.retailer_view.tracking.route);
});

test('marking picked up switches the cached navigation endpoint immediately', async () => {
  const activeOrder = { ...order, status: 'assigned' }, requests = [];
  const service = createRouteService({ env: {}, wait: async () => {}, fetchImpl: async url => {
    requests.push(url); return { ok: true, json: async () => ({ code: 'Ok', routes: [route] }) };
  } });
  const handler = createTrackingHandler({ db: fakeDb(activeOrder), routes: service });
  const req = { params: { orderId: 'o' }, user: { role: 'delivery_personnel', userId: 'rider' } };
  await handler(req, response());
  assert.equal(requests.length, 2);
  assert.match(requests[1], /121\.3252,14\.0682;121\.325,14\.068\?/);
  activeOrder.status = 'in_transit'; // The existing picked_up endpoint advances the parent order to in_transit.
  const res = response(); await handler(req, res);
  assert.equal(requests.length, 3);
  assert.match(requests[2], /121\.3252,14\.0682;121\.326,14\.069\?/);
  assert.equal(res.body.rider_view.navigation_phase, 'delivery');
});
test('unrelated accounts cannot read private delivery GPS/contact details', async () => {
  const res = response(); await createTrackingHandler({ db: fakeDb(order) })({ params: { orderId: 'o' }, user: { role: 'distributor', userId: 'other' } }, res);
  assert.equal(res.statusCode, 403); assert.equal(res.body.retailer_view, undefined);
});
test('route progress projects onto road segments and simulation stops at destination', () => {
  const points = [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: .01 }, { latitude: .01, longitude: .01 }];
  const length = geometry.routeLength(points), halfway = geometry.positionAlong(points, length / 2);
  const progress = geometry.routeProgress(points, halfway);
  assert.ok(Math.abs(progress.remaining - length / 2) < 1);
  assert.deepEqual(geometry.positionAlong(points, length * 2), points[2]);
  assert.deepEqual(geometry.positionAlong(points, -10), points[0]);
  assert.ok(geometry.routeProgress(points, { latitude: 1, longitude: 1 }).offRoute > 150);
});
test('embedded addresses cannot break out of the WebView script', () => {
  const text = '</script><script>alert(1)</script>';
  const encoded = geometry.scriptJson({ address: text });
  assert.ok(!encoded.includes('<')); assert.equal(JSON.parse(encoded).address, text);
});

test('Leaflet bridge updates existing markers, preserves text, and handles missing GPS', async () => {
  const { buildDeliveryTrackingHtml } = await import('../../mobile/src/lib/deliveryTrackingHtml.js');
  const vm = require('node:vm');
  const layers = [], messages = [], frames = new Map(); let frameId = 0;
  const layer = (point, options) => ({ point, options,
    addTo() { layers.push(this); return this; }, on() { return this; },
    setLatLng(p) { this.point = p; return this; }, getLatLng() { return { lat: this.point[0], lng: this.point[1] }; },
    setIcon(icon) { this.icon = icon; return this; }, bindPopup(text) { this.popup = text; return this; },
    setLatLngs(points) { this.points = points; return this; },
  });
  const map = { setView() { return this; }, removeLayer(item) { layers.splice(layers.indexOf(item), 1); },
    fitBounds() {}, panTo() {}, on() {}, invalidateSize() {}, attributionControl: { addAttribution() {} } };
  const L = { map: () => map, marker: layer, circle: layer, polyline: layer, tileLayer: layer, divIcon: options => options, latLngBounds: p => p };
  const context = { L, Number, Date, JSON, performance: { now: () => 0 },
    document: { getElementById: () => ({ style: {} }), createElement: () => ({ textContent: '' }) },
    ResizeObserver: class { observe() {} }, requestAnimationFrame: cb => { frames.set(++frameId, cb); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    parent: { postMessage: message => messages.push(message) }, addEventListener() {}, matchMedia: () => ({ matches: false }) };
  context.window = context;
  vm.createContext(context);
  for (const match of buildDeliveryTrackingHtml().matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) vm.runInContext(match[1], context);
  assert.equal(messages[0].type, 'ready');
  const destination = { latitude: 14.069, longitude: 121.326, name: 'Store', address: '<img src=x onerror=alert(1)>', contact: 'sample' };
  const data = { origin: { latitude: 14.068, longitude: 121.325, name: 'Hub' }, destination,
    rider: { latitude: 14.0682, longitude: 121.3252, name: 'Rider', live: true, accuracy: 8 }, route: [], completed: [], autoRecenter: true };
  context.updateDeliveryMap(data);
  const rider = layers.find(item => item.options?.title === 'Rider');
  const store = layers.find(item => item.options?.title === 'Store');
  assert.ok(store.popup.textContent.includes(destination.address));
  const count = layers.length;
  context.updateDeliveryMap({ ...data, rider: { ...data.rider, latitude: 14.0683 } });
  for (const callback of [...frames.values()]) callback(450);
  assert.equal(layers.length, count);
  assert.equal(rider.point[0], 14.0683);
  context.updateDeliveryMap({ ...data, rider: {}, origin: {}, destination: {} });
  assert.ok(!layers.includes(rider));
});
