const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Stateful HTTP-handler smoke: data produced by one role is consumed by the next.
// Database transaction/authorization semantics have separate PostgreSQL/security tests.
test('farmer 8 kg harvest -> assigned pickup -> received batch -> listed menu -> retailer checkout and approval', async () => {
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
  } };
  const handlers = new Map(); const app = { use() {}, listen() {} };
  for (const method of ['get', 'post', 'put', 'delete']) app[method] = (route, ...callbacks) => handlers.set(`${method} ${route}`, callbacks.at(-1));
  const express = Object.assign(() => app, { json: () => () => {}, raw: () => () => {} });
  const realRequire = createRequire(path.join(__dirname, '../index.js'));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), {
    require: name => name === 'express' ? express : name === 'dotenv' ? { config() {} } : name === '@supabase/supabase-js' ? { createClient: () => db } : realRequire(name),
    process: { env: {} }, console, Date, URL, setTimeout, clearTimeout,
  });
  async function call(key, userId, body = {}, id) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const user = data.users.find(row => row.id === userId);
    await handlers.get(key)({ user: { userId, role: user?.role }, body, params: { id }, query: {} }, res);
    assert.ok(res.statusCode < 400, `${key}: ${JSON.stringify(res.body)}`);
    return res.body;
  }
  const harvest = (await call('post /api/harvests', 'farmer', { vegetable_name: 'Carrot', quantity_kg: 8 })).harvest;
  const pickup = (await call('post /api/pickup-requests', 'farmer', { harvest_id: harvest.id })).request;
  await call('put /api/pickup-requests/:id/assign', 'hub', { delivery_personnel_id: 'rider', price_per_kg: 10 }, pickup.id);
  await call('post /api/pickup-requests/:id/pickup', 'rider', {}, pickup.id);
  const batch = data.products[0];
  assert.equal(batch.status, 'received'); assert.equal(batch.harvest_id, harvest.id); assert.equal(batch.farmer_id, 'farmer');
  assert.equal((await call('get /api/products/available', 'retailer')).length, 0);
  await call('put /api/products/:id/list', 'hub', { price_per_kg: 20 }, batch.id);
  const menu = await call('get /api/products/available', 'retailer');
  assert.equal(menu[0].available_kg, 8);
  const order = (await call('post /api/orders', 'retailer', {
    items: [{ vegetable_name: 'Carrot', quantity_kg: 6 }], delivery_address: 'Store',
    delivery_latitude: 14.1, delivery_longitude: 121.2,
    preferred_schedule: new Date(Date.now() + 86400000).toISOString(),
  })).order;
  assert.equal(data.products[0].stock_kg, 2); assert.equal(data.order_items[0].product_id, batch.id);
  assert.equal(data.orders[0].delivery_latitude, 14.1); assert.equal(data.orders[0].total_amount, 120);
  await call('put /api/orders/:id/approve', 'hub', {}, order.id);
  assert.equal(data.deliveries[0].order_id, order.id); assert.equal(data.deliveries[0].status, 'pending');
});
