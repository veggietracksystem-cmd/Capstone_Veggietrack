import { rf } from '../lib/responsive';
import React, { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import DeliveryTrackingMap from '../components/DeliveryTrackingMap';
import OrderStepIndicator from '../components/OrderStepIndicator';
import RiderEtaCard from '../components/RiderEtaCard';
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
import { statusLabel } from '../i18n/translate';
import TrackingErrorBoundary from '../components/TrackingErrorBoundary';

export default function CustomerDeliveryTrackingScreen(props) {
  const { user } = useAuth();
  return isDeliveryPersonnel(user)
    ? <RiderNavigationScreen {...props} />
    : <TrackingErrorBoundary onBack={() => props.navigation?.goBack?.()}><CustomerTrackingView {...props} /></TrackingErrorBoundary>;
}

function CustomerTrackingView({ route, navigation }) {
  const { t, tc } = useTranslation();
  // Screen skips the bottom safe-area edge, so pad the scroll content instead.
  const insets = useSafeAreaInsets();
  const { orderId, deliveryAddress, orderStatus = 'pending' } = route.params || {};
  const { data, loading, error, refresh } = useDeliveryTracking(orderId);
  const [refreshing, setRefreshing] = useState(false);
  const view = data?.retailer_view, status = data?.status || orderStatus;
  return <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
    <ScreenHeader
      title={orderId ? t('orderTracking.orderNumber', { id: String(orderId).slice(0, 8) }) : t('orderTracking.titleFallback')}
      onBack={() => navigation.goBack()}
    />
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => {
      setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); }
    }} />}>
      <View style={styles.status}>
        <Text style={styles.statusText}>{statusLabel(status)}</Text>
        <StatusBadge status={status} />
      </View>
      <Text style={styles.note}>{t('cmp.locUpdates')}</Text>
      {status !== 'cancelled' && <OrderStepIndicator status={status} />}
      <RiderEtaCard data={data} status={status} />
      {/* Rider row (prototype's rider-info row, shown above the map) —
          name/live fields already come back from the tracking API. */}
      {!!view?.rider && (
        <View style={[styles.card, styles.riderCard]}>
          <UserAvatar user={{ full_name: view.rider.name }} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={styles.value}>{view.rider.name}</Text>
            <Text style={styles.detail}>{view.rider.live ? t('track.locationLive') : t('track.waitingRiderLoc')}</Text>
          </View>
        </View>
      )}
      {loading && !data ? <ActivityIndicator style={{ padding: 30 }} color={colors.leaf700} /> : !data ? (
        <View style={[styles.card, styles.unavailable]} accessibilityRole="alert">
          <Text style={styles.value}>{t('track.notAvailable')}</Text>
          <Text style={styles.detail}>{t('track.tryLater')}</Text>
        </View>
      ) : (
        <TrackingErrorBoundary><DeliveryTrackingMap trackingData={data} style={styles.map} /></TrackingErrorBoundary>
      )}
      {!!error && !!data && <Text accessibilityLiveRegion="polite" style={styles.error}>{t('cmp.pullTry', { error })}</Text>}
      <View style={styles.card}><View style={styles.labelRow}><Ionicons name="business-outline" size={rf(16)} color={colors.leaf700} /><Text style={styles.label}>{t('cmp.dispatchHub')}</Text></View><Text style={styles.value}>{view?.pickup?.name || t('cmp.warehouse')}</Text><Text style={styles.detail}>{view?.pickup?.address || t('cmp.noWarehouseAddr')}</Text></View>
      <View style={styles.card}><View style={styles.labelRow}><Ionicons name="storefront-outline" size={rf(16)} color={colors.leaf700} /><Text style={styles.label}>{t('cmp.deliveryDestination')}</Text></View><Text style={styles.value}>{view?.delivery?.name || t('cmp.deliveryAddress')}</Text><Text style={styles.detail}>{view?.delivery?.address || deliveryAddress || t('cmp.noAddr')}</Text>
        {!!view?.delivery?.contact && <Text selectable style={styles.detail}>{t('cmp.contact', { contact: view.delivery.contact })}</Text>}</View>
      <View style={styles.card}>
        <Text style={styles.label}>{tc('plural.orderItems', view?.items?.length || 0)}</Text>
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
  content: { padding: 16, gap: 12, paddingBottom: 30 }, status: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 },
  statusText: { textTransform: 'capitalize', fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md), color: colors.leaf700 },
  note: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkSoft },
  map: { height: 510, flex: 0 },
  card: { padding: 14, borderRadius: radius.card, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 6, ...shadowCard },
  label: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md), color: colors.leaf700 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  value: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.ink },
  detail: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft },
  riderCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between', paddingVertical: 5 },
  itemTile: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  itemTileIcon: { width: 20, height: 20 },
  error: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm), color: colors.gold700, backgroundColor: colors.gold100, padding: 10, borderRadius: radius.ctrl },
  unavailable: { alignItems: 'center', padding: 20 },
});
