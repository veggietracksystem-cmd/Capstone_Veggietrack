import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { refineLocation, locationError, withDeadline, GPS_REFINEMENT_TIMEOUT_MS } from './locationSamples';

// High accuracy and maximumAge: 0 explicitly ask the OS/browser for fresh fixes.
// Permission/services checks have their own deadline, then refinement is bounded.
export async function acquireDevicePosition(options = {}) {
  const timeoutMs = options.timeoutMs ?? GPS_REFINEMENT_TIMEOUT_MS;
  if (Platform.OS === 'web') {
    if (!globalThis.navigator?.geolocation) throw locationError('LOCATION_UNAVAILABLE', 'This browser does not support GPS.');
    return refineLocation(timeoutMs => new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      resolve,
      error => reject(locationError(error.code === 1 ? 'LOCATION_PERMISSION_DENIED' : error.code === 3 ? 'GPS_TIMEOUT' : 'LOCATION_UNAVAILABLE',
        error.code === 1 ? 'Location permission denied. Enable it in your browser settings.' : 'GPS unavailable. Move to an open area and tap Refresh Location.')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    )), options);
  }
  await withDeadline(async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!(permission.granted || permission.status === 'granted')) throw locationError('LOCATION_PERMISSION_DENIED', 'Location permission denied. Enable it in your device settings.');
    if (!await Location.hasServicesEnabledAsync()) throw locationError('LOCATION_SERVICES_DISABLED', 'Location services are disabled. Enable GPS in your device settings.');
  }, timeoutMs);
  // refineLocation needs two distinct fixes. On Android each Highest-accuracy
  // getCurrentPositionAsync can take several seconds, so asking for fixes one
  // at a time often yields only one before the deadline (GPS_UNCONFIRMED). The
  // first fix still comes from getCurrentPositionAsync; later fixes come from a
  // watch, which streams a fresh reading roughly every second.
  const watch = startPositionStream();
  let reads = 0;
  try {
    return await refineLocation(async remainingMs => {
      try {
        const started = Date.now(), n = reads;
        const fromWatch = reads++ > 0 && await watch.ready;
        const position = fromWatch ? await watch.next()
          : await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, maximumAge: 0, timeout: remainingMs });
        // TEMP rider-dashboard diagnostics — remove once pickup GPS is fixed.
        console.log('[rider-debug] GPS read', n, fromWatch ? 'watch' : 'current', `${Date.now() - started}ms`,
          'acc', position?.coords?.accuracy, 'age', `${Date.now() - position?.timestamp}ms`, 'mocked', position?.mocked, 'ts', position?.timestamp);
        return position;
      }
      catch (error) {
        if (error?.code === 'GPS_STALE') throw error;
        if (error?.code === 3 || error?.code === 'E_LOCATION_TIMEOUT') throw locationError('GPS_TIMEOUT', 'Location refresh timed out. Tap Refresh Location and try again.');
        throw locationError('LOCATION_UNAVAILABLE', 'GPS unavailable. Move to an open area and tap Refresh Location.');
      }
    }, options);
  } finally {
    watch.stop();
  }
}

// Queue of positions from watchPositionAsync. `ready` resolves false when the
// watch is unavailable, and the caller falls back to getCurrentPositionAsync.
function startPositionStream() {
  const queue = [];
  let waiter = null, subscription = null, stopped = false;
  const ready = typeof Location.watchPositionAsync !== 'function' ? Promise.resolve(false)
    : Location.watchPositionAsync({ accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0 }, position => {
      if (waiter) { const resolve = waiter; waiter = null; resolve(position); } else queue.push(position);
    }).then(sub => {
      console.log('[rider-debug] GPS watch started', !stopped);
      if (stopped) { sub.remove(); return false; }
      subscription = sub;
      return true;
    }, () => false);
  return {
    ready,
    next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => { waiter = resolve; })),
    stop: () => { stopped = true; waiter = null; subscription?.remove(); },
  };
}
