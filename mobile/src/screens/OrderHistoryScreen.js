import useLatestRequest from '../hooks/useLatestRequest';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import ImageViewerModal from '../components/ImageViewerModal';
import { showAlert, peso, shortId } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { colors, control, fontSize, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { localizeVegetableName } from '../lib/vegetableNames';
import { getProofUrl, getDelivery, isOldCompleted } from './RetailerDashboard';
import ScreenHeader from '../components/ScreenHeader';
import StatusBadge from '../components/ui/StatusBadge';
import { getVegetableTile } from '../lib/vegetableIcons';
import VegetableImage from '../components/VegetableImage';
import RemoteImage from '../components/RemoteImage';
import { Ionicons } from '@expo/vector-icons';

const PRIMARY = colors.leaf700;

export default function OrderHistoryScreen({ navigation }) {
  const beginRead = useLatestRequest();
  const { t, language } = useTranslation();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [proofUri, setProofUri] = useState(null);

  const load = useCallback(async () => {
    const isCurrent = beginRead('load');
    try {
      const data = await api.get('/api/orders');
      if (!isCurrent()) return;
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!isCurrent()) return;
      showAlert(t('common.error'), friendlyError(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  useRefreshOnFocus(load);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const historyOrders = orders.filter(isOldCompleted);

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('orderHistory.title')} onBack={() => navigation.goBack()} />

      {loading ? (
        <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {historyOrders.length === 0 ? (
            <EmptyState iconElement={<Ionicons name="archive-outline" size={rf(44)} color={colors.inkFaint} />} title={t('orderHistory.emptyTitle')} message={t('orderHistory.emptyMessage')} />
          ) : (
            historyOrders.map((o) => (
              <View key={o.id} style={styles.orderCard}>
                <View style={styles.orderHeader}>
                  <Text style={styles.orderId}>{t('dashboards.retailer.orderNumber', { id: shortId(o.id) })}</Text>
                  <StatusBadge status={o.status} />
                </View>
                <Text style={styles.orderTotal}>{peso(o.total_amount)}</Text>
                {o.delivery_address ? (
                  <Text style={styles.rowMeta}>{t('dashboards.retailer.deliverTo', { address: o.delivery_address })}</Text>
                ) : null}

                {Array.isArray(o.order_items) && o.order_items.length > 0 && (
                  <View style={[styles.list, { marginTop: 10 }]}>
                    {o.order_items.map((it, i, arr) => {
                      const tile = getVegetableTile(it.vegetable_name);
                      return (
                        <View key={i} style={[styles.listRow, i === arr.length - 1 && styles.listRowLast]}>
                          <View style={[styles.itemTile, { backgroundColor: tile.bg }]}>
                            <VegetableImage source={tile.source} style={styles.itemTileIcon} fallbackSize={rf(16)} />
                          </View>
                          <Text style={[styles.itemLine, { flex: 1, marginBottom: 0 }]}>{localizeVegetableName(it.vegetable_name, language)}</Text>
                          <Text style={styles.itemLine}>{it.quantity_kg}kg @ {peso(it.price_at_order)}</Text>
                        </View>
                      );
                    })}
                  </View>
                )}

                {getProofUrl(o) && (
                  <TouchableOpacity style={styles.proofRow} onPress={() => setProofUri(getDelivery(o))} activeOpacity={0.8}>
                    <RemoteImage uri={getProofUrl(o)} style={styles.proofThumb} />
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

      <ImageViewerModal uri={proofUri?.proof_photo_url} proof={proofUri?.pod} visible={!!proofUri} onClose={() => setProofUri(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: PRIMARY, fontSize: rf(16), fontFamily: fonts.bodySemiBold, width: 50 },
  title: { fontSize: rf(19), fontFamily: fonts.heading, color: colors.ink },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },

  orderCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  orderId: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink },
  orderTotal: { fontFamily: fonts.heading, fontSize: rf(fontSize.xl), color: PRIMARY, marginBottom: 4 },
  rowMeta: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.inkSoft, marginTop: 2 },
  list: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  listRowLast: { borderBottomWidth: 0 },
  itemTile: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  itemTileIcon: { width: 22, height: 22 },
  itemLine: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginBottom: 2 },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 8 },
  proofThumb: { width: 48, height: 48, borderRadius: 6, backgroundColor: colors.border },
  proofText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: PRIMARY },
  detailsBtn: { marginTop: 10, paddingVertical: 10, borderRadius: radius.ctrl, alignItems: 'center', borderWidth: 1.4, borderColor: colors.border, backgroundColor: colors.leaf50, justifyContent: 'center', minHeight: control.height  },
  detailsBtnText: { fontFamily: fonts.bodyBold, color: colors.inkSoft, fontSize: rf(fontSize.md), textAlign: 'center' },
});
