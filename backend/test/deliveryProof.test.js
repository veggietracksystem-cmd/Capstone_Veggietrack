const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { validateSchedule, scheduleInstant, validateProof, distanceMeters, proofImageUrl, ensureProofImage } = require('../lib/deliveryProof');
const { loadDestination, destinationFor, coordinate, missingColumn } = require('../lib/deliveryTracking');
const { STALE_LOCATION_SECONDS } = require('../lib/locationPolicy');
const now = Date.parse('2026-09-05T22:00:00+08:00');
const destination = { latitude: 7.1, longitude: 125.6 };
const proof = { ...destination, accuracy: 10, captured_at: new Date(now).toISOString() };
const original = 'https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg';

for (const [label, current, selected, allowed] of [
  ['A', now, '2026-09-05T15:00', false], ['B', now, '2026-09-05T23:00', true],
  ['C', now, '2026-09-06T08:00', true],
  ['D', Date.parse('2026-09-05T10:00:00+08:00'), '2026-09-05T09:00', false],
  ['E', Date.parse('2026-09-05T10:00:00+08:00'), '2026-09-05T10:30', true],
]) test(`schedule example ${label}`, () => {
  if (allowed) assert.ok(Date.parse(validateSchedule(selected, current)) > current);
  else assert.throws(() => validateSchedule(selected, current), /past/);
});
test('schedule rejects missing, invalid calendar dates, date-only, equality, and invalid clock fields', () => {
  for (const value of [null, '', '2026-09-06', '2026-02-30T10:00', '2026-09-06T24:00', '2026-09-06T10:60', '2026-09-06T10:00:60', '2026-09-05T22:00']) assert.throws(() => validateSchedule(value, now));
});
test('explicit UTC, Manila offset and legacy wall time represent identical instants', () => {
  assert.equal(scheduleInstant('2026-09-05T22:00'), now);
  assert.equal(scheduleInstant('2026-09-05T22:00+08:00'), now);
  assert.equal(scheduleInstant('2026-09-05T14:00Z'), now);
});
test('Haversine uses geographic distance, including antimeridian', () => {
  assert.equal(distanceMeters(destination, destination), 0);
  assert.ok(Math.abs(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 }) - 111195) < 1);
  assert.ok(distanceMeters({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 }) < 223);
});
test('nearby proof is verified with authoritative submission time', () => {
  const result = validateProof(proof, destination, now + 1000);
  assert.equal(result.location_status, 'verified');
  assert.equal(result.distance_meters, 0);
  assert.equal(result.submitted_at, new Date(now + 1000).toISOString());
  assert.equal(result.address, null);
});
test('far away, outside capped radius, missing destination and invalid GPS are rejected', () => {
  for (const patch of [{ latitude: 8 }, { latitude: 7.102, accuracy: 50 }, { latitude: null }, { longitude: '125.6' }, { accuracy: 101 }, { accuracy: null }, { accuracy: NaN }, { accuracy: -1 }, { captured_at: '2026-09-05T22:00' }, { captured_at: new Date(now - 60001).toISOString() }, { captured_at: new Date(now + 30001).toISOString() }]) assert.throws(() => validateProof({ ...proof, ...patch }, destination, now));
  assert.throws(() => validateProof(proof, {}, now), /Delivery location coordinates are unavailable/);
});
for (const [meters, accuracy, allowed, radius] of [[0, 0, true, 100], [40, 10, true, 110], [75, 10, true, 110],
  [115, 20, true, 120], [125, 20, false, 120], [149, 100, true, 150], [151, 100, false, 150], [500, 10, false, 110], [500, 1000, false, 150]]) {
  test(`radius policy: ${meters}m away with ${accuracy}m accuracy`, () => {
    const sample = { ...proof, latitude: destination.latitude + meters / 6371000 * 180 / Math.PI, accuracy };
    if (allowed) assert.equal(validateProof(sample, destination, now).effective_radius_meters, radius);
    else assert.throws(() => validateProof(sample, destination, now), accuracy > 100 ? /GPS signal is too inaccurate/ : /Move closer/);
  });
}
test('stale GPS requires refresh and poor accuracy never masquerades as distance failure', () => {
  assert.throws(() => validateProof({ ...proof, captured_at: new Date(now - 60001).toISOString() }, destination, now), { code: 'GPS_STALE' });
  assert.throws(() => validateProof({ ...proof, latitude: 8, accuracy: 1000 }, destination, now), { code: 'GPS_INACCURATE' });
});
test('photo overlay contains Manila submission time and coordinates; rejects arbitrary URLs', () => {
  const url = proofImageUrl(original, validateProof(proof, destination, now), 'demo');
  const decoded = decodeURIComponent(decodeURIComponent(url));
  assert.match(decoded, /GPS: 7.100000, 125.600000/);
  assert.match(decoded, /10:00 pm/i);
  assert.match(decoded, /VeggieTrack/);
  assert.match(decoded, /b_rgb:1E4E09/);
  for (const bad of ['', 'file:///proof.jpg', 'https://evil.test/a.jpg', original.replace('/v1312461204/', '/w_100/')]) assert.throws(() => proofImageUrl(bad, proof));
  assert.throws(() => proofImageUrl(original, proof, 'other-cloud'));
});
test('image rendering failures block completion', async () => {
  await assert.rejects(ensureProofImage(original, async () => ({ ok: false, headers: new Headers() })), /generated/);
  await assert.rejects(ensureProofImage(original, async () => { throw Error('offline'); }), /offline/);
  await ensureProofImage(original, async () => ({ ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }) }));
});

// Exercise the actual registered API callbacks without starting a live server or
// touching production inventory. Database and image transport are injected.
const source = fs.readFileSync(require.resolve('../index'), 'utf8');
function handler(path, endMarker, deps = {}) {
  let callback;
  const start = source.indexOf(`app.${path}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), {
    app: { get: (_, auth, cb) => { callback = cb; }, post: (_, auth, cb) => { callback = cb; }, put: (_, auth, cb) => { callback = cb; } },
    verifyToken() {}, validateSchedule, validateProof, proofImageUrl: (url, pod) => proofImageUrl(url, pod, 'demo'),
    ensureProofImage: async () => {}, createNotification: async () => {}, loadDestination, destinationFor, coordinate, missingColumn, STALE_LOCATION_SECONDS, Date, console,
    cancelExpiredRetailerOrders: async () => {}, ...deps,
  });
  return callback;
}
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } }; }
test('API bypass: past schedule is rejected before any database or inventory access', async () => {
  const cb = handler("post('/api/orders'", "app.get('/api/orders'", { supabaseAdmin: { from() { throw Error('must not access database'); } } });
  const res = response();
  await cb({ user: { role: 'retailer', userId: 'r' }, body: { preferred_schedule: '2000-01-01T15:00', items: [{}], delivery_address: 'Store' } }, res);
  assert.equal(res.statusCode, 422); assert.match(res.body.error, /past/);
});
function completionDb({ status = 'in_transit', rpcError = null, missing = false } = {}) {
  const calls = [];
  return { calls, from(table) { const q = { select() { return q; }, eq() { return q; }, async single() {
    return { data: missing ? null : table === 'deliveries' ? { id: 'd', order_id: 'o', status, pod: { location_status: 'verified' } } :
      { id: 'o', status, delivery_latitude: destination.latitude, delivery_longitude: destination.longitude, retailer_id: 'retailer', distributor_id: 'distributor' } };
  } }; return q; }, async rpc(name, args) { calls.push({ name, args }); return { error: rpcError }; } };
}
const complete = db => handler("put('/api/deliveries/:id/complete'", '// Distributor weekly report', { supabaseAdmin: db });
const request = body => ({ params: { id: 'd' }, user: { role: 'delivery_personnel', userId: 'rider' }, body: { ...proof, captured_at: new Date().toISOString(), proof_photo_url: original, ...body } });
test('completion persists metadata and transformed photo via one atomic RPC', async () => {
  const db = completionDb(), res = response(); await complete(db)(request(), res);
  assert.equal(res.statusCode, 200); assert.equal(db.calls.length, 1);
  const { args } = db.calls[0]; assert.equal(args.p_pod.latitude, destination.latitude);
  assert.equal(args.p_pod.location_status, 'verified'); assert.match(args.p_photo_url, /l_text/);
});
test('completion rejects missing GPS/photo, poor accuracy and far-away proof without writes', async () => {
  for (const patch of [{ latitude: null }, { proof_photo_url: null }, { accuracy: 1000 }, { latitude: 8 }]) {
    const db = completionDb(), res = response(); await complete(db)(request(patch), res);
    assert.equal(res.statusCode, 422); assert.equal(db.calls.length, 0);
  }
});
test('completion cannot persist when uploaded image rendering fails', async () => {
  const db = completionDb(), res = response();
  const cb = handler("put('/api/deliveries/:id/complete'", '// Distributor weekly report', { supabaseAdmin: db, ensureProofImage: async () => { throw Error('Cloudinary non-2xx'); } });
  await cb(request(), res);
  assert.equal(res.statusCode, 503); assert.equal(db.calls.length, 0);
  assert.equal(res.body.error, 'Proof was uploaded, but the delivery could not be completed. Please try again.');
});
test('backend completion resolves the same legacy destination as tracking', async () => {
  const legacyOrder = { id: 'o', retailer_id: 'retailer', distributor_id: 'distributor', status: 'in_transit', delivery_address: 'Branch' };
  const retailer = { store_location: 'Main', latitude: 1, longitude: 2 };
  const addresses = [{ address: 'branch', ...destination }];
  const db = completionDb();
  db.from = table => {
    const q = { select() { return q; }, eq() { return q; },
      single: async () => ({ data: table === 'deliveries' ? { id: 'd', order_id: 'o', status: 'in_transit' } : table === 'orders' ? legacyOrder : retailer }),
      then: resolve => Promise.resolve({ data: addresses }).then(resolve) };
    return q;
  };
  const res = response(); await complete(db)(request(), res);
  assert.equal(res.statusCode, 200);
  const target = destinationFor(legacyOrder, retailer, addresses);
  assert.equal(db.calls[0].args.p_pod.coordinate_source, target.coordinate_source);
  assert.equal(db.calls[0].args.p_pod.distance_meters, distanceMeters(proof, target));
});
test('completion authorization, workflow, retries and database errors', async () => {
  for (const [options, code] of [[{ status: 'assigned' }, 409], [{ missing: true }, 404], [{ rpcError: { code: '22023', message: 'expired' } }, 422], [{ rpcError: { code: 'PGRST202' } }, 500], [{ status: 'delivered' }, 200]]) {
    const db = completionDb(options), res = response(); await complete(db)(request(), res); assert.equal(res.statusCode, code);
    if (options.status === 'delivered') assert.equal(db.calls.length, 0);
  }
  const db = completionDb(), res = response(), req = request(); req.user.role = 'retailer';
  await complete(db)(req, res); assert.equal(res.statusCode, 403); assert.equal(db.calls.length, 0);
});
test('retailer and distributor read endpoints include persisted POD metadata', async () => {
  const pod = validateProof(proof, destination, now);
  for (const role of ['retailer', 'distributor']) {
    const selections = [];
    const db = { from(table) {
      const q = { select(fields) { selections.push(fields); return q; }, eq() { return q; }, order() { return q; }, in() { return q; },
        then(resolve) { const delivery = { order_id: 'o', proof_photo_url: original, pod };
          return Promise.resolve({ data: table === 'orders' ? [{ id: 'o', deliveries: [delivery] }] : table === 'deliveries' ? [delivery] : [] }).then(resolve);
        } }; return q;
    } };
    const cb = role === 'retailer' ? handler("get('/api/orders'", '// ========== ORDER APPROVAL', { supabaseAdmin: db }) :
      handler("get('/api/orders/active'", '// DYNAMIC order details', { supabaseAdmin: db });
    const res = response(); await cb({ user: { role, userId: 'user' } }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body[0].deliveries[0].pod.latitude, 7.1);
    assert.ok(selections.some(value => /pod/.test(value)));
  }
});

test('GPS publishes use an atomic timestamp filter and do not append ignored older samples', async () => {
  let current = null; const history = [];
  const db = { from(table) {
    if (table === 'delivery_tracking') return { insert: async value => { history.push(value); return {}; } };
    let updates, filter;
    const q = { update(value) { updates = value; return q; }, eq() { return q; }, or(value) { filter = value; return q; },
      select() {
        assert.match(filter, /last_location_update\.is\.null,last_location_update\.lt\./);
        if (current && current.last_location_update >= updates.last_location_update) return Promise.resolve({ data: [] });
        current = updates; return Promise.resolve({ data: [updates] });
      } };
    return q;
  } };
  const cb = handler("post('/api/delivery/update-location'", '// ============================================', { supabaseAdmin: db });
  const newer = new Date(Date.now() - 1000).toISOString(), older = new Date(Date.now() - 5000).toISOString();
  for (const captured_at of [newer, older]) {
    const res = response(); await cb({ user: { role: 'delivery_personnel', userId: 'rider' }, body: { ...destination, accuracy: 5, captured_at } }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.ignored, captured_at === older ? true : undefined);
  }
  assert.equal(current.last_location_update, newer); assert.equal(history.length, 0);
});
