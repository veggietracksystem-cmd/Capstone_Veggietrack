const test = require('node:test');
const assert = require('node:assert/strict');
const { retailerProducts, distributorListings, isActiveBatch, isReceivedBatch, batchStatus } = require('../lib/batches');
const { vegetableKey } = require('../lib/vegetables');
const { id, hub, retailer, farmer, a, b, migration, rpc, buy, approve, manilaDayStart, stock, kg, items, setup } = require('./inventoryDb');

const NOT_ENOUGH = /Not enough stock available to approve this order\./;
const committed = (db, orderId) => db.query('SELECT stock_committed_at FROM orders WHERE id = $1', [orderId]).then(r => r.rows[0].stock_committed_at);

test('pending orders draw nothing; approval draws FIFO once and keeps separate batches, photos and sold-out history', async () => {
  const db = await setup();
  try {
    await db.exec('SET ROLE service_role');
    let listing = retailerProducts(await stock(db));
    assert.equal(listing.length, 1); assert.equal(listing[0].available_kg, 39);
    assert.deepEqual(listing[0].batch_photos, ['photo-a', 'photo-b']);

    const order = await buy(db);
    assert.equal(order.status, 'pending'); assert.equal(Number(order.total_amount), 1500);
    assert.deepEqual(kg(await stock(db)), [26, 13], 'checkout leaves stock untouched');
    assert.equal(retailerProducts(await stock(db))[0].available_kg, 39);
    assert.deepEqual(await items(db, order.id), [[null, 26, 50], [null, 4, 50]], 'pending items are not tied to a batch');
    assert.equal(await committed(db, order.id), null);

    // Viewing, refreshing and the expiry check change nothing.
    await db.query('SELECT * FROM orders'); await rpc(db, 'cancel_expired_retailer_orders', []);
    assert.deepEqual(kg(await stock(db)), [26, 13]);

    assert.ok(await approve(db, order.id));
    let rows = await stock(db);
    assert.deepEqual(rows.map(p => [Number(p.stock_kg), p.status]), [[0, 'sold_out'], [9, 'listed']]);
    assert.deepEqual(await items(db, order.id), [[a, 26, 50], [b, 4, 50]]);
    assert.ok(await committed(db, order.id));
    assert.equal(rows[0].batch_photo_url, 'photo-a');
    listing = retailerProducts(rows);
    assert.deepEqual([listing[0].available_kg, listing[0].batch_photos], [9, ['photo-b']], 'sold-out batch leaves the retailer list');
    assert.equal(distributorListings(rows)[0].available_kg, 9, 'distributor and retailer see the same stock');

    // Duplicate approval and later delivery steps never draw again.
    assert.equal(await approve(db, order.id), undefined);
    for (const status of ['picked_up', 'in_transit', 'delivered']) {
      await db.query('UPDATE orders SET status = $1 WHERE id = $2', [status, order.id]);
    }
    assert.deepEqual(kg(await stock(db)), [0, 9]);

    await approve(db, (await buy(db, 9)).id);
    rows = await stock(db);
    assert.ok(rows.every(p => !isActiveBatch(p) && !isReceivedBatch(p) && batchStatus(p) === 'sold_out'),
      'sold-out batches never return to Stocks for approval');
    assert.deepEqual(retailerProducts(rows), [], 'a sold-out vegetable leaves the retailer list');
    assert.deepEqual(distributorListings(rows).map(l => [l.available_kg, l.status]), [[0, 'Sold Out']], 'and stays in the distributor history');
    await db.query("INSERT INTO products(distributor_id,vegetable_name,stock_kg,price_per_kg,status) VALUES($1,'Tomato',18,50,'listed')", [hub]);
    listing = retailerProducts(await stock(db));
    assert.equal(listing.length, 1); assert.equal(listing[0].available_kg, 18);
  } finally { await db.close(); }
});

test('competing pending orders: the second approval is refused once stock runs short, and stock never goes negative', async () => {
  const db = await setup();
  try {
    await db.query('UPDATE products SET stock_kg = 10 WHERE id = $1', [a]);
    await db.query("UPDATE products SET status = 'received' WHERE id = $1", [b]);
    const [first, second] = await Promise.all([buy(db, 8), buy(db, 8)]);
    assert.deepEqual(kg(await stock(db)), [10, 13], 'both orders wait as pending');
    await approve(db, first.id);
    assert.deepEqual(kg(await stock(db)), [2, 13]);
    await assert.rejects(approve(db, second.id), NOT_ENOUGH);
    assert.deepEqual(kg(await stock(db)), [2, 13], 'a refused approval draws nothing');
    const refused = (await db.query('SELECT status, stock_committed_at FROM orders WHERE id = $1', [second.id])).rows[0];
    assert.deepEqual([refused.status, refused.stock_committed_at], ['pending', null]);
    assert.deepEqual(await items(db, second.id), [[null, 8, 50]]);
    // The retailer can still see that only 2 kg is left; declining keeps it there.
    assert.equal(retailerProducts(await stock(db))[0].available_kg, 2);
    await rpc(db, 'cancel_inventory_order', [second.id, hub, 'Out of stock']);
    assert.deepEqual(kg(await stock(db)), [2, 13]);
    await assert.rejects(db.query('UPDATE products SET stock_kg = -1 WHERE id = $1', [a]), /violates check constraint/);
  } finally { await db.close(); }
});

test('approval draws from the oldest batch at approval time and keeps the price quoted at checkout', async () => {
  const db = await setup();
  try {
    const order = await buy(db, 10);
    assert.deepEqual(await items(db, order.id), [[null, 10, 50]]);
    // Before approval: an older batch is listed, another order takes the old front
    // batch, and the price changes. FIFO is planned from the stock at approval.
    const older = id(12);
    await db.query("INSERT INTO products(id,distributor_id,vegetable_name,stock_kg,price_per_kg,status,harvest_date) VALUES($1,$2,'Tomato',4,50,'listed','2026-09-10')", [older, hub]);
    await approve(db, (await buy(db, 26, [{ vegetable_name: 'Tomato', quantity_kg: 26 }])).id);
    assert.deepEqual(kg(await stock(db)), [0, 4, 13], 'the other order drew 4 kg + 22 kg oldest first');
    await db.query('UPDATE products SET price_per_kg = 80');
    await approve(db, order.id);
    assert.deepEqual(kg(await stock(db)), [0, 0, 7]);
    assert.deepEqual(await items(db, order.id), [[b, 6, 50], [a, 4, 50]]);
    const saved = (await db.query('SELECT total_amount FROM orders WHERE id = $1', [order.id])).rows[0];
    assert.equal(Number(saved.total_amount), 500, 'the approved total is what the retailer agreed to');
  } finally { await db.close(); }
});

test('quoted lines at different prices keep their prices when approval draws from other batches', async () => {
  const db = await setup();
  try {
    await db.query('UPDATE products SET price_per_kg = 60 WHERE id = $1', [b]);
    const order = await buy(db, 30);
    assert.equal(Number(order.total_amount), 1540);
    const older = id(12);
    await db.query("INSERT INTO products(id,distributor_id,vegetable_name,stock_kg,price_per_kg,status,harvest_date) VALUES($1,$2,'Tomato',10,50,'listed','2026-09-10')", [older, hub]);
    await approve(db, order.id);
    assert.deepEqual(kg(await stock(db)), [0, 6, 13]);
    const lines = await items(db, order.id);
    assert.deepEqual(lines, [[a, 16, 50], [older, 10, 50], [a, 4, 60]]);
    assert.equal(lines.reduce((sum, [, quantity, price]) => sum + quantity * price, 0), 1540);
  } finally { await db.close(); }
});

test('failures roll back: checkout creates nothing, a failed approval leaves stock and the order pending', async () => {
  const db = await setup();
  try {
    await db.exec(`CREATE FUNCTION fail_second_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.vegetable_name = 'Kamatis' THEN RAISE EXCEPTION 'injected item failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER fail_item BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION fail_second_item();`);
    await assert.rejects(buy(db), /injected item failure/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM order_items')).rows[0].n, 0);
    await db.exec('DROP TRIGGER fail_item ON order_items');
    await assert.rejects(buy(db, 40), /not enough/);
    await assert.rejects(buy(db, 0, [{ vegetable_name: 'Tomato', quantity_kg: 5.001 }]), /positive quantity/);

    const order = await buy(db);
    await db.exec(`CREATE FUNCTION fail_draw() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id = '${b}' AND NEW.stock_kg < OLD.stock_kg THEN RAISE EXCEPTION 'injected draw failure'; END IF;
      RETURN NEW; END; $$; CREATE TRIGGER fail_draw BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fail_draw();`);
    await assert.rejects(approve(db, order.id), /injected draw failure/);
    assert.deepEqual(kg(await stock(db)), [26, 13], 'the first batch draw was rolled back too');
    assert.equal((await db.query('SELECT status FROM orders')).rows[0].status, 'pending');
    assert.deepEqual(await items(db, order.id), [[null, 26, 50], [null, 4, 50]]);
    await db.exec('DROP TRIGGER fail_draw ON products');
    await approve(db, order.id);
    assert.deepEqual(kg(await stock(db)), [0, 9]);
  } finally { await db.close(); }
});

test('declining a pending order changes no stock; cancelling an approved order restores the exact batches once', async () => {
  const db = await setup();
  try {
    const declined = await buy(db, 30);
    await rpc(db, 'cancel_inventory_order', [declined.id, hub, 'Out of range']);
    assert.deepEqual(kg(await stock(db)), [26, 13]);
    await assert.rejects(rpc(db, 'cancel_inventory_order', [declined.id, hub, 'again']), /already updated/);
    assert.equal(await approve(db, declined.id), undefined, 'approval only applies to pending orders');
    await assert.rejects(db.query("UPDATE orders SET status = 'approved' WHERE id = $1", [declined.id]), /closed and cannot be reopened/);
    assert.deepEqual(kg(await stock(db)), [26, 13]);

    const order = await buy(db, 30);
    await approve(db, order.id);
    await assert.rejects(rpc(db, 'cancel_inventory_order', [order.id, retailer, null]), /already updated/, 'approved orders are not cancelled from the app');
    await db.exec(`CREATE FUNCTION fail_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id = '${b}' AND NEW.stock_kg > OLD.stock_kg THEN RAISE EXCEPTION 'injected restore failure'; END IF;
      RETURN NEW; END; $$; CREATE TRIGGER fail_restore BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fail_restore();`);
    const cancel = () => db.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [order.id]);
    await assert.rejects(cancel(), /injected restore failure/);
    assert.deepEqual(kg(await stock(db)), [0, 9]);
    assert.equal((await db.query('SELECT status FROM orders WHERE id = $1', [order.id])).rows[0].status, 'approved');
    await db.exec('DROP TRIGGER fail_restore ON products');
    await db.query("UPDATE products SET status = 'archived' WHERE id = $1", [a]);
    await cancel();
    assert.deepEqual((await stock(db)).map(p => [Number(p.stock_kg), p.status]), [[26, 'archived'], [13, 'listed']]);
    assert.equal(await committed(db, order.id), null);
    await cancel(); await db.query('UPDATE orders SET stock_committed_at = now() WHERE id = $1', [order.id]);
    assert.deepEqual(kg(await stock(db)), [26, 13], 'restored exactly once');
    assert.equal(await committed(db, order.id), null, 'only the trigger sets the stock marker');
  } finally { await db.close(); }
});

test('returning an approved order to pending gives its stock back, and orders must start as pending', async () => {
  const db = await setup();
  try {
    const order = await buy(db, 30);
    await approve(db, order.id);
    await db.query("UPDATE orders SET status = 'pending' WHERE id = $1", [order.id]);
    assert.deepEqual(kg(await stock(db)), [26, 13]);
    assert.deepEqual(await items(db, order.id), [[null, 26, 50], [null, 4, 50]]);
    await approve(db, order.id);
    assert.deepEqual(kg(await stock(db)), [0, 9]);
    await assert.rejects(db.query("INSERT INTO orders(retailer_id, distributor_id, status) VALUES($1,$2,'approved')", [retailer, hub]), /must start as pending/);
  } finally { await db.close(); }
});

test('quantity reduction and unlisting are atomic and reject stale totals', async () => {
  const db = await setup();
  try {
    await assert.rejects(rpc(db, 'reduce_inventory_quantity', [a, hub, 38, 9]), /stock changed/);
    await db.exec(`CREATE FUNCTION fail_reduction() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id = '${b}' THEN RAISE EXCEPTION 'injected reduction failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER fail_reduction BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fail_reduction();`);
    await assert.rejects(rpc(db, 'reduce_inventory_quantity', [a, hub, 39, 9]), /injected reduction failure/);
    assert.deepEqual(kg(await stock(db)), [26, 13]);
    await db.exec('DROP TRIGGER fail_reduction ON products');
    const pending = await buy(db, 20);
    await rpc(db, 'reduce_inventory_quantity', [a, hub, 39, 9]);
    await assert.rejects(approve(db, pending.id), NOT_ENOUGH, 'a manual reduction is checked at approval');
    await db.query('SELECT * FROM unlist_inventory_product($1,$2)', [a, hub]);
    assert.deepEqual((await stock(db)).map(p => [Number(p.stock_kg), p.status]), [[0, 'archived'], [9, 'received']]);
    await assert.rejects(buy(db, 5), /not enough/);
  } finally { await db.close(); }
});

test('pickup completion creates one batch with provenance and rolls back when stock insertion fails', async () => {
  const db = await setup();
  try {
    await db.query("INSERT INTO harvests VALUES($1,$2,'Carrot',12,'for_pickup','2026-09-17T04:00:00Z')", [id(20), farmer]);
    await db.query("INSERT INTO pickup_requests VALUES($1,$2,$3,$4,'assigned',NULL)", [id(21), id(20), farmer, hub]);
    await db.exec("ALTER TABLE products ADD CONSTRAINT injected_stock_failure CHECK(vegetable_name <> 'Carrot')");
    const complete = () => db.query("UPDATE pickup_requests SET status='picked_up', received_at='2026-09-18T04:00:00Z' WHERE id=$1", [id(21)]);
    await assert.rejects(complete(), /injected_stock_failure/);
    assert.equal((await db.query('SELECT status FROM pickup_requests')).rows[0].status, 'assigned');
    assert.equal((await db.query('SELECT status FROM harvests')).rows[0].status, 'for_pickup');
    await db.exec('ALTER TABLE products DROP CONSTRAINT injected_stock_failure');
    await complete(); await complete();
    const batches = (await db.query('SELECT * FROM products WHERE pickup_request_id=$1', [id(21)])).rows;
    assert.equal(batches.length, 1);
    assert.equal(batches[0].farmer_id, farmer); assert.equal(batches[0].status, 'received');
    assert.equal(new Date(batches[0].harvest_date).toISOString(), '2026-09-17T04:00:00.000Z');
    assert.equal(new Date(batches[0].pickup_date).toISOString(), '2026-09-18T04:00:00.000Z');
    assert.equal(Number(batches[0].quantity_received), 12);
  } finally { await db.close(); }
});

test('overdue orders become unsuccessful once; stock returns only if never picked up; archived batches stay archived', async () => {
  const db = await setup();
  try {
    const waiting = await buy(db, 30); await approve(db, waiting.id);
    const onTheWay = await buy(db, 9); await approve(db, onTheWay.id);
    await db.query("UPDATE orders SET status = 'in_transit' WHERE id = $1", [onTheWay.id]);
    await db.query("INSERT INTO deliveries(order_id, status) VALUES ($1, 'assigned'), ($2, 'in_transit')", [waiting.id, onTheWay.id]);
    await db.query("UPDATE products SET status = 'archived' WHERE id = $1", [a]);
    assert.deepEqual(kg(await stock(db)), [0, 0]);
    await db.query('UPDATE orders SET preferred_schedule = $1', [await manilaDayStart(db, -1)]);
    assert.equal(await rpc(db, 'cancel_expired_retailer_orders', []), 2);
    assert.equal(await rpc(db, 'cancel_expired_retailer_orders', []), 0, 'no repeated transition');
    assert.deepEqual((await stock(db)).map(p => [Number(p.stock_kg), p.status]), [[26, 'archived'], [4, 'listed']],
      'the order waiting at the warehouse returns 26 kg + 4 kg; the removed batch is not sent back to Stocks');
    const orders = (await db.query('SELECT id, status, stock_committed_at FROM orders')).rows;
    assert.ok(orders.every(o => o.status === 'unsuccessful'));
    assert.equal(orders.find(o => o.id === waiting.id).stock_committed_at, null);
    assert.ok(orders.find(o => o.id === onTheWay.id).stock_committed_at, 'goods with the rider stay drawn');
    assert.deepEqual((await db.query('SELECT DISTINCT status FROM deliveries')).rows, [{ status: 'unsuccessful' }]);
    await assert.rejects(db.query("UPDATE orders SET status = 'in_transit' WHERE id = $1", [onTheWay.id]), /closed and cannot be reopened/);
  } finally { await db.close(); }
});

test('the conversion returns stock held by old pending orders once and keeps approved orders drawn', async () => {
  // Orders placed by the previous checkout already drew their stock.
  const legacy = { pending: id(30), approved: id(31), cancelled: id(32) };
  const db = await setup({ async beforeOrderStock(db) {
    await db.query(`INSERT INTO orders(id, retailer_id, distributor_id, status, total_amount, preferred_schedule) VALUES
      ($1,$4,$5,'pending',500,now() + interval '1 day'), ($2,$4,$5,'approved',400,now() + interval '1 day'),
      ($3,$4,$5,'cancelled',100,now() + interval '1 day')`, [legacy.pending, legacy.approved, legacy.cancelled, retailer, hub]);
    await db.query(`INSERT INTO order_items(order_id, product_id, vegetable_name, quantity_kg, price_at_order) VALUES
      ($1,$4,'Tomato',6,50), ($1,$5,'Kamatis',4,50), ($2,$4,'Tomato',8,50), ($3,$4,'Tomato',2,50)`,
    [legacy.pending, legacy.approved, legacy.cancelled, a, b]);
    await db.query('UPDATE products SET stock_kg = CASE id WHEN $1 THEN 12 ELSE 9 END', [a]);
  } });
  try {
    assert.deepEqual(kg(await stock(db)), [18, 13], 'the pending order gave back 6 kg + 4 kg');
    assert.deepEqual(await items(db, legacy.pending), [[null, 6, 50], [null, 4, 50]]);
    assert.equal(await committed(db, legacy.pending), null);
    assert.ok(await committed(db, legacy.approved));
    assert.equal(await committed(db, legacy.cancelled), null);
    await db.exec(migration('inventory_transactions.sql'));
    assert.deepEqual(kg(await stock(db)), [18, 13], 're-running the file converts nothing twice');

    await approve(db, legacy.pending);
    assert.deepEqual(kg(await stock(db)), [8, 13]);
    await db.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [legacy.approved]);
    assert.deepEqual(kg(await stock(db)), [16, 13], 'the old approved order returns its 8 kg once');
  } finally { await db.close(); }
});

test('database and JS aliases agree; inactive and rejected batches stay excluded; RPC permissions are restricted', async () => {
  const db = await setup();
  try {
    for (const name of ['Tomatoes', 'Kamatis', 'Talbos ng Kamote', 'Sweet Potato Leaves', 'water spinach', 'Fresh Red Onion', 'Basilica']) {
      assert.equal(await rpc(db, 'inventory_vegetable_key', [name]), vegetableKey(name));
    }
    for (const status of ['inactive', 'rejected']) {
      await db.query('UPDATE products SET status=$1 WHERE id=$2', [status, a]);
      const rows = await stock(db);
      assert.equal(retailerProducts(rows)[0].available_kg, 13);
      assert.equal(isReceivedBatch(rows[0]), false); assert.equal(batchStatus(rows[0]), status);
    }
    await assert.rejects(buy(db, 14), /not enough/);
    for (const signature of [
      'place_inventory_order(uuid,jsonb,text,double precision,double precision,timestamptz)',
      'cancel_inventory_order(uuid,uuid,text)', 'reduce_inventory_quantity(uuid,uuid,numeric,numeric)',
      'unlist_inventory_product(uuid,uuid)', 'receive_pickup_inventory()', 'commit_order_stock(uuid,uuid)',
      'release_order_stock(uuid)', 'sync_order_stock()', 'cancel_expired_retailer_orders()',
    ]) {
      const row = (await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon, has_function_privilege('authenticated',$1,'EXECUTE') AS auth, has_function_privilege('service_role',$1,'EXECUTE') AS service", [signature])).rows[0];
      assert.deepEqual(row, { anon: false, auth: false, service: true }, signature);
    }
    await assert.rejects(rpc(db, 'cancel_inventory_order', [(await buy(db, 5)).id, farmer, null]), /cannot cancel/);
  } finally { await db.close(); }
});

test('reapplying the original FIFO upgrade never relists completed or rejected batches', async () => {
  const db = await setup();
  try {
    await db.query("UPDATE products SET status='sold_out', stock_kg=0, quantity_received=NULL WHERE id=$1", [a]);
    await db.query("UPDATE products SET status='rejected', quantity_received=NULL WHERE id=$1", [b]);
    await db.exec(migration('fifo_inventory_upgrade.sql'));
    await db.exec(migration('fifo_inventory_upgrade.sql'));
    assert.deepEqual((await stock(db)).map(p => p.status), ['sold_out', 'rejected']);
  } finally { await db.close(); }
});
