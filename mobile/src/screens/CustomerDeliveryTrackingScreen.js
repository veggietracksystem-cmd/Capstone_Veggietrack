import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DeliveryTrackingMap from '../components/DeliveryTrackingMap';
import OrderStepIndicator from '../components/OrderStepIndicator';
import useDeliveryTracking from '../hooks/useDeliveryTracking';
import { useTranslation } from '../i18n/useTranslation';
import { useAuth } from '../context/AuthContext';
import RiderNavigationScreen from './delivery/RiderNavigationScreen';

export default function CustomerDeliveryTrackingScreen(props) {
  const { user } = useAuth();
  return user?.role === 'delivery_personnel'
    ? <RiderNavigationScreen {...props} />
    : <CustomerTrackingView {...props} />;
}

function CustomerTrackingView({ route, navigation }) {
  const { t } = useTranslation();
  const { orderId, deliveryAddress, orderStatus = 'pending' } = route.params || {};
  const { data, loading, error, refresh } = useDeliveryTracking(orderId);
  const [refreshing, setRefreshing] = useState(false);
  const view = data?.retailer_view, status = data?.status || orderStatus;
  return <SafeAreaView style={styles.container}>
    <View style={styles.header}>
      <TouchableOpacity accessibilityRole="button" onPress={() => navigation.goBack()}><Text style={styles.back}>‹ {t('common.back')}</Text></TouchableOpacity>
      <Text style={styles.title}>{orderId ? t('orderTracking.orderNumber', { id: String(orderId).slice(0, 8) }) : t('orderTracking.titleFallback')}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => {
      setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); }
    }} />}>
      <View style={styles.status}><Text style={styles.statusText}>{status.replace(/_/g, ' ')}</Text><Text style={styles.note}>GPS refreshed every 5 seconds</Text></View>
      {status !== 'cancelled' && <OrderStepIndicator status={status} />}
      {loading && !data ? <ActivityIndicator style={{ padding: 30 }} color="#218258" /> : <DeliveryTrackingMap trackingData={data} style={styles.map} />}
      {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error} Pull down to retry. Last received GPS is retained.</Text>}
      <View style={styles.card}><Text style={styles.label}>🏢 Dispatch hub</Text><Text>{view?.pickup?.name || 'Distributor warehouse'}</Text><Text style={styles.detail}>{view?.pickup?.address || 'No warehouse address available'}</Text></View>
      <View style={styles.card}><Text style={styles.label}>🏪 Retailer destination</Text><Text>{view?.delivery?.name || 'Delivery address'}</Text><Text style={styles.detail}>{view?.delivery?.address || deliveryAddress || 'No address available'}</Text>
        {!!view?.delivery?.contact && <Text selectable style={styles.detail}>Contact: {view.delivery.contact}</Text>}</View>
      <View style={styles.card}><Text style={styles.label}>Order items</Text>{view?.items?.map((item, index) =>
        <View key={`${item.vegetable_name}-${index}`} style={styles.item}><Text>{item.vegetable_name}</Text><Text>{item.quantity_kg} kg</Text></View>)}</View>
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f6f1' }, header: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, backgroundColor: '#fff' },
  back: { fontSize: 16, color: '#245636' }, title: { flex: 1, fontSize: 16, fontWeight: '700', color: '#245636' },
  content: { padding: 12, gap: 12, paddingBottom: 30 }, status: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 },
  statusText: { textTransform: 'capitalize', fontWeight: '700', color: '#245636' }, note: { fontSize: 11, color: '#617365' },
  map: { height: 510, flex: 0 }, card: { padding: 14, borderRadius: 12, backgroundColor: '#fff', gap: 6 }, label: { fontWeight: '700', color: '#245636' },
  detail: { fontSize: 13, color: '#57685c' }, item: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }, error: { color: '#85530b', backgroundColor: '#fff3db', padding: 10 },
});
