const { inventoryRpcStub, syncOrderStock, syncHarvest } = require('./inventoryRpcStub');
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
    { id: 'rider', role: 'delivery_personnel', full_name: 'Rider', account_status: 'active', is_available_for_delivery: true },
    { id: 'retailer', role: 'retailer', full_name: 'Retailer' },
  ] };
  const db = { from(table) {
    const rows = data[table] ||= []; const filters = []; let mode = 'read', values, singular = false;
    const query = {
      select() { return query; }, eq(k, v) { filters.push(row => row[k] === v); return query; },
      // Treat an absent key as NULL, matching a Postgres column default of NULL.
      is(k, v) { filters.push(row => (row[k] ?? null) === v); return query; },
      in(k, values) { filters.push(row => values.includes(row[k])); return query; },
      gt(k, v) { filters.push(row => row[k] > v); return query; }, order() { return query; }, limit() { return query; },
      insert(v) { mode = 'insert'; values = v; return query; }, update(v) { mode = 'update'; values = v; return query; },
      single() { singular = true; return query; }, maybeSingle() { singular = true; return query; },
      then(resolve, reject) {
        let result = rows.filter(row => filters.every(filter => filter(row)));
        if (mode === 'insert') { result = (Array.isArray(values) ? values : [values]).map(value => ({ id: `id-${++sequence}`, recorded_at: new Date().toISOString(), ...value })); rows.push(...result); }
        if (mode === 'update') for (const row of result) {
          const before = { ...row }; Object.assign(row, values);
          const error = table === 'orders' && syncOrderStock(data, before, row);
          if (error) { Object.assign(row, before); return Promise.resolve({ data: null, error }).then(resolve, reject); }
        }
        const joined = result.map(row => table === 'pickup_requests' ? { ...row, harvests: data.harvests?.find(h => h.id === row.harvest_id) } : { ...row });
        return Promise.resolve({ data: singular ? joined[0] || null : joined, error: null }).then(resolve, reject);
      },
    }; return query;
  },
  // In-memory versions of the sql/stock_safety.sql and sql/pickup_tracking_proof.sql
  // RPCs, so the real route handlers run end to end.
  async rpc(name, args) {
    const inventoryResult = inventoryRpcStub(data, name, args, () => `order-${++sequence}`);
    if (inventoryResult) return inventoryResult;
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
      const harvest = data.harvests.find(h => h.id === row.harvest_id);
      if (harvest) {
        // Same as the receive_pickup_inventory trigger: the batch holds the requested kg.
        const received = row.quantity_kg ?? harvest.quantity_kg;
        (data.products ||= []).push({ id: `batch-${++sequence}`, distributor_id: row.received_by,
          vegetable_name: harvest.vegetable_name, stock_kg: received,
          quantity_received: received, price_per_kg: null, status: 'received',
          harvest_id: harvest.id, farmer_id: row.farmer_id, pickup_request_id: row.id,
          harvest_date: harvest.recorded_at, pickup_date: row.received_at, created_at: row.received_at });
        syncHarvest(data, harvest);
      }

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
    process: { env: { CLOUDINARY_CLOUD_NAME: 'veggietrack' }, on() {} }, console, Date, URL, setTimeout, clearTimeout,
  });
  async function raw(key, userId, body = {}, id, query = {}) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const user = data.users.find(row => row.id === userId);
    await handlers.get(key)({ user: { userId, role: user?.role }, body, params: { id }, query }, res);
    return res;
  }
  async function call(key, userId, body = {}, id) {
    const res = await raw(key, userId, body, id);
    assert.ok(res.statusCode < 400, `${key}: ${JSON.stringify(res.body)}`);
    return res.body;
  }
  const harvest = (await call('post /api/harvests', 'farmer', { vegetable_name: 'Carrot', quantity_kg: 10 })).harvest;
  // The farmer must give a quantity within the harvest and a price per kg.
  for (const [body, field] of [[{}, 'quantity_kg'], [{ quantity_kg: 0, price_per_kg: 35 }, 'quantity_kg'],
    [{ quantity_kg: -2, price_per_kg: 35 }, 'quantity_kg'], [{ quantity_kg: 11, price_per_kg: 35 }, 'quantity_kg'],
    [{ quantity_kg: 8, price_per_kg: 0 }, 'price_per_kg'], [{ quantity_kg: 8, price_per_kg: 'abc' }, 'price_per_kg']]) {
    const rejected = await raw('post /api/pickup-requests', 'farmer', { harvest_id: harvest.id, ...body });
    assert.equal(rejected.statusCode, 422, JSON.stringify(body)); assert.equal(rejected.body.field, field);
  }
  assert.equal((data.pickup_requests || []).length, 0);
  const pickup = (await call('post /api/pickup-requests', 'farmer', { harvest_id: harvest.id, quantity_kg: 8, price_per_kg: 35 })).request;
  assert.deepEqual([pickup.status, pickup.quantity_kg, pickup.price_per_kg], ['requested', 8, 35]);
  // Duplicate protection: a double-tap / retried pickup request for the same
  // harvest must not create a second active request.
  const dupePickup = await raw('post /api/pickup-requests', 'farmer', { harvest_id: harvest.id, quantity_kg: 2, price_per_kg: 35 });
  assert.equal(dupePickup.statusCode, 409);
  assert.equal(data.pickup_requests.filter(p => p.harvest_id === harvest.id).length, 1);
  const farmerHarvest = (await call('get /api/harvests', 'farmer')).find(h => h.id === harvest.id);
  assert.deepEqual([farmerHarvest.status, farmerHarvest.requested_kg, farmerHarvest.available_kg], ['for_pickup', 8, 2]);

  // The distributor sees the farmer's quantity, price and total before approving.
  const pending = (await call('get /api/pickup-requests', 'hub')).find(p => p.id === pickup.id);
  assert.deepEqual([pending.farmer_name, pending.harvests.vegetable_name, pending.quantity_kg, pending.price_per_kg, pending.estimated_total, pending.status],
    ['Farmer', 'Carrot', 8, 35, 280, 'requested']);
  await call('put /api/pickup-requests/:id/approve', 'hub', {}, pickup.id);
  assert.equal(data.pickup_requests.find(p => p.id === pickup.id).status, 'approved');
  assert.equal((await raw('put /api/pickup-requests/:id/assign', 'hub', { delivery_personnel_id: 'retailer' }, pickup.id)).statusCode, 400, 'only riders can be assigned');
  await call('put /api/pickup-requests/:id/assign', 'hub', { delivery_personnel_id: 'rider' }, pickup.id);
  // Rider assignment idempotency: a duplicate/retried assign call is rejected
  // once the pickup is already assigned, and the original rider stays assigned.
  assert.equal((await raw('put /api/pickup-requests/:id/decline', 'hub', { reason: 'late' }, pickup.id)).statusCode, 409);
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
  // One batch with the requested 8 kg; the other 2 kg stay with the farmer.
  assert.deepEqual([data.products.length, batch.stock_kg, batch.quantity_received], [1, 8, 8]);
  assert.equal(data.harvests.find(h => h.id === harvest.id).status, 'available');
  const completed = (await call('get /api/pickup-requests', 'hub')).find(p => p.id === pickup.id);
  assert.deepEqual([completed.status, completed.batch_id, completed.rider_name], ['picked_up', batch.id, 'Rider']);
  // Farmer, rider and distributor read the same pickup row, so all see it picked up.
  for (const role of ['farmer', 'rider']) assert.equal((await call('get /api/pickup-requests', role)).find(p => p.id === pickup.id).status, 'picked_up', role);
  // A retried completion (lost response, double tap) changes nothing: no second batch or notification.
  const noticesBefore = data.notifications.length;
  global.fetch = async () => ({ ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }) });
  try {
    const again = await call('post /api/pickup-requests/:id/pickup', 'rider', {
      proof_photo_url: pickupProofPhoto, latitude: 14.1, longitude: 121.2, accuracy: 10, captured_at: new Date().toISOString(),
    }, pickup.id);
    assert.equal(again.message, 'Pickup already completed');
  } finally { global.fetch = realFetch; }
  assert.deepEqual([data.products.length, data.notifications.length], [1, noticesBefore]);
  // The farmer requests the rest; the distributor declines it with a reason.
  const rest = (await call('post /api/pickup-requests', 'farmer', { harvest_id: harvest.id, quantity_kg: 2, price_per_kg: 40 })).request;
  assert.equal((await raw('put /api/pickup-requests/:id/decline', 'hub', { reason: '  ' }, rest.id)).statusCode, 400);
  await call('put /api/pickup-requests/:id/decline', 'hub', { reason: 'Too little to collect' }, rest.id);
  const declined = (await call('get /api/pickup-requests', 'farmer')).find(p => p.id === rest.id);
  assert.deepEqual([declined.status, declined.decline_reason], ['declined', 'Too little to collect']);
  assert.equal((await call('get /api/harvests', 'farmer')).find(h => h.id === harvest.id).available_kg, 2);
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
  // A pending order holds no stock; approval draws it from the batch once.
  assert.equal(data.products[0].stock_kg, 8); assert.equal(data.order_items[0].product_id, null);
  assert.equal((await call('get /api/products/available', 'retailer'))[0].available_kg, 8);
  assert.equal(data.orders[0].delivery_latitude, 14.1); assert.equal(data.orders[0].total_amount, 120);
  await call('put /api/orders/:id/approve', 'hub', {}, order.id);
  assert.equal(data.products[0].stock_kg, 2); assert.equal(data.order_items[0].product_id, batch.id);
  assert.equal((await call('get /api/products/available', 'retailer'))[0].available_kg, 2);
  assert.equal((await raw('put /api/orders/:id/approve', 'hub', {}, order.id)).statusCode, 400);
  assert.equal(data.products[0].stock_kg, 2, 'a repeated approval draws nothing');
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

  // Vegetable Chain Tracking traces the batch from the farmer to the retailer.
  data.orders[0].status = 'delivered'; data.deliveries[0].delivered_at = new Date().toISOString();
  data.deliveries[0].proof_photo_url = 'https://res.cloudinary.com/veggietrack/image/upload/v1/pod.jpg';
  let [traced] = (await call('get /api/distributor/chain-tracking', 'hub')).batches;
  assert.deepEqual([traced.batch_id, traced.farmer_name, traced.pickup.farmer_price_per_kg, traced.pickup.estimated_total,
    traced.pickup.rider_name, traced.pickup.proof_photo_url], [batch.id, 'Farmer', 35, 280, 'Rider', data.pickup_requests.find(p => p.id === pickup.id).proof_photo_url]);
  assert.ok(traced.pickup.proof_photo_url.endsWith('/v123/pickups/carrot-proof.jpg'));
  assert.deepEqual(traced.sales.map(s => [s.retailer_name, s.quantity_kg, s.stage, s.proof_photo_url]),
    [['Retailer', 6, 'sold', data.deliveries[0].proof_photo_url]]);
  assert.deepEqual(traced.totals, { received: 8, remaining: 2, sold: 6, on_order: 0, not_delivered: 0, spoiled: 0, adjusted: 0 });

  // Discard: the remaining 2 kg leave sale, go to Spoiled Products and never back to Stocks.
  assert.equal((await raw('post /api/products/:id/discard', 'retailer', {}, batch.id)).statusCode, 403);
  const discard = await call('post /api/products/:id/discard', 'hub', {}, batch.id);
  assert.deepEqual([discard.spoilage.reason, discard.spoilage.quantity_kg], ['discarded', 2]);
  assert.deepEqual([data.products[0].stock_kg, data.products[0].status], [0, 'spoiled']);
  assert.equal((await call('get /api/products/available', 'retailer')).length, 0);
  assert.equal((await call('get /api/products', 'hub')).length, 0, 'not in Stocks or Stock to Approve');
  [traced] = (await call('get /api/distributor/chain-tracking', 'hub')).batches;
  assert.deepEqual([traced.status, traced.totals.remaining, traced.totals.sold, traced.totals.spoiled], ['spoiled', 0, 6, 2]);
  const spoiled = await call('get /api/distributor/spoilage', 'hub');
  assert.deepEqual(spoiled.records.map(r => [r.batch_id, r.vegetable_name, r.farmer_name, r.quantity_kg, r.reason]), [[batch.id, 'Carrot', 'Farmer', 2, 'discarded']]);
  assert.equal(spoiled.this_week.kg, 2);

  // Reports: received, sold and spoiled kilograms within the chosen dates only.
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const report = await call('get /api/distributor/chain-report', 'hub');
  assert.deepEqual(report.summary, { received_kg: 8, sold_kg: 6, spoiled_kg: 2, sales_total: 120, completed_transactions: 1, batches: 1 });
  const lastYear = await raw('get /api/distributor/chain-report', 'hub', {}, undefined, { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual([lastYear.body.events.length, lastYear.body.summary.received_kg], [0, 0]);
  const todayOnly = await raw('get /api/distributor/chain-report', 'hub', {}, undefined, { from: today, to: today });
  assert.deepEqual(todayOnly.body.events.map(e => e.type).sort(), ['received', 'sold', 'spoiled']);
  assert.equal((await raw('get /api/distributor/chain-report', 'hub', {}, undefined, { from: today, to: '2025-01-01' })).statusCode, 400);
  assert.deepEqual(report.vegetables, ['Carrot']);
  const carrot = await raw('get /api/distributor/chain-report', 'hub', {}, undefined, { from: today, to: today, vegetable: 'Carrot' });
  assert.deepEqual([carrot.body.vegetable, carrot.body.summary, carrot.body.events.length], ['Carrot', report.summary, 3]);
  const noTomato = await raw('get /api/distributor/chain-report', 'hub', {}, undefined, { vegetable: 'Tomato' });
  assert.deepEqual([noTomato.body.events.length, noTomato.body.summary.received_kg, noTomato.body.vegetables], [0, 0, ['Carrot']]);

  // 7-day rule. Stock picked up more than 7 days ago cannot be added at all.
  const daysAgo = d => new Date(Date.now() + 8 * 3600000 - d * 86400000).toISOString().slice(0, 10);
  const addStock = (vegetable_name, stock_kg, pickupDaysAgo) => raw('post /api/products', 'hub', {
    vegetable_name, price_per_kg: 30, stock_kg, batch_photo_url: photo, harvest_date: daysAgo(pickupDaysAgo + 1), pickup_date: daysAgo(pickupDaysAgo),
  });
  const tooOld = await addStock('Tomato', 18, 8);
  assert.deepEqual([tooOld.statusCode, tooOld.body.field], [400, 'pickup_date']);
  const tomato = (await addStock('Tomato', 18, 7)).body.product;
  await addStock('Okra', 6, 6);
  // Day 7: still on sale, and the distributor is alerted once (not on every refresh).
  const harvested = new Date(tomato.harvest_date).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
  for (let refresh = 0; refresh < 2; refresh += 1) {
    const alerts = await call('get /api/distributor/stock-alerts', 'hub');
    assert.deepEqual(alerts.map(a => [a.batch_id, a.remaining_kg, a.days_in_stock]), [[tomato.id, 18, 7]]);
    assert.equal(alerts[0].message, `Tomato has 18 kg remaining in stock. Harvested on ${harvested} and has been in stock for 7 days.`);
  }
  assert.equal(data.notifications.filter(n => n.type === 'stock_alert' && n.item_id === tomato.id).length, 1);
  assert.equal((await call('get /api/products/available', 'retailer')).find(p => p.vegetable_name === 'Tomato').available_kg, 18);
  // Day 8: past the spoilage limit. Only a warning: the 18 kg stay in the batch and
  // on sale, and Home, Stocks and the retailer catalogue all show 18 kg. Not spoiled.
  const tomatoBatch = () => data.products.find(p => p.id === tomato.id);
  tomatoBatch().pickup_date = `${daysAgo(8)}T04:00:00.000Z`;
  const tomatoEverywhere = async () => [
    (await call('get /api/products/listings', 'hub')).find(l => l.vegetable_name === 'Tomato'),
    (await call('get /api/products', 'hub')).find(p => p.id === tomato.id),
    (await call('get /api/products/available', 'retailer')).find(p => p.vegetable_name === 'Tomato'),
  ];
  for (let refresh = 0; refresh < 2; refresh += 1) {
    const [home, stocks, shop] = await tomatoEverywhere();
    assert.deepEqual([home.available_kg, home.status, home.needs_review], [18, 'Listed', true], 'Home: 18 kg, Needs Review');
    assert.deepEqual([stocks.stock_kg, stocks.past_limit, stocks.needs_review], [18, true, true], 'Stocks: same batch, Needs Review');
    assert.equal(shop.available_kg, 18, 'retailer: still on sale');
    assert.deepEqual([tomatoBatch().status, tomatoBatch().stock_kg], ['listed', 18]);
    assert.deepEqual((await call('get /api/distributor/stock-alerts', 'hub')).map(a => [a.batch_id, a.remaining_kg, a.past_limit, a.needs_review]), [[tomato.id, 18, true, true]]);
  }
  // Keep/Sell answers the review: still 18 kg on sale everywhere, no alert left.
  assert.equal((await call('post /api/products/:id/keep', 'hub', {}, tomato.id)).product.id, tomato.id);
  await call('post /api/products/:id/keep', 'hub', {}, tomato.id);
  const [keptHome, keptStocks, keptShop] = await tomatoEverywhere();
  assert.deepEqual([keptHome.available_kg, keptHome.needs_review, keptStocks.needs_review, keptStocks.kept_for_sale, keptShop.available_kg], [18, false, false, true, 18]);
  assert.deepEqual(await call('get /api/distributor/stock-alerts', 'hub'), []);
  const keepOther = await raw('post /api/products/:id/keep', 'retailer', {}, tomato.id);
  assert.equal(keepOther.statusCode, 403);
  let spoiledNow = await call('get /api/distributor/spoilage', 'hub');
  assert.deepEqual(spoiledNow.records.map(r => [r.vegetable_name, r.quantity_kg, r.reason]), [['Carrot', 2, 'discarded']]);
  assert.equal(spoiledNow.this_week.kg, 2, 'the 18 kg are not counted as spoiled before a discard');
  const reportBefore = await call('get /api/distributor/chain-report', 'hub');
  assert.equal(reportBefore.summary.spoiled_kg, 2);
  // Only the distributor's discard moves it to Spoiled Products, once.
  const tomatoDiscard = await call('post /api/products/:id/discard', 'hub', {}, tomato.id);
  assert.deepEqual([tomatoDiscard.spoilage.reason, tomatoDiscard.spoilage.quantity_kg, tomatoDiscard.spoilage.recorded_by], ['past_limit', 18, 'hub']);
  await call('post /api/products/:id/discard', 'hub', {}, tomato.id);
  assert.deepEqual([tomatoBatch().status, tomatoBatch().stock_kg], ['spoiled', 0]);
  spoiledNow = await call('get /api/distributor/spoilage', 'hub');
  assert.deepEqual(spoiledNow.records.map(r => [r.vegetable_name, r.quantity_kg, r.reason]), [['Tomato', 18, 'past_limit'], ['Carrot', 2, 'discarded']]);
  assert.equal(spoiledNow.this_week.kg, 20);
  assert.equal((await call('get /api/distributor/chain-report', 'hub')).summary.spoiled_kg, 20, 'report counts it after the discard');
  assert.deepEqual(await call('get /api/distributor/stock-alerts', 'hub'), []);
  assert.deepEqual((await call('get /api/products', 'hub')).map(p => p.vegetable_name), ['Okra']);
  assert.equal((await call('get /api/products/available', 'retailer')).some(p => p.vegetable_name === 'Tomato'), false, 'discarded stock is not sold');
  assert.equal((await raw('post /api/products/:id/keep', 'hub', {}, tomato.id)).statusCode, 409, 'nothing left to keep');
});
