// GET only: confirm every table and RPC the API calls at runtime exists in the
// hosted schema. Never writes, never selects row data (limit=0).
const fs = require('node:fs');
const path = require('node:path');
const env = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));

const TABLES = ['account_audit', 'deliveries', 'delivery_addresses', 'delivery_tracking', 'harvests',
  'messages', 'notifications', 'order_items', 'orders', 'payments', 'pickup_requests', 'products', 'users'];
const FUNCTIONS = ['advance_delivery_status', 'complete_delivery_with_proof', 'complete_pickup_with_proof',
  'decrement_product_stock', 'restore_product_stock', 'vt_account_context', 'vt_admin_transition'];

async function main() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw Error('MISSING_CONFIG');
  const headers = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/rest/v1/`, { method: 'GET', headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`SCHEMA_HTTP_${response.status}`);
  const schema = await response.json();

  const missingTables = TABLES.filter(name => !schema.definitions?.[name]);
  const missingFunctions = FUNCTIONS.filter(name => !schema.paths?.[`/rpc/${name}`]);
  for (const table of TABLES) {
    console.log(JSON.stringify({ table, exists: !!schema.definitions?.[table],
      columns: Object.keys(schema.definitions?.[table]?.properties || {}) }));
  }
  console.log(JSON.stringify({ missingTables, missingFunctions, writes_performed: false }));
  if (missingTables.length || missingFunctions.length) process.exitCode = 1;
}
main().catch(error => { console.error(JSON.stringify({ inspection_error: error.cause?.code || (/^[A-Z_0-9]+$/.test(error.message) ? error.message : error.name) })); process.exitCode = 1; });
