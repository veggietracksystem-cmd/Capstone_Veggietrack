const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PICKUP_PROXIMITY_LIMIT_METERS } = require('../lib/locationPolicy');

// The proof pre-flight endpoints exist for one reason: an image uploaded to
// Cloudinary for a completion the server then rejects is orphaned there with
// nothing referencing it. These tests pin the two properties that make the
// pre-flight worth having — it reaches the same verdict as the real
// completion, and it never writes anything on the way.
function harness(data) {
  const calls = { rpc: 0 };
  const db = {
    from(table) {
      const rows = data[table] ||= []; const filters = []; let singular = false;
      const query = {
        select() { return query; }, eq(k, v) { filters.push(row => row[k] === v); return query; },
        single() { singular = true; return query; }, maybeSingle() { singular = true; return query; },
        then(resolve, reject) {
          const result = rows.filter(row => filters.every(filter => filter(row)));
          return Promise.resolve({ data: singular ? result[0] || null : result, error: null }).then(resolve, reject);
        },
      }; return query;
    },
    async rpc() { calls.rpc++; return { data: null, error: null }; },
  };
  const handlers = new Map(); const app = { use() {}, listen() {} };
  for (const method of ['get', 'post', 'put', 'delete']) app[method] = (route, ...cb) => handlers.set(`${method} ${route}`, cb.at(-1));
  const express = Object.assign(() => app, { json: () => () => {}, raw: () => () => {} });
  const realRequire = createRequire(path.join(__dirname, '../index.js'));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), {
    require: name => name === 'express' ? express : name === 'dotenv' ? { config() {} } : name === '@supabase/supabase-js' ? { createClient: () => db } : realRequire(name),
    process: { env: { CLOUDINARY_CLOUD_NAME: 'veggietrack' }, on() {} }, console, Date, URL, setTimeout, clearTimeout,
  });
  return { calls, handlers, async call(key, user, body = {}, id) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
    await handlers.get(key)({ user, body, params: { id }, query: {} }, res);
    return res;
  } };
}
const rider = { userId: 'rider', role: 'delivery_personnel' };
const here = () => ({ latitude: 14.1, longitude: 121.2, accuracy: 10, captured_at: new Date().toISOString() });
const CHECK = 'post /api/deliveries/:id/complete/check';
const COMPLETE = 'put /api/deliveries/:id/complete';
const PICKUP_CHECK = 'post /api/pickup-requests/:id/pickup/check';
const PICKUP = 'post /api/pickup-requests/:id/pickup';
const photo = 'https://res.cloudinary.com/veggietrack/image/upload/v123/proof.jpg';

function deliveryData(overrides = {}) {
  return {
    users: [{ id: 'rider', role: 'delivery_personnel' }],
    orders: [{ id: 'order', status: 'in_transit', retailer_id: 'retailer', distributor_id: 'hub',
      delivery_latitude: 14.1, delivery_longitude: 121.2, ...overrides.order }],
    deliveries: [{ id: 'delivery', order_id: 'order', delivery_personnel_id: 'rider', status: 'in_transit', ...overrides.delivery }],
  };
}

test('delivery pre-flight accepts a completion the real endpoint would accept, and writes nothing', async () => {
  const { call, calls } = harness(deliveryData());
  const res = await call(CHECK, rider, here(), 'delivery');
  assert.equal(res.statusCode, 200);
  assert.deepEqual({ ...res.body }, { ok: true, completed: false, location_status: 'verified' });
  assert.equal(calls.rpc, 0, 'a check must never call the completion RPC');
});

test('delivery pre-flight reports an already completed delivery instead of demanding another photo', async () => {
  const { call } = harness(deliveryData({ order: { status: 'delivered' }, delivery: { status: 'delivered', pod: { latitude: 1 } } }));
  const res = await call(CHECK, rider, here(), 'delivery');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.completed, true);
});

// Every rejection below must happen BEFORE an upload; the matching completion
// call proves the check is not being more lenient than the endpoint it guards.
for (const [name, data, id, body, status, code] of [
  ['an unknown or unassigned delivery', deliveryData(), 'someone-elses', here(), 404, 'DELIVERY_NOT_FOUND'],
  ['a delivery that is not in transit', deliveryData({ delivery: { status: 'assigned' }, order: { status: 'assigned' } }), 'delivery', here(), 409, 'DELIVERY_NOT_IN_TRANSIT'],
  ['missing GPS', deliveryData(), 'delivery', { captured_at: new Date().toISOString() }, 422, 'GPS_REQUIRED'],
  ['GPS too inaccurate to verify', deliveryData(), 'delivery', { ...here(), accuracy: 500 }, 422, 'GPS_INACCURATE'],
  ['expired GPS', deliveryData(), 'delivery', { ...here(), captured_at: new Date(Date.now() - 120000).toISOString() }, 422, 'GPS_STALE'],
  ['a destination with no coordinates', deliveryData({ order: { delivery_latitude: null, delivery_longitude: null } }), 'delivery', here(), 422, 'DELIVERY_DESTINATION_MISSING'],
]) test(`delivery pre-flight rejects ${name}, and so does the completion it guards`, async () => {
  const { call, calls } = harness(data);
  const checked = await call(CHECK, rider, body, id);
  assert.equal(checked.statusCode, status);
  assert.equal(checked.body.code, code);
  assert.equal(calls.rpc, 0);
  // Same verdict from the real endpoint, reached without touching the photo.
  const completed = await call(COMPLETE, rider, { ...body, proof_photo_url: photo }, id);
  assert.equal(completed.statusCode, status);
  assert.equal(completed.body.code, code);
  assert.equal(calls.rpc, 0);
});

test('only riders can run the pre-flight checks', async () => {
  const { call } = harness(deliveryData());
  for (const [key, id] of [[CHECK, 'delivery'], [PICKUP_CHECK, 'pickup']]) {
    const res = await call(key, { userId: 'hub', role: 'distributor' }, here(), id);
    assert.equal(res.statusCode, 403);
  }
});

function pickupData(farm = { latitude: null, longitude: null }, status = 'assigned') {
  return {
    users: [{ id: 'farmer', ...farm }, { id: 'rider', role: 'delivery_personnel' }],
    pickup_requests: [{ id: 'pickup', status, farmer_id: 'farmer', harvest_id: 'harvest', delivery_personnel_id: 'rider' }],
  };
}

test('pickup pre-flight passes with valid GPS and leaves the request untouched', async () => {
  const data = pickupData();
  const { call, calls } = harness(data);
  const res = await call(PICKUP_CHECK, rider, here(), 'pickup');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(calls.rpc, 0);
  assert.equal(data.pickup_requests[0].status, 'assigned');
});

test('pickup pre-flight rejects a rider standing too far from the farm before any upload', async () => {
  const farm = { latitude: 14.1, longitude: 121.2 };
  const { call, calls } = harness(pickupData(farm));
  // ~1 km north of the farm pin.
  const far = { ...here(), latitude: farm.latitude + 1000 / 6371000 * 180 / Math.PI };
  const res = await call(PICKUP_CHECK, rider, far, 'pickup');
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.code, 'PICKUP_TOO_FAR');
  assert.match(res.body.error, /Move closer/);
  assert.ok(res.body.distance_meters > 900 && res.body.distance_meters < 1100);
  assert.equal(calls.rpc, 0);
  // Standing on the pin is accepted.
  assert.equal((await call(PICKUP_CHECK, rider, { ...here(), ...farm }, 'pickup')).statusCode, 200);
});

test('pickup pre-flight skips proximity when the farmer has saved no farm pin', async () => {
  const { call } = harness(pickupData());
  const away = { ...here(), latitude: 20 };
  assert.equal((await call(PICKUP_CHECK, rider, away, 'pickup')).statusCode, 200);
});

for (const [name, data, id, body, status, code] of [
  ['an unknown or unassigned pickup', pickupData(), 'someone-elses', here(), 404, 'PICKUP_NOT_FOUND'],
  ['a pickup that is not assigned or on the way', pickupData({ latitude: null, longitude: null }, 'pending'), 'pickup', here(), 400, 'PICKUP_NOT_ACTIONABLE'],
  ['missing GPS', pickupData(), 'pickup', {}, 422, 'GPS_REQUIRED'],
  ['GPS too inaccurate to verify', pickupData(), 'pickup', { ...here(), accuracy: 500 }, 422, 'GPS_INACCURATE'],
]) test(`pickup pre-flight rejects ${name}, and so does the completion it guards`, async () => {
  const { call, calls } = harness(data);
  const checked = await call(PICKUP_CHECK, rider, body, id);
  assert.equal(checked.statusCode, status);
  assert.equal(checked.body.code, code);
  const completed = await call(PICKUP, rider, { ...body, proof_photo_url: photo }, id);
  assert.equal(completed.statusCode, status);
  assert.equal(completed.body.code, code);
  assert.equal(calls.rpc, 0);
});

test('the advisory pickup proximity limit still matches the authoritative SQL rule', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../sql/pickup_tracking_proof.sql'), 'utf8');
  // complete_pickup_with_proof is the authority; the Node copy exists only so
  // the phone can be told "move closer" before it spends an upload.
  assert.match(sql, new RegExp(String.raw`distance \+ accuracy > ${PICKUP_PROXIMITY_LIMIT_METERS}\b`));
});
