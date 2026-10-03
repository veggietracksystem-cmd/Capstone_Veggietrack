const test = require('node:test');
const assert = require('node:assert/strict');
const { hub, retailer, a, b, migration, rpc, buy, approve, manilaDayStart, stock, setup } = require('./inventoryDb');
const { retailerProducts, isPastSpoilageLimit } = require('../lib/batches');

// Real PostgreSQL (PGlite) checks for sql/manual_spoilage.sql: passing the 7-day
// limit is only a warning; stock moves to Spoiled Products when the distributor discards it.
async function manualSetup() {
  const db = await setup();
  await db.exec(migration('manual_spoilage.sql'));
  return db;
}
// A batch that entered stock `days` Philippine calendar days ago (1 am Manila time).
const ageBatch = async (db, batchId, days) => {
  const start = await manilaDayStart(db, -days);
  await db.query("UPDATE products SET created_at = $2::timestamptz + interval '1 hour', pickup_date = NULL WHERE id=$1", [batchId, start]);
};
const spoilage = db => db.query('SELECT product_id, quantity_kg, reason, recorded_by FROM stock_spoilage ORDER BY recorded_at, id')
  .then(r => r.rows.map(row => [row.product_id, Number(row.quantity_kg), row.reason, row.recorded_by]));
const batchOf = async (db, batchId) => (await db.query('SELECT * FROM products WHERE id=$1', [batchId])).rows[0];
const spoiledTotal = async db => Number((await db.query('SELECT coalesce(sum(quantity_kg), 0) AS kg FROM stock_spoilage')).rows[0].kg);

test('past the limit is a warning: stock stays in the batch, is not sold and is not counted as spoiled', async () => {
  const db = await manualSetup();
  try {
    await ageBatch(db, a, 10); await ageBatch(db, b, 3);
    // Every path that used to spoil automatically now changes nothing.
    assert.equal((await db.query('SELECT public.spoil_expired_batches() AS n')).rows[0].n, 0);
    await assert.rejects(buy(db, 20), /not enough/, 'only the 13 kg within the limit can be bought');
    const order = await buy(db, 5);
    await approve(db, order.id);
    const pastLimit = await batchOf(db, a);
    assert.deepEqual([Number(pastLimit.stock_kg), pastLimit.status], [26, 'listed'], 'not zeroed, not spoiled');
    assert.deepEqual(await spoilage(db), [], 'no spoiled record without the distributor');
    assert.equal(await spoiledTotal(db), 0);
    assert.equal((await db.query('SELECT product_id FROM order_items WHERE order_id=$1', [order.id])).rows[0].product_id, b);
    // The retailer menu offers only stock within the limit; the batch is flagged for review.
    const rows = await stock(db);
    assert.deepEqual(retailerProducts(rows).map(p => [p.vegetable_name, p.available_kg]), [['Tomato', 8]]);
    assert.equal(isPastSpoilageLimit(rows.find(row => row.id === a)), true);
    assert.equal(isPastSpoilageLimit(rows.find(row => row.id === b)), false);
    // Re-running the migration or the old rule later still leaves it for review.
    await db.exec(migration('manual_spoilage.sql'));
    await db.query('SELECT public.spoil_expired_batches()');
    assert.deepEqual([Number((await batchOf(db, a)).stock_kg), (await batchOf(db, a)).status], [26, 'listed']);
  } finally { await db.close(); }
});

test('the distributor discards: stock moves to Spoiled Products once, with who and why', async () => {
  const db = await manualSetup();
  try {
    await ageBatch(db, a, 10);
    const discarded = await rpc(db, 'discard_product_stock', [a, hub]);
    assert.deepEqual([discarded.product_id, Number(discarded.quantity_kg), discarded.reason, discarded.recorded_by], [a, 26, 'past_limit', hub]);
    const batch = await batchOf(db, a);
    assert.deepEqual([Number(batch.stock_kg), batch.status, Number(batch.quantity_received)], [0, 'spoiled', 26], 'batch kept as history');
    assert.equal(await spoiledTotal(db), 26, 'counted as spoiled only now');
    // A retried discard (double tap, lost response) returns the same record.
    assert.equal((await rpc(db, 'discard_product_stock', [a, hub])).id, discarded.id);
    assert.equal((await spoilage(db)).length, 1);
    // A batch within the limit is recorded as a plain discard.
    assert.equal((await rpc(db, 'discard_product_stock', [b, hub])).reason, 'discarded');
    await assert.rejects(rpc(db, 'discard_product_stock', [b, retailer]), /not found or not owned/);
    assert.deepEqual((await spoilage(db)).map(row => row[2]), ['past_limit', 'discarded']);
  } finally { await db.close(); }
});

test('the new helper is server-only like the other inventory functions', async () => {
  const db = await manualSetup();
  try {
    const { rows } = await db.query(`SELECT has_function_privilege('authenticated', 'public.batch_past_spoilage_limit(timestamptz)', 'EXECUTE') AS auth,
      has_function_privilege('service_role', 'public.batch_past_spoilage_limit(timestamptz)', 'EXECUTE') AS service`);
    assert.deepEqual([rows[0].auth, rows[0].service], [false, true]);
  } finally { await db.close(); }
});

test('optional fix: stock spoiled only by the old automatic rule goes back for review; distributor discards stay', async () => {
  // The old rule first spoils batch a automatically; the distributor discards batch b.
  const db = await setup();
  try {
    await ageBatch(db, a, 10);
    assert.equal((await db.query('SELECT public.spoil_expired_batches() AS n')).rows[0].n, 1);
    await rpc(db, 'discard_product_stock', [b, hub]);
    await assert.rejects(db.exec(migration('restore_auto_spoiled_stock.sql')), /manual_spoilage\.sql first/);
    await db.exec('ROLLBACK'); // as the SQL editor does after a failed run
    await db.exec(migration('manual_spoilage.sql'));
    await db.exec(migration('restore_auto_spoiled_stock.sql'));
    await db.exec(migration('restore_auto_spoiled_stock.sql'));
    const restored = await batchOf(db, a);
    assert.deepEqual([Number(restored.stock_kg), restored.status], [26, 'listed'], 'back in its batch for review');
    assert.deepEqual((await spoilage(db)).map(row => [row[0], row[2]]), [[b, 'discarded']], 'the distributor discard stays');
    const archived = (await db.query('SELECT product_id, quantity_kg, reason FROM stock_spoilage_reverted')).rows;
    assert.deepEqual(archived.map(row => [row.product_id, Number(row.quantity_kg), row.reason]), [[a, 26, 'past_limit']], 'history kept');
    assert.equal((await batchOf(db, b)).status, 'spoiled');
    // Still past the limit: not sold until the distributor decides.
    await assert.rejects(buy(db, 5), /not enough/);
  } finally { await db.close(); }
});
