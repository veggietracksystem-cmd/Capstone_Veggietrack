const { coordinate } = require('./trackingGeometry');
const { STALE_LOCATION_SECONDS } = require('./deliveryLocation');

function navigationPhase(status) {
  return ['picked_up', 'in_transit', 'delivered'].includes(status) ? 'delivery' : 'pickup';
}
function activeJourney(trackingData, mode = 'tracking') {
  const view = trackingData?.retailer_view || {}, nav = trackingData?.rider_view || {}, tracking = view.tracking || {};
  const navigation = mode === 'navigation';
  const phase = (navigation ? nav.navigation_phase : tracking.navigation_phase) || navigationPhase(trackingData?.status);
  const pickup = view.pickup || nav.pickup_location || {}, delivery = view.delivery || nav.delivery_location || {};
  const target = (navigation ? nav.navigation_target : tracking.navigation_target) || (phase === 'pickup' ? pickup : delivery);
  // Older retailer payloads used tracking.route and eta_seconds for the static
  // warehouse corridor. Explicit leg metadata is required to call that live.
  const isActiveRoute = navigation || !!tracking.navigation_phase;
  return { phase, target, pickup, delivery,
    route: isActiveRoute ? (navigation ? nav.full_route : tracking.route) : null,
    etaSeconds: isActiveRoute ? (navigation ? nav.eta_seconds : tracking.eta_seconds) : null,
    estimatedRoute: tracking.estimated_route || (!isActiveRoute ? tracking.route : null),
    estimatedRouteSeconds: tracking.estimated_route_seconds ?? (!isActiveRoute ? tracking.eta_seconds : null) };
}
function isLivePosition(position, now = Date.now()) {
  if (!coordinate(position)) return false;
  const value = position?.timestamp ?? position?.last_updated;
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) && now - timestamp <= STALE_LOCATION_SECONDS * 1000 && timestamp - now <= 30000;
}
function liveEtaSeconds(journey, { live, ended = false, offRoute = false, demo = false } = {}) {
  const duration = journey?.etaSeconds;
  if (!live || ended || offRoute || demo || !journey?.route || duration == null || duration === '' ||
      !Number.isFinite(Number(duration)) || Number(duration) < 0) return null;
  // Use the current leg's OSRM duration. Scaling duration by polyline progress
  // silently assumes a constant speed across different roads.
  return Number(duration);
}

module.exports = { navigationPhase, activeJourney, isLivePosition, liveEtaSeconds };
