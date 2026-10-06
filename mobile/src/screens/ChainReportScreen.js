import useLatestRequest from '../hooks/useLatestRequest';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import { Text, View, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../api/client';
import CustomModal from '../components/CustomModal';
import EmptyState from '../components/EmptyState';
import ImageViewerModal from '../components/ImageViewerModal';
import RemoteImage from '../components/RemoteImage';
import BatchDateField from '../components/BatchDateField';
import ScreenHeader from '../components/ScreenHeader';
import SelectField from '../components/ui/SelectField';
import StatusBadge from '../components/ui/StatusBadge';
import { exportReportPdf, printReport } from '../lib/reportPdf';
import { showAlert, peso } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { localizeVegetableName } from '../lib/vegetableNames';
import { REPORT_PERIODS, periodRange, customRangeError, rangeLabel } from '../lib/reportPeriods';
import { colors, control, fontSize, fonts, radius, spacing, typography } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';
import { statusLabel } from '../i18n/translate';
import { DetailRow, formatDate } from './DistributorInventoryReportScreen';

const PRIMARY = colors.leaf700;
const TYPE_TONES = { received: 'received', sold: 'delivered', spoiled: 'spoiled' };
const kg = (value) => (value != null ? `${Number(value)} kg` : '—');
const shortDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }) : '—');

// Columns of the exported PDF/print table, one row per transaction.
const COLUMNS_META = [
  { key: 'date', labelKey: 'reports.col.date', width: '9%' },
  { key: 'type', labelKey: 'reports.col.activity', width: '8%' },
  { key: 'vegetable', labelKey: 'chain.col.vegetable', width: '9%' },
  { key: 'batch_id', labelKey: 'chain.col.batch', width: '18%', monospace: true },
  { key: 'farmer', labelKey: 'chain.col.farmer', width: '12%' },
  { key: 'retailer', labelKey: 'inventoryReport.colRetailer', width: '12%' },
  { key: 'quantity', labelKey: 'chain.col.qty', width: '8%' },
  { key: 'amount', labelKey: 'reports.col.amount', width: '9%' },
  { key: 'status', labelKey: 'chain.col.status', width: '15%' },
];

/**
 * Vegetable Chain Tracking > View Reports: stock received, sales delivered and
 * spoilage within a period, from the transaction dates stored for each batch,
 * for all vegetables or one. The server filters, so the summary always matches
 * the table.
 */
export default function ChainReportScreen({ navigation }) {
  const beginRead = useLatestRequest();
  const { t, language } = useTranslation();
  const [period, setPeriod] = useState('week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  // '' is All Vegetables. Options come from the report (every vegetable stocked).
  const [vegetable, setVegetable] = useState('');
  const [vegetableOptions, setVegetableOptions] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  // View Details: the report row's own record id (event.id). Read-only; filters stay as they are.
  const [detailId, setDetailId] = useState(null);
  const [photo, setPhoto] = useState(null);

  const customError = period === 'custom' ? customRangeError(customFrom, customTo) : null;
  const range = period === 'custom' ? (customError ? null : { from: customFrom, to: customTo }) : periodRange(period);

  const load = useCallback(async () => {
    if (!range) { setReport(null); return; }
    const isCurrent = beginRead('report');
    try {
      const vegetableQuery = vegetable ? `&vegetable=${encodeURIComponent(vegetable)}` : '';
      const data = await api.get(`/api/distributor/chain-report?from=${range.from}&to=${range.to}${vegetableQuery}`);
      if (!isCurrent()) return;
      setReport(data);
      if (Array.isArray(data?.vegetables)) setVegetableOptions(data.vegetables);
    } catch (err) {
      if (isCurrent()) showAlert(t('common.error'), friendlyError(err));
    }
  }, [range?.from, range?.to, vegetable, t]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const events = report?.events || [];
  // The selected row and the stored records behind it, from the same report response
  // as the table: the batch (received), its order_items line (sold) or its
  // stock_spoilage record (spoiled). Never matched by vegetable name.
  const detail = detailId ? events.find((event) => event.id === detailId) || null : null;
  const detailBatch = detail ? (report?.batches || []).find((batch) => batch.batch_id === detail.batch_id) || null : null;
  const detailSale = detail?.type === 'sold' && detailBatch
    ? detailBatch.sales.find((sale) => (detail.item_id ? sale.item_id === detail.item_id : sale.order_id === detail.order_id)) || null : null;
  const detailSpoilage = detail?.type === 'spoiled' && detailBatch
    ? detailBatch.spoilage.find((record) => record.id === detail.spoilage_id) || null : null;
  const summary = report?.summary;
  const typeLabel = (event) => t(`reports.type.${event.type}`);
  const vegetableLabel = (name) => (name ? localizeVegetableName(name, language) : t('reports.allVegetables'));
  // A chosen vegetable stays listed even if the options no longer include it.
  const vegetableChoices = vegetable && !vegetableOptions.includes(vegetable) ? [...vegetableOptions, vegetable] : vegetableOptions;
  const statusText = (event) => (event.type === 'spoiled' ? t(`spoilage.reason.${event.status}`) : t(`reports.status.${event.type}`));

  const handleExport = async (doPrint) => {
    if (!range) return;
    setExporting(true);
    try {
      const title = t('reports.exportTitle');
      const columns = COLUMNS_META.map((c) => ({ ...c, label: t(c.labelKey) }));
      const rows = events.map((event) => ({
        date: shortDate(event.date), type: typeLabel(event), vegetable: localizeVegetableName(event.vegetable_name, language),
        batch_id: event.batch_id, farmer: event.farmer_name || '—', retailer: event.type === 'sold' ? event.party || '—' : '—',
        quantity: kg(event.quantity_kg), amount: event.amount != null ? peso(event.amount) : '—', status: statusText(event),
      }));
      const subtitle = `${rangeLabel(range)} · ${vegetableLabel(vegetable)} · ${t('reports.summaryLine', { received: summary?.received_kg ?? 0, sold: summary?.sold_kg ?? 0, spoiled: summary?.spoiled_kg ?? 0 })}`;
      if (doPrint) await printReport(title, columns, rows, subtitle, { landscape: true });
      else await exportReportPdf(title, columns, rows, subtitle, { landscape: true });
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      setExporting(false);
    }
  };

  const stat = (label, value, strong) => (
    <View style={styles.stat} key={label}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, strong && styles.statStrong]}>{value}</Text>
    </View>
  );

  const header = (
    <View>
      {/* Two separate dropdowns; both filter the whole report, totals included. */}
      <View style={styles.filters}>
        <SelectField style={styles.filter} label={t('reports.dateRange')} value={period} onChange={setPeriod}
          options={REPORT_PERIODS.map((p) => ({ value: p, label: t(`reports.period.${p}`) }))} />
        <SelectField style={styles.filter} label={t('reports.vegetable')} value={vegetable} onChange={setVegetable}
          options={['', ...vegetableChoices].map((name) => ({ value: name, label: vegetableLabel(name) }))} />
      </View>
      {period === 'custom' && (
        <View style={styles.customRow}>
          <View style={styles.customField}>
            <Text style={styles.fieldLabel}>{t('reports.from')}</Text>
            <BatchDateField value={customFrom} onChange={setCustomFrom} />
          </View>
          <View style={styles.customField}>
            <Text style={styles.fieldLabel}>{t('reports.to')}</Text>
            <BatchDateField value={customTo} onChange={setCustomTo} minDate={customFrom || undefined} />
          </View>
        </View>
      )}
      {!!customError && (customFrom || customTo) && <Text style={styles.error}>{t(customError)}</Text>}
      {!!range && <Text style={styles.rangeText}>{rangeLabel(range)}</Text>}
      {!!summary && (
        <View style={styles.stats}>
          {stat(t('reports.receivedKg'), kg(summary.received_kg))}
          {stat(t('reports.soldKg'), kg(summary.sold_kg), true)}
          {stat(t('reports.spoiledKg'), kg(summary.spoiled_kg))}
          {stat(t('reports.completedSales'), `${summary.completed_transactions} · ${peso(summary.sales_total)}`)}
        </View>
      )}
      {events.length > 0 && (
        <View style={[styles.tableRow, styles.tableHead]} accessibilityRole="header">
          <Text style={[styles.headCell, styles.colDate]}>{t('reports.col.date')}</Text>
          <Text style={[styles.headCell, styles.colMain]}>{t('reports.col.transaction')}</Text>
          <Text style={[styles.headCell, styles.colQty]}>{t('chain.col.qty')}</Text>
        </View>
      )}
    </View>
  );

  const renderItem = ({ item: event, index }) => (
    <TouchableOpacity style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlt]} onPress={() => setDetailId(event.id)} activeOpacity={0.75}
      accessibilityRole="button" accessibilityLabel={t('chain.viewDetailsFor', { name: `${typeLabel(event)} ${localizeVegetableName(event.vegetable_name, language)}` })}>
      <Text style={[styles.cell, styles.colDate]}>{shortDate(event.date)}</Text>
      <View style={styles.colMain}>
        <View style={styles.mainTop}>
          <StatusBadge status={TYPE_TONES[event.type]} label={typeLabel(event)} />
          <Text style={styles.cellTitle} numberOfLines={1}>{localizeVegetableName(event.vegetable_name, language)}</Text>
        </View>
        <Text style={styles.cellMeta} numberOfLines={2}>
          {event.type === 'sold' ? t('reports.toRetailer', { name: event.party || '—' }) : t('reports.fromFarmer', { name: event.farmer_name || '—' })}
          {event.type === 'spoiled' ? ` · ${statusText(event)}` : ''}
        </Text>
        <Text style={styles.cellMeta} numberOfLines={1}>{t('chain.col.batch')}: {String(event.batch_id).slice(0, 8)}</Text>
        <Text style={styles.viewLink}>{t('inventoryReport.viewDetails')}</Text>
      </View>
      <View style={styles.colQty}>
        <Text style={styles.cellNum}>{kg(event.quantity_kg)}</Text>
        {event.amount != null && event.type === 'sold' && <Text style={styles.cellMeta}>{peso(event.amount)}</Text>}
      </View>
    </TouchableOpacity>
  );

  const money = (value) => (value != null ? peso(value) : '—');
  const perKg = (value) => (value != null ? `${peso(value)} / kg` : '—');
  const proof = (url, pod, label) => !!url && (
    <TouchableOpacity style={styles.proofRow} onPress={() => setPhoto({ proof_photo_url: url, pod })} accessibilityRole="button">
      <RemoteImage uri={url} style={styles.proofThumb} />
      <Text style={styles.proofText}>{label}</Text>
    </TouchableOpacity>
  );
  // Fields that exist for this kind of transaction, from its stored record.
  const renderDetail = () => {
    const batch = detailBatch;
    const source = (
      <>
        <DetailRow label={t('chain.col.batch')} value={detail.batch_id || '—'} />
        <DetailRow label={t('chain.col.vegetable')} value={localizeVegetableName(detail.vegetable_name, language)} />
        <DetailRow label={t('chain.col.farmer')} value={detail.farmer_name || '—'} />
        <DetailRow label={t('chain.col.harvestDate')} value={formatDate(detail.harvest_date)} />
      </>
    );
    if (detail.type === 'received') {
      const pickup = batch?.pickup;
      return (
        <>
          {source}
          <DetailRow label={t('reports.detail.receivedOn')} value={formatDate(detail.date)} />
          <DetailRow label={t('chain.col.qty')} value={kg(detail.quantity_kg)} />
          <Text style={styles.sectionHeading}>{t('chain.pickupHeading')}</Text>
          {pickup ? (
            <View style={styles.block}>
              <DetailRow label={t('chain.requestedQty')} value={kg(pickup.quantity_kg)} />
              <DetailRow label={t('chain.col.farmerPrice')} value={perKg(pickup.farmer_price_per_kg)} />
              <DetailRow label={t('pickupPanel.estimatedTotal')} value={money(pickup.estimated_total)} />
              <DetailRow label={t('chain.requestDate')} value={formatDate(pickup.requested_at)} />
              <DetailRow label={t('chain.col.pickupDate')} value={formatDate(pickup.picked_up_at)} />
              <DetailRow label={t('inventoryReport.colPickupRider')} value={pickup.rider_name || '—'} />
              {proof(pickup.proof_photo_url, pickup.pod, t('pickupPanel.pickupProof'))}
            </View>
          ) : <Text style={styles.noneText}>{t('chain.noPickup')}</Text>}
        </>
      );
    }
    if (detail.type === 'sold') {
      const sale = detailSale;
      return (
        <>
          <DetailRow label={t('reports.detail.orderId')} value={detail.order_id || '—'} />
          <DetailRow label={t('inventoryReport.colRetailer')} value={detail.party || '—'} />
          <DetailRow label={t('chain.col.qty')} value={kg(detail.quantity_kg)} />
          <DetailRow label={t('chain.col.sellingPrice')} value={perKg(sale?.price_per_kg)} />
          <DetailRow label={t('inventoryReport.colTotalAmount')} value={money(detail.amount)} />
          <DetailRow label={t('chain.orderDate')} value={formatDate(sale?.ordered_at)} />
          <DetailRow label={t('inventoryReport.colDeliveryDate')} value={formatDate(sale?.delivered_at || detail.date)} />
          <DetailRow label={t('inventoryReport.colDeliveryRider')} value={sale?.rider_name || '—'} />
          <DetailRow label={t('inventoryReport.colPayment')}>
            {sale?.payment_status ? <StatusBadge status={sale.payment_status} label={statusLabel(sale.payment_status, t)} /> : <Text style={styles.detailValue}>—</Text>}
          </DetailRow>
          {proof(sale?.proof_photo_url, sale?.pod, t('dashboards.distributor.proofOfDelivery'))}
          <Text style={styles.sectionHeading}>{t('reports.detail.sourceHeading')}</Text>
          <View style={styles.block}>{source}</View>
        </>
      );
    }
    if (detail.type === 'spoiled') {
      return (
        <>
          {source}
          <DetailRow label={t('chain.col.qty')} value={kg(detailSpoilage?.quantity_kg ?? detail.quantity_kg)} />
          <DetailRow label={t('spoilage.reasonLabel')}>
            <StatusBadge status={detail.status} label={t(`spoilage.reason.${detail.status}`)} />
          </DetailRow>
          <DetailRow label={t('spoilage.dateLabel')} value={formatDate(detailSpoilage?.recorded_at || detail.date)} />
          {!!batch?.status && (
            <DetailRow label={t('reports.detail.batchStatus')}>
              <StatusBadge status={batch.status} label={statusLabel(batch.status, t)} />
            </DetailRow>
          )}
        </>
      );
    }
    // A transaction type this screen does not know yet: its common fields only.
    return (
      <>
        {source}
        <DetailRow label={t('chain.col.qty')} value={kg(detail.quantity_kg)} />
        <DetailRow label={t('reports.col.date')} value={formatDate(detail.date)} />
      </>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('reports.title')} onBack={() => navigation.goBack()} />
      <FlatList
        data={loading ? [] : events}
        keyExtractor={(event, i) => event.id || `${event.type}-${event.batch_id}-${event.order_id || ''}-${i}`}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={header}
        ListEmptyComponent={loading ? <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 30 }} /> : (
          <EmptyState iconElement={<Ionicons name="document-text-outline" size={rf(44)} color={colors.inkFaint} />}
            title={range && vegetable ? t('reports.emptyVegetableTitle') : t('reports.emptyTitle')}
            message={!range ? t('reports.pickDates') : vegetable ? t('reports.emptyVegetableMessage') : t('reports.emptyMessage')} />
        )}
        ListFooterComponent={events.length > 0 ? (
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
        ) : null}
      />

      <CustomModal visible={!!detail} title={detail ? localizeVegetableName(detail.vegetable_name, language) : ''} onCancel={() => setDetailId(null)} compactActions>
        {!!detail && (
          <>
            <View style={styles.detailStatusRow}>
              <Text style={styles.detailLabel}>{t('reports.col.transaction')}</Text>
              <StatusBadge status={TYPE_TONES[detail.type] || 'pending'} label={typeLabel(detail)} />
            </View>
            {renderDetail()}
          </>
        )}
      </CustomModal>
      <ImageViewerModal uri={photo?.proof_photo_url} proof={photo?.pod} visible={!!photo} onClose={() => setPhoto(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  // Side by side when both fit (about 150 wide each), otherwise stacked.
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: spacing.md },
  filter: { flexGrow: 1, flexBasis: 150 },
  customRow: { flexDirection: 'row', gap: 10, marginBottom: spacing.sm },
  customField: { flex: 1, minWidth: 0 },
  fieldLabel: { ...typography.label, color: colors.inkSoft, marginBottom: 4 },
  error: { ...typography.error, color: colors.danger, marginBottom: spacing.sm },
  rangeText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginBottom: spacing.sm },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  stat: { flexGrow: 1, flexBasis: '45%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.ctrl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  statLabel: { ...typography.statLabel, color: colors.inkFaint },
  statValue: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink, marginTop: 2 },
  statStrong: { color: PRIMARY },
  tableRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10, paddingHorizontal: 10, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  tableRowAlt: { backgroundColor: colors.bgScreen },
  tableHead: { borderTopWidth: 1, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, backgroundColor: colors.leaf50, paddingVertical: 8 },
  headCell: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkSoft },
  colDate: { flex: 1.3, minWidth: 0 },
  colMain: { flex: 3.4, minWidth: 0 },
  colQty: { flex: 1.3, minWidth: 0, alignItems: 'flex-end', textAlign: 'right' },
  mainTop: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  cell: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.ink },
  cellTitle: { flexShrink: 1, fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink },
  cellMeta: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkSoft, marginTop: 3 },
  cellNum: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.sm), color: colors.ink, textAlign: 'right' },
  // Same View Details link and modal layout as Vegetable Chain Tracking.
  viewLink: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: PRIMARY, marginTop: 4 },
  detailStatusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  detailLabel: { ...typography.smallLabel, color: colors.inkFaint },
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
