// When a rider's pickup or delivery was completed, from the timestamps the
// completion functions store. Null for any other outcome: those records have no
// completion time, and none is invented.

// complete_pickup_with_proof sets status 'picked_up' and received_at.
function pickupCompletedAt(pickup) {
  return pickup?.status === 'picked_up' ? pickup.received_at || null : null;
}

// complete_delivery_with_proof sets status 'delivered' and delivered_at on the
// delivery and its order.
function deliveryCompletedAt(order) {
  const delivery = Array.isArray(order?.deliveries) ? order.deliveries[0] : order?.deliveries;
  if (order?.status !== 'delivered' && delivery?.status !== 'delivered') return null;
  return delivery?.delivered_at || order.delivered_at || null;
}

module.exports = { pickupCompletedAt, deliveryCompletedAt };
