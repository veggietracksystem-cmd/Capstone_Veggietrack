import { rf } from '../lib/responsive';
import React, { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DeliveryTrackingMap from '../components/DeliveryTrackingMap';
import OrderStepIndicator from '../components/OrderStepIndicator';
import ScreenHeader from '../components/ScreenHeader';
import useDeliveryTracking from '../hooks/useDeliveryTracking';
import { useTranslation } from '../i18n/useTranslation';
import { useAuth } from '../context/AuthContext';
import { isDeliveryPersonnel } from '../lib/roles';
import RiderNavigationScreen from './delivery/RiderNavigationScreen';
import { colors, fonts, fontSize, radius, shadowCard } from '../theme/appTheme';
import { Ionicons } from '@expo/vector-icons';
import StatusBadge from '../components/ui/StatusBadge';
import UserAvatar from '../components/UserAvatar';
import { getVegetableTile } from '../lib/vegetableIcons';
import VegetableImage from '../components/VegetableImage';

export default function CustomerDeliveryTrackingScreen(props) {
  const { user } = useAuth();
  return isDeliveryPersonnel(user)
    ? <RiderNavigationScreen {...props} />
    : <CustomerTrackingView {...props} />;
}

function CustomerTrackingView({ route, navigation }) {
  const { t } = useTranslation();
  const { orderId, deliveryAddress, orderStatus = 'pending' } = route.params || {};
  const { data, loading, error, refresh } = useDeliveryTracking(orderId);
  const [refreshing, setRefreshing] = useState(false);
  const view = data?.retailer_view, status = data?.status || orderStatus;
  return <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
    <ScreenHeader
      title={orderId ? t('orderTracking.orderNumber', { id: String(orderId).slice(0, 8) }) : t('orderTracking.titleFallback')}
      onBack={() => navigation.goBack()}
    />
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => {
      setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); }
    }} />}>
      <View style={styles.status}>
        <Text style={styles.statusText}>{status.replace(/_/g, ' ')}</Text>
        <StatusBadge status={status} />
      </View>
      <Text style={styles.note}>Location updates every few seconds.</Text>
      {status !== 'cancelled' && <OrderStepIndicator status={status} />}
      {/* Rider row (prototype's rider-info row, shown above the map) —
          name/live fields already come back from the tracking API. */}
      {!!view?.rider && (
        <View style={[styles.card, styles.riderCard]}>
          <UserAvatar user={{ full_name: view.rider.name }} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={styles.value}>{view.rider.name}</Text>
            <Text style={styles.detail}>{view.rider.live ? 'Location is live' : 'Waiting for the rider’s location'}</Text>
          </View>
        </View>
      )}
      {loading && !data ? <ActivityIndicator style={{ padding: 30 }} color={colors.leaf700} /> : <DeliveryTrackingMap trackingData={data} style={styles.map} />}
      {!!error && <Text accessibilityLiveRegion="polite" style={styles.error}>{error} Pull down to try again. The last known location is still shown.</Text>}
      <View style={styles.card}><View style={styles.labelRow}><Ionicons name="business-outline" size={rf(16)} color={colors.leaf700} /><Text style={styles.label}>Dispatch hub</Text></View><Text style={styles.value}>{view?.pickup?.name || 'Distributor warehouse'}</Text><Text style={styles.detail}>{view?.pickup?.address || 'No warehouse address available'}</Text></View>
      <View style={styles.card}><View style={styles.labelRow}><Ionicons name="storefront-outline" size={rf(16)} color={colors.leaf700} /><Text style={styles.label}>Delivery destination</Text></View><Text style={styles.value}>{view?.delivery?.name || 'Delivery address'}</Text><Text style={styles.detail}>{view?.delivery?.address || deliveryAddress || 'No address available'}</Text>
        {!!view?.delivery?.contact && <Text selectable style={styles.detail}>Contact: {view.delivery.contact}</Text>}</View>
      <View style={styles.card}>
        <Text style={styles.label}>Order items</Text>
        {view?.items?.map((item, index) => {
          const tile = getVegetableTile(item.vegetable_name);
          return (
            <View key={`${item.vegetable_name}-${index}`} style={styles.item}>
              <View style={[styles.itemTile, { backgroundColor: tile.bg }]}>
                <VegetableImage source={tile.source} style={styles.itemTileIcon} fallbackSize={rf(16)} />
              </View>
              <Text style={[styles.value, { flex: 1 }]}>{item.vegetable_name}</Text>
              <Text style={styles.value}>{item.quantity_kg} kg</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  content: { padding: 12, gap: 12, paddingBottom: 30 }, status: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 },
  statusText: { textTransform: 'capitalize', fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md), color: colors.leaf700 },
  note: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkSoft },
  map: { height: 510, flex: 0 },
  card: { padding: 14, borderRadius: radius.card, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, gap: 6, ...shadowCard },
  label: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md), color: colors.leaf700 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  value: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.ink },
  detail: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft },
  riderCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between', paddingVertical: 5 },
  itemTile: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  itemTileIcon: { width: 20, height: 20 },
  error: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm), color: colors.gold700, backgroundColor: colors.gold100, padding: 10, borderRadius: radius.ctrl },
});
