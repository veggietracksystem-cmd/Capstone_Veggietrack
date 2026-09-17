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
  return refineLocation(async remainingMs => {
    try {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, maximumAge: 0, timeout: remainingMs });
      return position;
    }
    catch (error) {
      if (error?.code === 'GPS_STALE') throw error;
      if (error?.code === 3 || error?.code === 'E_LOCATION_TIMEOUT') throw locationError('GPS_TIMEOUT', 'Location refresh timed out. Tap Refresh Location and try again.');
      throw locationError('LOCATION_UNAVAILABLE', 'GPS unavailable. Move to an open area and tap Refresh Location.');
    }
  }, options);
}
