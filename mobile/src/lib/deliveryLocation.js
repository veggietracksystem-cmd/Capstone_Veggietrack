import { coordinate, distanceBetween } from './trackingGeometry';
import { tr } from '../i18n/translate';

// Mirrors the backend location policy (backend/lib/locationPolicy.js).
export const BASE_DELIVERY_RADIUS_METERS = 100;
export const MAX_ACCURACY_ALLOWANCE_METERS = 50;
export const STALE_LOCATION_SECONDS = 60;
// EXPO_PUBLIC_MAX_GPS_ACCURACY_METERS may relax the accuracy cap for local desktop
// testing. `process` is checked because unit tests load this module without a bundler.
const ACCURACY_OVERRIDE = typeof process === 'undefined' ? NaN : Number(process.env?.EXPO_PUBLIC_MAX_GPS_ACCURACY_METERS);
export const MAX_ACCEPTABLE_GPS_ACCURACY_METERS = ACCURACY_OVERRIDE || 100;
// Functions (not constants) so the text follows the selected language.
export const missingDestinationMessage = () => tr('misc.noDestination');
export const poorAccuracyMessage = () => tr('misc.poorAccuracy');
export const refreshAccuracyMessage = () => tr('misc.refreshAccuracy');

export function orderDestination(order) {
  const snapshot = coordinate({ latitude: order?.delivery_latitude, longitude: order?.delivery_longitude });
  if (snapshot) return { ...snapshot, coordinate_source: 'order_snapshot' };
  // Older orders use coordinates the API resolved from a matching saved address;
  // the display text is never geocoded.
  const resolved = coordinate(order?.retailer_coords);
  return resolved ? { ...resolved, coordinate_source: order?.retailer_coords?.coordinate_source || order?.delivery_coordinate_source || order?.coordinate_source || 'retailer_store' } : null;
}

export function validateDeliveryLocation(position, destination, now = Date.now()) {
  const fail = (code, message, details = {}) => { throw Object.assign(new Error(message), { code, ...details }); };
  const target = coordinate(destination);
  if (!target) fail('MISSING_DESTINATION', missingDestinationMessage());
  const rider = coordinate(position);
  if (!rider) fail('LOCATION_UNAVAILABLE', tr('misc.needGps'));
  const accuracy = position.accuracy;
  if (position.mocked || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCEPTABLE_GPS_ACCURACY_METERS) fail('GPS_INACCURATE', poorAccuracyMessage());
  const timestamp = position.timestamp ?? Date.parse(position.captured_at);
  if (!Number.isFinite(timestamp) || now - timestamp > STALE_LOCATION_SECONDS * 1000 || timestamp > now + 30000) fail('GPS_STALE', tr('misc.gpsStale'));
  const distanceMeters = distanceBetween(rider, target);
  const effectiveRadiusMeters = BASE_DELIVERY_RADIUS_METERS + Math.min(accuracy, MAX_ACCURACY_ALLOWANCE_METERS);
  // Distance is shown for context but never blocks completion (see validateProof
  // in backend/lib/deliveryProof.js).
  const verified = distanceMeters <= effectiveRadiusMeters;
  const diagnostics = { distanceMeters, effectiveRadiusMeters, accuracy, verified, source: destination.coordinate_source || 'unavailable' };
  return diagnostics;
}
