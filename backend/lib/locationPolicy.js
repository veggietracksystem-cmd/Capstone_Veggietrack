// Keep these values aligned with mobile/src/lib/deliveryLocation.js and
// sql/delivery_location_policy.sql. GPS uncertainty is capped, never unlimited.
const BASE_DELIVERY_RADIUS_METERS = 100;
const MAX_ACCURACY_ALLOWANCE_METERS = 50;
const STALE_LOCATION_SECONDS = 60;
// Browser geolocation on a desktop is WiFi-derived and routinely reports
// hundreds of metres, which no real policy should accept. MAX_GPS_ACCURACY_METERS
// relaxes the cap for local testing only; unset (production) keeps the real 100m.
const MAX_ACCEPTABLE_GPS_ACCURACY_METERS = Number(process.env.MAX_GPS_ACCURACY_METERS) || 100;
// Mirrors the `distance + accuracy > 150` rule inside complete_pickup_with_proof
// (sql/pickup_tracking_proof.sql). The SQL remains the authority; this copy only
// lets the pre-flight check reject a too-far pickup before a photo is uploaded.
const PICKUP_PROXIMITY_LIMIT_METERS = 150;
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
  STALE_LOCATION_SECONDS, MAX_ACCEPTABLE_GPS_ACCURACY_METERS, PICKUP_PROXIMITY_LIMIT_METERS,
  distanceMeters, effectiveRadius };
