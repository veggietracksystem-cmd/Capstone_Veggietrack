const { planFifoDraw, sameVegetableAs, roundKg } = require('../lib/batches');
const { vegetableKey } = require('../lib/vegetables');

// Route integration uses a stateful API stub; inventoryTransactionsSql exercises real SQL.
const fail = message => ({ code: 'P0001', message });
const deduct = ({ batch, quantity_kg }) => {
  batch.stock_kg = roundKg(batch.stock_kg - quantity_kg);
  if (batch.stock_kg === 0) batch.status = 'sold_out';
};
const holdsStock = status => !['pending', 'cancelled'].includes(status);

// Mirrors the sync_order_stock trigger: call after an `orders` row changes. Leaving
// pending draws FIFO once; cancelling (or returning to pending) restores once.
// Returns an error (and changes nothing) when stock no longer covers the order.
function syncOrderStock(data, before, order) {
  const products = data.products || [];
  const items = (data.order_items || []).filter(i => i.order_id === order.id);
  order.stock_committed_at = before.stock_committed_at ?? null;
  if (holdsStock(order.status) && !order.stock_committed_at) {
    const byKey = new Map();
    for (const item of items) byKey.set(vegetableKey(item.vegetable_name), [...(byKey.get(vegetableKey(item.vegetable_name)) || []), item]);
    const plans = [];
    for (const lines of byKey.values()) {
      const own = products.filter(p => p.distributor_id === order.distributor_id && sameVegetableAs(lines[0].vegetable_name)(p));
      const plan = planFifoDraw(own, roundKg(lines.reduce((n, i) => n + i.quantity_kg, 0)));
      if (!plan.draws) return fail('Not enough stock available to approve this order.');
      plans.push({ lines, draws: plan.draws });
    }
    data.order_items = data.order_items.filter(i => i.order_id !== order.id);
    for (const { lines, draws } of plans) {
      draws.forEach(deduct);
      data.order_items.push(...draws.map(({ batch, quantity_kg }) => ({ order_id: order.id, product_id: batch.id,
        quantity_kg, vegetable_name: batch.vegetable_name, price_at_order: lines[0].price_at_order })));
    }
    order.stock_committed_at = new Date().toISOString();
  } else if (!holdsStock(order.status) && order.stock_committed_at) {
    for (const item of items) {
      const batch = products.find(p => p.id === item.product_id);
      if (batch) {
        batch.stock_kg = roundKg(batch.stock_kg + item.quantity_kg);
        batch.status = batch.status === 'sold_out' ? 'listed' : batch.status;
      }
    }
    order.stock_committed_at = null;
  }
  return null;
}

function inventoryRpcStub(data, name, args, nextId) {
  const products = data.products || [];
  const failed = message => ({ data: null, error: fail(message) });
  if (name === 'place_inventory_order') {
    // A pending order is quoted from listed stock but draws nothing.
    const draws = [];
    for (const item of args.p_items) {
      const plan = planFifoDraw(products.filter(sameVegetableAs(item.vegetable_name)), item.quantity_kg);
      if (!plan.draws) return failed('Insufficient stock');
      draws.push(...plan.draws);
    }
    const order = {
      id: nextId(), retailer_id: args.p_retailer_id, distributor_id: draws[0].batch.distributor_id,
      status: 'pending', created_at: new Date().toISOString(), stock_committed_at: null,
      delivery_address: args.p_delivery_address, delivery_latitude: args.p_delivery_latitude,
      delivery_longitude: args.p_delivery_longitude, preferred_schedule: args.p_preferred_schedule,
      total_amount: draws.reduce((n, d) => n + d.quantity_kg * d.batch.price_per_kg, 0),
    };
    (data.orders ||= []).push(order);
    for (const draw of draws) {
      (data.order_items ||= []).push({ order_id: order.id, product_id: null,
        quantity_kg: draw.quantity_kg, vegetable_name: draw.batch.vegetable_name,
        price_at_order: draw.batch.price_per_kg });
    }
    return { data: { ...order }, error: null };
  }
  if (name === 'cancel_inventory_order') {
    const order = (data.orders || []).find(o => o.id === args.p_order_id);
    if (!order || order.status !== 'pending') return failed('Order already updated');
    const before = { ...order };
    order.status = 'cancelled'; order.cancellation_reason = args.p_reason;
    syncOrderStock(data, before, order);
    return { data: { ...order }, error: null };
  }
  if (name === 'unlist_inventory_product' || name === 'reduce_inventory_quantity') {
    const anchor = products.find(p => p.id === args.p_product_id && p.distributor_id === args.p_distributor_id);
    if (!anchor) return failed('Product missing');
    const batches = products.filter(p => p.distributor_id === args.p_distributor_id && sameVegetableAs(anchor.vegetable_name)(p));
    if (name === 'unlist_inventory_product') {
      const updated = batches.filter(p => ['listed', 'sold_out'].includes(p.status));
      updated.forEach(p => { p.status = p.stock_kg > 0 ? 'received' : 'archived'; });
      return { data: updated.map(p => ({ ...p })), error: null };
    }
    const plan = planFifoDraw(batches, args.p_expected_total - args.p_new_total);
    if (!plan.draws || plan.available !== args.p_expected_total) return failed('Stock changed');
    plan.draws.forEach(deduct);
    return { data: null, error: null };
  }
  return null;
}

module.exports = { inventoryRpcStub, syncOrderStock };
