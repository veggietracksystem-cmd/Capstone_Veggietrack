import { effectiveOrderStatus, isClosedOrderStatus } from './orderStatus';

// Rider History: the rider's finished pickups and deliveries, built from the same
// persisted lists as Tasks (GET /api/pickup-requests, GET /api/delivery/orders),
// so a completion that moves a record out of Tasks moves it into History.

export const HISTORY_FILTERS = ['all', 'pickups', 'deliveries'];

// A pickup is open while assigned or on the way; any other status is final
// (picked_up when completed).
export const isOpenPickup = (pickup) => pickup.status === 'assigned' || pickup.status === 'otw';
// A delivery is final once its order is closed (delivered when completed).
export const isClosedDelivery = (order) => isClosedOrderStatus(effectiveOrderStatus(order));

const time = (value) => {
  const ms = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
};

// Newest first by completion time (completed_at from the server). Records that
// ended without completing (e.g. an unsuccessful delivery) have no completion
// time and sort by their schedule or creation time. Ties keep a stable order.
export function buildRiderHistory({ orders = [], pickups = [], filter = 'all' }) {
  const items = [];
  if (filter !== 'deliveries') {
    for (const record of pickups) {
      if (isOpenPickup(record)) continue;
      items.push({ kind: 'pickup', key: `p-${record.id}`, record, completedAt: record.completed_at || null,
        sortTime: time(record.completed_at) ?? time(record.requested_at || record.created_at) ?? 0 });
    }
  }
  if (filter !== 'pickups') {
    for (const record of orders) {
      if (!isClosedDelivery(record)) continue;
      items.push({ kind: 'delivery', key: `d-${record.id}`, record, completedAt: record.completed_at || null,
        sortTime: time(record.completed_at) ?? time(record.preferred_schedule) ?? time(record.created_at) ?? 0 });
    }
  }
  return items.sort((a, b) => (b.sortTime - a.sortTime) || a.key.localeCompare(b.key));
}
