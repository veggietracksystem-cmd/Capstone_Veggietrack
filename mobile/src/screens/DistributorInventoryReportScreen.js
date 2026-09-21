import useLatestRequest from '../hooks/useLatestRequest';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
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
import { SegmentedTabs } from '../components/ui/SegmentedTabs';
import StatusBadge from '../components/ui/StatusBadge';
import BottomNavBar from '../components/BottomNavBar';
import ScreenHeader from '../components/ScreenHeader';
import { exportReportPdf, printReport } from '../lib/reportPdf';
import { showAlert, peso } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { colors, control, fontSize, fonts, radius, shadowCard, spacing } from '../theme/appTheme';
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
  { key: 'payment_status', labelKey: 'inventoryReport.colPayment', width: 90, badge: true },
  { key: 'order_status', labelKey: 'inventoryReport.colOrderStatus', width: 100, badge: true },
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
                <View key={c.key} style={{ width: c.width, paddingRight: 6 }}>
                  {c.badge && r[c.key] !== '—' ? (
                    <StatusBadge status={String(r[c.key]).toLowerCase()} label={r[c.key]} />
                  ) : (
                    <Text style={styles.reportCell} numberOfLines={1}>{r[c.key]}</Text>
                  )}
                </View>
              ))}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

export default function DistributorInventoryReportScreen({ navigation }) {
  const beginRead = useLatestRequest();
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
    const isCurrent = beginRead('load');
    try {
      const data = await api.get('/api/distributor/inventory-report');
      if (!isCurrent()) return;
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      if (!isCurrent()) return;
      showAlert(t('common.error'), friendlyError(err));
    }
  }, [t]);

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

  const columns = COLUMNS_META.map((c) => ({ key: c.key, label: t(c.labelKey), width: c.width, badge: c.badge }));
  const inventoryRows = rows.filter((r) => r.order_status !== 'delivered');
  const historyRows = rows.filter((r) => r.order_status === 'delivered');
  const activeRows = section === 'inventory' ? inventoryRows : historyRows;
  const title = section === 'inventory' ? t('inventoryReport.inventoryTitle') : t('inventoryReport.historyTitle');

  // Compact "Received / Sold" summary tiles (prototype's distributor-inventory-report
  // screen) — a sum over the same rows already loaded for the table below, no new fetch.
  const receivedTotal = activeRows.reduce((sum, r) => sum + (Number(r.quantity_received) || 0), 0);
  const soldTotal = activeRows.reduce((sum, r) => sum + (Number(r.quantity_sold) || 0), 0);

  const handleExport = async (doPrint) => {
    setExporting(true);
    try {
      const formatted = activeRows.map(formatRow);
      if (doPrint) await printReport(title, columns, formatted);
      else await exportReportPdf(title, columns, formatted);
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader
        title={t('inventoryReport.title')}
        onBack={() => navigation.goBack()}
        right={
          <TouchableOpacity onPress={onRefresh} accessibilityRole="button" accessibilityLabel={t('common.retry')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="refresh-outline" size={rf(20)} color={PRIMARY} />
          </TouchableOpacity>
        }
      />

      <SegmentedTabs
        style={styles.tabRow}
        value={section}
        onChange={setSection}
        options={[
          { value: 'inventory', label: t('inventoryReport.inventoryTitle') },
          { value: 'history', label: t('inventoryReport.historyTitle') },
        ]}
      />

      {loading ? (
        <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.summaryGrid}>
            <View style={styles.statTile}>
              <Text style={styles.statTileLabel}>{t('inventoryReport.receivedLabel')}</Text>
              <Text style={styles.statTileValue}>{receivedTotal} kg</Text>
            </View>
            <View style={styles.statTile}>
              <Text style={styles.statTileLabel}>{t('inventoryReport.soldLabel')}</Text>
              <Text style={styles.statTileValue}>{soldTotal} kg</Text>
            </View>
          </View>

          {activeRows.length === 0 ? (
            <EmptyState iconElement={<Ionicons name="bar-chart-outline" size={rf(44)} color={colors.inkFaint} />} title={t('inventoryReport.emptyTitle')} message={t('inventoryReport.emptyMessage')} />
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
  content: { padding: 16, paddingBottom: 100, flexGrow: 1 },

  tabRow: { marginHorizontal: spacing.lg },

  // Compact Received/Sold summary tiles (prototype's .tile-grid/.tile)
  summaryGrid: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statTile: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.card, padding: 14 },
  statTileLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkSoft },
  statTileValue: { fontFamily: fonts.heading, fontSize: rf(fontSize.h1), color: colors.ink, marginTop: 4 },

  reportWrap: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.card, padding: 6 },
  reportHeaderRow: { flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: colors.border, paddingVertical: 6, paddingHorizontal: 6 },
  reportHeaderCell: { flexGrow: 0, flexShrink: 0, fontFamily: fonts.bodyBold, fontSize: rf(fontSize.xs), color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.3, paddingRight: 6 },
  reportRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  reportCell: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm), color: colors.ink },
  emptySubtitle: { fontFamily: fonts.body, color: colors.inkFaint, fontStyle: 'italic', padding: 16, textAlign: 'center' },

  reportActionsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  reportActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: PRIMARY, minHeight: control.height },
  reportActionBtnText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: PRIMARY, textAlign: 'center' },
  btnDisabled: { opacity: 0.6 },
});
