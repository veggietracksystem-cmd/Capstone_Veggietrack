import useTrackingPoll from './useTrackingPoll';

export default function useDeliveryTracking(orderId) {
  return useTrackingPoll(orderId ? `/api/delivery/tracking/${encodeURIComponent(orderId)}` : null);
}
