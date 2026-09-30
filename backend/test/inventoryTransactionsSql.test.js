const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { retailerProducts, isActiveBatch, isReceivedBatch, batchStatus } = require('../lib/batches');
const { vegetableKey } = require('../lib/vegetables');

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const hub = id(1), retailer = id(2), farmer = id(3), a = id(10), b = id(11);
const migration = file => fs.readFileSync(path.join(__dirname, '../sql', file), 'utf8');
const rpc = (db, fn, values) => db.query(`SELECT to_jsonb(public.${fn}(${values.map((_, i) => `$${i + 1}`).join(',')})) AS result`, values).then(r => r.rows[0].result);
const buy = (db, quantity = 30, items = [{ vegetable_name: 'Tomato', quantity_kg: quantity }]) =>
  rpc(db, 'place_inventory_order', [retailer, JSON.stringify(items), 'Store', 14.1, 121.2, new Date(Date.now() + 86400000).toISOString()]);
const stock = db => db.query('SELECT * FROM products ORDER BY harvest_date, id').then(r => r.rows);

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE users(id uuid PRIMARY KEY, role text);
    CREATE TABLE harvests(id uuid PRIMARY KEY, farmer_id uuid, vegetable_name text, quantity_kg numeric(10,2), status text, recorded_at timestamptz);
    CREATE TABLE pickup_requests(id uuid PRIMARY KEY, harvest_id uuid, farmer_id uuid, received_by uuid, status text, received_at timestamptz);
    CREATE TABLE products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), distributor_id uuid REFERENCES users,
      vegetable_name text, stock_kg numeric(10,2) NOT NULL, price_per_kg numeric(10,2), quantity_received numeric(10,2),
      status text, harvest_id uuid, pickup_request_id uuid, farmer_id uuid, harvest_date timestamptz,
      batch_photo_url text, updated_at timestamptz);
    CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), retailer_id uuid REFERENCES users,
      distributor_id uuid REFERENCES users, total_amount numeric(10,2), status text, delivery_address text,
      delivery_latitude double precision, delivery_longitude double precision,
      preferred_schedule timestamptz, cancellation_reason text, created_at timestamptz DEFAULT now());
    CREATE TABLE order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES orders,
      product_id uuid REFERENCES products, vegetable_name text, quantity_kg numeric(10,2), price_at_order numeric(10,2));
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    INSERT INTO users VALUES ('${hub}', 'distributor'), ('${retailer}', 'retailer'), ('${farmer}', 'farmer');
    INSERT INTO products(id, distributor_id, vegetable_name, stock_kg, price_per_kg, quantity_received, status, harvest_date, batch_photo_url)
    VALUES ('${a}','${hub}','Tomato',26,50,26,'listed','2026-09-15','photo-a'),
      ('${b}','${hub}','Kamatis',13,50,13,'listed','2026-09-16','photo-b');
  `);
  await db.exec(migration('stock_safety.sql'));
  await db.exec(migration('batch_lifecycle.sql'));
  await db.exec(migration('inventory_transactions.sql'));
  return db;
}

test('SQL FIFO scenarios A-E retain separate batches/photos, sold-out history and one restocked listing', async () => {
  const db = await setup();
  try {
    await db.exec(migration('inventory_transactions.sql'));
    await db.exec('SET ROLE service_role');
    let listing = retailerProducts(await stock(db));
    assert.equal(listing.length, 1); assert.equal(listing[0].available_kg, 39);
    assert.deepEqual(listing[0].batch_photos, ['photo-a', 'photo-b']);
    const order = await buy(db);
    assert.equal(Number(order.total_amount), 1500);
    let rows = await stock(db);
    assert.deepEqual(rows.map(p => [Number(p.stock_kg), p.status]), [[0, 'sold_out'], [9, 'listed']]);
    assert.deepEqual((await db.query('SELECT product_id, quantity_kg FROM order_items ORDER BY quantity_kg DESC')).rows.map(r => [r.product_id, Number(r.quantity_kg)]), [[a, 26], [b, 4]]);
    assert.equal(rows[0].batch_photo_url, 'photo-a');
    await buy(db, 9);
    rows = await stock(db);
    assert.ok(rows.every(p => !isActiveBatch(p) && !isReceivedBatch(p) && batchStatus(p) === 'sold_out'));
    assert.equal(retailerProducts(rows)[0].available_kg, 0);
    await db.query("INSERT INTO products(distributor_id,vegetable_name,stock_kg,price_per_kg,status) VALUES($1,'Tomato',18,50,'listed')", [hub]);
    listing = retailerProducts(await stock(db));
    assert.equal(listing.length, 1); assert.equal(listing[0].available_kg, 18);
  } finally { await db.close(); }
});

test('checkout failures roll back every stock draw, order and order item', async () => {
  const db = await setup();
  try {
    await db.exec(`CREATE FUNCTION fail_second_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.product_id = '${b}' THEN RAISE EXCEPTION 'injected item failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER fail_item BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION fail_second_item();`);
    await assert.rejects(buy(db), /injected item failure/);
    assert.deepEqual((await stock(db)).map(p => Number(p.stock_kg)), [26, 13]);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM order_items')).rows[0].n, 0);
    await db.exec('DROP TRIGGER fail_item ON order_items');
    await assert.rejects(buy(db, 40), /not enough/);
    await assert.rejects(buy(db, 0, [{ vegetable_name: 'Tomato', quantity_kg: 5.001 }]), /positive quantity/);
    assert.deepEqual((await stock(db)).map(p => Number(p.stock_kg)), [26, 13]);
    const outcomes = await Promise.allSettled([buy(db, 30), buy(db, 30)]);
    assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await stock(db)).reduce((n, p) => n + Number(p.stock_kg), 0), 9);
  } finally { await db.close(); }
});

test('cancellation restores exact batches once without reviving archived stock; failures roll back', async () => {
  const db = await setup();
  try {
    const order = await buy(db);
    await db.exec(`CREATE FUNCTION fail_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.id = '${b}' AND NEW.stock_kg > OLD.stock_kg THEN RAISE EXCEPTION 'injected restore failure'; END IF;
      RETURN NEW; END; $$; CREATE TRIGGER fail_restore BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION fail_restore();`);
    await assert.rejects(rpc(db, 'cancel_inventory_order', [order.id, retailer, null]), /injected restore failure/);
    assert.deepEqual((await stock(db)).map(p => Number(p.stock_kg)), [0, 9]);
    assert.equal((await db.query('SELECT status FROM orders')).rows[0].status, 'pending');
    await db.exec('DROP TRIGGER fail_restore ON products');
    await db.query("UPDATE products SET status = 'archived' WHERE id = $1", [a]);
    await rpc(db, 'cancel_inventory_order', [order.id, retailer, null]);
    assert.deepEqual((await stock(db)).map(p => [Number(p.stock_kg), p.status]), [[26, 'archived'], [13, 'listed']]);
    await assert.rejects(rpc(db, 'cancel_inventory_order', [order.id, retailer, null]), /already updated/);
    assert.deepEqual((await stock(db)).map(p => Number(p.stock_kg)), [26, 13]);
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
    assert.deepEqual((await stock(db)).map(p => Number(p.stock_kg)), [26, 13]);
    await db.exec('DROP TRIGGER fail_reduction ON products');
    await rpc(db, 'reduce_inventory_quantity', [a, hub, 39, 9]);
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

test('expiry restores archived batches without returning them to Stocks and cannot restore twice', async () => {
  const db = await setup();
  try {
    const order = await buy(db, 39);
    await db.query("UPDATE products SET status = 'archived'");
    await db.query("UPDATE orders SET preferred_schedule = now() - interval '1 hour' WHERE id=$1", [order.id]);
    assert.equal(await rpc(db, 'cancel_expired_retailer_orders', []), 1);
    assert.equal(await rpc(db, 'cancel_expired_retailer_orders', []), 0);
    assert.deepEqual((await stock(db)).map(p => [Number(p.stock_kg), p.status]), [[26, 'archived'], [13, 'archived']]);
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
      'unlist_inventory_product(uuid,uuid)', 'receive_pickup_inventory()',
    ]) {
      const row = (await db.query("SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon, has_function_privilege('authenticated',$1,'EXECUTE') AS auth, has_function_privilege('service_role',$1,'EXECUTE') AS service", [signature])).rows[0];
      assert.deepEqual(row, { anon: false, auth: false, service: true });
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
