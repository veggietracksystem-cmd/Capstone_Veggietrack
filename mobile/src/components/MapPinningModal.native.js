import { useState, useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import MapView, { Marker, UrlTile, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';

const PRIMARY = '#2e7d32';
const SAN_PABLO = { latitude: 14.0683, longitude: 121.3256 };

export default function MapPinningModal({ visible, onConfirm, onClose }) {
  const [pinnedCoords, setPinnedCoords] = useState(SAN_PABLO);
  const [addressName, setAddressName] = useState('Fetching address...');
  const [loadingAddress, setLoadingAddress] = useState(false);

  // Get current location on mount/visible
  useEffect(() => {
    if (!visible) return;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({});
          setPinnedCoords({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        }
      } catch {
        // use fallback
      }
    })();
  }, [visible]);

  // Reverse geocode when coordinates change
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

  const handleConfirm = () => {
    onConfirm({
      latitude: pinnedCoords.latitude,
      longitude: pinnedCoords.longitude,
      address: addressName,
    });
  };

  const handleMapPress = (e) => {
    const coords = e.nativeEvent.coordinate;
    setPinnedCoords(coords);
  };

  const region = {
    latitude: pinnedCoords.latitude,
    longitude: pinnedCoords.longitude,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
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
          Tap on the map to place the pin at your exact business location.
        </Text>

        <View style={styles.mapContainer}>
          <MapView
            style={styles.map}
            provider={PROVIDER_DEFAULT}
            initialRegion={region}
            onPress={handleMapPress}
          >
            <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} flipY={false} />
            <Marker
              coordinate={pinnedCoords}
              draggable
              onDragEnd={(e) => setPinnedCoords(e.nativeEvent.coordinate)}
              title="Your Location"
              pinColor={PRIMARY}
            />
          </MapView>
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
  map: { flex: 1 },
  footer: { padding: 16, borderTopWidth: 1, borderColor: '#eee', backgroundColor: '#fafafa' },
  addressLabel: { fontSize: 13, fontWeight: '700', color: '#555' },
  addressText: { fontSize: 14, color: '#222', marginVertical: 6, lineHeight: 20 },
  btn: { backgroundColor: PRIMARY, paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
