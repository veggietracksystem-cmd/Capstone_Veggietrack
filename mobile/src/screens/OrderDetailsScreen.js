import { Text, View, ScrollView, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import OrderStepIndicator from '../components/OrderStepIndicator';
import { peso, shortId } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { localizeVegetableName } from '../lib/vegetableNames';
import { statusColor, getProofUrl, getDelivery } from './RetailerDashboard';
import { rf } from '../lib/responsive';

const PRIMARY = colors.leaf700;

function splitSchedule(preferredSchedule) {
  if (!preferredSchedule) return { date: null, time: null };
  const [date, time] = preferredSchedule.split('T');
  return { date: date || null, time: time || null };
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
  const order = route.params?.order;

  if (!order) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.back}>‹ {t('common.back')}</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{t('orderDetails.title')}</Text>
          <View style={{ width: 50 }} />
        </View>
      </SafeAreaView>
    );
  }

  const delivery = getDelivery(order);
  const { date, time } = splitSchedule(order.preferred_schedule);
  const canTrack = order.status !== 'pending' && order.status !== 'cancelled';
  const proofUrl = getProofUrl(order);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('orderDetails.title')}</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.orderHeader}>
            <Text style={styles.orderId}>{t('dashboards.retailer.orderNumber', { id: shortId(order.id) })}</Text>
            <View style={[styles.statusBadge, { backgroundColor: statusColor(order.status) }]}>
              <Text style={styles.statusBadgeText}>{order.status}</Text>
            </View>
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
            <Image source={{ uri: proofUrl }} style={styles.proofImage} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: PRIMARY, fontSize: rf(16), fontFamily: fonts.bodySemiBold, width: 50 },
  title: { fontSize: rf(19), fontFamily: fonts.heading, color: colors.ink },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },

  card: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  orderId: { fontFamily: fonts.bodyBold, fontSize: rf(16), color: colors.ink },
  total: { fontFamily: fonts.heading, fontSize: rf(20), color: PRIMARY, marginBottom: 4 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12 },
  statusBadgeText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(12), textTransform: 'capitalize' },
  cancelledNote: { fontFamily: fonts.body, fontSize: rf(13), color: colors.danger, fontStyle: 'italic', marginTop: 8 },
  trackBtn: { marginTop: 10, paddingVertical: 10, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.4, borderColor: PRIMARY },
  trackBtnText: { fontFamily: fonts.bodyBold, color: PRIMARY, fontSize: rf(13.5) },

  sectionTitle: { fontFamily: fonts.heading, fontSize: rf(15), color: colors.ink, marginBottom: 8 },

  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  itemName: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: rf(14), color: colors.ink, textTransform: 'capitalize' },
  itemQty: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, marginRight: 10 },
  itemPrice: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft },

  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  detailLabel: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkFaint },
  detailValue: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: colors.ink, flexShrink: 1, textAlign: 'right' },

  proofImage: { width: '100%', height: 200, borderRadius: radius.ctrl, backgroundColor: colors.border },
});
