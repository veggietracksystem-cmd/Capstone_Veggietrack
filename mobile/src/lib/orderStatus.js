// One order status for every role. The backend keeps orders.status and the
// delivery record in step; closed statuses on the order always win so a stale or
// missing delivery record can never show a different status.

// Delivered, cancelled (including rejected) and unsuccessful deliveries are final.
export const CLOSED_ORDER_STATUSES = ['delivered', 'cancelled', 'unsuccessful'];

export const isClosedOrderStatus = (status) => CLOSED_ORDER_STATUSES.includes(status);

// The embedded deliveries relation comes back as an array; take the first record.
function deliveryOf(order) {
  if (Array.isArray(order?.deliveries)) return order.deliveries[0] || null;
  return order?.deliveries || null;
}

// Open orders show the delivery record's progress (e.g. assigned), falling back to
// the order's own status.
export function effectiveOrderStatus(order) {
  if (isClosedOrderStatus(order?.status)) return order.status;
  return deliveryOf(order)?.status || order?.status || 'pending';
}
