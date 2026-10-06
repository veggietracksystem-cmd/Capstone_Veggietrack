import { useState, useEffect, useRef } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { rf } from '../lib/responsive';
import PlaceAutocomplete from './PlaceAutocomplete';
import { Ionicons } from '@expo/vector-icons';
import ModalCloseButton from './ui/ModalCloseButton';
import { useTranslation } from '../i18n/useTranslation';
import { MAP_ZOOM_CSS } from '../lib/mapZoomStyle';
import { typography } from '../theme/appTheme';

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

  // On each open, start from the caller's existing pin so a cancelled edit does
  // not lose the saved location.
  useEffect(() => {
    if (!visible || !initialCoords) return;
    setPinnedCoords(initialCoords);
    setAddressName(initialAddress || t('cmp.fetchingAddress'));
  }, [visible]);

  // Load the Leaflet script from the CDN.
  useEffect(() => {
    if (!visible) return;
    if (window.L) {
      setLeafletLoaded(true);
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    link.crossOrigin = '';
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
    script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
    script.crossOrigin = '';
    script.onload = () => setLeafletLoaded(true);
    document.head.appendChild(script);
  }, [visible]);

  // Detect the current location, unless an existing pin was passed in.
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

  // Reverse geocode when the coordinates change.
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

  useEffect(() => {
    if (!visible || !leafletLoaded) return;

    const container = document.getElementById('pinning-map-leaflet');
    if (!container) return;

    // Start from the caller's pin rather than a possibly stale unconfirmed one.
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

    map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      setPinnedCoords({ latitude: lat, longitude: lng });
      marker.setLatLng([lat, lng]);
    });

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
          <ModalCloseButton onPress={onClose} />
        </View>

        <PlaceAutocomplete visible={visible} onSelect={handleSelectSearchResult} />

        <View style={styles.mapContainer}>
          <div id="pinning-map-leaflet" style={{ width: '100%', height: '100%', borderRadius: '12px' }} />

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
  title: { ...typography.modalTitle, color: PRIMARY },
  closeBtn: {
    width: 38, height: 38, borderRadius: 10, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#ddd', alignItems: 'center', justifyContent: 'center',
  },

  mapContainer: { flex: 1, marginHorizontal: 16, marginBottom: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: '#f9f9f9', minHeight: 280, position: 'relative' },
  locateBtn: { position: 'absolute', top: 12, right: 12, minHeight: 40, backgroundColor: '#fff', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ddd', alignItems: 'center', justifyContent: 'center', elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 3, zIndex: 1000 },
  locateBtnContent: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locateBtnText: { ...typography.buttonCompact, color: PRIMARY, textAlign: 'center' },
  locationError: { ...typography.error, position: 'absolute', zIndex: 1000, top: 58, left: 12, right: 12, padding: 8, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.94)', color: '#8a3b12', textAlign: 'center' },

  footer: { padding: 16, borderTopWidth: 1, borderColor: '#eee', backgroundColor: '#fafafa' },
  addressLabel: { ...typography.label, color: '#555' },
  addressText: { fontSize: rf(14), color: '#222', marginVertical: 6, lineHeight: 20 },
  btn: { backgroundColor: PRIMARY, minHeight: 48, paddingVertical: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  btnText: { ...typography.buttonPrimary, color: '#fff', textAlign: 'center' },
});
