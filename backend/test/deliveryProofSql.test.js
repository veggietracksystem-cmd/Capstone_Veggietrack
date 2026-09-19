const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('PostgreSQL migration, scheduling triggers, atomic progression/POD, permissions and retries', async () => {
  const db = new PGlite();
  const retailer = '00000000-0000-0000-0000-000000000001';
  const rider = '00000000-0000-0000-0000-000000000002';
  const order = '00000000-0000-0000-0000-000000000003';
  const delivery = '00000000-0000-0000-0000-000000000004';
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
      CREATE TYPE order_status AS ENUM ('pending','approved','picked_up','in_transit','delivered','cancelled');
      CREATE TABLE users(id uuid PRIMARY KEY, latitude double precision, longitude double precision, store_location text);
      CREATE TABLE delivery_addresses(user_id uuid, address text, latitude double precision, longitude double precision);
      CREATE TABLE orders(id uuid PRIMARY KEY, retailer_id uuid, delivery_personnel_id uuid, status order_status,
        preferred_schedule timestamptz, delivery_address text, delivery_latitude double precision, delivery_longitude double precision, distributor_id uuid,
        assigned_at timestamptz, in_transit_at timestamptz, delivered_at timestamptz);
      CREATE TABLE deliveries(id uuid PRIMARY KEY, order_id uuid REFERENCES orders(id), delivery_personnel_id uuid,
        status text, proof_photo_url text, delivered_at timestamptz);
      GRANT ALL ON orders, deliveries TO anon, authenticated;
      INSERT INTO users VALUES ('${retailer}',7.1,125.6,'Store');
      INSERT INTO delivery_addresses VALUES ('${retailer}','Store',7.1,125.6);
      INSERT INTO orders VALUES ('${order}','${retailer}','${rider}','approved','2000-01-01','Store',null,null,null);
      INSERT INTO deliveries VALUES ('${delivery}','${order}','${rider}','assigned',null,null);
    `);
    const migration = fs.readFileSync(path.join(__dirname, '../sql/delivery_proof.sql'), 'utf8');
    assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name IN ('delivery_latitude','delivery_longitude')")).rows.length, 2);
    await db.exec(migration);
    assert.equal((await db.query("SELECT data_type FROM information_schema.columns WHERE table_name='deliveries' AND column_name='pod'")).rows[0].data_type, 'jsonb');
    await db.exec(migration); // Reapplying must preserve historical proof/data.
    assert.equal((await db.query('SELECT delivery_latitude FROM orders')).rows[0].delivery_latitude, 7.1);
    const policyMigration = fs.readFileSync(path.join(__dirname, '../sql/delivery_location_policy.sql'), 'utf8');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('users','orders','deliveries','delivery_addresses')")).rows[0].n, 4);
    await db.exec(policyMigration);
    assert.equal((await db.query("SELECT data_type FROM information_schema.columns WHERE table_name='users' AND column_name='current_location_accuracy'")).rows[0].data_type, 'double precision');
    await db.exec(policyMigration); // The combined rollout is safe for already-migrated installations.
    // Applied on top, same as against the hosted project — relaxes the
    // distance-from-destination check from a hard block to a recorded status.
    await db.exec(fs.readFileSync(path.join(__dirname, '../sql/delivery_proof_relax_radius_migration.sql'), 'utf8'));
    await db.query("UPDATE orders SET status = 'approved' WHERE id = $1", [order]); // Old schedule does not prevent unrelated updates.
    await assert.rejects(db.query("UPDATE orders SET preferred_schedule = '1999-01-01' WHERE id = $1", [order]), /past/);
    await assert.rejects(db.query("INSERT INTO orders(id,preferred_schedule) VALUES ('00000000-0000-0000-0000-000000000005',now()-interval '1 minute')"), /past/);
    await db.query("UPDATE orders SET preferred_schedule = now()+interval '1 day' WHERE id = $1", [order]);
    const advance = status => db.query('SELECT advance_delivery_status($1,$2,$3)', [delivery,rider,status]);
    await assert.rejects(advance('in_transit'), /transition/);
    await advance('picked_up');
    // The order must actually pass through 'picked_up' (a distinct order_status
    // value, shown as its own step in the retailer/distributor UI) rather than
    // jumping straight to 'in_transit'.
    assert.equal((await db.query('SELECT status FROM orders')).rows[0].status, 'picked_up');
    await advance('picked_up'); // Retry safe.
    await advance('in_transit');
    assert.equal((await db.query('SELECT status FROM orders')).rows[0].status, 'in_transit');
    const pod = { latitude:7.1, longitude:125.6, accuracy:10, captured_at:new Date().toISOString(), submitted_at:new Date().toISOString() };
    const complete = (patch = {}, person = rider) => db.query('SELECT complete_delivery_with_proof($1,$2,$3,$4)', [delivery,person,'https://res.cloudinary.com/demo/image/upload/proof.jpg',JSON.stringify({...pod,...patch})]);
    await assert.rejects(complete({}, retailer), /assigned/);
    await assert.rejects(complete({accuracy:1000}), /GPS signal is too inaccurate/);
    await assert.rejects(complete({captured_at:'2000-01-01T00:00:00Z'}), /expired/);
    await assert.rejects(complete({captured_at:new Date(Date.now()-61000).toISOString()}), /expired/);
    assert.equal((await db.query('SELECT status FROM deliveries')).rows[0].status, 'in_transit');
    // Force a failure in the second update: PostgreSQL must roll back the first.
    await db.exec("CREATE FUNCTION fail_order_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$; CREATE TRIGGER fail_order_update BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION fail_order_update();");
    await assert.rejects(complete(), /forced failure/);
    const unchanged = (await db.query('SELECT status,pod,proof_photo_url FROM deliveries')).rows[0];
    assert.equal(unchanged.status, 'in_transit'); assert.equal(unchanged.pod, null); assert.equal(unchanged.proof_photo_url, null);
    await db.exec('DROP TRIGGER fail_order_update ON orders');
    // Accuracy overlap is accepted; arbitrary 1km uncertainty above remains rejected.
    await complete({latitude:7.1+115/6371000*180/Math.PI,accuracy:20});
    const saved = (await db.query('SELECT * FROM deliveries')).rows[0];
    assert.ok(Math.abs(saved.pod.distance_meters-115)<0.01); assert.equal(saved.pod.effective_radius_meters,120);
    assert.equal(saved.pod.coordinate_source,'order_snapshot'); assert.equal(saved.pod.location_status,'verified');
    assert.equal(saved.status,'delivered'); assert.equal((await db.query('SELECT status FROM orders')).rows[0].status,'delivered');
    await complete({latitude:8}); // Idempotent: cannot replace an existing proof.
    assert.equal((await db.query('SELECT pod FROM deliveries')).rows[0].pod.latitude,saved.pod.latitude);
    await assert.rejects(advance('picked_up'), /transition/);
    const privileges = (await db.query("SELECT has_table_privilege('authenticated','deliveries','UPDATE') AS writes, has_function_privilege('authenticated','complete_delivery_with_proof(uuid,uuid,text,jsonb)','EXECUTE') AS calls, has_function_privilege('service_role','complete_delivery_with_proof(uuid,uuid,text,jsonb)','EXECUTE') AS service")).rows[0];
    assert.equal(privileges.writes,false); assert.equal(privileges.calls,false); assert.equal(privileges.service,true);
  } finally { await db.close(); }
});

test('combined rollout safely adds inspected missing columns and rejects mismatched schemas', async () => {
  const db = new PGlite();
  const migration = fs.readFileSync(path.join(__dirname, '../sql/delivery_location_policy.sql'), 'utf8');
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
      CREATE TABLE users(id uuid PRIMARY KEY,latitude numeric,longitude numeric,store_location text);
      CREATE TABLE delivery_addresses(user_id uuid,address text,latitude numeric,longitude numeric);
      CREATE TABLE orders(id uuid PRIMARY KEY,retailer_id uuid,distributor_id uuid,delivery_personnel_id uuid,status text,delivery_address text,preferred_schedule timestamptz);
      CREATE TABLE deliveries(id uuid PRIMARY KEY,order_id uuid,delivery_personnel_id uuid,status text,proof_photo_url text,delivered_at timestamptz);`);
    const missing = await db.query("SELECT column_name FROM information_schema.columns WHERE column_name IN ('delivery_latitude','delivery_longitude','current_location_accuracy','pod')");
    assert.equal(missing.rows.length,0);
    await db.exec(migration);
    assert.equal((await db.query("SELECT column_name FROM information_schema.columns WHERE column_name IN ('delivery_latitude','delivery_longitude','current_location_accuracy','pod')")).rows.length,4);
    await db.exec('ALTER TABLE users ALTER COLUMN current_location_accuracy TYPE text');
    assert.equal((await db.query("SELECT data_type FROM information_schema.columns WHERE table_name='users' AND column_name='current_location_accuracy'")).rows[0].data_type,'text');
    await assert.rejects(db.exec(migration),/Existing column type mismatch/);
    await db.exec('ROLLBACK');
  } finally { await db.close(); }
});

test('delivery far from destination still completes — GPS is recorded, not a gate', async () => {
  const db = new PGlite();
  const retailer = '00000000-0000-0000-0000-000000000011';
  const rider = '00000000-0000-0000-0000-000000000012';
  const order = '00000000-0000-0000-0000-000000000013';
  const delivery = '00000000-0000-0000-0000-000000000014';
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
      CREATE TYPE order_status AS ENUM ('pending','approved','picked_up','in_transit','delivered','cancelled');
      CREATE TABLE users(id uuid PRIMARY KEY, latitude double precision, longitude double precision, store_location text);
      CREATE TABLE delivery_addresses(user_id uuid, address text, latitude double precision, longitude double precision);
      CREATE TABLE orders(id uuid PRIMARY KEY, retailer_id uuid, delivery_personnel_id uuid, status order_status,
        preferred_schedule timestamptz, delivery_address text, delivery_latitude double precision, delivery_longitude double precision, distributor_id uuid,
        assigned_at timestamptz, in_transit_at timestamptz, delivered_at timestamptz);
      CREATE TABLE deliveries(id uuid PRIMARY KEY, order_id uuid REFERENCES orders(id), delivery_personnel_id uuid,
        status text, proof_photo_url text, delivered_at timestamptz);
      GRANT ALL ON orders, deliveries TO anon, authenticated;
      INSERT INTO users VALUES ('${retailer}',7.1,125.6,'Store');
      INSERT INTO delivery_addresses VALUES ('${retailer}','Store',7.1,125.6);
      INSERT INTO orders VALUES ('${order}','${retailer}','${rider}','in_transit','2000-01-01','Store',null,null,null);
      INSERT INTO deliveries VALUES ('${delivery}','${order}','${rider}','in_transit',null,null);
    `);
    await db.exec(fs.readFileSync(path.join(__dirname, '../sql/delivery_proof.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../sql/delivery_location_policy.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../sql/delivery_proof_relax_radius_migration.sql'), 'utf8'));
    // ~11km away — nowhere near the old 100-150m radius — but photo/GPS/time are valid, so it still completes.
    const pod = { latitude: 7.2, longitude: 125.6, accuracy: 10, captured_at: new Date().toISOString(), submitted_at: new Date().toISOString() };
    await db.query('SELECT complete_delivery_with_proof($1,$2,$3,$4)',
      [delivery, rider, 'https://res.cloudinary.com/demo/image/upload/proof.jpg', JSON.stringify(pod)]);
    const saved = (await db.query('SELECT status,pod FROM deliveries')).rows[0];
    assert.equal(saved.status, 'delivered');
    assert.equal(saved.pod.location_status, 'unverified');
    assert.ok(saved.pod.distance_meters > saved.pod.effective_radius_meters);
    assert.equal((await db.query('SELECT status FROM orders')).rows[0].status, 'delivered');
  } finally { await db.close(); }
});
