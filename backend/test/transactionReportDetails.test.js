const test = require('node:test');
const assert = require('node:assert/strict');
const { routeHarness } = require('./routeHarness');

// Transaction Reports > View Details: every report row names its stored record
// (batch, order_items row or stock_spoilage row) and the report returns those
// batches, so the details shown are the row's own record, even when one
// vegetable has several batches or one order draws a batch on two lines.
const day = (d, h = 10) => `2026-10-0${d}T0${h - 8}:00:00Z`; // 10 am Manila on October d
function seed() {
  return {
    users: [
      { id: 'hub', role: 'distributor', full_name: 'Hub' },
      { id: 'ana', role: 'farmer', full_name: 'Ana' },
      { id: 'ben', role: 'farmer', full_name: 'Ben' },
      { id: 'store', role: 'retailer', full_name: 'Store One' },
      { id: 'rider', role: 'delivery_personnel', full_name: 'Rider R' },
    ],
    products: [
      // Two batches of the same vegetable (English and Tagalog names).
      { id: 'batch-a', distributor_id: 'hub', vegetable_name: 'Tomato', status: 'listed', stock_kg: 4, quantity_received: 30, price_per_kg: 50,
        farmer_id: 'ana', harvest_date: day(1), pickup_request_id: 'pickup-a', created_at: day(2), pickup_date: day(2) },
      { id: 'batch-b', distributor_id: 'hub', vegetable_name: 'Kamatis', status: 'spoiled', stock_kg: 0, quantity_received: 20, price_per_kg: 55,
        farmer_id: 'ben', harvest_date: day(2), created_at: day(3), pickup_date: day(3) },
    ],
    pickup_requests: [{ id: 'pickup-a', requested_at: day(1), received_at: day(2), delivery_personnel_id: 'rider', quantity_kg: 30, price_per_kg: 35, proof_photo_url: 'https://example.test/p.jpg', pod: null }],
    order_items: [
      // Order 1 draws both batches; order 2 draws batch-a on two price lines.
      { id: 'item-1', product_id: 'batch-a', order_id: 'order-1', quantity_kg: 10, price_at_order: 50 },
      { id: 'item-2', product_id: 'batch-b', order_id: 'order-1', quantity_kg: 6, price_at_order: 55 },
      { id: 'item-3', product_id: 'batch-a', order_id: 'order-2', quantity_kg: 8, price_at_order: 50 },
      { id: 'item-4', product_id: 'batch-a', order_id: 'order-2', quantity_kg: 3, price_at_order: 48 },
    ],
    orders: [
      { id: 'order-1', retailer_id: 'store', delivery_personnel_id: 'rider', status: 'delivered', created_at: day(4), delivered_at: day(5), stock_committed_at: day(4) },
      { id: 'order-2', retailer_id: 'store', delivery_personnel_id: 'rider', status: 'delivered', created_at: day(5), delivered_at: day(6), stock_committed_at: day(5) },
    ],
    deliveries: [
      { order_id: 'order-1', delivered_at: day(5), proof_photo_url: 'https://example.test/d1.jpg', pod: null },
      { order_id: 'order-2', delivered_at: day(6), proof_photo_url: null, pod: null },
    ],
    payments: [{ order_id: 'order-1' }],
    stock_spoilage: [
      { id: 'spoil-a', product_id: 'batch-a', quantity_kg: 5, reason: 'discarded', recorded_at: day(6) },
      { id: 'spoil-b', product_id: 'batch-b', quantity_kg: 14, reason: 'past_limit', recorded_at: day(7) },
    ],
  };
}
const report = async (call, query) => (await call('get /api/distributor/chain-report', 'hub', { query })).body;
// What View Details shows for a row: the record its id names, never a lookup by vegetable.
function recordOf(body, event) {
  const batch = body.batches.find((b) => b.batch_id === event.batch_id);
  if (event.type === 'sold') return { batch, sale: batch.sales.find((s) => s.item_id === event.item_id) };
  if (event.type === 'spoiled') return { batch, spoilage: batch.spoilage.find((r) => r.id === event.spoilage_id) };
  return { batch };
}

test('every report row has a unique id that resolves to its own stored record', async () => {
  const data = seed();
  const before = JSON.stringify(data);
  const call = routeHarness(data);
  const body = await report(call, { from: '2026-10-01', to: '2026-10-07' });

  const ids = body.events.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate rows');
  assert.deepEqual(ids.slice().sort(), ['received:batch-a', 'received:batch-b', 'sold:item-1', 'sold:item-2', 'sold:item-3', 'sold:item-4', 'spoiled:spoil-a', 'spoiled:spoil-b']);
  assert.deepEqual(body.batches.map((b) => b.batch_id).sort(), ['batch-a', 'batch-b']);

  for (const event of body.events) {
    const { batch, sale, spoilage } = recordOf(body, event);
    assert.ok(batch, `${event.id}: batch found`);
    assert.equal(batch.batch_id, event.batch_id);
    if (event.type === 'sold') {
      assert.equal(sale.item_id, event.item_id);
      assert.deepEqual([sale.order_id, sale.quantity_kg, sale.total_amount], [event.order_id, event.quantity_kg, event.amount], `${event.id}: same sale`);
    }
    if (event.type === 'spoiled') assert.deepEqual([spoilage.id, spoilage.quantity_kg, spoilage.reason], [event.spoilage_id, event.quantity_kg, event.status]);
    if (event.type === 'received') assert.equal(batch.totals.received, event.quantity_kg);
  }
  // Same vegetable, different batches: Tomato and Kamatis rows keep their own farmer and batch.
  const sold = Object.fromEntries(body.events.filter((e) => e.type === 'sold').map((e) => [e.id, [e.batch_id, e.farmer_name, e.quantity_kg, e.amount]]));
  assert.deepEqual(sold, {
    'sold:item-1': ['batch-a', 'Ana', 10, 500], 'sold:item-2': ['batch-b', 'Ben', 6, 330],
    'sold:item-3': ['batch-a', 'Ana', 8, 400], 'sold:item-4': ['batch-a', 'Ana', 3, 144],
  });
  const received = recordOf(body, body.events.find((e) => e.id === 'received:batch-a')).batch.pickup;
  assert.deepEqual([received.rider_name, received.farmer_price_per_kg, received.picked_up_at], ['Rider R', 35, day(2)]);
  const sale = recordOf(body, body.events.find((e) => e.id === 'sold:item-1')).sale;
  assert.deepEqual([sale.retailer_name, sale.rider_name, sale.payment_status, sale.delivered_at], ['Store One', 'Rider R', 'paid', day(5)]);
  assert.equal(recordOf(body, body.events.find((e) => e.id === 'sold:item-3')).sale.payment_status, 'unpaid');

  // Totals come from the same rows as before.
  assert.deepEqual(body.summary, { received_kg: 50, sold_kg: 27, spoiled_kg: 19, sales_total: 1374, completed_transactions: 2, batches: 2 });
  assert.equal(JSON.stringify(data), before, 'reading the report and its details changes nothing');
});

test('filters: rows, details and totals stay consistent for a vegetable or a date range', async () => {
  const call = routeHarness(seed());
  const tomato = await report(call, { from: '2026-10-01', to: '2026-10-07', vegetable: 'Kamatis' });
  assert.equal(tomato.events.length, 8, 'English and Tagalog names are one vegetable: both batches stay');
  const day6 = await report(call, { from: '2026-10-06', to: '2026-10-06' });
  assert.deepEqual(day6.events.map((e) => e.id).sort(), ['sold:item-3', 'sold:item-4', 'spoiled:spoil-a']);
  assert.deepEqual(day6.batches.map((b) => b.batch_id), ['batch-a'], 'only the batches behind the shown rows');
  for (const event of day6.events) assert.ok(recordOf(day6, event).batch, event.id);
  assert.deepEqual([day6.summary.sold_kg, day6.summary.spoiled_kg, day6.summary.received_kg], [11, 5, 0]);
  const forbidden = await call('get /api/distributor/chain-report', 'store', { query: {} });
  assert.equal(forbidden.statusCode, 403);
});
