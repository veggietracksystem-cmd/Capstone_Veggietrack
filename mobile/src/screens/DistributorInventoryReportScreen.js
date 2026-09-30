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
import ImageViewerModal from '../components/ImageViewerModal';
import RemoteImage from '../components/RemoteImage';
import { SegmentedTabs } from '../components/ui/SegmentedTabs';
import StatusBadge from '../components/ui/StatusBadge';
import BottomNavBar, { useBottomNavSpace } from '../components/BottomNavBar';
import ScreenHeader from '../components/ScreenHeader';
import { exportReportPdf, printReport } from '../lib/reportPdf';
import { showAlert, peso } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { colors, control, fontSize, fonts, radius, spacing } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { statusLabel } from '../i18n/translate';
import { localizeVegetableName } from '../lib/vegetableNames';

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
  { key: 'batch_id', labelKey: 'inventoryReport.colBatch', width: 150 },
  { key: 'batch_photo', labelKey: 'inventoryReport.colPhoto', width: 64, photo: true },
  { key: 'batch_status', labelKey: 'inventoryReport.colBatchStatus', width: 100, badge: true },
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

// Inventory filters over the batch lifecycle (backend/lib/batches.js): Active
// batches still have stock (received or listed); every other batch has finished
// its lifecycle and is listed under Sold out, including sold-out batches removed
// from the Product List (stored as 'archived').
const FILTERS = [
  { value: 'active', labelKey: 'status.active' },
  { value: 'sold_out', labelKey: 'status.sold_out' },
];
export const filterGroupOf = (r) => (['received', 'listed'].includes(r.batch_status) ? 'active' : 'sold_out');

// Columns describing the batch itself; the rest describe one consuming order.
const BATCH_COLUMNS = ['product', 'batch_id', 'batch_photo', 'batch_status', 'quantity_received', 'remaining_quantity',
  'price_per_kg', 'farmer_name', 'pickup_rider_name', 'harvest_date', 'pickup_date'];

// The report has one row per batch and order. Rows of a batch stay together and
// only the first shows the batch details, so each batch is listed once.
export function inventoryEntries(rows, filter) {
  const groups = new Map();
  rows.forEach((r, i) => {
    if (filterGroupOf(r) !== filter) return;
    const key = r.batch_id || `row-${i}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  return [...groups.values()].flatMap((batchRows) => batchRows.map((row, i) => ({ row, continued: i > 0 })));
}

// Payment statuses arrive as title-cased labels.
const statusCode = (value) => (value ? String(value).toLowerCase() : null);

export function formatRow(r, language, translate) {
  const codes = {
    // A removed sold-out batch ('archived') reads as Sold out.
    batch_status: r.batch_status === 'archived' ? 'sold_out' : statusCode(r.batch_status),
    payment_status: statusCode(r.payment_status),
    order_status: statusCode(r.order_status),
  };
  return {
    codes,
    product: localizeVegetableName(r.product, language),
    batch_id: r.batch_id || '—',
    batch_photo: r.batch_photo_url || null,
    batch_status: codes.batch_status ? statusLabel(codes.batch_status, translate) : '—',
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
    payment_status: codes.payment_status ? statusLabel(codes.payment_status, translate) : '—',
    order_status: codes.order_status ? statusLabel(codes.order_status, translate) : '—',
  };
}

// A further order of the batch above: batch details are left blank.
export function formatEntry({ row, continued }, language, translate) {
  const formatted = { ...formatRow(row, language, translate), continued };
  if (!continued) return formatted;
  BATCH_COLUMNS.forEach((key) => { formatted[key] = key === 'batch_photo' ? null : ''; });
  formatted.codes = { ...formatted.codes, batch_status: null };
  return formatted;
}

function PhotoCell({ uri, label, onOpen, blank }) {
  if (!uri) return <Text style={styles.reportCell}>{blank ? '' : '—'}</Text>;
  return (
    <TouchableOpacity onPress={() => onOpen(uri)} accessibilityRole="imagebutton" accessibilityLabel={label}>
      <RemoteImage uri={uri} style={styles.photoThumb} resizeMode="cover" />
    </TouchableOpacity>
  );
}

function ReportTable({ columns, rows, emptyLabel, onOpenPhoto }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.reportWrap}>
        <View style={styles.reportHeaderRow}>
          {columns.map((c) => (
            <Text key={c.key} style={[styles.reportHeaderCell, { width: c.width }]} numberOfLines={2}>{c.label}</Text>
          ))}
        </View>
        {rows.length === 0 ? (
          <Text style={styles.emptySubtitle}>{emptyLabel}</Text>
        ) : (
          rows.map((r, i) => (
            <View key={i} style={[styles.reportRow, r.continued && styles.reportRowContinued]}>
              {columns.map((c) => (
                <View key={c.key} style={{ width: c.width, paddingRight: 6 }}>
                  {c.photo ? (
                    <PhotoCell uri={r[c.key]} label={c.label} onOpen={onOpenPhoto} blank={r.continued} />
                  ) : c.badge && r.codes?.[c.key] ? (
                    <StatusBadge status={r.codes[c.key]} label={r[c.key]} />
                  ) : (
                    <Text style={styles.reportCell} selectable>{r[c.key]}</Text>
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
  const navSpace = useBottomNavSpace();
  const beginRead = useLatestRequest();
  const { t, language } = useTranslation();
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
  const [filter, setFilter] = useState('active');
  const [exporting, setExporting] = useState(false);
  const [photoUri, setPhotoUri] = useState(null);

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

  const columns = COLUMNS_META.map((c) => ({ key: c.key, label: t(c.labelKey), width: c.width, badge: c.badge, photo: c.photo }));
  // The PDF is text only, so the photo column is left out of exports.
  const exportColumns = columns.filter((c) => !c.photo);
  // Current and past batches in one screen, split by batch status.
  const filterOptions = FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey) }));
  const entries = inventoryEntries(rows, filter);
  const filterLabel = filterOptions.find((option) => option.value === filter)?.label;
  const title = `${t('inventoryReport.title')} — ${filterLabel}`;

  const handleExport = async (doPrint) => {
    setExporting(true);
    try {
      const formatted = entries.map((entry) => formatEntry(entry, language, t));
      if (doPrint) await printReport(title, exportColumns, formatted);
      else await exportReportPdf(title, exportColumns, formatted);
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
        right={
          <TouchableOpacity onPress={onRefresh} accessibilityRole="button" accessibilityLabel={t('common.retry')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="refresh-outline" size={rf(20)} color={PRIMARY} />
          </TouchableOpacity>
        }
      />

      <SegmentedTabs
        style={styles.tabRow}
        value={filter}
        onChange={setFilter}
        options={filterOptions}
      />

      {loading ? (
        <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: navSpace }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {entries.length === 0 ? (
            <EmptyState iconElement={<Ionicons name="bar-chart-outline" size={rf(44)} color={colors.inkFaint} />} title={t('inventoryReport.emptyTitle')}
              message={rows.length === 0 ? t('inventoryReport.emptyMessage') : t('inventoryReport.emptyFilterMessage')} />
          ) : (
            <ReportTable columns={columns} rows={entries.map((entry) => formatEntry(entry, language, t))} emptyLabel={t('inventoryReport.emptyTitle')} onOpenPhoto={setPhotoUri} />
          )}

          <View style={styles.reportActionsRow}>
            <TouchableOpacity
              style={[styles.reportActionBtn, exporting && styles.btnDisabled]}
              onPress={() => handleExport(false)}
              disabled={exporting || entries.length === 0}
              activeOpacity={0.8}
            >
              <Ionicons name="download-outline" size={rf(15)} color={PRIMARY} />
              <Text style={styles.reportActionBtnText}>{t('inventoryReport.exportPdfBtn')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.reportActionBtn, exporting && styles.btnDisabled]}
              onPress={() => handleExport(true)}
              disabled={exporting || entries.length === 0}
              activeOpacity={0.8}
            >
              <Ionicons name="print-outline" size={rf(15)} color={PRIMARY} />
              <Text style={styles.reportActionBtnText}>{t('inventoryReport.printBtn')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      <ImageViewerModal uri={photoUri} visible={!!photoUri} onClose={() => setPhotoUri(null)} />

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

  tabRow: { marginHorizontal: spacing.lg, marginTop: spacing.lg, marginBottom: 0 },

  reportWrap: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surface, padding: 6 },
  reportHeaderRow: { flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: colors.border, paddingVertical: 6, paddingHorizontal: 6 },
  reportHeaderCell: { flexGrow: 0, flexShrink: 0, fontFamily: fonts.bodyBold, fontSize: rf(fontSize.xs), color: colors.inkSoft, textTransform: 'uppercase', letterSpacing: 0.3, paddingRight: 6 },
  reportRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  // Another order of the batch in the row above.
  reportRowContinued: { backgroundColor: colors.bgScreen },
  reportCell: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm), color: colors.ink },
  photoThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: colors.leaf50 },
  emptySubtitle: { fontFamily: fonts.body, color: colors.inkFaint, fontStyle: 'italic', padding: 16, textAlign: 'center' },

  reportActionsRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  reportActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: PRIMARY, minHeight: control.height },
  reportActionBtnText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: PRIMARY, textAlign: 'center' },
  btnDisabled: { opacity: 0.6 },
});
