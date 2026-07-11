import { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';

const PRIMARY = '#2e7d32';
const SAN_PABLO = { latitude: 14.0683, longitude: 121.3256 };

export default function DeliveryMapModal({ visible, address, coords, onClose }) {
  const [loading, setLoading] = useState(true);
  const [destination, setDestination] = useState(null);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [geocodeFailed, setGeocodeFailed] = useState(false);

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
      try {
        if (coords && coords.latitude && coords.longitude) {
          if (!cancelled) setDestination(coords);
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
            setDestination(SAN_PABLO);
          }
        } else if (!cancelled) {
          setDestination(SAN_PABLO);
        }
      } catch {
        if (!cancelled) {
          setGeocodeFailed(true);
          setDestination(SAN_PABLO);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visible, address, coords]);

  // Initialize Map
  useEffect(() => {
    if (!visible || !leafletLoaded || !destination) return;

    const container = document.getElementById('delivery-map-leaflet');
    if (!container) return;

    const map = window.L.map('delivery-map-leaflet').setView([destination.latitude, destination.longitude], 14);

    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    const marker = window.L.marker([destination.latitude, destination.longitude]).addTo(map);
    if (address) {
      marker.bindPopup(`<b>Location</b><br>${address}`).openPopup();
    }

    return () => {
      map.remove();
    };
  }, [visible, leafletLoaded, destination, address]);

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
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 48 },
  title: { fontSize: 20, fontWeight: '700', color: PRIMARY },
  close: { color: PRIMARY, fontSize: 16, fontWeight: '600' },
  addr: { fontSize: 14, color: '#555', paddingHorizontal: 16, marginBottom: 8 },
  mapContainer: { flex: 1, margin: 16, borderRadius: 12, overflow: 'hidden', backgroundColor: '#f9f9f9', minHeight: 300 },
  note: { color: '#e65100', fontSize: 12, padding: 10, fontStyle: 'italic', backgroundColor: '#fff3e0', textAlign: 'center' },
});
