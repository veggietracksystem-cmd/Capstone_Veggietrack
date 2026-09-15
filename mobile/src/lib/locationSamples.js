const { coordinate } = require('./trackingGeometry');
const { STALE_LOCATION_SECONDS, MAX_ACCEPTABLE_GPS_ACCURACY_METERS } = require('./deliveryLocation');

const GPS_REFINEMENT_TIMEOUT_MS = 10000;
const GPS_POLL_INTERVAL_MS = 700;
const poorAccuracyMessage = 'Your GPS signal is not accurate enough yet. Move to an open area and tap Refresh Location.';
const locationError = (code, message) => Object.assign(new Error(message), { code });

// Never manufacture a timestamp: missing capture time cannot establish freshness.
function locationSample(value) {
  const coords = value?.coords || value;
  const point = coordinate(coords);
  const timestamp = typeof value?.timestamp === 'number' ? value.timestamp : Date.parse(value?.timestamp);
  const accuracy = coords?.accuracy == null || coords.accuracy === '' ? null : Number(coords.accuracy);
  return point && Number.isFinite(timestamp) ? { ...point, timestamp, mocked: value?.mocked === true,
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null } : null;
}
function isRecentSample(sample, now = Date.now()) {
  return !!sample && now - sample.timestamp <= STALE_LOCATION_SECONDS * 1000 && sample.timestamp - now <= 30000;
}
function isAcceptableSample(sample, now = Date.now()) {
  return isRecentSample(sample, now) && !sample.mocked && sample.accuracy != null && sample.accuracy <= MAX_ACCEPTABLE_GPS_ACCURACY_METERS;
}
function withDeadline(operation, timeoutMs) {
  let timer;
  return Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
    timer = setTimeout(() => reject(locationError('GPS_TIMEOUT', 'Location refresh timed out. Tap Refresh Location and try again.')), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}

// Two distinct acceptable capture timestamps are required. A cached fix repeated
// by a device is still one observation. Keep the more accurate recent fix.
async function refineLocation(readPosition, { timeoutMs = GPS_REFINEMENT_TIMEOUT_MS, now = Date.now,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), pollIntervalMs = GPS_POLL_INTERVAL_MS } = {}) {
  const deadline = now() + timeoutMs;
  const samples = new Map();
  let sawStale = false, sawInaccurate = false, lastError;
  while (now() < deadline) {
    try {
      const sample = locationSample(await withDeadline(() => readPosition(Math.max(1, deadline - now())), Math.max(1, deadline - now())));
      if (!isRecentSample(sample, now())) sawStale = true;
      else if (!isAcceptableSample(sample, now())) sawInaccurate = true;
      else samples.set(sample.timestamp, sample);
      const acceptable = [...samples.values()].filter(item => isAcceptableSample(item, now()));
      if (acceptable.length >= 2) return acceptable.sort((a, b) => a.accuracy - b.accuracy || b.timestamp - a.timestamp)[0];
    } catch (error) {
      if (['LOCATION_PERMISSION_DENIED', 'LOCATION_SERVICES_DISABLED'].includes(error.code)) throw error;
      lastError = error;
      if (error.code === 'GPS_TIMEOUT') break;
    }
    const remaining = deadline - now();
    if (remaining > 0) await pause(Math.min(pollIntervalMs, remaining));
  }
  if (sawInaccurate) throw locationError('GPS_INACCURATE', poorAccuracyMessage);
  if (sawStale && samples.size === 0) throw locationError('GPS_STALE', 'Your location is out of date. Tap Refresh Location and try again.');
  if (samples.size < 2 && samples.size > 0) throw locationError('GPS_UNCONFIRMED', 'Your location could not be confirmed. Tap Refresh Location and try again.');
  throw lastError || locationError('LOCATION_UNAVAILABLE', 'GPS unavailable. Move to an open area and tap Refresh Location.');
}

module.exports = { GPS_REFINEMENT_TIMEOUT_MS, GPS_POLL_INTERVAL_MS, locationSample, isRecentSample,
  isAcceptableSample, refineLocation, locationError, withDeadline };
