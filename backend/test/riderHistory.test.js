const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { routeHarness } = require('./routeHarness');
const { pickupCompletedAt, deliveryCompletedAt } = require('../lib/riderHistory');

// Rider History reads the rider's persisted pickups and deliveries. These tests run
// the real completion functions on PostgreSQL, then the real rider routes on the
// saved rows: a completed record keeps its rider and gains a completion time; a
// failed completion changes nothing, so the task stays open and can be retried.

const sql = (file) => fs.readFileSync(path.join(__dirname, '../sql', file), 'utf8');
const photo = 'https://res.cloudinary.com/demo/image/upload/proof.jpg';
const pod = (patch = {}) => JSON.stringify({ latitude: 7.1, longitude: 125.6, accuracy: 10,
  captured_at: new Date().toISOString(), submitted_at: new Date().toISOString(), ...patch });
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const rider = id(2), farmer = id(10), retailer = id(1), hub = id(20);

async function pickupDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE users(id uuid PRIMARY KEY, latitude double precision, longitude double precision);
    CREATE TABLE pickup_requests(id uuid PRIMARY KEY, farmer_id uuid, delivery_personnel_id uuid,
      status text, requested_at timestamptz, received_at timestamptz, proof_photo_url text, pod jsonb);
    INSERT INTO users VALUES ('${farmer}', null, null);
    INSERT INTO pickup_requests(id, farmer_id, delivery_personnel_id, status, requested_at) VALUES
      ('${id(101)}', '${farmer}', '${rider}', 'otw', '2026-09-30T08:54:00Z'),
      ('${id(102)}', '${farmer}', '${rider}', 'assigned', '2026-10-01T00:00:00Z'),
      ('${id(103)}', '${farmer}', '${rider}', 'otw', '2026-10-02T00:00:00Z');
  `);
  await db.exec(sql('pickup_tracking_proof.sql'));
  return db;
}

async function deliveryDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
    CREATE TYPE order_status AS ENUM ('pending','approved','picked_up','in_transit','delivered','cancelled');
    CREATE TABLE users(id uuid PRIMARY KEY, latitude double precision, longitude double precision, store_location text);
    CREATE TABLE delivery_addresses(user_id uuid, address text, latitude double precision, longitude double precision);
    CREATE TABLE orders(id uuid PRIMARY KEY, retailer_id uuid, delivery_personnel_id uuid, status order_status,
      preferred_schedule timestamptz, delivery_address text, delivery_latitude double precision, delivery_longitude double precision, distributor_id uuid,
      assigned_at timestamptz, in_transit_at timestamptz, delivered_at timestamptz, created_at timestamptz DEFAULT now());
    CREATE TABLE deliveries(id uuid PRIMARY KEY, order_id uuid REFERENCES orders(id), delivery_personnel_id uuid,
      status text, proof_photo_url text, delivered_at timestamptz);
    INSERT INTO users VALUES ('${retailer}',7.1,125.6,'Store');
    INSERT INTO delivery_addresses VALUES ('${retailer}','Store',7.1,125.6);
    INSERT INTO orders(id, retailer_id, delivery_personnel_id, status, preferred_schedule, delivery_address, distributor_id) VALUES
      ('${id(201)}','${retailer}','${rider}','in_transit','2000-01-01','Store','${hub}'),
      ('${id(202)}','${retailer}','${rider}','in_transit','2000-01-01','Store','${hub}'),
      ('${id(203)}','${retailer}','${rider}','in_transit','2000-01-01','Store','${hub}');
    INSERT INTO deliveries VALUES
      ('${id(301)}','${id(201)}','${rider}','in_transit',null,null),
      ('${id(302)}','${id(202)}','${rider}','in_transit',null,null),
      ('${id(303)}','${id(203)}','${rider}','in_transit',null,null);
  `);
  await db.exec(sql('delivery_proof.sql'));
  await db.exec(sql('delivery_location_policy.sql'));
  await db.exec(sql('delivery_proof_relax_radius_migration.sql'));
  return db;
}

const completePickup = (db, pickupId, patch) => db.query('SELECT complete_pickup_with_proof($1,$2,$3,$4)', [pickupId, rider, photo, pod(patch)]);
const completeDelivery = (db, deliveryId, patch) => db.query('SELECT complete_delivery_with_proof($1,$2,$3,$4)', [deliveryId, rider, photo, pod(patch)]);
const pause = () => new Promise((resolve) => setTimeout(resolve, 15));

test('completion helpers use the stored completion time and never invent one', () => {
  assert.equal(pickupCompletedAt({ status: 'picked_up', received_at: '2026-10-06T02:36:00Z', requested_at: '2026-09-30T00:00:00Z' }), '2026-10-06T02:36:00Z');
  assert.equal(pickupCompletedAt({ status: 'otw', received_at: null }), null);
  assert.equal(deliveryCompletedAt({ status: 'delivered', delivered_at: '2026-10-05T09:00:00Z', deliveries: [{ status: 'delivered', delivered_at: '2026-10-05T08:59:59Z' }] }), '2026-10-05T08:59:59Z');
  // The order row may lag the delivery row; the delivery decides.
  assert.equal(deliveryCompletedAt({ status: 'in_transit', deliveries: [{ status: 'delivered', delivered_at: '2026-10-05T09:00:00Z' }] }), '2026-10-05T09:00:00Z');
  assert.equal(deliveryCompletedAt({ status: 'unsuccessful', deliveries: [{ status: 'unsuccessful' }] }), null);
  // An order's own 'picked_up' status (rider collected it) is not a completed delivery.
  assert.equal(deliveryCompletedAt({ status: 'picked_up', deliveries: [{ status: 'picked_up' }] }), null);
});

test('A + E (pickups): a completed pickup is persisted with its rider and time and reaches History; a failed one stays an open task', async () => {
  const db = await pickupDb();
  try {
    await completePickup(db, id(101));
    await pause();
    await completePickup(db, id(103));
    // E: a final completion that fails (here: GPS rejected) writes nothing.
    await assert.rejects(completePickup(db, id(102), { accuracy: 500 }), /GPS/);
    // A retry after a lost response returns success without a second record or a new time.
    const before = (await db.query('SELECT received_at FROM pickup_requests WHERE id = $1', [id(101)])).rows[0].received_at;
    await completePickup(db, id(101));
    const rows = (await db.query('SELECT * FROM pickup_requests ORDER BY id')).rows;
    assert.equal(rows.length, 3, 'nothing deleted, nothing duplicated');
    assert.deepEqual(rows.map((r) => [r.id, r.status, r.delivery_personnel_id === rider, r.received_at != null]),
      [[id(101), 'picked_up', true, true], [id(102), 'assigned', true, false], [id(103), 'picked_up', true, true]]);
    assert.equal(rows[0].received_at.getTime(), before.getTime(), 'retry keeps the original completion time');

    // The rider route, on exactly these persisted rows (the same rows after an app restart).
    const data = {
      users: [{ id: rider, role: 'delivery_personnel' }, { id: farmer, full_name: 'Ana', farm_location: 'Farm' }],
      pickup_requests: rows.map((r) => ({ ...r, requested_at: r.requested_at.toISOString(), received_at: r.received_at?.toISOString() ?? null, received_by: hub })),
    };
    data.users.push({ id: hub, full_name: 'Hub' });
    const call = routeHarness(data);
    const res = await call('get /api/pickup-requests', rider);
    assert.equal(res.statusCode, 200);
    const byId = Object.fromEntries(res.body.map((p) => [p.id, p]));
    assert.deepEqual(Object.keys(byId).sort(), [id(101), id(102), id(103)], 'completed pickups stay in the rider list');
    assert.equal(byId[id(101)].completed_at, rows[0].received_at.toISOString());
    assert.ok(byId[id(103)].completed_at > byId[id(101)].completed_at, 'completion times are kept per pickup');
    assert.equal(byId[id(102)].completed_at, null);
    assert.equal(byId[id(102)].status, 'assigned', 'the failed one is still an open task');
    assert.deepEqual([byId[id(101)].distributor_name, byId[id(101)].proof_photo_url, byId[id(101)].pod?.latitude], ['Hub', photo, 7.1]);
  } finally { await db.close(); }
});

test('B + E (deliveries): a completed delivery is persisted with its rider and time and reaches History; a failed one stays open', async () => {
  const db = await deliveryDb();
  try {
    await completeDelivery(db, id(301));
    await pause();
    await completeDelivery(db, id(303));
    await assert.rejects(completeDelivery(db, id(302), { latitude: null }), /GPS/);
    await completeDelivery(db, id(301)); // retry: no change
    const orders = (await db.query('SELECT * FROM orders ORDER BY id')).rows;
    const deliveries = (await db.query('SELECT * FROM deliveries ORDER BY id')).rows;
    assert.deepEqual(orders.map((o) => [o.status, o.delivery_personnel_id === rider, o.delivered_at != null]),
      [['delivered', true, true], ['in_transit', true, false], ['delivered', true, true]]);
    assert.deepEqual(deliveries.map((d) => [d.status, d.delivery_personnel_id === rider, d.delivered_at != null]),
      [['delivered', true, true], ['in_transit', true, false], ['delivered', true, true]]);

    const iso = (v) => (v ? v.toISOString() : null);
    const data = {
      users: [{ id: rider, role: 'delivery_personnel' }, { id: retailer, full_name: 'Store One' }, { id: hub, full_name: 'Hub' }],
      orders: orders.map((o) => ({ ...o, preferred_schedule: iso(o.preferred_schedule), delivered_at: iso(o.delivered_at), created_at: iso(o.created_at),
        order_items: [], deliveries: deliveries.filter((d) => d.order_id === o.id).map((d) => ({ ...d, delivered_at: iso(d.delivered_at) })) })),
    };
    const call = routeHarness(data);
    const res = await call('get /api/delivery/orders', rider);
    assert.equal(res.statusCode, 200);
    const byId = Object.fromEntries(res.body.map((o) => [o.id, o]));
    assert.deepEqual(Object.keys(byId).sort(), [id(201), id(202), id(203)], 'delivered orders stay in the rider list');
    assert.equal(byId[id(201)].completed_at, iso(deliveries[0].delivered_at));
    assert.ok(byId[id(203)].completed_at > byId[id(201)].completed_at);
    assert.equal(byId[id(202)].completed_at, null);
    assert.equal(byId[id(202)].status, 'in_transit', 'the failed one is still an open task');
  } finally { await db.close(); }
});
