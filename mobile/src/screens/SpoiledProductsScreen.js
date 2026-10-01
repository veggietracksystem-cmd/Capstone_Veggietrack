import useLatestRequest from '../hooks/useLatestRequest';
import useRefreshOnFocus from '../hooks/useRefreshOnFocus';
import { rf } from '../lib/responsive';
import { useState, useEffect, useCallback } from 'react';
import { Text, View, FlatList, ActivityIndicator, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import api from '../api/client';
import EmptyState from '../components/EmptyState';
import ScreenHeader from '../components/ScreenHeader';
import { showAlert } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { localizeVegetableName } from '../lib/vegetableNames';
import { rangeLabel } from '../lib/reportPeriods';
import { colors, fontSize, fonts, radius, shadowCard, spacing } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

const PRIMARY = colors.leaf700;
const kg = (value) => (value != null ? `${Number(value)} kg` : '—');
const shortDate = (value) => (value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

/**
 * Vegetable Chain Tracking > Spoiled Products: stock that can no longer be sold,
 * either discarded by the distributor or past the 7-day spoilage limit. Every
 * row traces back to its original batch.
 */
export default function SpoiledProductsScreen({ navigation }) {
  const beginRead = useLatestRequest();
  const { t, language } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const isCurrent = beginRead('spoilage');
    try {
      const result = await api.get('/api/distributor/spoilage');
      if (isCurrent()) setData(result);
    } catch (err) {
      if (isCurrent()) showAlert(t('common.error'), friendlyError(err));
    }
  }, [t]);
  useEffect(() => { (async () => { setLoading(true); await load(); setLoading(false); })(); }, [load]);
  useRefreshOnFocus(load);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const records = data?.records || [];
  const week = data?.this_week;

  const header = (
    <View>
      <View style={styles.summary} accessibilityRole="summary">
        <Text style={styles.summaryLabel}>{t('spoilage.thisWeek')}</Text>
        <Text style={styles.summaryValue}>{kg(week?.kg ?? 0)}</Text>
        {!!week && <Text style={styles.summaryRange}>{rangeLabel({ from: week.from, to: week.to })}</Text>}
      </View>
      {records.length > 0 && (
        <View style={[styles.tableRow, styles.tableHead]} accessibilityRole="header">
          <Text style={[styles.headCell, styles.colMain]}>{t('chain.col.vegetableBatch')}</Text>
          <Text style={[styles.headCell, styles.colQty]}>{t('chain.col.qty')}</Text>
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
      <Text style={[styles.cellNum, styles.colQty]}>{kg(record.quantity_kg)}</Text>
      <Text style={[styles.reasonText, styles.colReason]}>{t(`spoilage.reason.${record.reason}`)}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader title={t('chain.spoiledProducts')} onBack={() => navigation.goBack()} />
      {loading ? <ActivityIndicator size="large" color={PRIMARY} style={{ marginTop: 40 }} /> : (
        <FlatList
          data={records}
          keyExtractor={(record) => record.id}
          renderItem={renderItem}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState iconElement={<Ionicons name="leaf-outline" size={rf(44)} color={colors.inkFaint} />}
            title={t('spoilage.emptyTitle')} message={t('spoilage.emptyMessage')} />}
        />
      )}
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
  tableRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10, paddingHorizontal: 10, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  tableRowAlt: { backgroundColor: colors.bgScreen },
  tableHead: { borderTopWidth: 1, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card, backgroundColor: colors.leaf50, paddingVertical: 8 },
  headCell: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkSoft },
  colMain: { flex: 3, minWidth: 0 },
  colQty: { flex: 1.1, minWidth: 0, textAlign: 'right' },
  colReason: { flex: 2, minWidth: 0, textAlign: 'right' },
  reasonText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.danger },
  cellTitle: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink },
  cellMeta: { fontFamily: fonts.body, fontSize: rf(fontSize.xs), color: colors.inkSoft, marginTop: 2 },
  cellNum: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.sm), color: colors.ink },
});
