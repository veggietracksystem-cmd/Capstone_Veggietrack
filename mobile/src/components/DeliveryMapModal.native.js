import { useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ActivityIndicator, StyleSheet,
} from 'react-native';
import MapView, { Marker, Polyline, UrlTile, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';

const PRIMARY = '#2e7d32';
// Default region (Metro Manila) used until we have the courier's position.
const FALLBACK = { latitude: 14.5995, longitude: 120.9842, latitudeDelta: 0.3, longitudeDelta: 0.3 };

export default function DeliveryMapModal({ visible, address, coords, onClose }) {
  const [loading, setLoading] = useState(true);
  const [courier, setCourier] = useState(null);
  const [destination, setDestination] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setCourier(null);
      setDestination(null);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (!cancelled) setError('Location permission denied — showing destination only.');
        } else {
          const pos = await Location.getCurrentPositionAsync({});
          if (!cancelled) setCourier({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        }

        if (coords && coords.latitude && coords.longitude) {
          if (!cancelled) setDestination({ latitude: Number(coords.latitude), longitude: Number(coords.longitude) });
        } else if (address) {
          // Best-effort geocode of the free-text delivery address.
          try {
            const geo = await Location.geocodeAsync(address);
            if (!cancelled && geo && geo[0]) {
              setDestination({ latitude: geo[0].latitude, longitude: geo[0].longitude });
            }
          } catch {
            /* geocoding can fail for vague addresses; ignore */
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not determine location.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [visible, address, coords]);

  const anchor = courier || destination;
  const region = anchor
    ? { latitude: anchor.latitude, longitude: anchor.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }
    : FALLBACK;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Delivery Route</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.close}>Close ✕</Text>
          </TouchableOpacity>
        </View>
        {address ? <Text style={styles.addr}>📍 {address}</Text> : null}

        {loading ? (
          <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
        ) : (
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <MapView style={styles.map} provider={PROVIDER_DEFAULT} initialRegion={region}>
              {/* OpenStreetMap raster tiles */}
              <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} flipY={false} />
              {courier && <Marker coordinate={courier} title="You (courier)" pinColor={PRIMARY} />}
              {destination && <Marker coordinate={destination} title="Delivery address" pinColor="#d32f2f" />}
              {courier && destination && (
                <Polyline coordinates={[courier, destination]} strokeColor={PRIMARY} strokeWidth={3} />
              )}
            </MapView>
            {!destination && address ? (
              <Text style={styles.note}>Couldn’t pinpoint that address on the map; showing your location.</Text>
            ) : null}
          </>
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
  error: { color: '#c62828', paddingHorizontal: 16, marginBottom: 8 },
  note: { color: '#888', fontSize: 13, padding: 12, fontStyle: 'italic' },
  map: { flex: 1 },
});
