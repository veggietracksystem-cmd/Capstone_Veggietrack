import { rf } from '../lib/responsive';
import { useState, useEffect, useRef } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { colors, fonts, radius } from '../theme/appTheme';
import { coordinate } from '../lib/trackingGeometry';

const PRIMARY = colors.leaf700;
const SAN_PABLO = { latitude: 14.0683, longitude: 121.3256 };

export default function DeliveryMapModal({ visible, address, coords, onClose }) {
  const [loading, setLoading] = useState(true);
  const [destination, setDestination] = useState(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [geocodeFailed, setGeocodeFailed] = useState(false);
  const [courier, setCourier] = useState(null);
  const [gpsError, setGpsError] = useState('');
  const mapRef = useRef(null), courierMarker = useRef(null);

  useEffect(() => {
    if (!visible) return;
    setCourier(null); setGpsError('');
    let cancelled = false;
    if (!navigator.geolocation) {
      setGpsError('Device location unavailable. The destination pin is not your location.');
      return;
    }
    const watch = navigator.geolocation.watchPosition(position => {
      if (!cancelled) { setCourier(coordinate(position.coords)); setGpsError(''); }
    }, () => {
      if (!cancelled) setGpsError('Cannot get your GPS. Enable location permission. The destination pin is not your location.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    return () => { cancelled = true; navigator.geolocation.clearWatch(watch); };
  }, [visible]);

  // Load Leaflet CDN script dynamically
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

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => setLeafletLoaded(true);
    document.head.appendChild(script);
  }, [visible]);

  // Geocode address or use coords
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setGeocodeFailed(false);
      setDestination(null);
      try {
        if (coordinate(coords)) {
          if (!cancelled) setDestination(coordinate(coords));
        } else if (address) {
          const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`);
          const data = await res.json();
          if (!cancelled && data && data[0]) {
            setDestination({
              latitude: parseFloat(data[0].lat),
              longitude: parseFloat(data[0].lon)
            });
          } else if (!cancelled) {
            setGeocodeFailed(true);
          }
        } else if (!cancelled) {
          setGeocodeFailed(true);
        }
      } catch {
        if (!cancelled) {
          setGeocodeFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visible, address, coords]);

  // Initialize Map
  useEffect(() => {
    if (!visible || !leafletLoaded || loading) return;

    const container = document.getElementById('delivery-map-leaflet');
    if (!container) return;

    const center = destination || SAN_PABLO;
    const map = window.L.map(container).setView([center.latitude, center.longitude], destination ? 14 : 10);
    mapRef.current = map;

    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    if (destination) {
      const label = document.createElement('div');
      label.textContent = `Destination: ${address || 'Delivery address'}`;
      window.L.marker([destination.latitude, destination.longitude], { title: 'Destination' }).addTo(map).bindPopup(label);
    }

    return () => {
      map.remove();
      mapRef.current = null; courierMarker.current = null;
    };
  }, [visible, leafletLoaded, loading, destination, address]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !courier) return;
    const point = [courier.latitude, courier.longitude];
    if (courierMarker.current) courierMarker.current.setLatLng(point);
    else {
      courierMarker.current = window.L.circleMarker(point, { radius: 9, color: '#fff', weight: 3, fillColor: '#218258', fillOpacity: 1 })
        .addTo(map).bindPopup('You (courier) — device GPS');
      if (destination) map.fitBounds([point, [destination.latitude, destination.longitude]], { padding: [35, 35], maxZoom: 16 });
      else map.setView(point, 16);
    }
  }, [courier, visible, leafletLoaded, loading, destination, address]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Map Navigation</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.close}>Close ✕</Text>
          </TouchableOpacity>
        </View>
        {address ? <Text style={styles.addr}>📍 {address}</Text> : null}
        <Text style={styles.note}>{gpsError || (courier ? 'Green dot: you (device GPS). Pin: destination.' : 'Waiting for your device GPS. Pin: destination.')}</Text>

        {loading ? (
          <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
        ) : (
          <View style={styles.mapContainer}>
            <div id="delivery-map-leaflet" style={{ width: '100%', height: '100%', borderRadius: '12px' }} />
            {geocodeFailed ? (
              <Text style={styles.note}>Could not pinpoint address on the map.</Text>
            ) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 48 },
  title: { fontFamily: fonts.heading, fontSize: rf(19), color: colors.ink },
  close: { fontFamily: fonts.bodySemiBold, color: PRIMARY, fontSize: rf(15) },
  addr: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft, paddingHorizontal: 16, marginBottom: 8 },
  mapContainer: { flex: 1, margin: 16, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.leaf50, minHeight: 300 },
  note: { fontFamily: fonts.body, color: colors.gold700, fontSize: rf(12), padding: 10, fontStyle: 'italic', backgroundColor: colors.gold100, textAlign: 'center' },
});
