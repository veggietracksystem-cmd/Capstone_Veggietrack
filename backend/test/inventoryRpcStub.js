const { planFifoDraw, sameVegetableAs, roundKg } = require('../lib/batches');

// Route integration uses a stateful API stub; inventoryTransactionsSql exercises real SQL.
function inventoryRpcStub(data, name, args, nextId) {
  const products = data.products || [];
  const fail = message => ({ data: null, error: { code: 'P0001', message } });
  const deduct = ({ batch, quantity_kg }) => {
    batch.stock_kg = roundKg(batch.stock_kg - quantity_kg);
    if (batch.stock_kg === 0) batch.status = 'sold_out';
  };
  if (name === 'place_inventory_order') {
    const draws = [];
    for (const item of args.p_items) {
      const plan = planFifoDraw(products.filter(sameVegetableAs(item.vegetable_name)), item.quantity_kg);
      if (!plan.draws) return fail('Insufficient stock');
      draws.push(...plan.draws);
    }
    const order = {
      id: nextId(), retailer_id: args.p_retailer_id, distributor_id: draws[0].batch.distributor_id,
      status: 'pending', created_at: new Date().toISOString(),
      delivery_address: args.p_delivery_address, delivery_latitude: args.p_delivery_latitude,
      delivery_longitude: args.p_delivery_longitude, preferred_schedule: args.p_preferred_schedule,
      total_amount: draws.reduce((n, d) => n + d.quantity_kg * d.batch.price_per_kg, 0),
    };
    (data.orders ||= []).push(order);
    for (const draw of draws) {
      deduct(draw);
      (data.order_items ||= []).push({ order_id: order.id, product_id: draw.batch.id,
        quantity_kg: draw.quantity_kg, vegetable_name: draw.batch.vegetable_name,
        price_at_order: draw.batch.price_per_kg });
    }
    return { data: { ...order }, error: null };
  }
  if (name === 'cancel_inventory_order') {
    const order = (data.orders || []).find(o => o.id === args.p_order_id);
    if (!order || order.status !== 'pending') return fail('Order already updated');
    for (const item of (data.order_items || []).filter(i => i.order_id === order.id)) {
      const batch = products.find(p => p.id === item.product_id);
      if (batch) {
        batch.stock_kg = roundKg(batch.stock_kg + item.quantity_kg);
        batch.status = batch.status === 'sold_out' ? 'listed' : batch.status;
      }
    }
    order.status = 'cancelled'; order.cancellation_reason = args.p_reason;
    return { data: { ...order }, error: null };
  }
  if (name === 'unlist_inventory_product' || name === 'reduce_inventory_quantity') {
    const anchor = products.find(p => p.id === args.p_product_id && p.distributor_id === args.p_distributor_id);
    if (!anchor) return fail('Product missing');
    const batches = products.filter(p => p.distributor_id === args.p_distributor_id && sameVegetableAs(anchor.vegetable_name)(p));
    if (name === 'unlist_inventory_product') {
      const updated = batches.filter(p => ['listed', 'sold_out'].includes(p.status));
      updated.forEach(p => { p.status = p.stock_kg > 0 ? 'received' : 'archived'; });
      return { data: updated.map(p => ({ ...p })), error: null };
    }
    const plan = planFifoDraw(batches, args.p_expected_total - args.p_new_total);
    if (!plan.draws || plan.available !== args.p_expected_total) return fail('Stock changed');
    plan.draws.forEach(deduct);
    return { data: null, error: null };
  }
  return null;
}

module.exports = { inventoryRpcStub };
