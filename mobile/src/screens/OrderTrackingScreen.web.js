import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import OrderStepIndicator from '../components/OrderStepIndicator';

const PRIMARY = '#2e7d32';
const POLL_MS = 10000; // Issue 11: refresh status every 10s

function statusColor(status) {
  switch (status) {
    case 'pending': return '#f9a825';
    case 'approved':
    case 'assigned': return '#1976d2';
    case 'in_transit': return '#7b1fa2';
    case 'delivered': return PRIMARY;
    case 'cancelled': return '#c62828';
    default: return '#607d8b';
  }
}

// Web fallback: react-native-maps has no web support, so we show the status/ETA
// and an "open in OpenStreetMap" link instead of an embedded native map.
export default function OrderTrackingScreen({ route, navigation }) {
  const { orderId, deliveryAddress, orderStatus = 'pending' } = route.params || {};
  const [status, setStatus] = useState(orderStatus);

  // Poll order status every 10s so the stepper stays live (Issue 11).
  useEffect(() => {
    if (!orderId) return undefined;
    let active = true;
    const fetchStatus = async () => {
      try {
        const order = await api.get(`/api/orders/${orderId}`);
        if (active && order?.status) setStatus(order.status);
      } catch { /* keep last known status */ }
    };
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, [orderId]);

  const openOSM = () => {
    const query = deliveryAddress || 'San Pablo City';
    Linking.openURL(`https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {orderId ? `Order #${String(orderId).slice(0, 8)}` : 'Order Tracking'}
        </Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.infoBar}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor(status) }]}>
          <Text style={styles.statusBadgeText}>{String(status).replace(/_/g, ' ')}</Text>
        </View>
      </View>

      {/* Issue 11: live progress stepper */}
      {status !== 'cancelled' ? (
        <View style={styles.stepperWrap}>
          <OrderStepIndicator status={status} />
        </View>
      ) : null}

      <View style={styles.body}>
        <Text style={styles.msg}>The interactive map is available in the mobile app (Android/iOS).</Text>
        {deliveryAddress ? <Text style={styles.addr}>📍 {deliveryAddress}</Text> : null}
        <TouchableOpacity style={styles.btn} onPress={openOSM}>
          <Text style={styles.btnText}>Open in OpenStreetMap</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: PRIMARY, fontSize: 16, fontWeight: '600', width: 50 },
  title: { fontSize: 17, fontWeight: '700', color: '#222', flex: 1, textAlign: 'center' },
  infoBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 12, borderRadius: 12 },
  statusBadgeText: { color: '#fff', fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
  stepperWrap: { paddingHorizontal: 12, paddingBottom: 10 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  msg: { fontSize: 15, color: '#555', textAlign: 'center' },
  addr: { fontSize: 15, color: '#333', fontWeight: '600', textAlign: 'center' },
  btn: { backgroundColor: PRIMARY, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
