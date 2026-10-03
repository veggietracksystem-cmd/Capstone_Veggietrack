import useLatestRequest from '../hooks/useLatestRequest';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import { Text, View, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import BatchDateField from '../components/BatchDateField';
import ScreenHeader from '../components/ScreenHeader';
import SelectField from '../components/ui/SelectField';
import StatusBadge from '../components/ui/StatusBadge';
import { exportReportPdf, printReport } from '../lib/reportPdf';
import { showAlert, peso } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { localizeVegetableName } from '../lib/vegetableNames';
import { REPORT_PERIODS, periodRange, customRangeError, rangeLabel } from '../lib/reportPeriods';
import { colors, control, fontSize, fonts, radius, spacing } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

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
    <View style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlt]}>
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
      </View>
      <View style={styles.colQty}>
        <Text style={styles.cellNum}>{kg(event.quantity_kg)}</Text>
        {event.amount != null && event.type === 'sold' && <Text style={styles.cellMeta}>{peso(event.amount)}</Text>}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('reports.title')} onBack={() => navigation.goBack()} />
      <FlatList
        data={loading ? [] : events}
        keyExtractor={(event, i) => `${event.type}-${event.batch_id}-${event.order_id || ''}-${i}`}
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
  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkSoft, marginBottom: 4 },
  error: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm), color: colors.danger, marginBottom: spacing.sm },
  rangeText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginBottom: spacing.sm },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  stat: { flexGrow: 1, flexBasis: '45%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.ctrl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  statLabel: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkFaint },
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
  reportActionsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  reportActionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.ctrl, borderWidth: 1.4, borderColor: PRIMARY, minHeight: control.height },
  reportActionBtnText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: PRIMARY, textAlign: 'center' },
  btnDisabled: { opacity: 0.6 },
});
