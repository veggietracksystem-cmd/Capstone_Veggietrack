// Vegetable Chain Tracking: the history of each stock batch from the farmer to a
// retailer or to Spoiled Products, built only from stored rows (products,
// pickup_requests, order_items, orders, deliveries, payments, stock_spoilage).
const { roundKg, batchStatus, compareFifo, daysInStock, stockSince, isPastSpoilageLimit, needsSpoilageReview } = require('./batches');
const { estimatedTotal } = require('./pickups');
const { canonicalVegetableName, vegetableKey } = require('./vegetables');

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const manilaDay = (value) => {
  const time = value == null ? NaN : new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : null;
};

// Where an order's kilograms are, as far as the batch is concerned. Pending orders
// hold no stock; cancelled orders gave it back; an order that was never picked
// up and became unsuccessful gave it back too (stock_committed_at is cleared).
function saleStage(order) {
  if (!order) return null;
  if (order.status === 'delivered') return 'sold';
  if (['approved', 'picked_up', 'in_transit'].includes(order.status)) return 'on_order';
  if (order.status === 'unsuccessful' && order.stock_committed_at) return 'not_delivered';
  return null;
}

/**
 * One entry per batch, oldest harvest first. Every kilogram received is counted
 * once: remaining + sold + on_order + not_delivered + spoiled (+ adjusted, the
 * part removed by an earlier manual quantity reduction) = received.
 */
function buildChainBatches({ batches = [], farmersById = {}, pickupsById = {}, peopleById = {}, items = [],
  ordersById = {}, deliveriesByOrderId = {}, paidOrderIds = new Set(), spoilage = [], now = Date.now() }) {
  const itemsByBatch = new Map(), spoilageByBatch = new Map();
  for (const item of items) itemsByBatch.set(item.product_id, [...(itemsByBatch.get(item.product_id) || []), item]);
  for (const record of spoilage) spoilageByBatch.set(record.product_id, [...(spoilageByBatch.get(record.product_id) || []), record]);
  const name = (id) => (id ? peopleById[id]?.full_name || null : null);

  return [...batches].sort(compareFifo).map((batch) => {
    const pickup = batch.pickup_request_id ? pickupsById[batch.pickup_request_id] || null : null;
    const sales = (itemsByBatch.get(batch.id) || []).map((item) => {
      const order = ordersById[item.order_id] || null;
      const delivery = deliveriesByOrderId[item.order_id] || null;
      const quantity = num(item.quantity_kg), price = item.price_at_order != null ? num(item.price_at_order) : null;
      return {
        // The order_items row: one batch can feed an order on more than one line.
        item_id: item.id ?? null,
        order_id: item.order_id,
        stage: saleStage(order),
        retailer_name: name(order?.retailer_id),
        quantity_kg: quantity,
        price_per_kg: price,
        total_amount: estimatedTotal(quantity, price),
        order_status: order?.status || null,
        ordered_at: order?.created_at || null,
        delivered_at: delivery?.delivered_at || order?.delivered_at || null,
        rider_name: name(order?.delivery_personnel_id),
        payment_status: order ? (paidOrderIds.has(item.order_id) ? 'paid' : 'unpaid') : null,
        proof_photo_url: delivery?.proof_photo_url || null,
        pod: delivery?.pod || null,
      };
    }).sort((a, b) => String(a.ordered_at).localeCompare(String(b.ordered_at)));
    const spoiled = (spoilageByBatch.get(batch.id) || [])
      .map((record) => ({ id: record.id, quantity_kg: num(record.quantity_kg), reason: record.reason, recorded_at: record.recorded_at }))
      .sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));

    const sum = (stage) => roundKg(sales.filter((sale) => sale.stage === stage).reduce((total, sale) => total + sale.quantity_kg, 0));
    const totals = {
      received: num(batch.quantity_received ?? batch.stock_kg),
      remaining: num(batch.stock_kg),
      sold: sum('sold'),
      on_order: sum('on_order'),
      not_delivered: sum('not_delivered'),
      spoiled: roundKg(spoiled.reduce((total, record) => total + record.quantity_kg, 0)),
    };
    const accounted = totals.remaining + totals.sold + totals.on_order + totals.not_delivered + totals.spoiled;
    totals.adjusted = Math.max(0, roundKg(totals.received - accounted));

    return {
      batch_id: batch.id,
      vegetable_name: batch.vegetable_name,
      status: batchStatus(batch),
      batch_photo_url: batch.batch_photo_url || null,
      farmer_name: farmersById[batch.farmer_id]?.full_name || batch.farmer_name || null,
      harvest_date: batch.harvest_date || null,
      price_per_kg: batch.price_per_kg != null ? num(batch.price_per_kg) : null,
      in_stock_since: stockSince(batch) || (pickup?.received_at ?? null),
      days_in_stock: ['received', 'listed'].includes(batchStatus(batch)) ? daysInStock(batch, now) : null,
      // Still active and past the 7-day limit; needs_review until the distributor decides.
      past_limit: isPastSpoilageLimit(batch, now),
      needs_review: needsSpoilageReview(batch, now),
      pickup: pickup ? {
        id: pickup.id,
        requested_at: pickup.requested_at || null,
        approved_at: pickup.approved_at || null,
        picked_up_at: pickup.received_at || null,
        quantity_kg: pickup.quantity_kg != null ? num(pickup.quantity_kg) : null,
        farmer_price_per_kg: pickup.price_per_kg != null ? num(pickup.price_per_kg) : null,
        estimated_total: estimatedTotal(pickup.quantity_kg, pickup.price_per_kg),
        rider_name: name(pickup.delivery_personnel_id),
        proof_photo_url: pickup.proof_photo_url || null,
        pod: pickup.pod || null,
      } : null,
      sales,
      spoilage: spoiled,
      totals,
    };
  });
}

// Report filters shared by View Reports and Spoiled Products. `from` and `to` are
// Philippine calendar days (YYYY-MM-DD, inclusive); either may be omitted.
// `vegetable` keeps one vegetable, matched by vegetableKey so English and Tagalog
// batch names ("Squash", "Kalabasa") count as the same vegetable.
function reportFilter({ from, to, vegetable } = {}) {
  const key = vegetable ? vegetableKey(vegetable) : null;
  return {
    inRange(date) {
      const day = manilaDay(date);
      return !!day && (!from || day >= from) && (!to || day <= to);
    },
    hasVegetable: (name) => !key || vegetableKey(name) === key,
  };
}

// Dated transactions of the given batches: stock received, sale delivered to a
// retailer, stock spoiled, filtered as in reportFilter. `id` names the stored
// record behind each row (the batch, the order_items row or the stock_spoilage
// row), so View Details opens exactly that record.
function chainEvents(chainBatches, filters = {}) {
  const { inRange, hasVegetable } = reportFilter(filters);
  const events = [];
  for (const batch of chainBatches) {
    if (!hasVegetable(batch.vegetable_name)) continue;
    const base = { batch_id: batch.batch_id, vegetable_name: batch.vegetable_name, farmer_name: batch.farmer_name, harvest_date: batch.harvest_date };
    if (inRange(batch.in_stock_since)) {
      events.push({ ...base, id: `received:${batch.batch_id}`, type: 'received', date: batch.in_stock_since, quantity_kg: batch.totals.received, party: batch.farmer_name, status: batch.status, amount: batch.pickup?.estimated_total ?? null });
    }
    batch.sales.forEach((sale, index) => {
      const date = sale.delivered_at || sale.ordered_at;
      if (sale.stage === 'sold' && inRange(date)) {
        events.push({ ...base, id: `sold:${sale.item_id || `${batch.batch_id}:${sale.order_id}:${index}`}`, type: 'sold', date,
          quantity_kg: sale.quantity_kg, party: sale.retailer_name, status: 'delivered', amount: sale.total_amount, order_id: sale.order_id, item_id: sale.item_id });
      }
    });
    for (const record of batch.spoilage) {
      if (inRange(record.recorded_at)) {
        events.push({ ...base, id: `spoiled:${record.id}`, type: 'spoiled', date: record.recorded_at, quantity_kg: record.quantity_kg, party: batch.farmer_name, status: record.reason, amount: null, spoilage_id: record.id });
      }
    }
  }
  return events.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function reportSummary(events) {
  const kg = (type) => roundKg(events.filter((event) => event.type === type).reduce((total, event) => total + event.quantity_kg, 0));
  const sold = events.filter((event) => event.type === 'sold');
  return {
    received_kg: kg('received'),
    sold_kg: kg('sold'),
    spoiled_kg: kg('spoiled'),
    sales_total: sold.reduce((cents, event) => cents + Math.round((event.amount || 0) * 100), 0) / 100,
    completed_transactions: new Set(sold.map((event) => event.order_id)).size,
    batches: new Set(events.map((event) => event.batch_id)).size,
  };
}

// Report filter options: each vegetable the distributor has stocked, once, by
// its display name.
function reportVegetables(chainBatches) {
  const names = new Map();
  for (const batch of chainBatches) {
    const key = vegetableKey(batch.vegetable_name);
    if (key && !names.has(key)) names.set(key, canonicalVegetableName(batch.vegetable_name));
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

// Monday-to-Sunday Philippine week containing `now`, as YYYY-MM-DD days.
function manilaWeek(now = Date.now()) {
  const today = new Date(now + 8 * 3600000);
  const offset = (today.getUTCDay() + 6) % 7;
  const start = new Date(today.getTime() - offset * 86400000).toISOString().slice(0, 10);
  const end = new Date(today.getTime() + (6 - offset) * 86400000).toISOString().slice(0, 10);
  return { from: start, to: end };
}

module.exports = { saleStage, buildChainBatches, reportFilter, chainEvents, reportSummary, reportVegetables, manilaDay, manilaWeek };
