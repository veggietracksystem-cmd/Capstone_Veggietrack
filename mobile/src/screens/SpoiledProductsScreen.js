import useLatestRequest from '../hooks/useLatestRequest';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import { Text, View, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, RefreshControl, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import BatchDateField from '../components/BatchDateField';
import ScreenHeader from '../components/ScreenHeader';
import SelectField from '../components/ui/SelectField';
import { showAlert } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { localizeVegetableName } from '../lib/vegetableNames';
import { REPORT_PERIODS, periodRange, customRangeError, rangeLabel } from '../lib/reportPeriods';
import { colors, fontSize, fonts, radius, shadowCard, spacing } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = colors.leaf700;
const kg = (value) => (value != null ? `${Number(value)} kg` : '—');
const fitOneLine = { numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.7 };
const shortDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

/**
 * Vegetable Chain Tracking > Spoiled Products: stock that can no longer be sold,
 * either discarded by the distributor or past the 7-day spoilage limit. Every
 * row traces back to its original batch.
 */
export default function SpoiledProductsScreen({ navigation }) {
  const beginRead = useLatestRequest();
  const { t, tc, language } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Same two filters as View Reports, plus All Dates. '' is All Vegetables.
  const [period, setPeriod] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [vegetable, setVegetable] = useState('');
  const [vegetableOptions, setVegetableOptions] = useState([]);

  const customError = period === 'custom' ? customRangeError(customFrom, customTo) : null;
  const range = period === 'all' ? null
    : period === 'custom' ? (customError ? null : { from: customFrom, to: customTo }) : periodRange(period);
  // A custom range without two valid days has nothing to show yet.
  const waitingForDates = period === 'custom' && !range;
  const filtered = period !== 'all' || !!vegetable;

  // The server filters, so the list and its total always match.
  const load = useCallback(async () => {
    // This week's total stays on screen while the dates are being chosen.
    if (waitingForDates) { setData((prev) => (prev ? { ...prev, records: [], total_kg: 0 } : prev)); return; }
    const isCurrent = beginRead('spoilage');
    try {
      const params = [range && `from=${range.from}&to=${range.to}`, vegetable && `vegetable=${encodeURIComponent(vegetable)}`].filter(Boolean);
      const result = await api.get(`/api/distributor/spoilage${params.length ? `?${params.join('&')}` : ''}`);
      if (!isCurrent()) return;
      setData(result);
      if (Array.isArray(result?.vegetables)) setVegetableOptions(result.vegetables);
    } catch (err) {
      if (isCurrent()) showAlert(t('common.error'), friendlyError(err));
    }
  }, [waitingForDates, range?.from, range?.to, vegetable, t]);
  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [load]);
  useRefreshOnFocus(load);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const resetFilters = () => { setPeriod('all'); setCustomFrom(''); setCustomTo(''); setVegetable(''); };

  const records = data?.records || [];
  const week = data?.this_week;
  // The Quantity column is narrow on small phones: its header and values stay on
  // one line and shrink to fit (Android/iOS), with a smaller size below 380 wide (also web).
  const { width } = useWindowDimensions();
  const narrow = width < 380;
  const vegetableLabel = (name) => (name ? localizeVegetableName(name, language) : t('reports.allVegetables'));
  // A chosen vegetable stays listed even if the options no longer include it.
  const vegetableChoices = vegetable && !vegetableOptions.includes(vegetable) ? [...vegetableOptions, vegetable] : vegetableOptions;

  const header = (
    <View>
      <View style={styles.summary} accessibilityRole="summary">
        <Text style={styles.summaryLabel}>{t('spoilage.thisWeek')}</Text>
        <Text style={styles.summaryValue}>{kg(week?.kg ?? 0)}</Text>
        {!!week && <Text style={styles.summaryRange}>{rangeLabel({ from: week.from, to: week.to })}</Text>}
      </View>
      <View style={styles.filters}>
        <SelectField style={styles.filter} label={t('reports.dateRange')} value={period} onChange={setPeriod}
          options={['all', ...REPORT_PERIODS].map((p) => ({ value: p, label: t(`reports.period.${p}`) }))} />
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
      <View style={styles.resultRow}>
        <Text style={styles.resultText}>
          {waitingForDates ? t('reports.pickDates')
            : `${range ? rangeLabel(range) : t('reports.period.all')} · ${vegetableLabel(vegetable)} · ${tc('spoilage.shown', records.length, { kg: kg(data?.total_kg ?? 0) })}`}
        </Text>
        {filtered && (
          <TouchableOpacity onPress={resetFilters} accessibilityRole="button" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.resetText}>{t('spoilage.showAll')}</Text>
          </TouchableOpacity>
        )}
      </View>
      {records.length > 0 && (
        <View style={[styles.tableRow, styles.tableHead]} accessibilityRole="header">
          <Text style={[styles.headCell, styles.colMain]}>{t('chain.col.vegetableBatch')}</Text>
          <Text style={[styles.headCell, styles.colQty, narrow && styles.headCellNarrow]} {...fitOneLine}>{t('chain.col.qty')}</Text>
          <Text style={[styles.headCell, styles.colReason]}>{t('spoilage.reasonLabel')}</Text>
        </View>
      )}
    </View>
  );

  const renderItem = ({ item: record, index }) => (
    <View style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlt]}>
      <View style={styles.colMain}>
        <Text style={styles.cellTitle} numberOfLines={1}>{localizeVegetableName(record.vegetable_name, language)}</Text>
        <Text style={styles.cellMeta} numberOfLines={1}>{t('chain.col.batch')}: {String(record.batch_id).slice(0, 8)}</Text>
        <Text style={styles.cellMeta} numberOfLines={1}>{t('chain.col.farmer')}: {record.farmer_name || '—'}</Text>
        <Text style={styles.cellMeta} numberOfLines={1}>{t('spoilage.harvested', { date: shortDate(record.harvest_date) })}</Text>
        <Text style={styles.cellMeta} numberOfLines={1}>{t('spoilage.moved', { date: shortDate(record.recorded_at) })}</Text>
      </View>
      <Text style={[styles.cellNum, styles.colQty, narrow && styles.cellNumNarrow]} {...fitOneLine}>{kg(record.quantity_kg)}</Text>
      <Text style={[styles.reasonText, styles.colReason]}>{t(`spoilage.reason.${record.reason}`)}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('chain.spoiledProducts')} onBack={() => navigation.goBack()} />
      {/* The filters stay mounted while a new selection loads, as on View Reports. */}
      <FlatList
        data={loading ? [] : records}
        keyExtractor={(record) => record.id}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={header}
        ListEmptyComponent={loading ? <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 30 }} />
          : waitingForDates ? null : <EmptyState iconElement={<Ionicons name="leaf-outline" size={rf(44)} color={colors.inkFaint} />}
            title={filtered ? t('spoilage.emptyFilteredTitle') : t('spoilage.emptyTitle')}
            message={filtered ? t('spoilage.emptyFilteredMessage') : t('spoilage.emptyMessage')} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgScreen },
  content: { padding: 16, paddingBottom: 40, flexGrow: 1 },
  summary: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 16, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadowCard },
  summaryLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.inkSoft },
  summaryValue: { fontFamily: fonts.heading, fontSize: rf(28), color: colors.danger, marginTop: 4 },
  summaryRange: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkFaint, marginTop: 2 },
  // Filter layout from View Reports (ChainReportScreen).
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: spacing.md },
  filter: { flexGrow: 1, flexBasis: 150 },
  customRow: { flexDirection: 'row', gap: 10, marginBottom: spacing.sm },
  customField: { flex: 1, minWidth: 0 },
  fieldLabel: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkSoft, marginBottom: 4 },
  error: { fontFamily: fonts.bodyMedium, fontSize: rf(fontSize.sm), color: colors.danger, marginBottom: spacing.sm },
  resultRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: spacing.sm },
  resultText: { flexShrink: 1, fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.inkSoft },
  resetText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: PRIMARY },
  tableRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10, paddingHorizontal: 10, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  tableRowAlt: { backgroundColor: colors.bgScreen },
  tableHead: { borderTopWidth: 1, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, backgroundColor: colors.leaf50, paddingVertical: 8 },
  headCell: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkSoft },
  headCellNarrow: { fontSize: rf(fontSize.xs) - 2 },
  cellNumNarrow: { fontSize: rf(fontSize.sm) - 2 },
  colMain: { flex: 3, minWidth: 0 },
  colQty: { flex: 1.3, minWidth: 0, textAlign: 'right' },
  colReason: { flex: 1.8, minWidth: 0, textAlign: 'right' },
  reasonText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.danger },
  cellTitle: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink },
  cellMeta: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkSoft, marginTop: 2 },
  cellNum: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.sm), color: colors.ink },
});
