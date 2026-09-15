const { coordinate } = require('./deliveryTracking');
// 150 m accommodates entrances/loading areas; accuracy must be <= 50 m.
const RADIUS_METERS = 150;
const MAX_ACCURACY_METERS = 50;
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
function distanceMeters(a, b) {
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function validateProof(body, destination, now = Date.now()) {
  const point = coordinate(body);
  if (!point || typeof body.latitude !== 'number' || typeof body.longitude !== 'number') throw new Error('Current GPS coordinates are required.');
  if (typeof body.accuracy !== 'number' || !Number.isFinite(body.accuracy) || body.accuracy < 0 || body.accuracy > MAX_ACCURACY_METERS) throw new Error('GPS accuracy is insufficient. Retry at the delivery location (50 meters or better).');
  const captured = typeof body.captured_at === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(body.captured_at) ? Date.parse(body.captured_at) : NaN;
  if (!Number.isFinite(captured) || now - captured > 10 * 60 * 1000 || captured - now > 30000) throw new Error('Proof location has expired. Retake the photo and GPS location.');
  if (!coordinate(destination)) throw new Error('Delivery destination has no saved map pin. Ask the distributor to correct the destination before completing delivery.');
  const distance = distanceMeters(point, destination);
  // Include reported uncertainty: do not verify readings straddling the boundary.
  if (distance + body.accuracy > RADIUS_METERS) throw new Error(`Outside the delivery verification area (${Math.round(distance)} meters away). Retry at the destination.`);
  return { latitude: point.latitude, longitude: point.longitude, accuracy: body.accuracy,
    captured_at: new Date(captured).toISOString(), submitted_at: new Date(now).toISOString(),
    location_status: 'verified', distance_meters: distance, address: null };
}
function proofImageUrl(url, proof, cloud = process.env.CLOUDINARY_CLOUD_NAME) {
  // Restrict to original Cloudinary uploads; never fetch arbitrary client URLs.
  if (typeof url !== 'string' || !/^https:\/\/res\.cloudinary\.com\/[\w-]+\/image\/upload\/v\d+\/[\w/.-]+$/.test(url) || url.includes('..')) throw new Error('A valid uploaded proof photo is required.');
  if (cloud && new URL(url).pathname.split('/')[1] !== cloud) throw new Error('Upload proof to the configured VeggieTrack photo storage.');
  const date = new Date(proof.submitted_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const label = `VeggieTrack | Delivery proof\nSubmitted: ${date} PHT\nGPS: ${proof.latitude.toFixed(6)}, ${proof.longitude.toFixed(6)}`;
  const text = encodeURIComponent(encodeURIComponent(label));
  return url.replace('/image/upload/', `/image/upload/c_pad,w_1200,h_900,b_rgb:1E4E09/l_text:Arial_24:${text},co_white,b_rgb:1E4E09/fl_layer_apply,g_south,y_12/`);
}
async function ensureProofImage(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  const valid = response.ok && /^image\//.test(response.headers.get('content-type') || '');
  await response.body?.cancel();
  if (!valid) throw new Error('Proof image could not be generated. Retry uploading the photo.');
}
module.exports = { scheduleInstant, validateSchedule, distanceMeters, validateProof, proofImageUrl, ensureProofImage, RADIUS_METERS, MAX_ACCURACY_METERS };
