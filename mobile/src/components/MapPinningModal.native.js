import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import { rf } from '../lib/responsive';
import PlaceAutocomplete from './PlaceAutocomplete';
import { buildPinningMapHtml } from '../lib/leafletMapHtml';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = '#1E4E09';
const SAN_PABLO = { latitude: 14.0683, longitude: 121.3256 };

export default function MapPinningModal({ visible, onConfirm, onClose, initialCoords, initialAddress }) {
  const { t } = useTranslation();
  const [pinnedCoords, setPinnedCoords] = useState(initialCoords || SAN_PABLO);
  const [addressName, setAddressName] = useState(initialAddress || t('cmp.fetchingAddress'));
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);

  const webviewRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [openId, setOpenId] = useState(0);
  const [webviewError, setWebviewError] = useState(null);
  const pendingFlyToRef = useRef(null);

  // Sends a fly-to command into the WebView's Leaflet instance. Queued until
  // the page reports 'ready' if the WebView hasn't finished loading yet (e.g.
  // geolocation resolves faster than the CDN-hosted Leaflet page can load).
  const flyToMap = (lat, lng, zoom = 16) => {
    if (mapReady && webviewRef.current) {
      webviewRef.current.injectJavaScript(`window.flyTo && window.flyTo(${lat}, ${lng}, ${zoom}); true;`);
    } else {
      pendingFlyToRef.current = { lat, lng, zoom };
    }
  };

  const handleWebViewMessage = (e) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'ready') {
        setMapReady(true);
        if (pendingFlyToRef.current) {
          const { lat, lng, zoom } = pendingFlyToRef.current;
          pendingFlyToRef.current = null;
          webviewRef.current?.injectJavaScript(`window.flyTo && window.flyTo(${lat}, ${lng}, ${zoom}); true;`);
        }
      } else if (data.type === 'pinchange') {
        setPinnedCoords({ latitude: data.latitude, longitude: data.longitude });
      } else if (data.type === 'error') {
        console.warn('[MapPinningModal.native] WebView error:', data.message);
      }
    } catch {
      /* ignore malformed messages */
    }
  };

  // 0. Each time the modal opens: reset the map (forces a fresh WebView load
  // via `openId`) and re-seed from the caller's existing pin (e.g. Edit
  // Profile), so re-opening after a cancel doesn't lose the saved location.
  useEffect(() => {
    if (!visible) return;
    setMapReady(false);
    setWebviewError(null);
    setOpenId((n) => n + 1);
    if (initialCoords) {
      setPinnedCoords(initialCoords);
      setAddressName(initialAddress || t('cmp.fetchingAddress'));
    }
  }, [visible]);

  // 1. Auto-detect user current location on mount/visible — skipped when an
  // existing pin was passed in, so editing a saved location doesn't silently
  // jump to the device's current GPS position.
  useEffect(() => {
    if (!visible || initialCoords) return;
    handleDetectLocation();
  }, [visible]);

  const handleDetectLocation = async () => {
    setDetectingLocation(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        const coords = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        };
        setPinnedCoords(coords);
        flyToMap(coords.latitude, coords.longitude, 16);
      }
    } catch (err) {
      console.warn('[MapPinningModal.native] Geolocation error:', err);
    } finally {
      setDetectingLocation(false);
    }
  };

  // 2. Reverse geocode when coordinates change
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    (async () => {
      setLoadingAddress(true);
      try {
        const geo = await Location.reverseGeocodeAsync({
          latitude: pinnedCoords.latitude,
          longitude: pinnedCoords.longitude,
        });
        if (!cancelled && geo && geo[0]) {
          const g = geo[0];
          const parts = [
            g.name,
            g.street,
            g.district,
            g.city || g.subregion,
            g.region,
            g.country
          ].filter(Boolean);
          setAddressName(parts.join(', ') || `${pinnedCoords.latitude.toFixed(4)}, ${pinnedCoords.longitude.toFixed(4)}`);
        }
      } catch {
        if (!cancelled) {
          setAddressName(`${pinnedCoords.latitude.toFixed(4)}, ${pinnedCoords.longitude.toFixed(4)}`);
        }
      } finally {
        if (!cancelled) setLoadingAddress(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visible, pinnedCoords]);

  const handleSelectSearchResult = (item) => {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    if (isNaN(lat) || isNaN(lon)) return;

    const coords = { latitude: lat, longitude: lon };
    setPinnedCoords(coords);
    setAddressName(item.display_name || item.name);

    flyToMap(lat, lon, 16);
  };

  const handleConfirm = () => {
    onConfirm({
      latitude: pinnedCoords.latitude,
      longitude: pinnedCoords.longitude,
      address: addressName,
    });
  };

  // Fresh HTML/WebView per modal-open (keyed by openId) so the map always
  // starts centered on the caller's existing pin, not a stale closure value.
  const html = useMemo(() => {
    const seed = initialCoords || pinnedCoords;
    return buildPinningMapHtml({ centerLat: seed.latitude, centerLng: seed.longitude, zoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('cmp.pinTitle')}</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="close" size={rf(18)} color="#555" />
          </TouchableOpacity>
        </View>

        <PlaceAutocomplete visible={visible} onSelect={handleSelectSearchResult} />

        {/* Map Container & Floating Buttons */}
        <View style={styles.mapContainer}>
          <WebView
            ref={webviewRef}
            key={openId}
            originWhitelist={['*']}
            source={{ html }}
            style={styles.map}
            onMessage={handleWebViewMessage}
            onError={() => setWebviewError(t('cmp.mapLoadFailed'))}
          />
          {webviewError ? <Text style={styles.mapErrorNote}>{webviewError}</Text> : null}

          {/* Floating Locate Me Button */}
          <TouchableOpacity
            style={styles.locateBtn}
            onPress={handleDetectLocation}
            disabled={detectingLocation}
          >
            {detectingLocation ? (
              <ActivityIndicator color={PRIMARY} size="small" />
            ) : (
              <View style={styles.locateBtnContent}>
                <Ionicons name="locate-outline" size={rf(18)} color={PRIMARY} />
                <Text style={styles.locateBtnText}>{t('cmp.myLocation')}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.addressLabel}>{t('cmp.selectedAddress')}</Text>
          {loadingAddress ? (
            <ActivityIndicator size="small" color={PRIMARY} style={{ marginVertical: 8 }} />
          ) : (
            <Text style={styles.addressText}>{addressName}</Text>
          )}

          <TouchableOpacity style={styles.btn} onPress={handleConfirm}>
            <Text style={styles.btnText}>{t('cmp.confirmPin')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  kav: { flex: 1 },
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 48 },
  title: { fontSize: rf(20), fontWeight: '700', color: PRIMARY },
  // Same small rounded outlined close button every other modal uses.
  closeBtn: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#ddd', alignItems: 'center', justifyContent: 'center',
  },

  mapContainer: { flex: 1, marginHorizontal: 16, marginBottom: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: '#f9f9f9', minHeight: 280, position: 'relative' },
  map: { flex: 1 },
  mapErrorNote: { position: 'absolute', bottom: 8, left: 8, right: 8, backgroundColor: 'rgba(255,255,255,0.9)', color: '#c62828', fontSize: rf(12), padding: 8, borderRadius: 6, textAlign: 'center' },
  locateBtn: { position: 'absolute', top: 12, right: 12, minHeight: 40, backgroundColor: '#fff', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ddd', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3, zIndex: 1000 },
  locateBtnContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locateBtnText: { color: PRIMARY, fontWeight: '700', fontSize: rf(13), textAlign: 'center' },

  footer: { padding: 16, borderTopWidth: 1, borderColor: '#eee', backgroundColor: '#fafafa' },
  addressLabel: { fontSize: rf(13), fontWeight: '700', color: '#555' },
  addressText: { fontSize: rf(14), color: '#222', marginVertical: 6, lineHeight: 20 },
  btn: { backgroundColor: PRIMARY, minHeight: 48, paddingVertical: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: rf(16), textAlign: 'center' },
});
