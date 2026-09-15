import { acquireDevicePosition } from './deviceLocation';

// On web launch the picker directly from the tap; permissions/GPS await afterwards.
// onSelected stages the image before GPS refinement so a GPS failure cannot lose it.
export async function captureProofPhoto(t, picker, platform, onSelected) {
  let result;
  if (platform === 'web') {
    result = await picker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
  } else {
    const permission = await picker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error(t('dashboards.delivery.cameraPermissionMessage'));
    result = await picker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
  }
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset?.uri) throw new Error(t('dashboards.delivery.cameraErrorFallback'));
  onSelected?.(asset);
  try { return { ...asset, pod: await currentProofLocation(t) }; }
  catch (error) { error.selectedPhoto = asset; throw error; }
}

export async function currentProofLocation(t) {
  try {
    const position = await acquireDevicePosition({ timeoutMs: 10000 });
    return { latitude: position.latitude, longitude: position.longitude, accuracy: position.accuracy,
      captured_at: new Date(position.timestamp).toISOString() };
  } catch (error) {
    if (error.code === 'GPS_INACCURATE') throw Object.assign(new Error(t('pod.accuracy')), { code: error.code });
    const key = { LOCATION_PERMISSION_DENIED: 'permission', LOCATION_SERVICES_DISABLED: 'services', GPS_STALE: 'stale', GPS_UNCONFIRMED: 'stale', GPS_TIMEOUT: 'timeout', LOCATION_UNAVAILABLE: 'unavailable' }[error.code];
    if (key) throw Object.assign(new Error(t(`pod.${key}`)), { code: error.code });
    throw error;
  }
}
