// Read-only deployment audit. Print schema availability/configuration flags only.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync(path.join(__dirname, '../.env')));
const targets = {
  orders: ['id', 'retailer_id', 'distributor_id', 'delivery_personnel_id', 'delivery_address', 'delivery_latitude', 'delivery_longitude', 'preferred_schedule', 'status'],
  users: ['id', 'role', 'latitude', 'longitude', 'store_location', 'current_latitude', 'current_longitude', 'current_location_accuracy', 'last_location_update', 'avatar_url', 'profile_picture_updated_at'],
  delivery_addresses: ['user_id', 'address', 'latitude', 'longitude'],
  deliveries: ['id', 'order_id', 'delivery_personnel_id', 'status', 'proof_photo_url', 'delivered_at', 'pod'],
};
async function main() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw Error('MISSING_CONFIG');
  const headers = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/rest/v1/`, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`SCHEMA_HTTP_${response.status}`);
  const schema = await response.json();
  for (const [table, columns] of Object.entries(targets)) {
    const properties = schema.definitions?.[table]?.properties || {};
    console.log(JSON.stringify({ table, columns: columns.map(name => ({ name, exists: Object.hasOwn(properties, name), format: properties[name]?.format || null })) }));
    const existing = columns.filter(name => Object.hasOwn(properties, name));
    if (existing.length) {
      const check = await fetch(`${base}/rest/v1/${table}?select=${existing.join(',')}&limit=0`, { headers, signal: AbortSignal.timeout(20000) });
      console.log(JSON.stringify({ table, zero_row_query_status: check.status }));
    }
  }
  console.log(JSON.stringify({ functions: ['complete_delivery_with_proof', 'advance_delivery_status'].map(name => ({ name, exists: !!schema.paths?.[`/rpc/${name}`] })), writes_performed: false }));
}
main().catch(error => { console.error(JSON.stringify({ inspection_error: error.cause?.code || (/^[A-Z_0-9]+$/.test(error.message) ? error.message : error.name) })); process.exitCode = 1; });
