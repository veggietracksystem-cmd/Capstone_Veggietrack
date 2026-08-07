import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, ScrollView, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import BottomNavBar from '../components/BottomNavBar';
import { exportReportPdf, printReport } from '../lib/reportPdf';
import { showAlert, peso } from '../lib/ui';
import { colors, fonts, radius, shadowCard } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = colors.leaf700;

const DISTRIBUTOR_TABS_KEYS = [
  { id: 'home', iconName: 'home-outline', labelKey: 'dashboards.distributor.tabHome' },
  { id: 'orders', iconName: 'clipboard-outline', labelKey: 'dashboards.distributor.tabOrders' },
  { id: 'stocks', iconName: 'archive-outline', labelKey: 'dashboards.distributor.tabStocks' },
  { id: 'inventory', iconName: 'cube-outline', labelKey: 'dashboards.distributor.tabInventory' },
  { id: 'profile', iconName: 'person-outline', labelKey: 'dashboards.distributor.tabProfile' },
];

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const COLUMNS_META = [
  { key: 'product', labelKey: 'inventoryReport.colProduct', width: 100 },
  { key: 'quantity_received', labelKey: 'inventoryReport.colQtyReceived', width: 90 },
  { key: 'quantity_sold', labelKey: 'inventoryReport.colQtySold', width: 80 },
  { key: 'remaining_quantity', labelKey: 'inventoryReport.colRemaining', width: 90 },
  { key: 'price_per_kg', labelKey: 'inventoryReport.colPrice', width: 80 },
  { key: 'total_amount', labelKey: 'inventoryReport.colTotalAmount', width: 100 },
  { key: 'farmer_name', labelKey: 'inventoryReport.colFarmer', width: 110 },
  { key: 'retailer_name', labelKey: 'inventoryReport.colRetailer', width: 110 },
  { key: 'pickup_rider_name', labelKey: 'inventoryReport.colPickupRider', width: 110 },
  { key: 'delivery_personnel', labelKey: 'inventoryReport.colDeliveryRider', width: 110 },
  { key: 'harvest_date', labelKey: 'inventoryReport.colHarvestDate', width: 100 },
  { key: 'pickup_date', labelKey: 'inventoryReport.colPickupDate', width: 100 },
  { key: 'delivery_date', labelKey: 'inventoryReport.colDeliveryDate', width: 100 },
  { key: 'payment_status', labelKey: 'inventoryReport.colPayment', width: 90 },
  { key: 'order_status', labelKey: 'inventoryReport.colOrderStatus', width: 100 },
];

function formatRow(r) {
  return {
    product: r.product,
    quantity_received: r.quantity_received != null ? `${r.quantity_received} kg` : '—',
    quantity_sold: r.quantity_sold != null ? `${r.quantity_sold} kg` : '—',
    remaining_quantity: r.remaining_quantity != null ? `${r.remaining_quantity} kg` : '—',
    price_per_kg: r.price_per_kg != null ? peso(r.price_per_kg) : '—',
    total_amount: r.total_amount != null ? peso(r.total_amount) : '—',
    farmer_name: r.farmer_name || '—',
    retailer_name: r.retailer_name || '—',
    pickup_rider_name: r.pickup_rider_name || '—',
    delivery_personnel: r.delivery_personnel || '—',
    harvest_date: formatDate(r.harvest_date),
    pickup_date: formatDate(r.pickup_date),
    delivery_date: formatDate(r.delivery_date),
    payment_status: r.payment_status || '—',
    order_status: r.order_status || '—',
  };
}

function ReportTable({ columns, rows, emptyLabel }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.reportWrap}>
        <View style={styles.reportHeaderRow}>
          {columns.map((c) => (
            <Text key={c.key} style={[styles.reportHeaderCell, { width: c.width }]} numberOfLines={1}>{c.label}</Text>
          ))}
        </View>
        {rows.length === 0 ? (
          <Text style={styles.emptySubtitle}>{emptyLabel}</Text>
        ) : (
          rows.map((r, i) => (
            <View key={i} style={styles.reportRow}>
              {columns.map((c) => (
                <Text key={c.key} style={[styles.reportCell, { width: c.width }]} numberOfLines={1}>{r[c.key]}</Text>
              ))}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

export default function DistributorInventoryReportScreen({ navigation }) {
  const { t } = useTranslation();
  const DISTRIBUTOR_TABS = DISTRIBUTOR_TABS_KEYS.map((tab) => ({ ...tab, label: t(tab.labelKey) }));
  const handleBottomTabPress = (tab) => {
    if (tab.id === 'inventory') return;
    if (tab.id === 'stocks') navigation.navigate('Stocks');
    else if (tab.id === 'profile') navigation.navigate('Profile');
    else if (tab.id === 'orders') navigation.navigate('DistributorDashboard', { tab: 'orders' });
    else if (tab.id === 'home') navigation.navigate('DistributorDashboard', { tab: 'home' });
  };
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [section, setSection] = useState('inventory'); // 'inventory' | 'history'
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/api/distributor/inventory-report');
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      showAlert(t('common.error'), err.message);
    }
  }, [t]);

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

  const columns = COLUMNS_META.map((c) => ({ key: c.key, label: t(c.labelKey), width: c.width }));
  const inventoryRows = rows.filter((r) => r.order_status !== 'delivered');
  const historyRows = rows.filter((r) => r.order_status === 'delivered');
  const activeRows = section === 'inventory' ? inventoryRows : historyRows;
  const title = section === 'inventory' ? t('inventoryReport.inventoryTitle') : t('inventoryReport.historyTitle');

  const handleExport = async (doPrint) => {
    setExporting(true);
    try {
      const formatted = activeRows.map(formatRow);
      if (doPrint) await printReport(title, columns, formatted);
      else await exportReportPdf(title, columns, formatted);
    } catch (err) {
      showAlert(t('common.error'), err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.back}>‹ {t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('inventoryReport.title')}</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, section === 'inventory' && styles.tabBtnActive]}
          onPress={() => setSection('inventory')}
        >
          <Text style={[styles.tabBtnText, section === 'inventory' && styles.tabBtnTextActive]}>
            {t('inventoryReport.inventoryTitle')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, section === 'history' && styles.tabBtnActive]}
          onPress={() => setSection('history')}
        >
          <Text style={[styles.tabBtnText, section === 'history' && styles.tabBtnTextActive]}>
            {t('inventoryReport.historyTitle')}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {activeRows.length === 0 ? (
            <EmptyState icon="📊" title={t('inventoryReport.emptyTitle')} message={t('inventoryReport.emptyMessage')} />
          ) : (
            <ReportTable columns={columns} rows={activeRows.map(formatRow)} emptyLabel={t('inventoryReport.emptyTitle')} />
          )}

          <View style={styles.reportActionsRow}>
            <TouchableOpacity
              style={[styles.reportActionBtn, exporting && styles.btnDisabled]}
              onPress={() => handleExport(false)}
              disabled={exporting || activeRows.length === 0}
              activeOpacity={0.8}
            >
              <Ionicons name="download-outline" size={rf(15)} color={PRIMARY} />
              <Text style={styles.reportActionBtnText}>{t('inventoryReport.exportPdfBtn')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.reportActionBtn, exporting && styles.btnDisabled]}
              onPress={() => handleExport(true)}
              disabled={exporting || activeRows.length === 0}
              activeOpacity={0.8}
            >
              <Ionicons name="print-outline" size={rf(15)} color={PRIMARY} />
              <Text style={styles.reportActionBtnText}>{t('inventoryReport.printBtn')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      <BottomNavBar
        tabs={DISTRIBUTOR_TABS}
        activeTab="inventory"
        onTabPress={handleBottomTabPress}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  back: { color: PRIMARY, fontSize: rf(16), fontFamily: fonts.bodySemiBold, width: 50 },
  title: { fontSize: rf(19), fontFamily: fonts.heading, color: colors.ink },
  content: { padding: 16, paddingBottom: 100, flexGrow: 1 },

  tabRow: { flexDirection: 'row', backgroundColor: colors.leaf50, borderRadius: radius.ctrl, padding: 4, marginHorizontal: 16, marginBottom: 12 },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: colors.card, ...shadowCard },
  tabBtnText: { fontFamily: fonts.bodySemiBold, color: colors.inkSoft, fontSize: rf(14) },
  tabBtnTextActive: { color: PRIMARY },

  reportWrap: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.card, padding: 6 },
  reportHeaderRow: { flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: colors.border, paddingVertical: 6, paddingHorizontal: 6 },
  reportHeaderCell: { flexGrow: 0, flexShrink: 0, fontFamily: fonts.bodyBold, fontSize: rf(10.5), color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.3, paddingRight: 6 },
  reportRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  reportCell: { flexGrow: 0, flexShrink: 0, fontFamily: fonts.bodyMedium, fontSize: rf(12), color: colors.ink, paddingRight: 6 },
  emptySubtitle: { fontFamily: fonts.body, color: colors.inkFaint, fontStyle: 'italic', padding: 16, textAlign: 'center' },

  reportActionsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  reportActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: PRIMARY },
  reportActionBtnText: { fontFamily: fonts.bodySemiBold, fontSize: rf(13.5), color: PRIMARY },
  btnDisabled: { opacity: 0.6 },
});
