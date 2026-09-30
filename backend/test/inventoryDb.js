const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// Shared PostgreSQL fixture for the inventory SQL tests. Column types follow the
// hosted project, including the order_status enum (which has no 'assigned').
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const hub = id(1), retailer = id(2), farmer = id(3), a = id(10), b = id(11);
const migration = file => fs.readFileSync(path.join(__dirname, '../sql', file), 'utf8');
const rpc = (db, fn, values) => db.query(`SELECT to_jsonb(public.${fn}(${values.map((_, i) => `$${i + 1}`).join(',')})) AS result`, values).then(r => r.rows[0].result);
const buy = (db, quantity = 30, items = [{ vegetable_name: 'Tomato', quantity_kg: quantity }]) =>
  rpc(db, 'place_inventory_order', [retailer, JSON.stringify(items), 'Store', 14.1, 121.2, new Date(Date.now() + 86400000).toISOString()]);
// Same statement as PUT /api/orders/:id/approve.
const approve = (db, orderId) => db.query("UPDATE orders SET status = 'approved' WHERE id = $1 AND status = 'pending' RETURNING *", [orderId]).then(r => r.rows[0]);
// Start of today's Philippine calendar day (UTC+8), as a timestamptz.
const manilaDayStart = (db, days = 0) => db.query("SELECT (date_trunc('day', now() AT TIME ZONE INTERVAL '+08:00') + $1 * interval '1 day') AT TIME ZONE INTERVAL '+08:00' AS t", [days]).then(r => r.rows[0].t);
const stock = db => db.query('SELECT * FROM products ORDER BY harvest_date, id').then(r => r.rows);
const kg = rows => rows.map(p => Number(p.stock_kg));
const items = (db, orderId) => db.query('SELECT product_id, quantity_kg, price_at_order FROM order_items WHERE order_id = $1 ORDER BY quantity_kg DESC', [orderId])
  .then(r => r.rows.map(row => [row.product_id, Number(row.quantity_kg), Number(row.price_at_order)]));

// `beforeOrderStock` runs after the earlier migrations but before
// inventory_transactions.sql, e.g. to create orders the way the old checkout did.
async function setup({ beforeOrderStock } = {}) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TYPE order_status AS ENUM ('pending', 'approved', 'picked_up', 'in_transit', 'delivered', 'cancelled');
    CREATE TABLE users(id uuid PRIMARY KEY, role text);
    CREATE TABLE harvests(id uuid PRIMARY KEY, farmer_id uuid, vegetable_name text, quantity_kg numeric(10,2), status text, recorded_at timestamptz);
    CREATE TABLE pickup_requests(id uuid PRIMARY KEY, harvest_id uuid, farmer_id uuid, received_by uuid, status text, received_at timestamptz);
    CREATE TABLE products(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), distributor_id uuid REFERENCES users,
      vegetable_name text, stock_kg numeric(10,2) NOT NULL, price_per_kg numeric(10,2), quantity_received numeric(10,2),
      status text, harvest_id uuid, pickup_request_id uuid, farmer_id uuid, harvest_date timestamptz,
      batch_photo_url text, updated_at timestamptz);
    CREATE TABLE orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), retailer_id uuid REFERENCES users,
      distributor_id uuid REFERENCES users, total_amount numeric(10,2), status order_status DEFAULT 'pending', delivery_address text,
      delivery_latitude double precision, delivery_longitude double precision,
      preferred_schedule timestamptz, cancellation_reason text, created_at timestamptz DEFAULT now());
    CREATE TABLE order_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES orders,
      product_id uuid REFERENCES products ON DELETE SET NULL, vegetable_name text NOT NULL,
      quantity_kg numeric(10,2) NOT NULL, price_at_order numeric(10,2) NOT NULL);
    CREATE TABLE deliveries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid REFERENCES orders,
      delivery_personnel_id uuid, status text DEFAULT 'pending');
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    INSERT INTO users VALUES ('${hub}', 'distributor'), ('${retailer}', 'retailer'), ('${farmer}', 'farmer');
    INSERT INTO products(id, distributor_id, vegetable_name, stock_kg, price_per_kg, quantity_received, status, harvest_date, batch_photo_url)
    VALUES ('${a}','${hub}','Tomato',26,50,26,'listed','2026-09-15','photo-a'),
      ('${b}','${hub}','Kamatis',13,50,13,'listed','2026-09-16','photo-b');
  `);
  await db.exec(migration('stock_safety.sql'));
  await db.exec(migration('batch_lifecycle.sql'));
  if (beforeOrderStock) await beforeOrderStock(db);
  await db.exec(migration('inventory_transactions.sql'));
  return db;
}

module.exports = { id, hub, retailer, farmer, a, b, migration, rpc, buy, approve, manilaDayStart, stock, kg, items, setup };
