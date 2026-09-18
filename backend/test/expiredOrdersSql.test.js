const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// pg_cron is a server-side Postgres extension (not available in PGlite's
// embedded WASM engine), so only the SQL function's own logic is verified
// here — never claim the scheduled job itself runs from this test. The
// scheduling half of sql/expired_retailer_orders.sql can only be verified by
// applying it to the real Supabase project and querying cron.job /
// cron.job_run_details there.
async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE products(id uuid PRIMARY KEY, stock_kg numeric NOT NULL, status text, updated_at timestamptz);
    CREATE TABLE orders(id uuid PRIMARY KEY, status text, preferred_schedule timestamptz);
    CREATE TABLE order_items(order_id uuid, product_id uuid, quantity_kg numeric);
    GRANT ALL ON products, orders, order_items TO anon, authenticated;
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../sql/stock_safety.sql'), 'utf8'));
  // Strip the pg_cron scheduling section (PGlite doesn't have the extension)
  // and apply only the function definition + grants.
  const full = fs.readFileSync(path.join(__dirname, '../sql/expired_retailer_orders.sql'), 'utf8');
  const functionOnly = full.slice(0, full.indexOf('-- ============================================================\n-- Scheduled execution'));
  await db.exec(functionOnly);
  return db;
}
const past = () => new Date(Date.now() - 3600_000).toISOString();
const future = () => new Date(Date.now() + 3600_000).toISOString();

test('cancels only eligible expired non-terminal orders, never delivered/in_transit/cancelled/future-scheduled, restores stock, and is idempotent on rerun', async () => {
  const db = await setup();
  try {
    const batchA = '00000000-0000-0000-0000-0000000000a1';
    const batchB = '00000000-0000-0000-0000-0000000000a2';
    await db.exec(`INSERT INTO products VALUES
      ('${batchA}', 3, 'listed', now()),
      ('${batchB}', 0, 'sold_out', now());`);

    const expiredPending = '00000000-0000-0000-0000-0000000000b1';
    const expiredApproved = '00000000-0000-0000-0000-0000000000b2';
    const futurePending = '00000000-0000-0000-0000-0000000000b3';
    const inTransit = '00000000-0000-0000-0000-0000000000b4';
    const delivered = '00000000-0000-0000-0000-0000000000b5';
    const alreadyCancelled = '00000000-0000-0000-0000-0000000000b6';
    await db.query(
      `INSERT INTO orders(id, status, preferred_schedule) VALUES
        ($1,'pending',$7), ($2,'approved',$7), ($3,'pending',$8),
        ($4,'in_transit',$7), ($5,'delivered',$7), ($6,'cancelled',$7)`,
      [expiredPending, expiredApproved, futurePending, inTransit, delivered, alreadyCancelled, past(), future()]
    );
    // expiredApproved drew 5kg from batchA and 2kg from the already-sold-out batchB.
    await db.query(`INSERT INTO order_items(order_id, product_id, quantity_kg) VALUES
      ($1, $2, 5), ($1, $3, 2)`, [expiredApproved, batchA, batchB]);

    const affected = (await db.query('SELECT cancel_expired_retailer_orders() AS n')).rows[0].n;
    assert.equal(affected, 2, 'only the two expired pending/approved orders are eligible');

    const statuses = Object.fromEntries((await db.query('SELECT id, status FROM orders')).rows.map(r => [r.id, r.status]));
    assert.equal(statuses[expiredPending], 'cancelled');
    assert.equal(statuses[expiredApproved], 'cancelled');
    assert.equal(statuses[futurePending], 'pending', 'a future-scheduled order must never be touched');
    assert.equal(statuses[inTransit], 'in_transit', 'an order already in transit must never be cancelled by this job');
    assert.equal(statuses[delivered], 'delivered', 'a delivered order must never be cancelled');
    assert.equal(statuses[alreadyCancelled], 'cancelled');

    const stock = Object.fromEntries((await db.query('SELECT id, stock_kg, status FROM products')).rows.map(r => [r.id, r]));
    assert.equal(Number(stock[batchA].stock_kg), 8, 'stock is restored to the exact batch it was drawn from');
    assert.equal(stock[batchA].status, 'listed');
    assert.equal(Number(stock[batchB].stock_kg), 2, 'a sold_out batch is restored and flips back to listed');
    assert.equal(stock[batchB].status, 'listed');

    // Rerunning must be a safe no-op: nothing left eligible, no double-restore.
    const secondRun = (await db.query('SELECT cancel_expired_retailer_orders() AS n')).rows[0].n;
    assert.equal(secondRun, 0);
    assert.equal(Number((await db.query('SELECT stock_kg FROM products WHERE id = $1', [batchA])).rows[0].stock_kg), 8);
  } finally { await db.close(); }
});

test('function is locked down to service_role/postgres, never callable by anon or authenticated', async () => {
  const db = await setup();
  try {
    const privileges = (await db.query(
      "SELECT has_function_privilege('anon','cancel_expired_retailer_orders()','EXECUTE') AS anon_ok, " +
      "has_function_privilege('authenticated','cancel_expired_retailer_orders()','EXECUTE') AS auth_ok, " +
      "has_function_privilege('service_role','cancel_expired_retailer_orders()','EXECUTE') AS service_ok"
    )).rows[0];
    assert.equal(privileges.anon_ok, false);
    assert.equal(privileges.auth_ok, false);
    assert.equal(privileges.service_ok, true);
  } finally { await db.close(); }
});
