// Keep these values aligned with mobile/src/lib/deliveryLocation.js and
// sql/delivery_location_policy.sql. GPS uncertainty is capped, never unlimited.
const BASE_DELIVERY_RADIUS_METERS = 100;
const MAX_ACCURACY_ALLOWANCE_METERS = 50;
const STALE_LOCATION_SECONDS = 60;
const MAX_ACCEPTABLE_GPS_ACCURACY_METERS = 100;
function distanceMeters(a, b) {
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function effectiveRadius(accuracy) {
  return BASE_DELIVERY_RADIUS_METERS + Math.min(accuracy, MAX_ACCURACY_ALLOWANCE_METERS);
}
module.exports = { BASE_DELIVERY_RADIUS_METERS, MAX_ACCURACY_ALLOWANCE_METERS,
  STALE_LOCATION_SECONDS, MAX_ACCEPTABLE_GPS_ACCURACY_METERS, distanceMeters, effectiveRadius };
