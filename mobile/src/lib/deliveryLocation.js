import { coordinate, distanceBetween } from './trackingGeometry';

// UX mirrors the authoritative backend policy. Road distance is never a geofence.
export const BASE_DELIVERY_RADIUS_METERS = 100;
export const MAX_ACCURACY_ALLOWANCE_METERS = 50;
export const STALE_LOCATION_SECONDS = 60;
// EXPO_PUBLIC_MAX_GPS_ACCURACY_METERS relaxes the cap for local testing on a
// desktop browser, whose WiFi-derived fixes never reach 100m. Unset in any real
// build, which keeps the policy mirrored with backend/lib/locationPolicy.js.
// Read defensively: this module is also loaded outside a bundler (the mobile
// unit tests evaluate it in a bare sandbox), where `process` does not exist and
// a direct read would throw before any of these constants were defined.
const ACCURACY_OVERRIDE = typeof process === 'undefined' ? NaN : Number(process.env?.EXPO_PUBLIC_MAX_GPS_ACCURACY_METERS);
export const MAX_ACCEPTABLE_GPS_ACCURACY_METERS = ACCURACY_OVERRIDE || 100;
export const MISSING_DESTINATION_MESSAGE = 'We don’t have a location for this delivery yet. Please contact the distributor.';
export const POOR_ACCURACY_MESSAGE = 'Your location isn’t accurate enough to confirm where you are. Please refresh your location and try again.';
export const REFRESH_ACCURACY_MESSAGE = 'Your location isn’t accurate enough yet. Move to an open area and tap Refresh Location.';

export function orderDestination(order) {
  const snapshot = coordinate({ latitude: order?.delivery_latitude, longitude: order?.delivery_longitude });
  if (snapshot) return { ...snapshot, coordinate_source: 'order_snapshot' };
  // The API resolves only a matching saved address/store for older orders.
  // Never geocode the display text or use an unrelated default address here.
  const resolved = coordinate(order?.retailer_coords);
  return resolved ? { ...resolved, coordinate_source: order?.retailer_coords?.coordinate_source || order?.delivery_coordinate_source || order?.coordinate_source || 'retailer_store' } : null;
}

export function validateDeliveryLocation(position, destination, now = Date.now()) {
  const fail = (code, message, details = {}) => { throw Object.assign(new Error(message), { code, ...details }); };
  const target = coordinate(destination);
  if (!target) fail('MISSING_DESTINATION', MISSING_DESTINATION_MESSAGE);
  const rider = coordinate(position);
  if (!rider) fail('LOCATION_UNAVAILABLE', 'Current GPS coordinates are required. Refresh your location and try again.');
  const accuracy = position.accuracy;
  if (position.mocked || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCEPTABLE_GPS_ACCURACY_METERS) fail('GPS_INACCURATE', POOR_ACCURACY_MESSAGE);
  const timestamp = position.timestamp ?? Date.parse(position.captured_at);
  if (!Number.isFinite(timestamp) || now - timestamp > STALE_LOCATION_SECONDS * 1000 || timestamp > now + 30000) fail('GPS_STALE', 'Your GPS location is out of date. Refresh your location and try again.');
  const distanceMeters = distanceBetween(rider, target);
  const effectiveRadiusMeters = BASE_DELIVERY_RADIUS_METERS + Math.min(accuracy, MAX_ACCURACY_ALLOWANCE_METERS);
  // Distance-to-destination is shown for context (and matches what the
  // backend records for ETA/routing) but never blocks completion — see
  // validateProof in backend/lib/deliveryProof.js for the matching change.
  const verified = distanceMeters <= effectiveRadiusMeters;
  const diagnostics = { distanceMeters, effectiveRadiusMeters, accuracy, verified, source: destination.coordinate_source || 'unavailable' };
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.debug('[delivery verification]', { rider, destination: target, ...diagnostics });
  return diagnostics;
}
