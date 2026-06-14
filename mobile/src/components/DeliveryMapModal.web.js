import { View, Text, Modal, TouchableOpacity, StyleSheet, Linking } from 'react-native';

const PRIMARY = '#2e7d32';

// Web fallback: react-native-maps has no web support, so we offer an
// "open in OpenStreetMap" link instead of an embedded native map.
export default function DeliveryMapModal({ visible, address, onClose }) {
  const openOSM = () => {
    const url = `https://www.openstreetmap.org/search?query=${encodeURIComponent(address || '')}`;
    Linking.openURL(url);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Delivery Route</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.close}>Close ✕</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.msg}>
            The interactive map is available in the mobile app (Android/iOS).
          </Text>
          {address ? <Text style={styles.addr}>📍 {address}</Text> : null}
          <TouchableOpacity style={styles.btn} onPress={openOSM} disabled={!address}>
            <Text style={styles.btnText}>Open in OpenStreetMap</Text>
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
  close: { color: PRIMARY, fontSize: 16, fontWeight: '600' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  msg: { fontSize: 15, color: '#555', textAlign: 'center' },
  addr: { fontSize: 15, color: '#333', fontWeight: '600', textAlign: 'center' },
  btn: { backgroundColor: PRIMARY, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
