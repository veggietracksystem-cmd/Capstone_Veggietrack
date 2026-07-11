import { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

const PRIMARY = '#2e7d32';
const SAN_PABLO = { latitude: 14.0683, longitude: 121.3256 };

export default function MapPinningModal({ visible, onConfirm, onClose }) {
  const [pinnedCoords, setPinnedCoords] = useState(SAN_PABLO);
  const [addressName, setAddressName] = useState('Fetching address...');
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [loadingAddress, setLoadingAddress] = useState(false);

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

  // Reverse geocode when coordinates change
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    (async () => {
      setLoadingAddress(true);
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pinnedCoords.latitude}&lon=${pinnedCoords.longitude}`);
        const data = await res.json();
        if (!cancelled) {
          setAddressName(data.display_name || `${pinnedCoords.latitude.toFixed(4)}, ${pinnedCoords.longitude.toFixed(4)}`);
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

  // Initialize Map
  useEffect(() => {
    if (!visible || !leafletLoaded) return;

    const container = document.getElementById('pinning-map-leaflet');
    if (!container) return;

    const map = window.L.map('pinning-map-leaflet').setView([pinnedCoords.latitude, pinnedCoords.longitude], 13);

    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    let marker = window.L.marker([pinnedCoords.latitude, pinnedCoords.longitude], { draggable: true }).addTo(map);

    // Map click handler
    map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      setPinnedCoords({ latitude: lat, longitude: lng });
      marker.setLatLng([lat, lng]);
    });

    // Marker drag handler
    marker.on('dragend', (e) => {
      const { lat, lng } = marker.getLatLng();
      setPinnedCoords({ latitude: lat, longitude: lng });
    });

    return () => {
      map.remove();
    };
  }, [visible, leafletLoaded]);

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
          <Text style={styles.title}>Pin Your Location</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.close}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.instructions}>
          Click or tap on the map to move the pin to your exact business location.
        </Text>

        <View style={styles.mapContainer}>
          <div id="pinning-map-leaflet" style={{ width: '100%', height: '100%', borderRadius: '12px' }} />
        </View>

        <View style={styles.footer}>
          <Text style={styles.addressLabel}>Selected Address:</Text>
          {loadingAddress ? (
            <ActivityIndicator size="small" color={PRIMARY} style={{ marginVertical: 8 }} />
          ) : (
            <Text style={styles.addressText}>{addressName}</Text>
          )}

          <TouchableOpacity style={styles.btn} onPress={handleConfirm}>
            <Text style={styles.btnText}>Confirm Location Pin</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingTop: 48 },
  title: { fontSize: 20, fontWeight: '700', color: PRIMARY },
  close: { color: '#c62828', fontSize: 16, fontWeight: '600' },
  instructions: { fontSize: 14, color: '#666', paddingHorizontal: 16, marginBottom: 8 },
  mapContainer: { flex: 1, margin: 16, borderRadius: 12, overflow: 'hidden', backgroundColor: '#f9f9f9', minHeight: 300 },
  footer: { padding: 16, borderTopWidth: 1, borderColor: '#eee', backgroundColor: '#fafafa' },
  addressLabel: { fontSize: 13, fontWeight: '700', color: '#555' },
  addressText: { fontSize: 14, color: '#222', marginVertical: 6, lineHeight: 20 },
  btn: { backgroundColor: PRIMARY, paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
