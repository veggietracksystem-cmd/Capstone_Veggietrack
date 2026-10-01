const test = require('node:test');
const assert = require('node:assert/strict');
const { id, hub, retailer, farmer, a, b, migration, rpc, buy, approve, manilaDayStart, stock, setup } = require('./inventoryDb');
const { retailerProducts, daysInStock, STOCK_ALERT_DAYS } = require('../lib/batches');

// Real PostgreSQL (PGlite) checks for sql/pickup_pricing_and_spoilage.sql.
const harvest = (db, n, kg, recorded = '2026-09-20T02:00:00Z') =>
  db.query("INSERT INTO harvests VALUES($1,$2,'Tomato',$3,'available',$4)", [id(n), farmer, kg, recorded]);
const request = (db, harvestN, quantity, price = 35) => rpc(db, 'request_harvest_pickup', [farmer, id(harvestN), quantity, price, null]);
const harvestStatus = async (db, n) => (await db.query('SELECT status FROM harvests WHERE id=$1', [id(n)])).rows[0].status;
const pickUp = (db, pickupId) => db.query(
  "UPDATE pickup_requests SET status='assigned', received_by=$2 WHERE id=$1 AND status='requested'", [pickupId, hub])
  .then(() => db.query("UPDATE pickup_requests SET status='picked_up', received_at=now() WHERE id=$1", [pickupId]));
// A batch that entered stock `days` Philippine calendar days ago (1 am Manila time).
const ageBatch = async (db, batchId, days) => {
  const start = await manilaDayStart(db, -days);
  await db.query("UPDATE products SET created_at = $2::timestamptz + interval '1 hour', pickup_date = NULL WHERE id=$1", [batchId, start]);
};
const spoilage = db => db.query('SELECT product_id, quantity_kg, reason FROM stock_spoilage ORDER BY recorded_at, id')
  .then(r => r.rows.map(row => [row.product_id, Number(row.quantity_kg), row.reason]));
const batchOf = async (db, batchId) => (await db.query('SELECT * FROM products WHERE id=$1', [batchId])).rows[0];

test('migration is re-runnable and fills quantity and price on earlier whole-harvest requests', async () => {
  const db = await setup({ spoilage: false });
  try {
    await harvest(db, 20, 40);
    await db.query("INSERT INTO pickup_requests(id, harvest_id, farmer_id, status, amount) VALUES($1,$2,$3,'requested',22.5)", [id(21), id(20), farmer]);
    await db.exec(migration('pickup_pricing_and_spoilage.sql'));
    await db.exec(migration('pickup_pricing_and_spoilage.sql'));
    const row = (await db.query('SELECT quantity_kg, price_per_kg FROM pickup_requests WHERE id=$1', [id(21)])).rows[0];
    assert.deepEqual([Number(row.quantity_kg), Number(row.price_per_kg)], [40, 22.5]);
    await assert.rejects(db.query("UPDATE pickup_requests SET status='lost' WHERE id=$1", [id(21)]), /pickup_requests_status_valid/);
  } finally { await db.close(); }
});

test('farmer requests part of a harvest with a price; the rest stays available after pickup', async () => {
  const db = await setup();
  try {
    await harvest(db, 20, 100);
    for (const [quantity, price, pattern] of [[0, 35, /greater than 0 kg/], [-5, 35, /greater than 0 kg/], [10.123, 35, /greater than 0 kg/],
      [101, 35, /up to 100 kg/], [60, 0, /price per kg/], [60, -1, /price per kg/], [60, null, /price per kg/]]) {
      await assert.rejects(request(db, 20, quantity, price), pattern, `${quantity} kg at ${price}`);
    }
    await assert.rejects(rpc(db, 'request_harvest_pickup', [retailer, id(20), 10, 35, null]), /not owned by you/);
    const first = await request(db, 20, 60, 35);
    assert.deepEqual([first.status, Number(first.quantity_kg), Number(first.price_per_kg)], ['requested', 60, 35]);
    assert.equal(await harvestStatus(db, 20), 'for_pickup');
    // A retried or second request while one is open is rejected.
    await assert.rejects(request(db, 20, 10), /already been requested/);
    assert.equal(Number((await db.query('SELECT public.harvest_reserved_kg($1) AS kg', [id(20)])).rows[0].kg), 60);

    await pickUp(db, first.id);
    const [batch] = (await db.query('SELECT * FROM products WHERE pickup_request_id=$1', [first.id])).rows;
    assert.deepEqual([Number(batch.stock_kg), Number(batch.quantity_received), batch.status, batch.farmer_id], [60, 60, 'received', farmer]);
    assert.equal(await harvestStatus(db, 20), 'available');
    await assert.rejects(request(db, 20, 41), /up to 40 kg/);
    const second = await request(db, 20, 40, 36);
    await pickUp(db, second.id);
    assert.equal(await harvestStatus(db, 20), 'picked_up');
    await assert.rejects(request(db, 20, 1), /no kilograms left/);
    // Completing the same pickup again never adds a second batch.
    await db.query("UPDATE pickup_requests SET status='picked_up' WHERE id=$1", [second.id]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM products WHERE harvest_id=$1', [id(20)])).rows[0].n, 2);
  } finally { await db.close(); }
});

test('distributor decline needs a reason, keeps the request as history and frees the harvest', async () => {
  const db = await setup();
  try {
    await harvest(db, 20, 50);
    const pending = await request(db, 20, 50);
    await assert.rejects(rpc(db, 'decline_pickup_request', [pending.id, hub, '  ']), /reason is required/);
    const declined = await rpc(db, 'decline_pickup_request', [pending.id, hub, 'Price too high']);
    assert.deepEqual([declined.status, declined.decline_reason, declined.received_by], ['declined', 'Price too high', hub]);
    assert.ok(declined.declined_at);
    assert.equal(await harvestStatus(db, 20), 'available');
    assert.equal((await rpc(db, 'decline_pickup_request', [pending.id, hub, 'again'])).decline_reason, 'Price too high');
    // A rider-assigned pickup can no longer be declined.
    const next = await request(db, 20, 20);
    await db.query("UPDATE pickup_requests SET status='assigned', received_by=$2 WHERE id=$1", [next.id, hub]);
    await assert.rejects(rpc(db, 'decline_pickup_request', [next.id, hub, 'late']), /already updated/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pickup_requests WHERE harvest_id=$1", [id(20)])).rows[0].n, 2);
  } finally { await db.close(); }
});

test('7-day rule: sellable through day 7, moved to Spoiled Products as past the limit from day 8', async () => {
  const db = await setup();
  try {
    await ageBatch(db, a, 8); await ageBatch(db, b, 7);
    // Checkout runs the rule first: batch a (day 8) is never sold, so 20 kg is
    // more than the 13 kg still sellable. (A failed checkout rolls back, including
    // the spoilage it recorded; the next successful action records it.)
    await assert.rejects(buy(db, 20), /not enough/);
    const order = await buy(db, 5);
    assert.deepEqual(await spoilage(db), [[a, 26, 'past_limit']]);
    const expired = await batchOf(db, a);
    assert.deepEqual([Number(expired.stock_kg), expired.status, Number(expired.quantity_received)], [0, 'spoiled', 26]);
    // Day 7 is still sellable and FIFO now starts from the next valid batch.
    assert.deepEqual(retailerProducts(await stock(db)).map(p => [p.vegetable_name, p.available_kg]), [['Tomato', 13]]);
    await approve(db, order.id);
    assert.equal((await db.query('SELECT product_id FROM order_items WHERE order_id=$1', [order.id])).rows[0].product_id, b);
    assert.equal(Number((await batchOf(db, b)).stock_kg), 8);
    // Running the rule again changes nothing; day 6 and day 7 batches stay.
    assert.equal((await db.query('SELECT public.spoil_expired_batches() AS n')).rows[0].n, 0);
    // The same day count as the API alert helper.
    const since = (await batchOf(db, b)).created_at;
    assert.equal((await db.query('SELECT public.batch_days_in_stock($1) AS d', [since])).rows[0].d, daysInStock({ created_at: since }));
    assert.equal(daysInStock({ created_at: since }), STOCK_ALERT_DAYS);
  } finally { await db.close(); }
});

test('approval re-checks the limit: a batch that expires while an order is pending is not drawn', async () => {
  const db = await setup();
  try {
    const order = await buy(db, 30);
    await ageBatch(db, a, 9);
    await assert.rejects(approve(db, order.id), /Not enough stock/);
    assert.equal((await db.query('SELECT status FROM orders WHERE id=$1', [order.id])).rows[0].status, 'pending');
    assert.equal(Number((await batchOf(db, b)).stock_kg), 13);
    assert.equal((await db.query('SELECT public.spoil_expired_batches() AS n')).rows[0].n, 1);
    assert.deepEqual(await spoilage(db), [[a, 26, 'past_limit']]);
  } finally { await db.close(); }
});

test('discard moves remaining stock to Spoiled Products once and never back to Stocks', async () => {
  const db = await setup();
  try {
    await db.query("UPDATE products SET status='received' WHERE id=$1", [b]);
    const discarded = await rpc(db, 'discard_product_stock', [b, hub]);
    assert.deepEqual([discarded.product_id, Number(discarded.quantity_kg), discarded.reason, discarded.recorded_by], [b, 13, 'discarded', hub]);
    const batch = await batchOf(db, b);
    assert.deepEqual([Number(batch.stock_kg), batch.status, Number(batch.quantity_received)], [0, 'spoiled', 13]);
    // A retried discard returns the same record and records nothing new.
    assert.equal((await rpc(db, 'discard_product_stock', [b, hub])).id, discarded.id);
    await assert.rejects(rpc(db, 'discard_product_stock', [a, retailer]), /not found or not owned/);
    // Unlisting the vegetable leaves the spoiled batch alone (it never returns to Stocks).
    await db.query('SELECT * FROM unlist_inventory_product($1,$2)', [a, hub]);
    assert.equal((await batchOf(db, b)).status, 'spoiled');
    await assert.rejects(db.query("UPDATE products SET status='received' WHERE id=$1", [b]), /products_active_batch_has_stock/);

    // A batch already past the limit is recorded as past the limit, not as a discard.
    await db.query("UPDATE products SET status='listed' WHERE id=$1", [a]);
    await ageBatch(db, a, 10);
    assert.equal((await rpc(db, 'discard_product_stock', [a, hub])).reason, 'past_limit');
    assert.deepEqual(await spoilage(db), [[b, 13, 'discarded'], [a, 26, 'past_limit']]);
  } finally { await db.close(); }
});

test('stock returned by a cancelled order to a spoiled batch is spoiled too, never relisted or double counted', async () => {
  const db = await setup();
  try {
    const order = await buy(db, 30);
    await approve(db, order.id);
    assert.deepEqual((await stock(db)).map(p => [Number(p.stock_kg), p.status]), [[0, 'sold_out'], [9, 'listed']]);
    await rpc(db, 'discard_product_stock', [b, hub]);
    await db.query("UPDATE orders SET status='cancelled' WHERE id=$1", [order.id]);
    // a (sold out, still valid) is back on sale; b (discarded) keeps 0 kg and records the return.
    assert.deepEqual((await stock(db)).map(p => [Number(p.stock_kg), p.status]), [[26, 'listed'], [0, 'spoiled']]);
    assert.deepEqual(await spoilage(db), [[b, 9, 'discarded'], [b, 4, 'discarded']]);
    // Every kilogram received is in exactly one place: on sale, with an order, or spoiled.
    const rows = (await db.query(`SELECT p.id, p.quantity_received, p.stock_kg,
        coalesce((SELECT sum(i.quantity_kg) FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE i.product_id = p.id AND o.stock_committed_at IS NOT NULL), 0) AS drawn,
        coalesce((SELECT sum(s.quantity_kg) FROM stock_spoilage s WHERE s.product_id = p.id), 0) AS spoiled
      FROM products p ORDER BY p.harvest_date`)).rows;
    for (const row of rows) {
      assert.equal(Number(row.stock_kg) + Number(row.drawn) + Number(row.spoiled), Number(row.quantity_received), row.id);
      assert.ok(Number(row.stock_kg) >= 0);
    }
  } finally { await db.close(); }
});

test('new functions and the spoilage table are only for the server', async () => {
  const db = await setup();
  try {
    for (const signature of ['request_harvest_pickup(uuid,uuid,numeric,numeric,text)', 'decline_pickup_request(uuid,uuid,text)',
      'discard_product_stock(uuid,uuid)', 'spoil_expired_batches()', 'restore_product_stock(uuid,numeric)', 'sync_harvest_status(uuid)']) {
      const row = (await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon, has_function_privilege('authenticated',$1,'EXECUTE') AS auth, has_function_privilege('service_role',$1,'EXECUTE') AS service", [signature])).rows[0];
      assert.deepEqual(row, { anon: false, auth: false, service: true }, signature);
    }
    const table = (await db.query("SELECT has_table_privilege('anon','stock_spoilage','SELECT') AS anon, has_table_privilege('authenticated','stock_spoilage','SELECT') AS auth")).rows[0];
    assert.deepEqual(table, { anon: false, auth: false });
  } finally { await db.close(); }
});

test('migration replaces the early stock check that only allowed sold_out or archived at 0 kg', async () => {
  const db = await setup({ spoilage: false });
  try {
    // The hosted database was set up with this first version of batch_lifecycle.sql.
    await db.exec(`ALTER TABLE products DROP CONSTRAINT products_active_batch_has_stock;
      ALTER TABLE products ADD CONSTRAINT products_active_batch_has_stock CHECK (status IS NULL OR status IN ('sold_out', 'archived') OR stock_kg > 0);
      UPDATE products SET created_at = now();`);
    await db.exec(migration('pickup_pricing_and_spoilage.sql'));
    await ageBatch(db, a, 9);
    assert.equal((await db.query('SELECT public.spoil_expired_batches() AS n')).rows[0].n, 1);
    assert.equal((await rpc(db, 'discard_product_stock', [b, hub])).reason, 'discarded');
    assert.deepEqual((await stock(db)).map(p => [p.status, Number(p.stock_kg)]), [['spoiled', 0], ['spoiled', 0]]);
    await assert.rejects(db.query("UPDATE products SET status='listed' WHERE id=$1", [a]), /products_active_batch_has_stock/);
  } finally { await db.close(); }
});
