const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('pickup proof migration and complete_pickup_with_proof: validates GPS/photo/timestamp, checks farmer proximity when known, is idempotent and permission-locked', async () => {
  const db = new PGlite();
  const farmer = '00000000-0000-0000-0000-000000000010';
  const rider = '00000000-0000-0000-0000-000000000011';
  const otherRider = '00000000-0000-0000-0000-000000000012';
  const pickup = '00000000-0000-0000-0000-000000000013';
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE users(id uuid PRIMARY KEY, latitude double precision, longitude double precision);
      CREATE TABLE pickup_requests(id uuid PRIMARY KEY, farmer_id uuid, delivery_personnel_id uuid,
        status text, received_at timestamptz, proof_photo_url text, pod jsonb);
      GRANT ALL ON pickup_requests TO anon, authenticated;
      INSERT INTO users VALUES ('${farmer}', null, null);
      INSERT INTO pickup_requests(id, farmer_id, delivery_personnel_id, status)
        VALUES ('${pickup}', '${farmer}', '${rider}', 'assigned');
    `);
    const migration = fs.readFileSync(path.join(__dirname, '../sql/pickup_tracking_proof.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration); // Reapplying must be safe.

    const photo = 'https://res.cloudinary.com/demo/image/upload/proof.jpg';
    const pod = () => ({ latitude: 7.1, longitude: 125.6, accuracy: 10, captured_at: new Date().toISOString(), submitted_at: new Date().toISOString() });
    const complete = (rider_id, patch = {}) => db.query('SELECT complete_pickup_with_proof($1,$2,$3,$4)',
      [pickup, rider_id, photo, JSON.stringify({ ...pod(), ...patch })]);

    // Wrong rider cannot complete someone else's pickup.
    await assert.rejects(complete(otherRider), /not assigned to you/);
    // Missing/invalid GPS or photo are rejected before any write.
    await assert.rejects(complete(rider, { latitude: null }), /GPS/);
    await assert.rejects(complete(rider, { accuracy: 500 }), /GPS/);
    await assert.rejects(complete(rider, { captured_at: '2000-01-01T00:00:00Z' }), /expired/);
    await assert.rejects(db.query('SELECT complete_pickup_with_proof($1,$2,$3,$4)', [pickup, rider, 'https://evil.test/a.jpg', JSON.stringify(pod())]), /valid proof photo/);
    assert.equal((await db.query('SELECT status FROM pickup_requests')).rows[0].status, 'assigned');

    // No farm coordinates saved yet: GPS/photo alone completes the pickup.
    await complete(rider);
    const saved = (await db.query('SELECT * FROM pickup_requests')).rows[0];
    assert.equal(saved.status, 'picked_up');
    assert.equal(saved.pod.coordinate_source, 'unavailable');
    assert.equal(saved.proof_photo_url, photo);

    // Idempotent retry: a lost response must not fail or overwrite the saved proof.
    await complete(rider, { latitude: 9 });
    assert.equal((await db.query('SELECT pod FROM pickup_requests')).rows[0].pod.latitude, 7.1);
    assert.equal((await db.query("SELECT has_function_privilege('authenticated','complete_pickup_with_proof(uuid,uuid,text,jsonb)','EXECUTE') AS calls, has_function_privilege('service_role','complete_pickup_with_proof(uuid,uuid,text,jsonb)','EXECUTE') AS service")).rows[0].service, true);
  } finally { await db.close(); }
});

test('complete_pickup_with_proof enforces proximity once the farmer has a saved farm location', async () => {
  const db = new PGlite();
  const farmer = '00000000-0000-0000-0000-000000000020';
  const rider = '00000000-0000-0000-0000-000000000021';
  const pickup = '00000000-0000-0000-0000-000000000022';
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE users(id uuid PRIMARY KEY, latitude double precision, longitude double precision);
      CREATE TABLE pickup_requests(id uuid PRIMARY KEY, farmer_id uuid, delivery_personnel_id uuid,
        status text, received_at timestamptz, proof_photo_url text, pod jsonb);
      GRANT ALL ON pickup_requests TO anon, authenticated;
      INSERT INTO users VALUES ('${farmer}', 7.1, 125.6);
      INSERT INTO pickup_requests(id, farmer_id, delivery_personnel_id, status)
        VALUES ('${pickup}', '${farmer}', '${rider}', 'assigned');
    `);
    await db.exec(fs.readFileSync(path.join(__dirname, '../sql/pickup_tracking_proof.sql'), 'utf8'));
    const photo = 'https://res.cloudinary.com/demo/image/upload/proof.jpg';
    const pod = (lat) => ({ latitude: lat, longitude: 125.6, accuracy: 10, captured_at: new Date().toISOString(), submitted_at: new Date().toISOString() });
    const complete = lat => db.query('SELECT complete_pickup_with_proof($1,$2,$3,$4)', [pickup, rider, photo, JSON.stringify(pod(lat))]);
    // ~1km away must be rejected once a farm pin exists.
    await assert.rejects(complete(7.1 + 1000 / 6371000 * 180 / Math.PI), /Move closer/);
    await complete(7.1); // On-site completes normally.
    const saved = (await db.query('SELECT * FROM pickup_requests')).rows[0];
    assert.equal(saved.status, 'picked_up');
    assert.equal(saved.pod.coordinate_source, 'farmer_profile');
    assert.ok(saved.pod.distance_meters < 1);
  } finally { await db.close(); }
});

test('complete_pickup_with_proof also accepts completion from the otw (on the way) status, not only assigned', async () => {
  const db = new PGlite();
  const farmer = '00000000-0000-0000-0000-000000000030';
  const rider = '00000000-0000-0000-0000-000000000031';
  const pickup = '00000000-0000-0000-0000-000000000032';
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE users(id uuid PRIMARY KEY, latitude double precision, longitude double precision);
      CREATE TABLE pickup_requests(id uuid PRIMARY KEY, farmer_id uuid, delivery_personnel_id uuid,
        status text, received_at timestamptz, proof_photo_url text, pod jsonb);
      GRANT ALL ON pickup_requests TO anon, authenticated;
      INSERT INTO users VALUES ('${farmer}', null, null);
      INSERT INTO pickup_requests(id, farmer_id, delivery_personnel_id, status)
        VALUES ('${pickup}', '${farmer}', '${rider}', 'otw');
    `);
    await db.exec(fs.readFileSync(path.join(__dirname, '../sql/pickup_tracking_proof.sql'), 'utf8'));
    const photo = 'https://res.cloudinary.com/demo/image/upload/proof.jpg';
    const pod = { latitude: 7.1, longitude: 125.6, accuracy: 10, captured_at: new Date().toISOString(), submitted_at: new Date().toISOString() };
    await db.query('SELECT complete_pickup_with_proof($1,$2,$3,$4)', [pickup, rider, photo, JSON.stringify(pod)]);
    assert.equal((await db.query('SELECT status FROM pickup_requests')).rows[0].status, 'picked_up');
  } finally { await db.close(); }
});
