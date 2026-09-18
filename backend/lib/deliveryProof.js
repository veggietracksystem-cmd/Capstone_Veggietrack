const { coordinate } = require('./deliveryTracking');
const { BASE_DELIVERY_RADIUS_METERS, MAX_ACCURACY_ALLOWANCE_METERS, STALE_LOCATION_SECONDS,
  MAX_ACCEPTABLE_GPS_ACCURACY_METERS, distanceMeters, effectiveRadius } = require('./locationPolicy');
function scheduleInstant(value) {
  if (typeof value !== 'string') return NaN;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!m || Number(m[2].slice(0, 2)) > 23 || Number(m[2].slice(3)) > 59 || Number(m[3] || 0) > 59) return NaN;
  const day = new Date(`${m[1]}T00:00:00Z`);
  if (!Number.isFinite(+day) || day.toISOString().slice(0, 10) !== m[1]) return NaN;
  return Date.parse(value + (m[5] ? '' : '+08:00'));
}
function validateSchedule(value, now = Date.now()) {
  const instant = scheduleInstant(value);
  if (!Number.isFinite(instant)) throw new Error('Select a valid delivery date and time.');
  if (instant <= now) throw new Error('Delivery date and time cannot be in the past.');
  return new Date(instant).toISOString();
}
function proofError(code, message) { return Object.assign(new Error(message), { code }); }
function validateProof(body = {}, destination, now = Date.now()) {
  if (!coordinate(destination)) throw proofError('DELIVERY_DESTINATION_MISSING', 'Delivery location coordinates are unavailable. Contact the distributor.');
  const point = coordinate(body);
  if (!point || typeof body.latitude !== 'number' || typeof body.longitude !== 'number') throw proofError('GPS_REQUIRED', 'Current GPS coordinates are required.');
  if (typeof body.accuracy !== 'number' || !Number.isFinite(body.accuracy) || body.accuracy < 0 || body.accuracy > MAX_ACCEPTABLE_GPS_ACCURACY_METERS) throw proofError('GPS_INACCURATE', 'Your current GPS signal is too inaccurate to verify your location. Refresh your location and try again.');
  const captured = typeof body.captured_at === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(body.captured_at) ? Date.parse(body.captured_at) : NaN;
  if (!Number.isFinite(captured) || now - captured > STALE_LOCATION_SECONDS * 1000 || captured - now > 30000) throw proofError('GPS_STALE', 'Your GPS location has expired. Refresh your location and try again.');
  const distance = distanceMeters(point, destination);
  const radius = effectiveRadius(body.accuracy);
  if (process.env.DEBUG_DELIVERY_LOCATION === 'true') console.debug('Delivery location verification', {
    rider: point, destination: coordinate(destination), accuracy: body.accuracy, distance_meters: distance,
    effective_radius_meters: radius, coordinate_source: destination.coordinate_source || 'order_snapshot',
  });
  if (distance > radius) throw proofError('DELIVERY_OUTSIDE_RADIUS', `You are approximately ${Math.round(distance)} m from the delivery location. Move closer before completing this delivery.`);
  return { latitude: point.latitude, longitude: point.longitude, accuracy: body.accuracy,
    captured_at: new Date(captured).toISOString(), submitted_at: new Date(now).toISOString(),
    location_status: 'verified', distance_meters: distance, effective_radius_meters: radius,
    coordinate_source: destination.coordinate_source || 'order_snapshot', address: null };
}
// GPS/photo/timestamp capture is mandatory for pickup exactly as it is for
// delivery; only the destination-proximity requirement differs (a farmer's
// farm location pin is optional, so the caller checks distance separately —
// see complete_pickup_with_proof in sql/pickup_tracking_proof.sql).
function validatePickupProof(body = {}, now = Date.now()) {
  const point = coordinate(body);
  if (!point || typeof body.latitude !== 'number' || typeof body.longitude !== 'number') throw proofError('GPS_REQUIRED', 'Current GPS coordinates are required.');
  if (typeof body.accuracy !== 'number' || !Number.isFinite(body.accuracy) || body.accuracy < 0 || body.accuracy > MAX_ACCEPTABLE_GPS_ACCURACY_METERS) throw proofError('GPS_INACCURATE', 'Your current GPS signal is too inaccurate to verify your location. Refresh your location and try again.');
  const captured = typeof body.captured_at === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(body.captured_at) ? Date.parse(body.captured_at) : NaN;
  if (!Number.isFinite(captured) || now - captured > STALE_LOCATION_SECONDS * 1000 || captured - now > 30000) throw proofError('GPS_STALE', 'Your GPS location has expired. Refresh your location and try again.');
  return { latitude: point.latitude, longitude: point.longitude, accuracy: body.accuracy,
    captured_at: new Date(captured).toISOString(), submitted_at: new Date(now).toISOString() };
}
function proofImageUrl(url, proof, cloud = process.env.CLOUDINARY_CLOUD_NAME, kind = 'Delivery') {
  // Restrict to original Cloudinary uploads; never fetch arbitrary client URLs.
  if (typeof url !== 'string' || !/^https:\/\/res\.cloudinary\.com\/[\w-]+\/image\/upload\/v\d+\/[\w/.-]+$/.test(url) || url.includes('..')) throw new Error('A valid uploaded proof photo is required.');
  if (cloud && new URL(url).pathname.split('/')[1] !== cloud) throw new Error('Upload proof to the configured VeggieTrack photo storage.');
  const date = new Date(proof.submitted_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const label = `VeggieTrack | ${kind} proof\nSubmitted: ${date} PHT\nGPS: ${proof.latitude.toFixed(6)}, ${proof.longitude.toFixed(6)}`;
  const text = encodeURIComponent(encodeURIComponent(label));
  return url.replace('/image/upload/', `/image/upload/c_pad,w_1200,h_900,b_rgb:1E4E09/l_text:Arial_24:${text},co_white,b_rgb:1E4E09/fl_layer_apply,g_south,y_12/`);
}
async function ensureProofImage(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  const valid = response.ok && /^image\//.test(response.headers.get('content-type') || '');
  await response.body?.cancel();
  if (!valid) throw new Error('Proof image could not be generated. Retry uploading the photo.');
}
module.exports = { scheduleInstant, validateSchedule, distanceMeters, validateProof, validatePickupProof, proofImageUrl, ensureProofImage,
  BASE_DELIVERY_RADIUS_METERS, MAX_ACCURACY_ALLOWANCE_METERS, STALE_LOCATION_SECONDS,
  MAX_ACCEPTABLE_GPS_ACCURACY_METERS, effectiveRadius,
  RADIUS_METERS: BASE_DELIVERY_RADIUS_METERS + MAX_ACCURACY_ALLOWANCE_METERS,
  MAX_ACCURACY_METERS: MAX_ACCEPTABLE_GPS_ACCURACY_METERS };
