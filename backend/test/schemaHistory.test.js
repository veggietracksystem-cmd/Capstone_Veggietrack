const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('base schema and incremental inventory/image/status/tracking migrations execute on PostgreSQL', async () => {
  const db = new PGlite();
  try {
    // Supabase-provided facilities; fixture only, never a hosted migration.
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
      CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;`);
    const files = ['schema_complete.sql', 'veggietrack_fixes.sql', 'fifo_inventory_upgrade.sql', 'add_image_urls.sql', 'delivery_reject.sql', 'delivery_tracking_maps.sql'];
    for (const file of files) {
      // Read-only inspection before each migration; no assumptions about enum-vs-text status.
      const before = await db.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'");
      if (file === 'schema_complete.sql') assert.equal(before.rows.length, 0);
      else assert.ok(before.rows.some(row => row.table_name === 'orders' && row.column_name === 'status'));
      await db.exec(fs.readFileSync(path.join(__dirname, '../sql', file), 'utf8'));
    }
    const columns = (await db.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'")).rows;
    for (const [table, column] of [['products','pickup_request_id'], ['products','harvest_id'], ['order_items','product_id'], ['harvests','image_url'], ['orders','delivery_latitude'], ['orders','delivery_longitude'], ['users','current_location_accuracy']]) {
      assert.ok(columns.some(row => row.table_name === table && row.column_name === column), `${table}.${column}`);
    }
  } finally { await db.close(); }
});
