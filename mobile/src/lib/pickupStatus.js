// Pickup request lifecycle (backend/lib/pickups.js) as shown in the app.
//   requested  Pending          approved  Approved
//   assigned   Ready for Pickup otw       In Progress
//   picked_up  Picked Up        declined  Declined

// Distributor Pickup Requests tabs, in order.
export const PICKUP_TABS = ['pending', 'active', 'completed', 'declined'];

export function pickupTabOf(status) {
  if (status === 'requested') return 'pending';
  if (['approved', 'assigned', 'otw'].includes(status)) return 'active';
  if (status === 'picked_up') return 'completed';
  if (['declined', 'cancelled'].includes(status)) return 'declined';
  return 'pending';
}

// StatusBadge tone and translation key for a pickup status.
const BADGES = {
  requested: { tone: 'pending', labelKey: 'pickupStatus.requested' },
  approved: { tone: 'approved', labelKey: 'pickupStatus.approved' },
  assigned: { tone: 'assigned', labelKey: 'pickupStatus.assigned' },
  otw: { tone: 'otw', labelKey: 'pickupStatus.otw' },
  picked_up: { tone: 'completed', labelKey: 'pickupStatus.picked_up' },
  declined: { tone: 'declined', labelKey: 'pickupStatus.declined' },
  cancelled: { tone: 'cancelled', labelKey: 'pickupStatus.declined' },
};
export function pickupBadge(status) {
  return BADGES[status] || { tone: status, labelKey: null };
}
