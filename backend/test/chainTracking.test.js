const test = require('node:test');
const assert = require('node:assert/strict');
const { daysInStock, needsStockAlert, STOCK_ALERT_DAYS } = require('../lib/batches');
const { harvestAvailability, pickupInputError, estimatedTotal } = require('../lib/pickups');
const { saleStage, buildChainBatches, chainEvents, reportSummary, reportVegetables, manilaWeek } = require('../lib/chainTracking');

test('days in stock are Philippine calendar days from the stock entry date', () => {
  const now = Date.parse('2026-09-27T16:00:00Z'); // 12:00 am, September 28 in Manila
  assert.equal(daysInStock({ created_at: '2026-09-20T15:59:00Z' }, now), 8); // 11:59 pm, September 20
  assert.equal(daysInStock({ created_at: '2026-09-20T16:00:00Z' }, now), 7); // 12:00 am, September 21
  // A pickup date entered on Add New Product wins over the time the row was saved.
  assert.equal(daysInStock({ pickup_date: '2026-09-21T04:00:00Z', created_at: '2026-09-27T04:00:00Z' }, now), 7);
  assert.equal(daysInStock({}, now), null);
  const batch = (days, extra = {}) => ({ status: 'listed', stock_kg: 18, created_at: new Date(now - days * 86400000).toISOString(), ...extra });
  assert.equal(STOCK_ALERT_DAYS, 7);
  assert.equal(needsStockAlert(batch(6), now), false);
  assert.equal(needsStockAlert(batch(7), now), true);
  assert.equal(needsStockAlert(batch(7, { status: 'received' }), now), true);
  assert.equal(needsStockAlert(batch(7, { stock_kg: 0, status: 'sold_out' }), now), false);
  assert.equal(needsStockAlert(batch(9, { stock_kg: 0, status: 'spoiled' }), now), false);
});

test('a harvest keeps the kilograms not claimed by a request that was not declined', () => {
  const harvest = { id: 'h', quantity_kg: 100 };
  assert.deepEqual(harvestAvailability(harvest, []), { requested_kg: 0, available_kg: 100 });
  assert.deepEqual(harvestAvailability(harvest, [
    { harvest_id: 'h', quantity_kg: 60, status: 'picked_up' },
    { harvest_id: 'h', quantity_kg: 30, status: 'declined' },
    { harvest_id: 'other', quantity_kg: 99, status: 'requested' },
  ]), { requested_kg: 60, available_kg: 40 });
  // An older request without a quantity took the whole harvest.
  assert.deepEqual(harvestAvailability(harvest, [{ harvest_id: 'h', status: 'assigned' }]), { requested_kg: 100, available_kg: 0 });
  assert.equal(estimatedTotal(60, 35), 2100);
  assert.equal(estimatedTotal(2.5, 33.33), 83.33);
  assert.equal(estimatedTotal(null, 35), null);
});

test('pickup input is checked on the server: kg within the harvest and a positive price', () => {
  assert.equal(pickupInputError({ quantity_kg: 60, price_per_kg: 35 }, 100), null);
  assert.equal(pickupInputError({ quantity_kg: '60', price_per_kg: '35.50' }, 100), null);
  assert.equal(pickupInputError({ quantity_kg: 100, price_per_kg: 1 }, 100), null);
  for (const [input, field] of [[{ quantity_kg: 0, price_per_kg: 35 }, 'quantity_kg'], [{ quantity_kg: -1, price_per_kg: 35 }, 'quantity_kg'],
    [{ quantity_kg: 1.234, price_per_kg: 35 }, 'quantity_kg'], [{ quantity_kg: 'sixty', price_per_kg: 35 }, 'quantity_kg'],
    [{ quantity_kg: 101, price_per_kg: 35 }, 'quantity_kg'], [{ quantity_kg: 60 }, 'price_per_kg'],
    [{ quantity_kg: 60, price_per_kg: -5 }, 'price_per_kg'], [{ quantity_kg: 60, price_per_kg: '35 pesos' }, 'price_per_kg'],
    [{ quantity_kg: 60, price_per_kg: 10.555 }, 'price_per_kg']]) {
    assert.equal(pickupInputError(input, 100)?.field, field, JSON.stringify(input));
  }
  assert.match(pickupInputError({ quantity_kg: 101, price_per_kg: 35 }, 100).error, /up to 100 kg/);
});

test('chain tracking counts every received kilogram exactly once across sales and spoilage', () => {
  const orders = {
    delivered: { status: 'delivered', retailer_id: 'shop', created_at: '2026-09-22T01:00:00Z', stock_committed_at: 'x' },
    transit: { status: 'in_transit', retailer_id: 'shop', created_at: '2026-09-23T01:00:00Z', stock_committed_at: 'x' },
    lost: { status: 'unsuccessful', retailer_id: 'shop', created_at: '2026-09-23T02:00:00Z', stock_committed_at: 'x' },
    returned: { status: 'unsuccessful', retailer_id: 'shop', created_at: '2026-09-23T03:00:00Z', stock_committed_at: null },
    cancelled: { status: 'cancelled', retailer_id: 'shop', created_at: '2026-09-23T04:00:00Z', stock_committed_at: null },
  };
  for (const [id, order] of Object.entries(orders)) order.id = id;
  const [batch, unsold] = buildChainBatches({
    batches: [
      { id: 'b1', vegetable_name: 'Tomato', status: 'spoiled', stock_kg: 0, quantity_received: 100, farmer_id: 'f', harvest_date: '2026-09-19T04:00:00Z', created_at: '2026-09-20T02:00:00Z', pickup_request_id: 'p1' },
      { id: 'b2', vegetable_name: 'Okra', status: 'received', stock_kg: 5, quantity_received: 5, farmer_name: 'Typed Farmer', harvest_date: '2026-09-25T04:00:00Z', created_at: '2026-09-26T02:00:00Z' },
    ],
    farmersById: { f: { full_name: 'Ana' } },
    peopleById: { shop: { full_name: 'Store A' }, rider: { full_name: 'Rider R' } },
    pickupsById: { p1: { id: 'p1', quantity_kg: 100, price_per_kg: 30, received_at: '2026-09-20T02:00:00Z', delivery_personnel_id: 'rider', proof_photo_url: 'pickup.jpg' } },
    items: [
      { product_id: 'b1', order_id: 'delivered', quantity_kg: 40, price_at_order: 50 },
      { product_id: 'b1', order_id: 'transit', quantity_kg: 20, price_at_order: 50 },
      { product_id: 'b1', order_id: 'lost', quantity_kg: 5, price_at_order: 50 },
      { product_id: 'b1', order_id: 'returned', quantity_kg: 7, price_at_order: 50 },
      { product_id: 'b1', order_id: 'cancelled', quantity_kg: 3, price_at_order: 50 },
    ],
    ordersById: orders,
    deliveriesByOrderId: { delivered: { delivered_at: '2026-09-24T03:00:00Z', proof_photo_url: 'pod.jpg' } },
    paidOrderIds: new Set(['delivered']),
    spoilage: [{ id: 's1', product_id: 'b1', quantity_kg: 15, reason: 'past_limit', recorded_at: '2026-09-28T16:05:00Z' }],
    now: Date.parse('2026-09-30T04:00:00Z'),
  });
  assert.deepEqual(batch.totals, { received: 100, remaining: 0, sold: 40, on_order: 20, not_delivered: 5, spoiled: 15, adjusted: 20 });
  assert.deepEqual(batch.sales.map(s => [s.order_id, s.stage]), [['delivered', 'sold'], ['transit', 'on_order'], ['lost', 'not_delivered'], ['returned', null], ['cancelled', null]]);
  assert.deepEqual([batch.farmer_name, batch.pickup.farmer_price_per_kg, batch.pickup.estimated_total, batch.pickup.rider_name, batch.pickup.proof_photo_url],
    ['Ana', 30, 3000, 'Rider R', 'pickup.jpg']);
  assert.deepEqual([batch.sales[0].retailer_name, batch.sales[0].proof_photo_url, batch.sales[0].payment_status, batch.sales[0].total_amount], ['Store A', 'pod.jpg', 'paid', 2000]);
  assert.equal(batch.days_in_stock, null, 'no stock-age count for a finished batch');
  // A batch that was never sold has no retailer at all.
  assert.deepEqual([unsold.sales.length, unsold.farmer_name, unsold.totals.remaining, unsold.days_in_stock], [0, 'Typed Farmer', 5, 4]);
  assert.equal(saleStage(undefined), null);

  const all = chainEvents([batch, unsold]);
  assert.deepEqual(all.map(e => [e.type, e.batch_id, e.quantity_kg]), [
    ['spoiled', 'b1', 15], ['received', 'b2', 5], ['sold', 'b1', 40], ['received', 'b1', 100]]);
  assert.deepEqual(reportSummary(all), { received_kg: 105, sold_kg: 40, spoiled_kg: 15, sales_total: 2000, completed_transactions: 1, batches: 2 });
  // 2026-09-28T16:05Z is September 29 in Manila, so it is outside a September 28 range.
  assert.deepEqual(chainEvents([batch, unsold], { from: '2026-09-21', to: '2026-09-28' }).map(e => e.type), ['received', 'sold']);
  assert.deepEqual(chainEvents([batch, unsold], { from: '2026-09-29', to: '2026-09-29' }).map(e => e.type), ['spoiled']);
  assert.deepEqual(chainEvents([batch, unsold], { from: '2026-10-01' }), []);

  // Vegetable filter: one vegetable's batches under English or Tagalog names, combined with the dates.
  const kamatis = { ...unsold, batch_id: 'b3', vegetable_name: 'Kamatis' };
  const tomato = chainEvents([batch, unsold, kamatis], { vegetable: 'Tomato' });
  assert.deepEqual(tomato.map(e => [e.type, e.batch_id]), [['spoiled', 'b1'], ['received', 'b3'], ['sold', 'b1'], ['received', 'b1']]);
  assert.deepEqual(reportSummary(tomato), { received_kg: 105, sold_kg: 40, spoiled_kg: 15, sales_total: 2000, completed_transactions: 1, batches: 2 });
  assert.deepEqual(chainEvents([batch, unsold, kamatis], { vegetable: 'kamatis' }), tomato);
  assert.deepEqual(chainEvents([batch, unsold, kamatis], { vegetable: 'Okra' }).map(e => [e.type, e.batch_id]), [['received', 'b2']]);
  assert.deepEqual(chainEvents([batch, unsold, kamatis], { vegetable: 'Tomato', from: '2026-09-21', to: '2026-09-28' }).map(e => [e.type, e.batch_id]),
    [['received', 'b3'], ['sold', 'b1']]);
  assert.deepEqual(chainEvents([batch, unsold, kamatis], { vegetable: 'Carrot' }), []);
  assert.deepEqual(chainEvents([batch, unsold, kamatis], { vegetable: '' }).length, 5, 'no vegetable means all');
  assert.deepEqual(reportVegetables([batch, unsold, kamatis]), ['Okra', 'Tomato'], 'each vegetable once, by display name');
});

test('this week runs Monday to Sunday in the Philippines', () => {
  assert.deepEqual(manilaWeek(Date.parse('2026-09-30T04:00:00Z')), { from: '2026-09-28', to: '2026-10-04' }); // Wednesday
  assert.deepEqual(manilaWeek(Date.parse('2026-10-04T15:59:00Z')), { from: '2026-09-28', to: '2026-10-04' }); // Sunday 11:59 pm
  assert.deepEqual(manilaWeek(Date.parse('2026-10-04T16:00:00Z')), { from: '2026-10-05', to: '2026-10-11' }); // Monday 12:00 am
});
