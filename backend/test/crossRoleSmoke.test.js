const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Stateful HTTP-handler smoke: data produced by one role is consumed by the next.
// Database transaction/authorization semantics have separate PostgreSQL/security tests.
test('farmer 8 kg harvest -> assigned pickup -> received batch -> listed menu -> retailer checkout and approval', async () => {
  process.env.CLOUDINARY_CLOUD_NAME = 'veggietrack';
  let sequence = 0;
  const data = { users: [
    { id: 'farmer', role: 'farmer', full_name: 'Farmer' },
    { id: 'hub', role: 'distributor', full_name: 'Distributor' },
    { id: 'rider', role: 'delivery_personnel', full_name: 'Rider' },
    { id: 'retailer', role: 'retailer', full_name: 'Retailer' },
  ] };
  const db = { from(table) {
    const rows = data[table] ||= []; const filters = []; let mode = 'read', values, singular = false;
    const query = {
      select() { return query; }, eq(k, v) { filters.push(row => row[k] === v); return query; },
      // A never-set column and an explicit SQL NULL are the same thing in
      // real Postgres; this in-memory mock must treat an absent key the same
      // way `.is(col, null)` would against a real column default of NULL.
      is(k, v) { filters.push(row => (row[k] ?? null) === v); return query; },
      in(k, values) { filters.push(row => values.includes(row[k])); return query; },
      gt(k, v) { filters.push(row => row[k] > v); return query; }, order() { return query; }, limit() { return query; },
      insert(v) { mode = 'insert'; values = v; return query; }, update(v) { mode = 'update'; values = v; return query; },
      single() { singular = true; return query; }, maybeSingle() { singular = true; return query; },
      then(resolve, reject) {
        let result = rows.filter(row => filters.every(filter => filter(row)));
        if (mode === 'insert') { result = (Array.isArray(values) ? values : [values]).map(value => ({ id: `id-${++sequence}`, recorded_at: new Date().toISOString(), ...value })); rows.push(...result); }
        if (mode === 'update') result.forEach(row => Object.assign(row, values));
        const joined = result.map(row => table === 'pickup_requests' ? { ...row, harvests: data.harvests?.find(h => h.id === row.harvest_id) } : { ...row });
        return Promise.resolve({ data: singular ? joined[0] || null : joined, error: null }).then(resolve, reject);
      },
    }; return query;
  },
  // Minimal reimplementation of sql/stock_safety.sql and
  // sql/pickup_tracking_proof.sql's RPCs against the same in-memory rows, so
  // this smoke test exercises the real Node call sites end-to-end.
  async rpc(name, args) {
    if (name === 'decrement_product_stock') {
      const row = (data.products || []).find(p => p.id === args.p_product_id);
      if (!row || Number(args.p_quantity) <= 0 || Number(row.stock_kg) < Number(args.p_quantity)) return { data: null, error: null };
      row.stock_kg = Number(row.stock_kg) - Number(args.p_quantity);
      row.status = row.stock_kg <= 0 ? 'sold_out' : 'listed';
      return { data: { ...row }, error: null };
    }
    if (name === 'restore_product_stock') {
      const row = (data.products || []).find(p => p.id === args.p_product_id);
      if (!row || Number(args.p_quantity) <= 0) return { data: null, error: null };
      row.stock_kg = Number(row.stock_kg) + Number(args.p_quantity);
      if (row.status === 'sold_out') row.status = 'listed';
      return { data: { ...row }, error: null };
    }
    if (name === 'complete_pickup_with_proof') {
      const row = (data.pickup_requests || []).find(p => p.id === args.p_pickup_id);
      if (!row || row.delivery_personnel_id !== args.p_rider_id || !['assigned', 'otw'].includes(row.status)) {
        return { data: null, error: { message: 'Pickup request not assigned to you', code: '22023' } };
      }
      row.status = 'picked_up'; row.received_at = new Date().toISOString();
      row.proof_photo_url = args.p_photo_url; row.pod = { ...args.p_pod, location_status: 'verified' };
      return { data: row.pod, error: null };
    }
    return { data: null, error: null };
  } };
  const handlers = new Map(); const app = { use() {}, listen() {} };
  for (const method of ['get', 'post', 'put', 'delete']) app[method] = (route, ...callbacks) => handlers.set(`${method} ${route}`, callbacks.at(-1));
  const express = Object.assign(() => app, { json: () => () => {}, raw: () => () => {} });
  const realRequire = createRequire(path.join(__dirname, '../index.js'));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), {
    require: name => name === 'express' ? express : name === 'dotenv' ? { config() {} } : name === '@supabase/supabase-js' ? { createClient: () => db } : realRequire(name),
    process: { env: { CLOUDINARY_CLOUD_NAME: 'veggietrack' } }, console, Date, URL, setTimeout, clearTimeout,
  });
  async function raw(key, userId, body = {}, id) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const user = data.users.find(row => row.id === userId);
    await handlers.get(key)({ user: { userId, role: user?.role }, body, params: { id }, query: {} }, res);
    return res;
  }
  async function call(key, userId, body = {}, id) {
    const res = await raw(key, userId, body, id);
    assert.ok(res.statusCode < 400, `${key}: ${JSON.stringify(res.body)}`);
    return res.body;
  }
  const harvest = (await call('post /api/harvests', 'farmer', { vegetable_name: 'Carrot', quantity_kg: 8 })).harvest;
  const pickup = (await call('post /api/pickup-requests', 'farmer', { harvest_id: harvest.id })).request;
  // Duplicate protection: a double-tap / retried pickup request for the same
  // harvest must not create a second active request.
  const dupePickup = await raw('post /api/pickup-requests', 'farmer', { harvest_id: harvest.id });
  assert.equal(dupePickup.statusCode, 409);
  assert.equal(data.pickup_requests.filter(p => p.harvest_id === harvest.id).length, 1);

  await call('put /api/pickup-requests/:id/assign', 'hub', { delivery_personnel_id: 'rider', price_per_kg: 10 }, pickup.id);
  // Rider assignment idempotency: a duplicate/retried assign call is rejected
  // once the pickup is already assigned, and the original rider stays assigned.
  const dupeAssign = await raw('put /api/pickup-requests/:id/assign', 'hub', { delivery_personnel_id: 'rider', price_per_kg: 10 }, pickup.id);
  assert.equal(dupeAssign.statusCode, 400); // rejected by the status guard before the atomic update is even attempted
  assert.equal(data.pickup_requests.find(p => p.id === pickup.id).delivery_personnel_id, 'rider');
  const pickupProofPhoto = 'https://res.cloudinary.com/veggietrack/image/upload/v123/pickups/carrot-proof.jpg';
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }) });
  try {
    await call('post /api/pickup-requests/:id/pickup', 'rider', {
      proof_photo_url: pickupProofPhoto, latitude: 14.1, longitude: 121.2, accuracy: 10, captured_at: new Date().toISOString(),
    }, pickup.id);
  } finally { global.fetch = realFetch; }
  const batch = data.products[0];
  assert.equal(batch.status, 'received'); assert.equal(batch.harvest_id, harvest.id); assert.equal(batch.farmer_id, 'farmer');
  assert.equal((await call('get /api/products/available', 'retailer')).length, 0);
  const photo = 'https://res.cloudinary.com/veggietrack/image/upload/v123/batches/carrot-received.jpg';
  await call('put /api/products/:id/batch-photo', 'hub', { batch_photo_url: photo }, batch.id);
  await call('put /api/products/:id/list', 'hub', { price_per_kg: 20 }, batch.id);
  const menu = await call('get /api/products/available', 'retailer');
  assert.equal(menu[0].available_kg, 8);
  assert.equal(menu[0].batch_photo_url, photo);
  const order = (await call('post /api/orders', 'retailer', {
    items: [{ vegetable_name: 'Carrot', quantity_kg: 6 }], delivery_address: 'Store',
    delivery_latitude: 14.1, delivery_longitude: 121.2,
    preferred_schedule: new Date(Date.now() + 86400000).toISOString(),
  })).order;
  assert.equal(data.products[0].stock_kg, 2); assert.equal(data.order_items[0].product_id, batch.id);
  assert.equal(data.orders[0].delivery_latitude, 14.1); assert.equal(data.orders[0].total_amount, 120);
  await call('put /api/orders/:id/approve', 'hub', {}, order.id);
  assert.equal(data.deliveries[0].order_id, order.id); assert.equal(data.deliveries[0].status, 'pending');

  // Order-level rider assignment idempotency: repeated assignment requests
  // (double click, network retry) must not create conflicting assignments.
  await call('put /api/orders/:id/assign', 'hub', { delivery_personnel_id: 'rider' }, order.id);
  assert.equal(data.orders[0].delivery_personnel_id, 'rider'); assert.equal(data.deliveries[0].status, 'assigned');
  const retrySameRider = await raw('put /api/orders/:id/assign', 'hub', { delivery_personnel_id: 'rider' }, order.id);
  assert.ok(retrySameRider.statusCode < 400, 'retrying the same assignment is a safe no-op'); // idempotent retry succeeds
  const reassignOtherRider = await raw('put /api/orders/:id/assign', 'hub', { delivery_personnel_id: 'other-rider' }, order.id);
  assert.equal(reassignOtherRider.statusCode, 409); // assigning a different rider on top is rejected
  assert.equal(data.orders[0].delivery_personnel_id, 'rider', 'the original rider must remain assigned');
});
