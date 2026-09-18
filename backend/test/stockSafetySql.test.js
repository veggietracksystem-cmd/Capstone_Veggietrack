const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE products(id uuid PRIMARY KEY, stock_kg numeric NOT NULL, status text, updated_at timestamptz);
    GRANT ALL ON products TO anon, authenticated;
    INSERT INTO products VALUES ('00000000-0000-0000-0000-000000000001', 10, 'listed');
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../sql/stock_safety.sql'), 'utf8'));
  return db;
}
const id = '00000000-0000-0000-0000-000000000001';
// Mirrors how supabase-js's .rpc() actually calls a scalar/composite-returning
// function: PostgREST serializes the return value through to_jsonb before
// sending it as the HTTP response, so a NULL composite becomes JSON null (an
// object property, not raw "SELECT * FROM func()" table expansion, which
// would instead yield a row of all-NULL columns that looks truthy).
const call = (db, fn, args) => db.query(`SELECT to_jsonb(${fn}($1,$2)) AS result`, args).then(r => r.rows[0].result);

test('stock_safety migration is safe to reapply and the CHECK constraint blocks negative stock at the row level', async () => {
  const db = await setup();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, '../sql/stock_safety.sql'), 'utf8')); // idempotent reapply
    await assert.rejects(db.query('UPDATE products SET stock_kg = -1 WHERE id = $1', [id]), /products_stock_kg_non_negative|violates check constraint/);
    const privileges = (await db.query("SELECT has_function_privilege('authenticated','decrement_product_stock(uuid,numeric)','EXECUTE') AS calls, has_function_privilege('service_role','decrement_product_stock(uuid,numeric)','EXECUTE') AS service")).rows[0];
    assert.equal(privileges.calls, false); assert.equal(privileges.service, true);
  } finally { await db.close(); }
});

test('decrement_product_stock is an atomic guarded decrement: succeeds within stock, fails over stock (true NULL, not an all-null row), flips sold_out at zero, rejects non-positive quantity', async () => {
  const db = await setup();
  try {
    const decrement = qty => call(db, 'decrement_product_stock', [id, qty]);
    let result = await decrement(4);
    assert.equal(Number(result.stock_kg), 6); assert.equal(result.status, 'listed');
    result = await decrement(6);
    assert.equal(Number(result.stock_kg), 0); assert.equal(result.status, 'sold_out');
    // No stock left: the guarded UPDATE matches no row, so the function must
    // return a genuine SQL NULL — never an all-null row that looks truthy.
    assert.equal(await decrement(1), null);
    assert.equal(Number((await db.query('SELECT stock_kg FROM products')).rows[0].stock_kg), 0);
    for (const bad of [0, -1, NaN]) assert.equal(await decrement(bad), null);
  } finally { await db.close(); }
});

test('two overlapping decrements for more than total stock: exactly one wins and stock never goes negative (lost-update race closed by the atomic guarded UPDATE)', async () => {
  const db = await setup(); // stock_kg = 10
  try {
    const [a, b] = await Promise.all([
      call(db, 'decrement_product_stock', [id, 7]),
      call(db, 'decrement_product_stock', [id, 7]),
    ]);
    const succeeded = [a, b].filter(r => r !== null);
    assert.equal(succeeded.length, 1, 'exactly one of the two overlapping 7kg draws against 10kg stock must win');
    const finalStock = Number((await db.query('SELECT stock_kg FROM products')).rows[0].stock_kg);
    assert.equal(finalStock, 3);
    assert.ok(finalStock >= 0);
  } finally { await db.close(); }
});

test('restore_product_stock increments stock, flips sold_out back to listed, preserves any other status, and rejects non-positive quantity', async () => {
  const db = await setup();
  try {
    await db.query("UPDATE products SET stock_kg = 0, status = 'sold_out' WHERE id = $1", [id]);
    let result = await call(db, 'restore_product_stock', [id, 5]);
    assert.equal(Number(result.stock_kg), 5); assert.equal(result.status, 'listed');
    await db.query("UPDATE products SET status = 'received' WHERE id = $1", [id]);
    result = await call(db, 'restore_product_stock', [id, 2]);
    assert.equal(result.status, 'received', 'a batch already unlisted back to received must not be relisted by a restore');
    for (const bad of [0, -1]) assert.equal(await call(db, 'restore_product_stock', [id, bad]), null);
  } finally { await db.close(); }
});
