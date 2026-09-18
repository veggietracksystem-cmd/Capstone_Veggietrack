import ProofDetails from '../components/ProofDetails';
import { useCallback, useEffect, useState } from 'react';
import api from '../api/client';
import useLatestRequest from '../hooks/useLatestRequest';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import { manilaSchedule } from '../lib/deliverySchedule';
import { Text, View, ScrollView, TouchableOpacity, Image, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import OrderStepIndicator from '../components/OrderStepIndicator';
import { peso, shortId, showAlert } from '../lib/ui';
import { colors, fonts, fontSize, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { localizeVegetableName } from '../lib/vegetableNames';
import { getProofUrl, getDelivery } from './RetailerDashboard';
import { rf } from '../lib/responsive';
import { useAutoSync } from '../sync/SyncProvider';
import ScreenHeader from '../components/ScreenHeader';
import StatusBadge from '../components/ui/StatusBadge';

const PRIMARY = colors.leaf700;

function splitSchedule(preferredSchedule) {
  if (!preferredSchedule) return { date: null, time: null };
  return { date: manilaSchedule(preferredSchedule), time: null };
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

export default function OrderDetailsScreen({ navigation, route }) {
  const { t, language } = useTranslation();
  const [order, setOrder] = useState(route.params?.order);
  const [refreshing, setRefreshing] = useState(false);
  const beginRead = useLatestRequest();
  const orderId = route.params?.order?.id || route.params?.orderId;
  const refreshOrder = useCallback(async () => {
    if (!orderId) return;
    const isCurrent = beginRead('order');
    setRefreshing(true);
    try {
      const data = await api.get(`/api/orders/${orderId}`);
      if (isCurrent()) setOrder(data);
    } catch (err) {
      if (isCurrent()) showAlert(t('common.error'), err.message);
    } finally {
      if (isCurrent()) setRefreshing(false);
    }
  }, [orderId, t]);
  useAutoSync(`order-details-${orderId || 'unknown'}`, refreshOrder);
  useEffect(() => { setOrder(route.params?.order); void refreshOrder(); }, [refreshOrder]);
  useRefreshOnFocus(refreshOrder);

  if (!order) {
    return (
      <SafeAreaView style={styles.container}>
        <ScreenHeader title={t('orderDetails.title')} onBack={() => navigation.goBack()} />
      </SafeAreaView>
    );
  }

  const delivery = getDelivery(order);
  const { date, time } = splitSchedule(order.preferred_schedule);
  const canTrack = order.status !== 'pending' && order.status !== 'cancelled';
  const proofUrl = getProofUrl(order);

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('orderDetails.title')} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshOrder} />}>
        <View style={styles.card}>
          <View style={styles.orderHeader}>
            <Text style={styles.orderId}>{t('dashboards.retailer.orderNumber', { id: shortId(order.id) })}</Text>
            <StatusBadge status={order.status} />
          </View>
          <Text style={styles.total}>{peso(order.total_amount)}</Text>

          {order.status === 'cancelled' ? (
            <Text style={styles.cancelledNote}>
              {t('dashboards.retailer.orderCancelledNote')}
              {order.cancellation_reason ? ` — ${order.cancellation_reason}` : ''}
            </Text>
          ) : (
            <OrderStepIndicator status={order.status} />
          )}

          {canTrack && (
            <TouchableOpacity
              style={styles.trackBtn}
              onPress={() => navigation.navigate('OrderTracking', {
                orderId: order.id,
                deliveryAddress: order.delivery_address,
                orderStatus: order.status,
              })}
              activeOpacity={0.8}
            >
              <Text style={styles.trackBtnText}>{t('dashboards.retailer.trackOrderBtn')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('orderDetails.itemsTitle')}</Text>
          {Array.isArray(order.order_items) && order.order_items.length > 0 ? (
            order.order_items.map((it, i) => (
              <View key={i} style={styles.itemRow}>
                <Text style={styles.itemName}>{localizeVegetableName(it.vegetable_name, language)}</Text>
                <Text style={styles.itemQty}>{it.quantity_kg} kg</Text>
                <Text style={styles.itemPrice}>{peso(it.price_at_order)}/kg</Text>
              </View>
            ))
          ) : (
            <Text style={styles.detailValue}>{t('dashboards.distributor.noItemDetails')}</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('orderDetails.deliveryTitle')}</Text>
          <Row label={t('orderDetails.deliveryAddress')} value={order.delivery_address} />
          <Row label={t('orderDetails.preferredDate')} value={date} />
          <Row label={t('orderDetails.preferredTime')} value={time} />
          <Row label={t('orderDetails.deliveryStatus')} value={delivery?.status} />
        </View>

        {proofUrl && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t('dashboards.retailer.proofOfDelivery')}</Text>
            <Image source={{ uri: proofUrl }} style={styles.proofImage} resizeMode="contain" />
            <ProofDetails proof={delivery?.pod} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },

  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  orderId: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink },
  total: { fontFamily: fonts.heading, fontSize: rf(fontSize.title), color: PRIMARY, marginBottom: 4 },
  cancelledNote: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.danger, fontStyle: 'italic', marginTop: 8 },
  trackBtn: { marginTop: 10, paddingVertical: 10, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.4, borderColor: PRIMARY },
  trackBtnText: { fontFamily: fonts.bodyBold, color: PRIMARY, fontSize: rf(fontSize.md) },

  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(fontSize.lg), color: colors.ink, marginBottom: 8 },

  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemName: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.md), color: colors.ink, textTransform: 'capitalize' },
  itemQty: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginRight: 10 },
  itemPrice: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft },

  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  detailLabel: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft },
  detailValue: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.ink, flexShrink: 1, textAlign: 'right' },

  proofImage: { width: '100%', height: 200, borderRadius: radius.ctrl, backgroundColor: colors.border },
});
