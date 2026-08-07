import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import ImageViewerModal from '../components/ImageViewerModal';
import { peso, shortId } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { localizeVegetableName } from '../lib/vegetableNames';
import { statusColor, getProofUrl, isOldCompleted } from './RetailerDashboard';

const PRIMARY = colors.leaf700;

export default function OrderHistoryScreen({ navigation }) {
  const { t, language } = useTranslation();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [proofUri, setProofUri] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/orders');
      setOrders(Array.isArray(data) ? data : []);
    } catch {
      // stay on whatever was already loaded
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const historyOrders = orders.filter(isOldCompleted);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('orderHistory.title')}</Text>
        <View style={{ width: 50 }} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {historyOrders.length === 0 ? (
            <EmptyState icon="🗄️" title={t('orderHistory.emptyTitle')} message={t('orderHistory.emptyMessage')} />
          ) : (
            historyOrders.map((o) => (
              <View key={o.id} style={styles.orderCard}>
                <View style={styles.orderHeader}>
                  <Text style={styles.orderId}>{t('dashboards.retailer.orderNumber', { id: shortId(o.id) })}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: statusColor(o.status) }]}>
                    <Text style={styles.statusBadgeText}>{o.status}</Text>
                  </View>
                </View>
                <Text style={styles.orderTotal}>{peso(o.total_amount)}</Text>
                {o.delivery_address ? (
                  <Text style={styles.rowMeta}>{t('dashboards.retailer.deliverTo', { address: o.delivery_address })}</Text>
                ) : null}

                {Array.isArray(o.order_items) && o.order_items.length > 0 && (
                  <View style={styles.itemsBox}>
                    {o.order_items.map((it, i) => (
                      <Text key={i} style={styles.itemLine}>
                        • {localizeVegetableName(it.vegetable_name, language)} — {it.quantity_kg}kg @ {peso(it.price_at_order)}
                      </Text>
                    ))}
                  </View>
                )}

                {getProofUrl(o) && (
                  <TouchableOpacity style={styles.proofRow} onPress={() => setProofUri(getProofUrl(o))} activeOpacity={0.8}>
                    <Image source={{ uri: getProofUrl(o) }} style={styles.proofThumb} />
                    <Text style={styles.proofText}>{t('dashboards.retailer.proofOfDelivery')}</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.detailsBtn}
                  onPress={() => navigation.navigate('OrderDetails', { order: o })}
                  activeOpacity={0.8}
                >
                  <Text style={styles.detailsBtnText}>{t('dashboards.retailer.viewDetailsBtn')}</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      )}

      <ImageViewerModal uri={proofUri} visible={!!proofUri} onClose={() => setProofUri(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: PRIMARY, fontSize: rf(16), fontFamily: fonts.bodySemiBold, width: 50 },
  title: { fontSize: rf(19), fontFamily: fonts.heading, color: colors.ink },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },

  orderCard: { backgroundColor: colors.card, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  orderId: { fontFamily: fonts.bodyBold, fontSize: rf(15), color: colors.ink },
  orderTotal: { fontFamily: fonts.heading, fontSize: rf(17), color: PRIMARY, marginBottom: 4 },
  rowMeta: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkSoft, marginTop: 2 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 10, borderRadius: 12 },
  statusBadgeText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(12), textTransform: 'capitalize' },
  itemsBox: { backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 10, marginTop: 8 },
  itemLine: { fontFamily: fonts.body, fontSize: rf(13), color: colors.inkSoft, marginBottom: 2 },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 8 },
  proofThumb: { width: 48, height: 48, borderRadius: 6, backgroundColor: colors.border },
  proofText: { fontFamily: fonts.bodySemiBold, fontSize: rf(13), color: PRIMARY },
  detailsBtn: { marginTop: 10, paddingVertical: 10, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.4, borderColor: colors.border, backgroundColor: colors.leaf50 },
  detailsBtnText: { fontFamily: fonts.bodyBold, color: colors.inkSoft, fontSize: rf(13.5) },
});
