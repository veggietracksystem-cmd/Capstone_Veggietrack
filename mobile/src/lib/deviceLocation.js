import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { refineLocation, locationError, withDeadline, GPS_REFINEMENT_TIMEOUT_MS } from './locationSamples';
import { tr } from '../i18n/translate';

// On Android, requestForegroundPermissionsAsync always opens the system permission
// screen, even when access is already granted (it closes at once). That pauses and
// resumes the app, so calling it from code that runs on resume loops: on a phone
// with permission already allowed, the rider map opened it ~6 times a second until
// Android closed VeggieTrack for "rapid activity launch". So: check first, and ask
// only when access is missing, the caller allows it, and Android can still ask.
export async function ensureLocationPermission({ ask = true } = {}) {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted || current.status === 'granted' || !ask || current.canAskAgain === false) return current;
  return Location.requestForegroundPermissionsAsync();
}
export const isPermissionGranted = (permission) => !!(permission?.granted || permission?.status === 'granted');
// Android 12+: the rider allowed only approximate location ("Use precise location" off).
export const isApproximateOnly = (permission) => permission?.android?.accuracy === 'coarse';

// High accuracy and maximumAge: 0 explicitly ask the OS/browser for fresh fixes.
// Permission/services checks have their own deadline, then refinement is bounded.
export async function acquireDevicePosition(options = {}) {
  const timeoutMs = options.timeoutMs ?? GPS_REFINEMENT_TIMEOUT_MS;
  if (Platform.OS === 'web') {
    if (!globalThis.navigator?.geolocation) throw locationError('LOCATION_UNAVAILABLE', 'This browser can’t find your location.');
    return refineLocation(timeoutMs => new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      resolve,
      error => reject(locationError(error.code === 1 ? 'LOCATION_PERMISSION_DENIED' : error.code === 3 ? 'GPS_TIMEOUT' : 'LOCATION_UNAVAILABLE',
        error.code === 1 ? tr('misc.gpsDenied') : tr('misc.gpsUnavail'))),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    )), options);
  }
  await withDeadline(async () => {
    const permission = await ensureLocationPermission({ ask: options.askPermission !== false });
    if (!isPermissionGranted(permission)) throw locationError('LOCATION_PERMISSION_DENIED', 'Location access is turned off. Please allow it in your phone’s settings.');
    if (!await Location.hasServicesEnabledAsync()) throw locationError('LOCATION_SERVICES_DISABLED', 'Location is turned off on your phone. Please turn it on in your phone’s settings.');
  }, timeoutMs);
  // refineLocation needs two distinct fixes. The first comes from
  // getCurrentPositionAsync; later fixes come from a position watch, which is
  // much faster than repeated single requests on Android.
  const watch = startPositionStream();
  let reads = 0;
  try {
    return await refineLocation(async remainingMs => {
      try {
        const fromWatch = reads++ > 0 && await watch.ready;
        const position = fromWatch ? await watch.next()
          : await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, maximumAge: 0, timeout: remainingMs });
        return position;
      }
      catch (error) {
        if (error?.code === 'GPS_STALE') throw error;
        if (error?.code === 3 || error?.code === 'E_LOCATION_TIMEOUT') throw locationError('GPS_TIMEOUT', 'Finding your location took too long. Tap Refresh Location and try again.');
        throw locationError('LOCATION_UNAVAILABLE', 'We can’t find your location. Move to an open area and tap Refresh Location.');
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
