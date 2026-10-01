import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import api from '../../api/client';
import CustomModal from '../CustomModal';
import useRefreshOnFocus from '../../hooks/useRefreshOnFocus';
import useRequestLock from '../../hooks/useRequestLock';
import { kvGet, kvSet } from '../../offline/db';
import { rf } from '../../lib/responsive';
import { showAlert } from '../../lib/ui';
import { friendlyError } from '../../lib/errorMessages';
import { localizeVegetableName } from '../../lib/vegetableNames';
import { useTranslation } from '../../i18n/useTranslation';
import { colors, fontSize, fonts, radius, spacing, actionBtn, actionBtnOutline, actionBtnDanger, actionBtnText } from '../../theme/appTheme';

// Batches the distributor chose to keep selling; they are not shown again.
const KEEP_SELLING_KEY = 'stock_alerts_keep_selling';
const longDate = (value) => (value
  ? new Date(value).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' })
  : null);

/**
 * Distributor Home: batches on their 7th day in stock that still have stock
 * (7-day stock rule). The distributor keeps selling, changes the price (Stocks
 * edit) or discards the rest. Unsold stock moves to Spoiled Products on day 8.
 */
export default function StockAlertsCard({ navigation, onChanged }) {
  const { t, language } = useTranslation();
  const requestLock = useRequestLock();
  const [alerts, setAlerts] = useState([]);
  const [keepSelling, setKeepSelling] = useState([]);
  const [discarding, setDiscarding] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, kept] = await Promise.all([api.get('/api/distributor/stock-alerts'), kvGet(KEEP_SELLING_KEY).catch(() => null)]);
      setAlerts(Array.isArray(list) ? list : []);
      setKeepSelling(Array.isArray(kept) ? kept : []);
    } catch { /* The rest of Home stays usable when alerts cannot load. */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useRefreshOnFocus(load);

  const shown = alerts.filter((alert) => !keepSelling.includes(alert.batch_id));
  if (shown.length === 0 && !discarding) return null;

  const keep = async (alert) => {
    // Only batches still alerted are remembered, so the list never grows.
    const next = [...keepSelling.filter((id) => alerts.some((a) => a.batch_id === id)), alert.batch_id];
    setKeepSelling(next);
    await kvSet(KEEP_SELLING_KEY, next).catch(() => {});
  };

  const confirmDiscard = async () => {
    if (!requestLock.acquire('discard')) return;
    setBusy(true);
    try {
      const result = await api.post(`/api/products/${discarding.batch_id}/discard`);
      setDiscarding(null);
      await load();
      onChanged?.();
      showAlert(t('discard.doneTitle'), result?.spoilage?.reason === 'past_limit' ? t('discard.pastLimitMessage') : t('discard.doneMessage'));
    } catch (err) {
      showAlert(t('common.error'), friendlyError(err));
    } finally {
      requestLock.release('discard');
      setBusy(false);
    }
  };

  const describe = (alert) => {
    const name = localizeVegetableName(alert.vegetable_name, language);
    const harvested = longDate(alert.harvest_date);
    return harvested
      ? t('stockAlerts.message', { name, kg: alert.remaining_kg, date: harvested, days: alert.days_in_stock })
      : t('stockAlerts.messageNoHarvest', { name, kg: alert.remaining_kg, days: alert.days_in_stock });
  };

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.head}>
        <Ionicons name="alert-circle-outline" size={rf(20)} color={colors.gold700} />
        <Text style={styles.title}>{t('stockAlerts.title')}</Text>
      </View>
      <Text style={styles.subtitle}>{t('stockAlerts.subtitle')}</Text>
      {shown.map((alert) => (
        <View key={alert.batch_id} style={styles.item}>
          <Text style={styles.message}>{describe(alert)}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => keep(alert)} accessibilityRole="button">
              <Text style={styles.btnOutlineText}>{t('stockAlerts.keepSelling')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnOutline]} accessibilityRole="button"
              onPress={() => navigation.navigate('Stocks', { editBatchId: alert.batch_id })}>
              <Text style={styles.btnOutlineText}>{t('stockAlerts.changePrice')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.btnDanger]} onPress={() => setDiscarding(alert)} accessibilityRole="button">
              <Text style={styles.btnDangerText}>{t('discard.button')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <CustomModal
        visible={!!discarding}
        title={t('discard.title')}
        confirmLabel={t('discard.button')}
        onConfirm={confirmDiscard}
        cancelLabel={t('common.cancel')}
        onCancel={() => setDiscarding(null)}
        busy={busy}
        danger
      >
        {!!discarding && (
          <Text style={styles.confirmText}>
            {t('discard.confirm', { kg: discarding.remaining_kg, name: localizeVegetableName(discarding.vegetable_name, language) })}
          </Text>
        )}
      </CustomModal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.gold100, borderRadius: radius.card, padding: 14, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.gold300 || colors.border },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.bodyBold, fontSize: rf(fontSize.lg), color: colors.ink },
  subtitle: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: 4 },
  item: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  message: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink, lineHeight: rf(20) },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 10 },
  btn: { ...actionBtn, flexGrow: 1, minHeight: 36 },
  btnOutline: actionBtnOutline,
  btnOutlineText: { ...actionBtnText, color: colors.leaf700 },
  btnDanger: actionBtnDanger,
  btnDangerText: { ...actionBtnText, color: colors.danger },
  confirmText: { fontFamily: fonts.body, fontSize: rf(fontSize.md), color: colors.ink, lineHeight: rf(21) },
});
