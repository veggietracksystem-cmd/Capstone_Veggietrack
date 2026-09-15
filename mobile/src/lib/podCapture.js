import * as Location from 'expo-location';

// The modal requests location before opening. On web the picker must launch
// directly from a user tap; refresh GPS immediately after the photo returns.
export async function captureProofPhoto(t, picker, platform) {
  let result;
  if (platform === 'web') {
    result = await picker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
  } else {
    const permission = await picker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error(t('dashboards.delivery.cameraPermissionMessage'));
    result = await picker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
  }
  if (result.canceled) return null;
  if (!result.assets?.[0]?.uri) throw new Error(t('dashboards.delivery.cameraErrorFallback'));
  return { ...result.assets[0], pod: await currentProofLocation(t) };
}

export async function currentProofLocation(t) {
  let timer;
  try {
    const operation = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error(t('pod.permission'));
      if (!(await Location.hasServicesEnabledAsync())) throw new Error(t('pod.services'));
      // Expo web defaults maximumAge to Infinity. Override it explicitly so a
      // previously cached navigation position cannot become delivery proof.
      return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest, maximumAge: 0, timeout: 20000 });
    };
    const result = await Promise.race([
      operation(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(t('pod.timeout'))), 20000); }),
    ]);
    const { latitude, longitude, accuracy } = result.coords || {};
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new Error(t('pod.unavailable'));
    if (result.mocked || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 50) throw new Error(t('pod.accuracy'));
    if (!Number.isFinite(result.timestamp) || Date.now() - result.timestamp > 30000 || result.timestamp > Date.now() + 30000) throw new Error(t('pod.stale'));
    return { latitude, longitude, accuracy, captured_at: new Date(result.timestamp).toISOString() };
  } catch (error) {
    if (error.code === 1) throw new Error(t('pod.permission'));
    if (error.code === 2) throw new Error(t('pod.unavailable'));
    if (error.code === 3) throw new Error(t('pod.timeout'));
    throw new Error(error.message || t('pod.unavailable'));
  } finally { clearTimeout(timer); }
}
