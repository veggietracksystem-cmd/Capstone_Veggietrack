const test = require('node:test');
const assert = require('node:assert/strict');
const { hub, b, migration, rpc, buy, approve, manilaDayStart, stock, kg, setup } = require('./inventoryDb');

// PGlite does not support pg_cron, so only the SQL function is tested here; the
// scheduled job must be verified on the Supabase project.
const expiryFunction = file => {
  const sql = migration(file).replace(/\r\n/g, '\n');
  const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.cancel_expired_retailer_orders()');
  return sql.slice(start, sql.indexOf('$$;', start) + 3);
};
const cronFile = () => {
  const full = migration('expired_retailer_orders.sql').replace(/\r\n/g, '\n');
  return full.slice(0, full.indexOf('-- ============================================================\n-- Scheduled execution'));
};

test('expired_retailer_orders.sql installs the same function as inventory_transactions.sql', () => {
  const copy = expiryFunction('expired_retailer_orders.sql');
  assert.ok(copy.includes("SET status = 'unsuccessful'"));
  assert.equal(copy, expiryFunction('inventory_transactions.sql'));
});

test('orders not delivered by the end of their scheduled day become unsuccessful for every role; final orders and today\'s orders are untouched; runs once', async () => {
  const db = await setup();
  try {
    await db.exec(cronFile()); // either file's copy may be the one installed
    await db.query('UPDATE products SET stock_kg = 20, quantity_received = 20 WHERE id = $1', [b]);
    const today = await manilaDayStart(db); // 00:00 today, Philippine time
    const yesterdayLastSecond = new Date(new Date(today).getTime() - 1000).toISOString();
    const approvedYesterday = await buy(db, 30);
    const pendingYesterday = await buy(db, 9);
    const dueToday = await buy(db, 5);
    const inTransitYesterday = await buy(db, 5);
    const deliveredYesterday = await buy(db, 5);
    const rejectedYesterday = await buy(db, 5);
    for (const order of [approvedYesterday, dueToday, inTransitYesterday, deliveredYesterday]) await approve(db, order.id);
    await db.query("UPDATE orders SET status = 'in_transit' WHERE id = $1", [inTransitYesterday.id]);
    await db.query("UPDATE orders SET status = 'delivered' WHERE id = $1", [deliveredYesterday.id]);
    await rpc(db, 'cancel_inventory_order', [rejectedYesterday.id, hub, 'Out of delivery range']);
    for (const [order, status] of [[approvedYesterday, 'assigned'], [dueToday, 'assigned'], [inTransitYesterday, 'in_transit'], [deliveredYesterday, 'delivered']]) {
      await db.query('INSERT INTO deliveries(order_id, status) VALUES ($1, $2)', [order.id, status]);
    }
    await db.query('UPDATE orders SET preferred_schedule = $1 WHERE id <> $2', [yesterdayLastSecond, dueToday.id]);
    await db.query('UPDATE orders SET preferred_schedule = $1 WHERE id = $2', [today, dueToday.id]);
    assert.deepEqual(kg(await stock(db)), [0, 1], '30 + 5 + 5 + 5 kg drawn by the approved orders only');

    assert.equal((await db.query('SELECT cancel_expired_retailer_orders() AS n')).rows[0].n, 3);
    const statusOf = async table => Object.fromEntries((await db.query(
      table === 'orders' ? 'SELECT id AS k, status FROM orders' : 'SELECT order_id AS k, status FROM deliveries')).rows.map(r => [r.k, r.status]));
    const orders = await statusOf('orders'), deliveries = await statusOf('deliveries');
    assert.deepEqual([approvedYesterday, pendingYesterday, dueToday, inTransitYesterday, deliveredYesterday, rejectedYesterday].map(o => orders[o.id]),
      ['unsuccessful', 'unsuccessful', 'approved', 'unsuccessful', 'delivered', 'cancelled'],
      'an order scheduled earlier today stays open until the day ends');
    assert.deepEqual([approvedYesterday, dueToday, inTransitYesterday, deliveredYesterday].map(o => deliveries[o.id]),
      ['unsuccessful', 'assigned', 'unsuccessful', 'delivered'], 'the delivery record shows the same status');
    assert.deepEqual(kg(await stock(db)), [26, 5], 'only the order still at the warehouse returns its 26 kg + 4 kg');

    assert.equal((await db.query('SELECT cancel_expired_retailer_orders() AS n')).rows[0].n, 0);
    assert.deepEqual(kg(await stock(db)), [26, 5], 'a rerun changes nothing');
    assert.deepEqual(await statusOf('orders'), orders);
  } finally { await db.close(); }
});

test('function is locked down to service_role/postgres, never callable by anon or authenticated', async () => {
  const db = await setup();
  try {
    await db.exec(cronFile());
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
