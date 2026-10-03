import useLatestRequest from '../hooks/useLatestRequest';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import {
  Text, View, FlatList, TouchableOpacity,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../api/client';
import CustomModal from '../components/CustomModal';
import EmptyState from '../components/EmptyState';
import ImageViewerModal from '../components/ImageViewerModal';
import RemoteImage from '../components/RemoteImage';
import VegetableImage from '../components/VegetableImage';
import { SegmentedTabs } from '../components/ui/SegmentedTabs';
import StatusBadge from '../components/ui/StatusBadge';
import BottomNavBar, { useBottomNavSpace } from '../components/BottomNavBar';
import ScreenHeader from '../components/ScreenHeader';
import { exportReportPdf, printReport } from '../lib/reportPdf';
import { showAlert, peso } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { getVegetableTile } from '../lib/vegetableIcons';
import { colors, control, fontSize, fonts, radius, spacing, actionBtn, actionBtnOutline, actionBtnText } from '../theme/appTheme';
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

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Vegetable Chain Tracking filters over the batch lifecycle (backend/lib/batches.js):
// Active batches still have stock, and every other batch finished by selling out.
// Batches whose stock was discarded are reached through the Spoiled Products
// button above the tabs, so there is no separate Spoiled tab.
const FILTERS = [
  { value: 'active', labelKey: 'status.active' },
  { value: 'sold_out', labelKey: 'status.sold_out' },
];
export const filterGroupOf = (batch) => (['received', 'listed'].includes(batch.status) ? 'active'
  : batch.status === 'spoiled' ? 'spoiled' : 'sold_out');

// A listed batch reads as Active (as in Stocks); a removed sold-out batch ('archived') as Sold out.
export const displayStatus = (status) => (status === 'listed' ? 'active' : status === 'archived' ? 'sold_out' : status);

const num = (value) => (value != null && Number.isFinite(Number(value)) ? Number(value) : null);
export const kg = (value) => (num(value) != null ? `${num(value)} kg` : '—');
export const shortBatchId = (id) => (id && id.length > 8 ? `${id.slice(0, 8)}...` : id || '—');
const orderStatusCode = (value) => (value ? String(value).toLowerCase() : null);

// Columns of the exported PDF/print table: one row per batch (the screen shows a
// compact table and the full record in View Details).
const COLUMNS_META = [
  { key: 'product', labelKey: 'chain.col.vegetable', width: '7%' },
  { key: 'batch_id', labelKey: 'chain.col.batch', width: '13%', monospace: true },
  { key: 'status', labelKey: 'chain.col.status', width: '6%' },
  { key: 'farmer_name', labelKey: 'chain.col.farmer', width: '8%' },
  { key: 'harvest_date', labelKey: 'chain.col.harvestDate', width: '7%' },
  { key: 'picked_up', labelKey: 'chain.col.pickupDate', width: '7%' },
  { key: 'received', labelKey: 'chain.col.received', width: '6%' },
  { key: 'sold', labelKey: 'chain.col.sold', width: '6%' },
  { key: 'spoiled', labelKey: 'chain.col.spoiled', width: '6%' },
  { key: 'remaining', labelKey: 'chain.col.remaining', width: '6%' },
  { key: 'farmer_price', labelKey: 'chain.col.farmerPrice', width: '7%' },
  { key: 'selling_price', labelKey: 'chain.col.sellingPrice', width: '7%' },
  { key: 'retailers', labelKey: 'chain.col.retailers', width: '10%' },
];

export function formatBatch(batch, language, t) {
  const status = displayStatus(batch.status);
  const retailers = [...new Set((batch.sales || []).filter((s) => s.stage === 'sold' || s.stage === 'on_order').map((s) => s.retailer_name).filter(Boolean))];
  return {
    codes: { status },
    product: localizeVegetableName(batch.vegetable_name, language),
    batch_id: batch.batch_id || '—',
    status: status ? statusLabel(status, t) : '—',
    farmer_name: batch.farmer_name || '—',
    harvest_date: formatDate(batch.harvest_date),
    picked_up: formatDate(batch.pickup?.picked_up_at || batch.in_stock_since),
    received: kg(batch.totals?.received),
    sold: kg(batch.totals?.sold),
    spoiled: kg(batch.totals?.spoiled),
    remaining: kg(batch.totals?.remaining),
    farmer_price: batch.pickup?.farmer_price_per_kg != null ? peso(batch.pickup.farmer_price_per_kg) : '—',
    selling_price: batch.price_per_kg != null ? peso(batch.price_per_kg) : '—',
    retailers: retailers.join(', ') || '—',
  };
}

function DetailRow({ label, value, children }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      {children || <Text style={styles.detailValue} selectable>{value}</Text>}
    </View>
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
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('active');
  const [exporting, setExporting] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [width, setWidth] = useState(0);
  const wide = width >= 640;

  const load = useCallback(async () => {
    const isCurrent = beginRead('load');
    try {
      const data = await api.get('/api/distributor/chain-tracking');
      if (!isCurrent()) return;
      setBatches(Array.isArray(data?.batches) ? data.batches : []);
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

  const filterOptions = FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey) }));
  const shown = batches.filter((batch) => filterGroupOf(batch) === filter);
  const detail = batches.find((batch) => batch.batch_id === detailId) || null;

  // Export/print a text-only table of the selected tab on an A4 landscape page.
  const handleExport = async (doPrint) => {
    setExporting(true);
    try {
      const title = t(`chain.exportTitle.${filter}`);
      const columns = COLUMNS_META.map((c) => ({ ...c, label: t(c.labelKey) }));
      const formatted = shown.map((batch) => formatBatch(batch, language, t));
      if (doPrint) await printReport(title, columns, formatted, undefined, { landscape: true });
      else await exportReportPdf(title, columns, formatted, undefined, { landscape: true });
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      setExporting(false);
    }
  };

  // An active batch past the 7-day limit reads "Needs review" until the distributor discards it.
  const renderStatus = (status, pastLimit) => (pastLimit
    ? <StatusBadge status="pending" label={t('stocks.statusNeedsReview')} />
    : <StatusBadge status={displayStatus(status)} label={statusLabel(displayStatus(status), t)} />);
  const cell = (value) => (num(value) != null ? String(num(value)) : '—');

  const header = (
    <View>
      <View style={styles.topActions}>
        <TouchableOpacity style={styles.topActionBtn} onPress={() => navigation.navigate('ChainReport')} accessibilityRole="button">
          <Ionicons name="document-text-outline" size={rf(16)} color={PRIMARY} />
          <Text style={styles.topActionText}>{t('chain.viewReports')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.topActionBtn} onPress={() => navigation.navigate('SpoiledProducts')} accessibilityRole="button">
          <Ionicons name="trash-bin-outline" size={rf(16)} color={PRIMARY} />
          <Text style={styles.topActionText}>{t('chain.spoiledProducts')}</Text>
        </TouchableOpacity>
      </View>
      <SegmentedTabs style={styles.tabRow} value={filter} onChange={(value) => { setFilter(value); setDetailId(null); }} options={filterOptions} />
      {shown.length > 0 && (
        <View style={[styles.tableRow, styles.tableHead]} accessibilityRole="header">
          <Text style={[styles.headCell, styles.colBatch]}>{t('chain.col.vegetableBatch')}</Text>
          {wide && <Text style={[styles.headCell, styles.colFarmer]}>{t('chain.col.farmer')}</Text>}
          {wide && <Text style={[styles.headCell, styles.colDate]}>{t('chain.col.harvestDate')}</Text>}
          <Text style={[styles.headCell, styles.colKg]}>{t('chain.col.receivedKg')}</Text>
          <Text style={[styles.headCell, styles.colKg]}>{t('chain.col.soldKg')}</Text>
          {wide && <Text style={[styles.headCell, styles.colKg]}>{t('chain.col.spoiledKg')}</Text>}
          <Text style={[styles.headCell, styles.colKg]}>{t('chain.col.leftKg')}</Text>
          <Text style={[styles.headCell, styles.colStatus]}>{t('chain.col.status')}</Text>
        </View>
      )}
    </View>
  );

  const renderItem = ({ item: b, index }) => {
    const tile = getVegetableTile(b.vegetable_name);
    const name = localizeVegetableName(b.vegetable_name, language);
    return (
      <TouchableOpacity style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlt]} onPress={() => setDetailId(b.batch_id)}
        accessibilityRole="button" accessibilityLabel={t('chain.viewDetailsFor', { name })} activeOpacity={0.75}>
        <View style={[styles.colBatch, styles.batchCell]}>
          <View style={[styles.tile, { backgroundColor: tile.bg }]}>
            <VegetableImage source={tile.source} style={styles.tileIcon} fallbackSize={rf(16)} />
          </View>
          <View style={styles.batchText}>
            <Text style={styles.cellTitle} numberOfLines={1}>{name}</Text>
            <Text style={styles.cellMeta} numberOfLines={1}>{shortBatchId(b.batch_id)}</Text>
            {!wide && <Text style={styles.cellMeta} numberOfLines={1}>{b.farmer_name || '—'}</Text>}
            <Text style={styles.viewLink}>{t('inventoryReport.viewDetails')}</Text>
          </View>
        </View>
        {wide && <Text style={[styles.cell, styles.colFarmer]} numberOfLines={2}>{b.farmer_name || '—'}</Text>}
        {wide && <Text style={[styles.cell, styles.colDate]}>{formatDate(b.harvest_date)}</Text>}
        <Text style={[styles.cellNum, styles.colKg]}>{cell(b.totals?.received)}</Text>
        <Text style={[styles.cellNum, styles.colKg]}>{cell(b.totals?.sold)}</Text>
        {wide && <Text style={[styles.cellNum, styles.colKg]}>{cell(b.totals?.spoiled)}</Text>}
        <Text style={[styles.cellNum, styles.colKg, styles.cellStrong]}>{cell(b.totals?.remaining)}</Text>
        <View style={[styles.colStatus, styles.statusCell]}>{renderStatus(b.status, b.past_limit)}</View>
      </TouchableOpacity>
    );
  };

  const exportButtons = shown.length > 0 && (
    <View style={styles.reportActionsRow}>
      <TouchableOpacity style={[styles.reportActionBtn, exporting && styles.btnDisabled]} onPress={() => handleExport(false)} disabled={exporting} activeOpacity={0.8}>
        <Ionicons name="download-outline" size={rf(15)} color={PRIMARY} />
        <Text style={styles.reportActionBtnText}>{t('inventoryReport.exportPdfBtn')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.reportActionBtn, exporting && styles.btnDisabled]} onPress={() => handleExport(true)} disabled={exporting} activeOpacity={0.8}>
        <Ionicons name="print-outline" size={rf(15)} color={PRIMARY} />
        <Text style={styles.reportActionBtnText}>{t('inventoryReport.printBtn')}</Text>
      </TouchableOpacity>
    </View>
  );

  const totals = detail?.totals || {};
  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('chain.title')} />

      {loading ? (
        <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(b) => b.batch_id}
          renderItem={renderItem}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          contentContainerStyle={[styles.content, { paddingBottom: navSpace }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState iconElement={<Ionicons name="git-network-outline" size={rf(44)} color={colors.inkFaint} />} title={t('chain.emptyTitle')}
              message={batches.length === 0 ? t('chain.emptyMessage') : t('chain.emptyFilterMessage')} />
          }
          ListFooterComponent={exportButtons || null}
        />
      )}

      <CustomModal visible={!!detail} title={detail ? localizeVegetableName(detail.vegetable_name, language) : ''} onCancel={() => setDetailId(null)} compactActions>
        {!!detail && (
          <>
            <View style={styles.detailStatusRow}>
              <Text style={styles.detailLabel}>{t('chain.col.status')}</Text>
              {renderStatus(detail.status, detail.past_limit)}
            </View>
            {detail.batch_photo_url
              ? <RemoteImage uri={detail.batch_photo_url} style={styles.detailPhoto} resizeMode="cover" accessibilityLabel={t('inventoryReport.colPhoto')} />
              : null}
            <DetailRow label={t('chain.col.batch')} value={detail.batch_id || '—'} />
            <DetailRow label={t('chain.col.vegetable')} value={localizeVegetableName(detail.vegetable_name, language)} />
            <DetailRow label={t('chain.col.farmer')} value={detail.farmer_name || '—'} />
            <DetailRow label={t('chain.col.harvestDate')} value={formatDate(detail.harvest_date)} />
            <DetailRow label={t('chain.inStockSince')} value={formatDate(detail.in_stock_since)} />
            {detail.days_in_stock != null && <DetailRow label={t('chain.daysInStock')} value={t('chain.daysValue', { days: detail.days_in_stock })} />}

            <Text style={styles.sectionHeading}>{t('chain.quantities')}</Text>
            <DetailRow label={t('chain.col.received')} value={kg(totals.received)} />
            <DetailRow label={t('chain.col.sold')} value={kg(totals.sold)} />
            {num(totals.on_order) > 0 && <DetailRow label={t('chain.onOrder')} value={kg(totals.on_order)} />}
            {num(totals.not_delivered) > 0 && <DetailRow label={t('chain.notDelivered')} value={kg(totals.not_delivered)} />}
            <DetailRow label={t('chain.col.spoiled')} value={kg(totals.spoiled)} />
            {num(totals.adjusted) > 0 && <DetailRow label={t('chain.adjusted')} value={kg(totals.adjusted)} />}
            <DetailRow label={t('chain.col.remaining')} value={kg(totals.remaining)} />
            <DetailRow label={t('chain.col.sellingPrice')} value={detail.price_per_kg != null ? `${peso(detail.price_per_kg)} / kg` : '—'} />

            <Text style={styles.sectionHeading}>{t('chain.pickupHeading')}</Text>
            {detail.pickup ? (
              <View style={styles.block}>
                <DetailRow label={t('chain.requestedQty')} value={kg(detail.pickup.quantity_kg)} />
                <DetailRow label={t('chain.col.farmerPrice')} value={detail.pickup.farmer_price_per_kg != null ? `${peso(detail.pickup.farmer_price_per_kg)} / kg` : '—'} />
                <DetailRow label={t('pickupPanel.estimatedTotal')} value={detail.pickup.estimated_total != null ? peso(detail.pickup.estimated_total) : '—'} />
                <DetailRow label={t('chain.requestDate')} value={formatDate(detail.pickup.requested_at)} />
                <DetailRow label={t('chain.col.pickupDate')} value={formatDate(detail.pickup.picked_up_at)} />
                <DetailRow label={t('inventoryReport.colPickupRider')} value={detail.pickup.rider_name || '—'} />
                {!!detail.pickup.proof_photo_url && (
                  <TouchableOpacity style={styles.proofRow} onPress={() => setPhoto({ proof_photo_url: detail.pickup.proof_photo_url, pod: detail.pickup.pod })} accessibilityRole="button">
                    <RemoteImage uri={detail.pickup.proof_photo_url} style={styles.proofThumb} />
                    <Text style={styles.proofText}>{t('pickupPanel.pickupProof')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <Text style={styles.noneText}>{t('chain.noPickup')}</Text>
            )}

            <Text style={styles.sectionHeading}>{t('chain.salesHeading', { count: detail.sales.length })}</Text>
            {detail.sales.length === 0 ? (
              <Text style={styles.noneText}>{t('chain.noSales')}</Text>
            ) : detail.sales.map((sale, i) => (
              <View key={`${sale.order_id}-${i}`} style={styles.block}>
                <DetailRow label={t('inventoryReport.colRetailer')} value={sale.retailer_name || '—'} />
                <DetailRow label={t('chain.col.qty')} value={kg(sale.quantity_kg)} />
                <DetailRow label={t('inventoryReport.colTotalAmount')} value={sale.total_amount != null ? peso(sale.total_amount) : '—'} />
                <DetailRow label={t('chain.orderDate')} value={formatDate(sale.ordered_at)} />
                <DetailRow label={t('inventoryReport.colDeliveryDate')} value={formatDate(sale.delivered_at)} />
                <DetailRow label={t('inventoryReport.colDeliveryRider')} value={sale.rider_name || '—'} />
                <DetailRow label={t('inventoryReport.colPayment')}>
                  {sale.payment_status ? <StatusBadge status={sale.payment_status} label={statusLabel(sale.payment_status, t)} /> : <Text style={styles.detailValue}>—</Text>}
                </DetailRow>
                <DetailRow label={t('inventoryReport.colOrderStatus')}>
                  {sale.order_status ? <StatusBadge status={orderStatusCode(sale.order_status)} label={statusLabel(orderStatusCode(sale.order_status), t)} /> : <Text style={styles.detailValue}>—</Text>}
                </DetailRow>
                {sale.stage == null && <Text style={styles.noneText}>{t('chain.returnedToStock')}</Text>}
                {!!sale.proof_photo_url && (
                  <TouchableOpacity style={styles.proofRow} onPress={() => setPhoto({ proof_photo_url: sale.proof_photo_url, pod: sale.pod })} accessibilityRole="button">
                    <RemoteImage uri={sale.proof_photo_url} style={styles.proofThumb} />
                    <Text style={styles.proofText}>{t('dashboards.distributor.proofOfDelivery')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}

            <Text style={styles.sectionHeading}>{t('chain.spoilageHeading')}</Text>
            {detail.spoilage.length === 0 ? (
              <Text style={styles.noneText}>{t('chain.noSpoilage')}</Text>
            ) : detail.spoilage.map((record) => (
              <View key={record.id} style={styles.block}>
                <DetailRow label={t('chain.col.qty')} value={kg(record.quantity_kg)} />
                <DetailRow label={t('spoilage.reasonLabel')}>
                  <StatusBadge status={record.reason} label={t(`spoilage.reason.${record.reason}`)} />
                </DetailRow>
                <DetailRow label={t('spoilage.dateLabel')} value={formatDate(record.recorded_at)} />
              </View>
            ))}
          </>
        )}
      </CustomModal>

      <ImageViewerModal uri={photo?.proof_photo_url} proof={photo?.pod} visible={!!photo} onClose={() => setPhoto(null)} />

      <BottomNavBar tabs={DISTRIBUTOR_TABS} activeTab="inventory" onTabPress={handleBottomTabPress} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  content: { padding: 16, paddingBottom: 100, flexGrow: 1 },

  topActions: { flexDirection: 'row', gap: 10, marginBottom: spacing.md },
  topActionBtn: { ...actionBtn, ...actionBtnOutline, flex: 1, flexDirection: 'row', gap: 6, minHeight: control.height },
  topActionText: { ...actionBtnText, fontSize: rf(fontSize.md), color: PRIMARY },
  tabRow: { marginBottom: spacing.md },

  tableRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 10, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  tableRowAlt: { backgroundColor: colors.bgScreen },
  tableHead: { borderTopWidth: 1, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, backgroundColor: colors.leaf50, paddingVertical: 8 },
  headCell: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkSoft },
  colBatch: { flex: 2.6, minWidth: 0 },
  colFarmer: { flex: 1.6, minWidth: 0 },
  colDate: { flex: 1.4, minWidth: 0 },
  colKg: { flex: 1, minWidth: 0, textAlign: 'right' },
  colStatus: { flex: 1.7, minWidth: 0, alignItems: 'flex-end' },
  batchCell: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  batchText: { flex: 1, minWidth: 0 },
  tile: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tileIcon: { width: 26, height: 26 },
  cellTitle: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink },
  cellMeta: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkSoft, marginTop: 1 },
  viewLink: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: PRIMARY, marginTop: 4 },
  cell: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.ink },
  cellNum: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.ink },
  cellStrong: { fontFamily: fonts.bodyBold, color: PRIMARY },
  statusCell: { justifyContent: 'center' },

  detailStatusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailPhoto: { width: '100%', height: 180, borderRadius: radius.card, marginTop: 12, backgroundColor: colors.leaf50 },
  detailRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'flex-start' },
  detailLabel: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkFaint },
  detailValue: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink, marginTop: 2 },
  sectionHeading: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.md), color: colors.ink, marginTop: 18, marginBottom: 4 },
  block: { marginTop: 8, paddingHorizontal: 12, borderRadius: radius.ctrl, backgroundColor: colors.bgScreen },
  noneText: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkFaint, paddingVertical: 8 },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  proofThumb: { width: 56, height: 56, borderRadius: radius.ctrl, backgroundColor: colors.leaf50 },
  proofText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: PRIMARY },

  reportActionsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  reportActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: PRIMARY, minHeight: control.height },
  reportActionBtnText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: PRIMARY, textAlign: 'center' },
  btnDisabled: { opacity: 0.6 },
});
