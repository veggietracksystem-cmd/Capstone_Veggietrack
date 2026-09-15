// GET only: inspect schema metadata and selected column availability, never row data or credentials.
const fs = require('node:fs');
const path = require('node:path');
const env = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));
const required = {
  orders: ['id', 'retailer_id', 'delivery_personnel_id', 'delivery_address', 'delivery_latitude', 'delivery_longitude', 'status'],
  users: ['id', 'role', 'latitude', 'longitude', 'store_location', 'current_latitude', 'current_longitude', 'current_location_accuracy', 'last_location_update'],
  delivery_addresses: ['user_id', 'address', 'latitude', 'longitude'],
  deliveries: ['id', 'order_id', 'delivery_personnel_id', 'status', 'proof_photo_url', 'delivered_at', 'pod'],
};
async function main() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw Error('MISSING_CONFIG');
  const headers = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const schemaResponse = await fetch(`${base}/rest/v1/`, { method: 'GET', headers, signal: AbortSignal.timeout(20000) });
  if (!schemaResponse.ok) throw Error(`SCHEMA_HTTP_${schemaResponse.status}`);
  const schema = await schemaResponse.json();
  for (const [table, columns] of Object.entries(required)) {
    const response = await fetch(`${base}/rest/v1/${table}?select=${columns.join(',')}&limit=0`, { method: 'GET', headers, signal: AbortSignal.timeout(20000) });
    console.log(JSON.stringify({ table, status: response.status, columns: columns.map(name => ({ name,
      format: schema.definitions?.[table]?.properties?.[name]?.format || null })) }));
    if (!response.ok) throw Error(`COLUMN_INSPECTION_HTTP_${response.status}`);
  }
  console.log(JSON.stringify({ functions: ['complete_delivery_with_proof', 'advance_delivery_status'].map(name => ({ name, exists: !!schema.paths?.[`/rpc/${name}`] })), writes_performed: false }));
}
main().catch(error => { console.error(JSON.stringify({ inspection_error: error.cause?.code || (/^[A-Z_0-9]+$/.test(error.message) ? error.message : error.name) })); process.exitCode = 1; });
