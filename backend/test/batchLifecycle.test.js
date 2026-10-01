const { inventoryRpcStub, syncOrderStock } = require('./inventoryRpcStub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { PGlite } = require('@electric-sql/pglite');
const { vegetableKey, canonicalVegetableName } = require('../lib/vegetables');
const { planFifoDraw, retailerProducts, batchDate } = require('../lib/batches');
const { validateOrderItems } = require('../lib/orderRules');

process.env.CLOUDINARY_CLOUD_NAME = 'veggietrack';
const photo = (name) => `https://res.cloudinary.com/veggietrack/image/upload/v123/batches/${name}.jpg`;
const manilaDay = (daysAgo) => new Date(Date.now() + 8 * 3600000 - daysAgo * 86400000).toISOString().slice(0, 10);

// Runs the real index.js route handlers against an in-memory `products` /
// `orders` store (same approach as crossRoleSmoke.test.js). The two stock RPCs
// mirror sql/stock_safety.sql + sql/batch_lifecycle.sql.
function createApi() {
  let sequence = 0;
  const data = { users: [
    { id: 'hub', role: 'distributor', full_name: 'Distributor' },
    { id: 'juan', role: 'farmer', full_name: 'Farmer Juan', account_status: 'active' },
    { id: 'retailer', role: 'retailer', full_name: 'Retailer' },
  ] };
  const db = { from(table) {
    const rows = data[table] ||= []; const filters = []; let mode = 'read', values, singular = false;
    const query = {
      select() { return query; }, eq(k, v) { filters.push(row => row[k] === v); return query; },
      is(k, v) { filters.push(row => (row[k] ?? null) === v); return query; },
      in(k, list) { filters.push(row => list.includes(row[k])); return query; },
      gt(k, v) { filters.push(row => row[k] > v); return query; }, lt(k, v) { filters.push(row => row[k] < v); return query; },
      order() { return query; }, limit() { return query; },
      insert(v) { mode = 'insert'; values = v; return query; }, update(v) { mode = 'update'; values = v; return query; },
      single() { singular = true; return query; }, maybeSingle() { singular = true; return query; },
      then(resolve, reject) {
        let result = rows.filter(row => filters.every(filter => filter(row)));
        if (mode === 'insert') {
          result = (Array.isArray(values) ? values : [values]).map(value => ({
            id: `${table}-${++sequence}`, created_at: new Date(Date.UTC(2026, 0, 1) + sequence * 1000).toISOString(), ...value,
          }));
          rows.push(...result);
        }
        if (mode === 'update') for (const row of result) {
          const before = { ...row }; Object.assign(row, values);
          const error = table === 'orders' && syncOrderStock(data, before, row);
          if (error) { Object.assign(row, before); return Promise.resolve({ data: null, error }).then(resolve, reject); }
        }
        const copies = result.map(row => ({ ...row }));
        return Promise.resolve({ data: singular ? copies[0] || null : copies, error: null }).then(resolve, reject);
      },
    }; return query;
  },
  async rpc(name, args) {
    const inventoryResult = inventoryRpcStub(data, name, args, () => `order-${++sequence}`);
    if (inventoryResult) return inventoryResult;
    const row = (data.products || []).find(p => p.id === args.p_product_id);
    if (name === 'decrement_product_stock') {
      if (!row || row.status !== 'listed' || Number(args.p_quantity) <= 0 || Number(row.stock_kg) < Number(args.p_quantity)) return { data: null, error: null };
      row.stock_kg = Math.round((Number(row.stock_kg) - Number(args.p_quantity)) * 1000) / 1000;
      row.status = row.stock_kg <= 0 ? 'sold_out' : 'listed';
      return { data: { ...row }, error: null };
    }
    if (name === 'restore_product_stock') {
      if (!row || Number(args.p_quantity) <= 0) return { data: null, error: null };
      row.stock_kg = Number(row.stock_kg) + Number(args.p_quantity);
      row.status = { sold_out: 'listed', archived: 'received' }[row.status] || row.status;
      return { data: { ...row }, error: null };
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
  async function raw(key, userId, body = {}, id) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
    const user = data.users.find(row => row.id === userId);
    await handlers.get(key)({ user: { userId, role: user?.role }, body, params: { id }, query: {} }, res);
    return res;
  }
  async function call(key, userId, body, id) {
    const res = await raw(key, userId, body, id);
    assert.ok(res.statusCode < 400, `${key}: ${JSON.stringify(res.body)}`);
    return res.body;
  }
  const batch = id => data.products.find(p => p.id === id);
  const addBatch = async (vegetable_name, stock_kg, { harvestDaysAgo = 3, photoName = 'batch', price = 50, farmer_name = 'Farmer Juan' } = {}) => (await call('post /api/products', 'hub', {
    vegetable_name, price_per_kg: price, stock_kg, batch_photo_url: photo(photoName), farmer_name,
    harvest_date: manilaDay(harvestDaysAgo), pickup_date: manilaDay(Math.max(0, harvestDaysAgo - 1)),
  })).product;
  const buy = (vegetable_name, quantity_kg) => raw('post /api/orders', 'retailer', {
    items: [{ vegetable_name, quantity_kg }], delivery_address: 'Store', delivery_latitude: 14.1, delivery_longitude: 121.2,
    preferred_schedule: new Date(Date.now() + 86400000).toISOString(),
  });
  const approve = order => raw('put /api/orders/:id/approve', 'hub', {}, order.id);
  const buyApproved = async (vegetable_name, quantity_kg) => {
    const res = await buy(vegetable_name, quantity_kg);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal((await approve(res.body.order)).statusCode, 200);
    return res.body.order;
  };
  const shop = () => call('get /api/products/available', 'retailer');
  const stocks = () => call('get /api/products', 'hub');
  const report = () => call('get /api/distributor/inventory-report', 'hub');
  return { data, raw, call, batch, addBatch, buy, approve, buyApproved, shop, stocks, report };
}

test('English and Tagalog spellings of a vegetable share one key and one display name', () => {
  assert.equal(vegetableKey('Kamatis'), vegetableKey('tomato'));
  assert.equal(vegetableKey(' Tomatoes '), 'tomato');
  assert.equal(canonicalVegetableName('kalabasa'), 'Squash');
  assert.equal(canonicalVegetableName('Talbos ng Kamote'), 'Sweet Potato Leaves');
  assert.notEqual(vegetableKey('Talbos ng Kamote'), vegetableKey('Kamote'));
  assert.deepEqual(validateOrderItems([{ vegetable_name: 'Squash', quantity_kg: 3 }, { vegetable_name: 'Kalabasa', quantity_kg: 4 }]),
    [{ vegetable_name: 'Squash', quantity_kg: 7 }]);
});

test('FIFO plan draws the oldest harvest first, then the earliest-added batch on the same day', () => {
  const batches = [
    { id: 'b', status: 'listed', stock_kg: 13, harvest_date: '2026-09-19T04:00:00Z', created_at: '2026-09-19T05:00:00Z' },
    { id: 'a', status: 'listed', stock_kg: 26, harvest_date: '2026-09-18T04:00:00Z', created_at: '2026-09-20T05:00:00Z' },
    { id: 'sold', status: 'sold_out', stock_kg: 0, harvest_date: '2026-09-01T04:00:00Z' },
  ];
  const { available, draws } = planFifoDraw(batches, 30);
  assert.equal(available, 39);
  assert.deepEqual(draws.map(d => [d.batch.id, d.quantity_kg]), [['a', 26], ['b', 4]]);
  assert.equal(planFifoDraw(batches, 40).draws, null);
  const sameDay = [
    { id: 'z', status: 'listed', stock_kg: 5, harvest_date: '2026-09-18T04:00:00Z', created_at: '2026-09-18T09:00:00Z' },
    { id: 'y', status: 'listed', stock_kg: 5, harvest_date: '2026-09-18T04:00:00Z', created_at: '2026-09-18T08:00:00Z' },
  ];
  assert.equal(planFifoDraw(sameDay, 5).draws[0].batch.id, 'y');
});

test('retailer aggregation: one entry per vegetable, sold-out and archived batches add no stock', () => {
  const products = retailerProducts([
    { id: '1', vegetable_name: 'Squash', status: 'listed', stock_kg: 500, price_per_kg: 30, batch_photo_url: photo('s1') },
    { id: '2', vegetable_name: 'Kalabasa', status: 'listed', stock_kg: 150, price_per_kg: 30, batch_photo_url: photo('s2') },
    { id: '3', vegetable_name: 'cucumber', status: 'sold_out', stock_kg: 0, price_per_kg: 40, batch_photo_url: photo('c1') },
    { id: '4', vegetable_name: 'Carrot', status: 'archived', stock_kg: 0, price_per_kg: 20 },
    { id: '5', vegetable_name: 'Okra', status: 'received', stock_kg: 9, price_per_kg: null },
  ]);
  assert.deepEqual(products.map(p => [p.vegetable_name, p.available_kg]), [['Squash', 650]], 'sold-out, archived and received stock is not offered');
  assert.deepEqual(products[0].batch_photos, [photo('s1'), photo('s2')]);
});

test('batch dates accept real calendar days only', () => {
  assert.equal(batchDate('2026-02-30'), null);
  assert.equal(batchDate('20-09-2026'), null);
  assert.equal(batchDate('2026-09-20').iso, '2026-09-20T04:00:00.000Z');
});

test('Scenario A: a single batch sells out, leaves the retailer list and active stock, and never returns to approval', async () => {
  const api = createApi();
  const a = await api.addBatch('Tomato', 20);
  assert.deepEqual((await api.shop()).map(p => [p.vegetable_name, p.available_kg]), [['Tomato', 20]]);

  await api.buyApproved('Tomato', 20);
  assert.equal(api.batch(a.id).stock_kg, 0);
  assert.equal(api.batch(a.id).status, 'sold_out');
  assert.deepEqual(await api.shop(), [], 'a sold-out Tomato is no longer offered to retailers');
  assert.equal((await api.stocks()).length, 0, 'sold-out batch left Stocks (Batches and Products)');
  const rows = (await api.report()).filter(r => r.batch_id === a.id);
  assert.ok(rows.length > 0 && rows.every(r => r.batch_status === 'sold_out'));
  assert.equal((await api.buy('Tomato', 5)).statusCode, 409, 'nothing left to sell');

  // A sold-out batch cannot be listed again or returned to Stocks.
  assert.equal((await api.raw('put /api/products/:id/list', 'hub', { price_per_kg: 50 }, a.id)).statusCode, 400);
  const listing = (await api.call('get /api/products/listings', 'hub'))[0];
  assert.equal(listing.status, 'Sold Out');
  await api.call('put /api/products/:id/unlist', 'hub', {}, listing.id);
  assert.equal(api.batch(a.id).status, 'archived');
  assert.equal((await api.stocks()).length, 0, 'removing the product does not return a sold-out batch to Stocks');
  assert.equal((await api.shop()).length, 0);
  assert.equal((await api.raw('put /api/products/:id/list', 'hub', { price_per_kg: 50 }, a.id)).statusCode, 400);
  assert.equal((await api.raw('delete /api/products/:id', 'hub', {}, a.id)).statusCode, 400, 'history is never deleted');
});

test('Scenarios B, C, E: two batches show as one product, FIFO takes the oldest first, photos follow their batches', async () => {
  const api = createApi();
  const a = await api.addBatch('Tomato', 26, { harvestDaysAgo: 4, photoName: 'photo-a' });
  const b = await api.addBatch('Kamatis', 13, { harvestDaysAgo: 2, photoName: 'photo-b', price: 99 });
  assert.equal(api.batch(b.id).price_per_kg, 50, 'a new batch takes the price already on sale');
  assert.equal(api.batch(b.id).vegetable_name, 'Kamatis', 'each batch keeps its own record');

  let shop = await api.shop();
  assert.equal(shop.length, 1, 'only one Tomato listing');
  assert.equal(shop[0].available_kg, 39);
  assert.deepEqual(shop[0].batch_photos, [photo('photo-a'), photo('photo-b')]);
  assert.equal(shop[0].batch_id, undefined, 'retailers never see batch ids');

  await api.buyApproved('Tomato', 30);
  assert.deepEqual([api.batch(a.id).stock_kg, api.batch(a.id).status], [0, 'sold_out']);
  assert.deepEqual([api.batch(b.id).stock_kg, api.batch(b.id).status], [9, 'listed']);
  assert.deepEqual(api.data.order_items.map(i => [i.product_id, i.quantity_kg]), [[a.id, 26], [b.id, 4]]);
  shop = await api.shop();
  assert.deepEqual(shop.map(p => [p.vegetable_name, p.available_kg]), [['Tomato', 9]]);
  assert.deepEqual(shop[0].batch_photos, [photo('photo-b')], 'only the photo of the batch still on sale');
  assert.deepEqual((await api.stocks()).map(s => s.id), [b.id]);
  const statuses = Object.fromEntries((await api.report()).map(r => [r.batch_id, r.batch_status]));
  assert.deepEqual(statuses, { [a.id]: 'sold_out', [b.id]: 'listed' });
});

test('Scenario D: a new batch after selling out becomes the stock behind the same Tomato listing', async () => {
  const api = createApi();
  await api.addBatch('Tomato', 26, { harvestDaysAgo: 5 });
  await api.addBatch('Tomato', 13, { harvestDaysAgo: 4 });
  await api.buyApproved('Tomato', 39);
  assert.deepEqual(await api.shop(), []);

  const c = await api.addBatch('Tomato', 18, { harvestDaysAgo: 1 });
  assert.deepEqual((await api.shop()).map(p => [p.vegetable_name, p.available_kg]), [['Tomato', 18]]);
  assert.deepEqual((await api.call('get /api/products/listings', 'hub')).map(l => [l.vegetable_name, l.available_kg, l.status]), [['Tomato', 18, 'Listed']]);
  assert.deepEqual((await api.stocks()).map(s => s.id), [c.id]);
});

test('an older batch reduced to exactly 0 kg leaves the retailer list; the next FIFO batch takes over as one Tomato entry', async () => {
  const api = createApi();
  const first = await api.addBatch('Tomato', 10, { harvestDaysAgo: 5, photoName: 'batch-a' });
  const next = await api.addBatch('Kamatis', 30, { harvestDaysAgo: 1, photoName: 'batch-b' });
  const listing = (await api.call('get /api/products/listings', 'hub'))[0];
  await api.call('put /api/products/:id/reduce-quantity', 'hub', { new_total_kg: 30 }, listing.id);
  assert.deepEqual([api.batch(first.id).stock_kg, api.batch(first.id).status], [0, 'sold_out']);

  const shop = await api.shop();
  assert.deepEqual(shop.map(p => [p.vegetable_name, p.available_kg, p.batch_photos]), [['Tomato', 30, [photo('batch-b')]]]);
  assert.deepEqual((await api.stocks()).map(s => s.id), [next.id], 'the sold-out batch is not back in Stocks');
  assert.equal((await api.raw('put /api/products/:id/list', 'hub', { price_per_kg: 50 }, first.id)).statusCode, 400);
  assert.equal((await api.report()).find(r => r.batch_id === first.id).batch_status, 'sold_out', 'it stays in the inventory history');

  await api.buyApproved('Tomato', 12);
  assert.deepEqual([api.batch(next.id).stock_kg, api.batch(first.id).stock_kg], [18, 0], 'the next batch is drawn');
  assert.deepEqual((await api.shop()).map(p => [p.vegetable_name, p.available_kg]), [['Tomato', 18]]);
});

test('Scenario F: farmer, harvest date and pickup date entered on Add New Product reach Stocks and Inventory', async () => {
  const api = createApi();
  const carrot = await api.addBatch('Carrot', 12, { harvestDaysAgo: 3 });
  const [stock] = await api.stocks();
  assert.equal(stock.farmer_name, 'Farmer Juan');
  assert.equal(stock.harvest_date, `${manilaDay(3)}T04:00:00.000Z`);
  assert.equal(stock.pickup_date, `${manilaDay(2)}T04:00:00.000Z`);
  const [row] = (await api.report()).filter(r => r.batch_id === carrot.id);
  assert.deepEqual([row.product, row.farmer_name, row.harvest_date, row.pickup_date],
    ['Carrot', 'Farmer Juan', stock.harvest_date, stock.pickup_date]);
  assert.deepEqual([row.batch_id, row.quantity_received, row.remaining_quantity, row.batch_photo_url, row.batch_status],
    [carrot.id, 12, 12, photo('batch'), 'listed']);
  // A second Carrot batch keeps its own details; the first is untouched.
  await api.addBatch('Carrot', 4, { harvestDaysAgo: 1 });
  assert.equal(api.batch(carrot.id).harvest_date, stock.harvest_date);
  assert.equal(api.batch(carrot.id).stock_kg, 12);

  // The farmer is optional free text, stored as typed; no farmer account is required.
  assert.deepEqual([api.batch(carrot.id).farmer_name, api.batch(carrot.id).farmer_id], ['Farmer Juan', undefined]);
  const blank = await api.addBatch('Okra', 6, { farmer_name: '   ' });
  assert.equal(api.batch(blank.id).farmer_name, null, 'a blank farmer is saved as empty');
  assert.equal((await api.stocks()).find(s => s.id === blank.id).farmer_name, null);
  assert.equal((await api.report()).find(r => r.batch_id === blank.id).farmer_name, null);
  const typed = await api.addBatch('Okra', 6, { farmer_name: '  Maria dela Cruz ' });
  assert.equal(api.batch(typed.id).farmer_name, 'Maria dela Cruz');
  const base = { vegetable_name: 'Carrot', price_per_kg: 20, stock_kg: 5, batch_photo_url: photo('x'), harvest_date: manilaDay(2), pickup_date: manilaDay(1) };
  assert.equal((await api.raw('post /api/products', 'hub', base)).statusCode, 201, 'no farmer at all is fine');
  for (const [change, field] of [
    [{ farmer_name: 42 }, 'farmer_name'], [{ farmer_name: 'x'.repeat(121) }, 'farmer_name'],
    [{ harvest_date: '' }, 'harvest_date'], [{ pickup_date: manilaDay(3) }, 'pickup_date'],
    [{ harvest_date: manilaDay(-2), pickup_date: manilaDay(-1) }, 'pickup_date'],
  ]) {
    const res = await api.raw('post /api/products', 'hub', { ...base, ...change });
    assert.equal(res.statusCode, 400, JSON.stringify(change));
    assert.equal(res.body.field, field);
  }
});

test('pending orders hold no stock: declining or cancelling leaves every batch unchanged', async () => {
  const api = createApi();
  const a = await api.addBatch('Pechay', 10);
  const declined = (await api.buy('Pechay', 10)).body.order;
  const cancelled = (await api.buy('Pechay', 6)).body.order;
  assert.deepEqual([api.batch(a.id).stock_kg, api.batch(a.id).status], [10, 'listed'], 'placing orders draws nothing');
  assert.equal((await api.shop())[0].available_kg, 10);
  await api.call('put /api/orders/:id/cancel', 'hub', { reason: 'Out of delivery range' }, declined.id);
  await api.call('put /api/orders/:id/cancel', 'retailer', {}, cancelled.id);
  assert.deepEqual([api.batch(a.id).stock_kg, api.batch(a.id).status], [10, 'listed']);
  assert.equal((await api.raw('put /api/orders/:id/approve', 'hub', {}, declined.id)).statusCode, 400);
  assert.equal(api.batch(a.id).stock_kg, 10, 'a declined order can never draw stock');
  const rows = (await api.report()).filter(row => row.batch_id === a.id);
  assert.ok(rows.every(row => row.quantity_sold === 0 && row.total_amount === 0));

  // Remove Product with stock left: the batch goes back to Stocks to be re-added.
  const listing = (await api.call('get /api/products/listings', 'hub'))[0];
  await api.call('put /api/products/:id/unlist', 'hub', {}, listing.id);
  assert.equal(api.batch(a.id).status, 'received');
  assert.deepEqual((await api.stocks()).map(s => s.id), [a.id]);
});

test('approval draws stock once; competing pending orders cannot oversell', async () => {
  const api = createApi();
  const batch = await api.addBatch('Pechay', 10);
  const first = (await api.buy('Pechay', 8)).body.order;
  const second = (await api.buy('Pechay', 8)).body.order;
  assert.equal(api.batch(batch.id).stock_kg, 10, 'both orders can wait as pending');
  assert.equal((await api.approve(first)).statusCode, 200);
  assert.equal(api.batch(batch.id).stock_kg, 2);
  assert.equal((await api.approve(first)).statusCode, 400, 'approving twice is rejected');
  const blocked = await api.approve(second);
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.body.error, 'Not enough stock available to approve this order.');
  assert.equal(api.data.orders.find(o => o.id === second.id).status, 'pending');
  assert.deepEqual([api.batch(batch.id).stock_kg, api.batch(batch.id).status], [2, 'listed']);
  assert.equal((await api.shop())[0].available_kg, 2);
  assert.equal((await api.call('get /api/products/listings', 'hub'))[0].available_kg, 2, 'distributor and retailer agree');
  // An approved order can no longer be cancelled from the app, so its stock stays drawn.
  assert.equal((await api.raw('put /api/orders/:id/cancel', 'retailer', {}, first.id)).statusCode, 400);
  assert.equal(api.batch(batch.id).stock_kg, 2);
  const [sold] = (await api.report()).filter(row => row.batch_id === batch.id);
  assert.deepEqual([sold.quantity_sold, sold.order_status], [8, 'approved']);
});

test('inactive/rejected batches never return to approval; removing received stock preserves history', async () => {
  const api = createApi();
  const batch = await api.addBatch('Tomato', 10);
  for (const status of ['inactive', 'rejected', 'unknown']) {
    api.batch(batch.id).status = status;
    assert.equal((await api.stocks()).length, 0);
    assert.equal((await api.raw('put /api/products/:id/list', 'hub', { price_per_kg: 50 }, batch.id)).statusCode, 400);
    assert.equal((await api.report())[0].batch_status, status);
  }
  api.batch(batch.id).status = 'received';
  await api.call('delete /api/products/:id', 'hub', {}, batch.id);
  assert.equal(api.batch(batch.id).status, 'archived');
  assert.equal((await api.report())[0].remaining_quantity, 10);
  assert.equal((await api.stocks()).length, 0);
});

test('harvest workflow states cannot be reset; ordinary available-harvest edits remain allowed', async () => {
  const api = createApi();
  const harvest = (await api.call('post /api/harvests', 'juan', { vegetable_name: 'Carrot', quantity_kg: 8 })).harvest;
  await api.call('put /api/harvests/:id', 'juan', { quantity_kg: 9 }, harvest.id);
  assert.equal(api.data.harvests[0].quantity_kg, 9);
  api.data.harvests[0].status = 'picked_up';
  const reset = await api.raw('put /api/harvests/:id', 'juan', { status: 'available' }, harvest.id);
  assert.equal(reset.statusCode, 400);
  assert.equal(api.data.harvests[0].status, 'picked_up');
  assert.equal((await api.raw('put /api/harvests/:id', 'juan', { quantity_kg: 20 }, harvest.id)).statusCode, 400);
  await api.call('put /api/harvests/:id', 'juan', { image_url: photo('harvest') }, harvest.id);
  assert.equal(api.data.harvests[0].image_url, photo('harvest'));
  assert.equal((await api.raw('post /api/harvests', 'juan', { vegetable_name: 'Carrot', quantity_kg: 8, status: 'picked_up' })).statusCode, 400);
  assert.equal((await api.raw('post /api/harvests', 'juan', { vegetable_name: 'Carrot', quantity_kg: 0.001 })).statusCode, 400);
});

test('Edit Quantity deducts oldest-first and marks an emptied batch sold out', async () => {
  const api = createApi();
  const a = await api.addBatch('Onion', 5, { harvestDaysAgo: 4 });
  const b = await api.addBatch('Sibuyas', 10, { harvestDaysAgo: 2 });
  const listing = (await api.call('get /api/products/listings', 'hub'))[0];
  assert.deepEqual([listing.vegetable_name, listing.available_kg], ['Onion', 15]);
  await api.call('put /api/products/:id/reduce-quantity', 'hub', { new_total_kg: 8 }, listing.id);
  assert.deepEqual([api.batch(a.id).stock_kg, api.batch(a.id).status], [0, 'sold_out']);
  assert.deepEqual([api.batch(b.id).stock_kg, api.batch(b.id).status], [8, 'listed']);
});

test('batch_lifecycle.sql repairs zero-stock batches, enforces the lifecycle and is safe to re-run', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE pickup_requests(id uuid PRIMARY KEY, received_at timestamptz);
      CREATE TABLE products(id uuid PRIMARY KEY, vegetable_name text, stock_kg numeric NOT NULL, status text,
        updated_at timestamptz, harvest_date timestamptz, pickup_request_id uuid, quantity_received numeric);
      INSERT INTO pickup_requests VALUES ('00000000-0000-0000-0000-0000000000aa', '2026-09-20T02:00:00Z');
      INSERT INTO products(id, vegetable_name, stock_kg, status, pickup_request_id, harvest_date) VALUES
        ('00000000-0000-0000-0000-000000000001', 'cucumber', 0, 'listed', '00000000-0000-0000-0000-0000000000aa', '2026-09-19T00:00:00Z'),
        ('00000000-0000-0000-0000-000000000002', 'Tomato', 0, 'received', NULL, NULL),
        ('00000000-0000-0000-0000-000000000003', 'Squash', 500, 'listed', NULL, NULL),
        ('00000000-0000-0000-0000-000000000004', 'Okra', 8, 'received', NULL, NULL),
        ('00000000-0000-0000-0000-000000000005', 'Pipino', 0, 'sold_out', NULL, NULL);
    `);
    await db.exec(fs.readFileSync(path.join(__dirname, '../sql/stock_safety.sql'), 'utf8'));
    const migration = fs.readFileSync(path.join(__dirname, '../sql/batch_lifecycle.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // re-run is a no-op

    const rows = Object.fromEntries((await db.query('SELECT id, status, stock_kg, created_at FROM products')).rows.map(r => [r.id.slice(-1), r]));
    assert.deepEqual(Object.fromEntries(Object.entries(rows).map(([k, r]) => [k, r.status])), { 1: 'sold_out', 2: 'archived', 3: 'listed', 4: 'received', 5: 'sold_out' });
    assert.equal(new Date(rows[1].created_at).toISOString(), '2026-09-20T02:00:00.000Z', 'created_at backfilled from the pickup');
    assert.ok(Object.values(rows).every(r => r.created_at), 'every batch has a created_at');
    const cols = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'products'")).rows.map(r => r.column_name);
    assert.ok(cols.includes('pickup_date'));

    const soldOut = '00000000-0000-0000-0000-000000000001';
    await assert.rejects(db.query("UPDATE products SET status = 'received' WHERE id = $1", [soldOut]), /products_active_batch_has_stock/);
    await assert.rejects(db.query("UPDATE products SET status = 'listed' WHERE id = $1", [soldOut]), /products_active_batch_has_stock/);
    await assert.rejects(db.query("UPDATE products SET status = 'pending' WHERE id = $1", ['00000000-0000-0000-0000-000000000003']), /products_status_valid/);

    const call = (fn, id, qty) => db.query(`SELECT to_jsonb(${fn}($1,$2)) AS r`, [id, qty]).then(r => r.rows[0].r);
    assert.equal((await call('restore_product_stock', soldOut, 3)).status, 'listed');
    assert.equal(await call('decrement_product_stock', '00000000-0000-0000-0000-000000000004', 3), null, 'a received batch is never sold from');
    assert.deepEqual((await db.query("SELECT status, stock_kg FROM products WHERE id = '00000000-0000-0000-0000-000000000004'")).rows.map(r => [r.status, Number(r.stock_kg)]), [['received', 8]]);
    const drained = await call('decrement_product_stock', '00000000-0000-0000-0000-000000000003', 500);
    assert.deepEqual([Number(drained.stock_kg), drained.status], [0, 'sold_out']);
  } finally { await db.close(); }
});
