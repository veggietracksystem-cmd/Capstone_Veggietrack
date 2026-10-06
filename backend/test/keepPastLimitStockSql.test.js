const test = require('node:test');
const assert = require('node:assert/strict');
const { id, hub, a, b, migration, rpc, buy, approve, manilaDayStart, stock, items, setup } = require('./inventoryDb');
const {
  retailerProducts, distributorListings, isActiveBatch, isPastSpoilageLimit, needsSpoilageReview, needsStockAlert,
} = require('../lib/batches');

// Real PostgreSQL (PGlite) checks for sql/keep_past_limit_stock.sql: the 7-day limit
// only flags a batch for review. Its stock stays on sale until the distributor
// discards it, and Home, Stocks and the retailer catalogue count the same kilograms.
async function keepSetup() {
  const db = await setup();
  await db.exec(migration('manual_spoilage.sql'));
  await db.exec(migration('keep_past_limit_stock.sql'));
  return db;
}
// A batch that entered stock `days` Philippine calendar days ago (1 am Manila time).
const ageBatch = async (db, batchId, days) => {
  const start = await manilaDayStart(db, -days);
  await db.query("UPDATE products SET created_at = $2::timestamptz + interval '1 hour', pickup_date = NULL WHERE id=$1", [batchId, start]);
};
const batchOf = async (db, batchId) => (await db.query('SELECT * FROM products WHERE id=$1', [batchId])).rows[0];
// Same update as POST /api/products/:id/keep.
const keep = (db, batchId) => db.query('UPDATE products SET kept_for_sale_at = now(), kept_for_sale_by = $2 WHERE id = $1', [batchId, hub]);
const spoilage = db => db.query('SELECT product_id, quantity_kg, reason FROM stock_spoilage ORDER BY recorded_at, id')
  .then(r => r.rows.map(row => [row.product_id, Number(row.quantity_kg), row.reason]));

// The three screens, from the same rows: Home Product List, Stocks (active batches),
// and the retailer catalogue. Returns [kg, status] per screen for one vegetable.
async function screens(db, vegetable = 'Tomato') {
  const rows = await stock(db);
  const home = distributorListings(rows.filter(r => ['listed', 'sold_out'].includes(r.status))).find(l => l.vegetable_name === vegetable);
  const listed = rows.filter(r => isActiveBatch(r) && r.status === 'listed');
  const stocksKg = listed.reduce((sum, r) => sum + Number(r.stock_kg), 0);
  const shop = retailerProducts(rows.filter(r => r.status === 'listed' && Number(r.stock_kg) > 0)).find(p => p.vegetable_name === vegetable);
  return {
    home: home && [home.available_kg, home.status, home.needs_review],
    stocks: [stocksKg, listed.some(r => needsSpoilageReview(r))],
    retailer: shop ? shop.available_kg : 'not offered',
  };
}

// One 5 kg Eggplant batch, as in the reported case.
async function eggplant(db, days) {
  const egg = id(20);
  await db.query(`INSERT INTO products(id, distributor_id, vegetable_name, stock_kg, price_per_kg, quantity_received, status, harvest_date, batch_photo_url)
    VALUES ($1, $2, 'Eggplant', 5, 40, 5, 'listed', now() - interval '20 days', 'photo-e')`, [egg, hub]);
  await ageBatch(db, egg, days);
  return egg;
}

test('1. 5 kg within the limit is available everywhere', async () => {
  const db = await keepSetup();
  try {
    const egg = await eggplant(db, 3);
    assert.equal(needsSpoilageReview(await batchOf(db, egg)), false);
    assert.deepEqual(await screens(db, 'Eggplant'), { home: [5, 'Listed', false], stocks: [44, false], retailer: 5 });
  } finally { await db.close(); }
});

test('2. 5 kg past the limit is Needs Review, not Out of Stock, and can still be bought', async () => {
  const db = await keepSetup();
  try {
    const egg = await eggplant(db, 8);
    const batch = await batchOf(db, egg);
    assert.deepEqual([isPastSpoilageLimit(batch), needsSpoilageReview(batch), needsStockAlert(batch)], [true, true, true]);
    assert.deepEqual((await screens(db, 'Eggplant')).home, [5, 'Listed', true], 'Home: 5 kg, flagged for review');
    assert.equal((await screens(db, 'Eggplant')).retailer, 5, 'retailer still sees the 5 kg');
    // Nothing spoils or zeroes it by age.
    assert.equal((await db.query('SELECT public.spoil_expired_batches() AS n')).rows[0].n, 0);
    assert.deepEqual(await spoilage(db), []);
    const order = await buy(db, 5, [{ vegetable_name: 'Eggplant', quantity_kg: 5 }]);
    await approve(db, order.id);
    assert.deepEqual(await items(db, order.id), [[egg, 5, 40]], 'checkout and approval draw the past-limit batch');
    const sold = await batchOf(db, egg);
    assert.deepEqual([Number(sold.stock_kg), sold.status], [0, 'sold_out']);
  } finally { await db.close(); }
});

test('3. Keep/Sell clears Needs Review and the 5 kg stay available to retailers', async () => {
  const db = await keepSetup();
  try {
    const egg = await eggplant(db, 9);
    await keep(db, egg);
    const batch = await batchOf(db, egg);
    assert.deepEqual([isPastSpoilageLimit(batch), needsSpoilageReview(batch), needsStockAlert(batch)], [true, false, false]);
    assert.deepEqual(await screens(db, 'Eggplant'), { home: [5, 'Listed', false], stocks: [44, false], retailer: 5 });
    // A Keep on day 7 answers only that day's alert: the review still starts on day 8.
    await db.query("UPDATE products SET kept_for_sale_at = created_at + interval '7 days' WHERE id = $1", [egg]);
    assert.equal(needsSpoilageReview(await batchOf(db, egg)), true);
  } finally { await db.close(); }
});

test('4. Discard removes the stock from sale and records it as spoiled', async () => {
  const db = await keepSetup();
  try {
    const egg = await eggplant(db, 8);
    const record = await rpc(db, 'discard_product_stock', [egg, hub]);
    assert.deepEqual([record.product_id, Number(record.quantity_kg), record.reason], [egg, 5, 'past_limit']);
    const batch = await batchOf(db, egg);
    assert.deepEqual([Number(batch.stock_kg), batch.status, Number(batch.quantity_received)], [0, 'spoiled', 5]);
    // Spoiled batches leave every list; nothing of it can be bought.
    assert.deepEqual(await screens(db, 'Eggplant'), { home: undefined, stocks: [39, false], retailer: 'not offered' });
    await assert.rejects(buy(db, 5, [{ vegetable_name: 'Eggplant', quantity_kg: 5 }]), /not enough/);
  } finally { await db.close(); }
});

test('5. 0 kg left is Out of Stock (Sold Out) on Home and not offered to retailers', async () => {
  const db = await keepSetup();
  try {
    const order = await buy(db, 39);
    await approve(db, order.id);
    assert.deepEqual(await screens(db), { home: [0, 'Sold Out', false], stocks: [0, false], retailer: 'not offered' });
  } finally { await db.close(); }
});

test('6 and 7. FIFO draws the oldest batch first, including one past the limit, and all screens agree', async () => {
  const db = await keepSetup();
  try {
    // Batch a (26 kg, oldest harvest) is past the limit; batch b (13 kg) is fresh.
    await ageBatch(db, a, 10); await ageBatch(db, b, 2);
    assert.deepEqual(await screens(db), { home: [39, 'Listed', true], stocks: [39, true], retailer: 39 });
    const first = await buy(db, 30);
    await approve(db, first.id);
    assert.deepEqual(await items(db, first.id), [[a, 26, 50], [b, 4, 50]], 'oldest batch empties first');
    assert.deepEqual(await screens(db), { home: [9, 'Listed', false], stocks: [9, false], retailer: 9 }, 'review clears once that batch is sold');
    const rest = await buy(db, 9);
    await approve(db, rest.id);
    assert.deepEqual(await items(db, rest.id), [[b, 9, 50]]);
    assert.deepEqual(await screens(db), { home: [0, 'Sold Out', false], stocks: [0, false], retailer: 'not offered' });
  } finally { await db.close(); }
});

test('the migration is safe to re-run and keeps the checkout functions server-only', async () => {
  const db = await keepSetup();
  try {
    await db.exec(migration('keep_past_limit_stock.sql'));
    const { rows } = await db.query(`SELECT
      has_function_privilege('authenticated', 'public.place_inventory_order(uuid,jsonb,text,double precision,double precision,timestamptz)', 'EXECUTE') AS auth,
      has_function_privilege('service_role', 'public.commit_order_stock(uuid,uuid)', 'EXECUTE') AS service`);
    assert.deepEqual([rows[0].auth, rows[0].service], [false, true]);
  } finally { await db.close(); }
});
