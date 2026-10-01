import useTrackingPoll from './useTrackingPoll';

// Pickup-request counterpart of useDeliveryTracking; same polling behaviour.
export default function usePickupTracking(pickupId) {
  return useTrackingPoll(pickupId ? `/api/pickup-requests/${encodeURIComponent(pickupId)}/tracking` : null);
}
