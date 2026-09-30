// Checks deployed columns and RPC signatures. --summary reads stock fields and
// prints aggregate counts only; neither mode invokes RPCs or changes data.
const fs = require('node:fs');
const path = require('node:path');
const env = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));

const TABLES = {
  products: ['id', 'distributor_id', 'vegetable_name', 'price_per_kg', 'stock_kg', 'quantity_received',
    'farmer_id', 'harvest_id', 'pickup_request_id', 'harvest_date', 'pickup_date', 'created_at',
    'updated_at', 'batch_photo_url', 'status'],
  order_items: ['order_id', 'product_id', 'vegetable_name', 'quantity_kg', 'price_at_order'],
  orders: ['id', 'retailer_id', 'status', 'total_amount', 'cancellation_reason', 'delivery_address',
    'delivery_latitude', 'delivery_longitude', 'preferred_schedule'],
};
const FUNCTIONS = ['decrement_product_stock', 'restore_product_stock', 'cancel_expired_retailer_orders',
  'place_inventory_order', 'cancel_inventory_order', 'reduce_inventory_quantity', 'unlist_inventory_product'];

async function main() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw Error('MISSING_CONFIG');
  const headers = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/rest/v1/`, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`SCHEMA_HTTP_${response.status}`);
  const schema = await response.json();
  let complete = true;
  for (const [table, columns] of Object.entries(TABLES)) {
    const properties = schema.definitions?.[table]?.properties || {};
    const missing = columns.filter(name => !Object.hasOwn(properties, name));
    let queryStatus = null;
    if (!missing.length) {
      const check = await fetch(`${base}/rest/v1/${table}?select=${columns.join(',')}&limit=0`, {
        headers, signal: AbortSignal.timeout(20000),
      });
      queryStatus = check.status;
      complete &&= check.ok;
    }
    complete &&= missing.length === 0;
    console.log(JSON.stringify({ table, missing_columns: missing, zero_row_query_status: queryStatus }));
  }
  const missingFunctions = FUNCTIONS.filter(name => !schema.paths?.[`/rpc/${name}`]);
  complete &&= missingFunctions.length === 0;
  if (process.argv.includes('--summary')) {
    const counts = { batches: 0, statuses: {}, active_without_stock: 0, negative_stock: 0,
      completed_with_stock: 0, missing_farmer: 0, missing_harvest_date: 0, missing_created_at: 0,
      manual_batches_missing_pickup_date: 0, listed_without_photo: 0 };
    for (let offset = 0; ; offset += 500) {
      const query = new URLSearchParams({
        select: 'status,stock_kg,farmer_id,harvest_date,pickup_date,created_at,pickup_request_id,batch_photo_url',
        order: 'id', limit: '500', offset: String(offset),
      });
      const stockResponse = await fetch(`${base}/rest/v1/products?${query}`, {
        headers, signal: AbortSignal.timeout(20000),
      });
      if (!stockResponse.ok) throw Error(`STOCK_HTTP_${stockResponse.status}`);
      const rows = await stockResponse.json();
      for (const row of rows) {
        const status = row.status ?? '(null)';
        counts.batches++;
        counts.statuses[status] = (counts.statuses[status] || 0) + 1;
        if (['received', 'listed'].includes(row.status) && !(Number(row.stock_kg) > 0)) counts.active_without_stock++;
        if (Number(row.stock_kg) < 0) counts.negative_stock++;
        if (['sold_out', 'archived'].includes(row.status) && Number(row.stock_kg) > 0) counts.completed_with_stock++;
        if (!row.farmer_id) counts.missing_farmer++;
        if (!row.harvest_date) counts.missing_harvest_date++;
        if (!row.created_at) counts.missing_created_at++;
        if (!row.pickup_request_id && !row.pickup_date) counts.manual_batches_missing_pickup_date++;
        if (row.status === 'listed' && !row.batch_photo_url) counts.listed_without_photo++;
      }
      if (rows.length < 500) break;
    }
    console.log(JSON.stringify({ inventory_summary: counts }));
  }
  console.log(JSON.stringify({ missing_functions: missingFunctions, contract_present: complete,
    function_bodies_verified: false, constraints_verified: false, writes_performed: false }));
  if (!complete) process.exitCode = 1;
}

main().catch(error => {
  console.error(JSON.stringify({ inspection_error: error.cause?.code
    || (/^[A-Z_0-9]+$/.test(error.message) ? error.message : error.name) }));
  process.exitCode = 1;
});
