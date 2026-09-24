import { useState, useEffect, useRef } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { rf } from '../lib/responsive';
import PlaceAutocomplete from './PlaceAutocomplete';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from '../i18n/useTranslation';
import { MAP_ZOOM_CSS } from '../lib/mapZoomStyle';

const PRIMARY = '#1E4E09';
const SAN_PABLO = { latitude: 14.0683, longitude: 121.3256 };

export default function MapPinningModal({ visible, onConfirm, onClose, initialCoords, initialAddress }) {
  const { t } = useTranslation();
  const [pinnedCoords, setPinnedCoords] = useState(initialCoords || SAN_PABLO);
  const [addressName, setAddressName] = useState(initialAddress || t('cmp.fetchingAddress'));
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [locationError, setLocationError] = useState('');

  const mapRef = useRef(null);
  const markerRef = useRef(null);

  // 0. Re-seed from the caller's existing pin (e.g. Edit Profile) each time the
  // modal opens, so re-opening after a cancel doesn't lose the saved location.
  useEffect(() => {
    if (!visible || !initialCoords) return;
    setPinnedCoords(initialCoords);
    setAddressName(initialAddress || t('cmp.fetchingAddress'));
  }, [visible]);

  // 1. Load Leaflet CDN script dynamically
  useEffect(() => {
    if (!visible) return;
    if (window.L) {
      setLeafletLoaded(true);
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    // Green zoom buttons (added once, after Leaflet's own CSS so it wins).
    if (!document.getElementById('vt-map-zoom-style')) {
      const zoomStyle = document.createElement('style');
      zoomStyle.id = 'vt-map-zoom-style';
      zoomStyle.textContent = MAP_ZOOM_CSS;
      document.head.appendChild(zoomStyle);
    }

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => setLeafletLoaded(true);
    document.head.appendChild(script);
  }, [visible]);

  // 2. Auto-detect user current location on modal open — skipped when an
  // existing pin was passed in, so editing a saved location doesn't silently
  // jump to the device's current GPS position.
  useEffect(() => {
    if (!visible || initialCoords) return;
    handleDetectLocation();
  }, [visible]);

  const handleDetectLocation = () => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setLocationError(t('cmp.locUnavailBrowser'));
      return;
    }
    setLocationError('');
    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const coords = { latitude: lat, longitude: lng };
        setPinnedCoords(coords);
        setDetectingLocation(false);
        if (mapRef.current && markerRef.current) {
          mapRef.current.setView([lat, lng], 16);
          markerRef.current.setLatLng([lat, lng]);
        }
      },
      (err) => {
        setLocationError(err?.code === 1
          ? t('cmp.locBlocked')
          : t('cmp.locFailed'));
        setDetectingLocation(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  // 3. Reverse geocode when coordinates change
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    (async () => {
      setLoadingAddress(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pinnedCoords.latitude}&lon=${pinnedCoords.longitude}`
        );
        const data = await res.json();
        if (!cancelled) {
          setAddressName(
            data.display_name ||
              `${pinnedCoords.latitude.toFixed(4)}, ${pinnedCoords.longitude.toFixed(4)}`
          );
        }
      } catch {
        if (!cancelled) {
          setAddressName(
            `${pinnedCoords.latitude.toFixed(4)}, ${pinnedCoords.longitude.toFixed(4)}`
          );
        }
      } finally {
        if (!cancelled) setLoadingAddress(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, pinnedCoords]);

  // 4. Initialize Map
  useEffect(() => {
    if (!visible || !leafletLoaded) return;

    const container = document.getElementById('pinning-map-leaflet');
    if (!container) return;

    // Seed from the caller's existing pin (not the possibly-stale `pinnedCoords`
    // closure) so the map is torn down/recreated fresh each open and always
    // starts centered on the saved location rather than a leftover unconfirmed one.
    const seed = initialCoords || pinnedCoords;

    const map = window.L.map('pinning-map-leaflet').setView(
      [seed.latitude, seed.longitude],
      15
    );
    mapRef.current = map;

    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    let marker = window.L.marker([seed.latitude, seed.longitude], {
      draggable: true,
    }).addTo(map);
    markerRef.current = marker;

    // Map click handler
    map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      setPinnedCoords({ latitude: lat, longitude: lng });
      marker.setLatLng([lat, lng]);
    });

    // Marker drag handler
    marker.on('dragend', () => {
      const { lat, lng } = marker.getLatLng();
      setPinnedCoords({ latitude: lat, longitude: lng });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [visible, leafletLoaded]);

  const handleSelectSearchResult = (item) => {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    if (isNaN(lat) || isNaN(lon)) return;

    const coords = { latitude: lat, longitude: lon };
    setPinnedCoords(coords);
    setAddressName(item.display_name || item.name);

    if (mapRef.current && markerRef.current) {
      mapRef.current.setView([lat, lon], 16);
      markerRef.current.setLatLng([lat, lon]);
    }
  };

  const handleConfirm = () => {
    onConfirm({
      latitude: pinnedCoords.latitude,
      longitude: pinnedCoords.longitude,
      address: addressName,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
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
          <div id="pinning-map-leaflet" style={{ width: '100%', height: '100%', borderRadius: '12px' }} />

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
          {locationError ? <Text style={styles.locationError}>{locationError}</Text> : null}
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 48 },
  title: { fontSize: rf(20), fontWeight: '700', color: PRIMARY },
  // Same small rounded outlined close button every other modal uses.
  closeBtn: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#ddd', alignItems: 'center', justifyContent: 'center',
  },

  mapContainer: { flex: 1, marginHorizontal: 16, marginBottom: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: '#f9f9f9', minHeight: 280, position: 'relative' },
  locateBtn: { position: 'absolute', top: 12, right: 12, minHeight: 40, backgroundColor: '#fff', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ddd', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3, zIndex: 1000 },
  locateBtnContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locateBtnText: { color: PRIMARY, fontWeight: '700', fontSize: rf(13), textAlign: 'center' },
  locationError: { position: 'absolute', zIndex: 1000, top: 58, left: 12, right: 12, padding: 8, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.94)', color: '#8a3b12', fontSize: rf(12), textAlign: 'center' },

  footer: { padding: 16, borderTopWidth: 1, borderColor: '#eee', backgroundColor: '#fafafa' },
  addressLabel: { fontSize: rf(13), fontWeight: '700', color: '#555' },
  addressText: { fontSize: rf(14), color: '#222', marginVertical: 6, lineHeight: 20 },
  btn: { backgroundColor: PRIMARY, minHeight: 48, paddingVertical: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: rf(16), textAlign: 'center' },
});
