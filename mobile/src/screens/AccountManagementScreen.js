import { rf } from '../lib/responsive';
import { useState, useEffect, useRef } from 'react';
import { Text, View, ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthButton, AuthInput, authStyles as s } from '../components/AuthForm';
import ScreenHeader from '../components/ScreenHeader';
import { FilterChips } from '../components/ui/SegmentedTabs';
import StatusBadge from '../components/ui/StatusBadge';
import { colors, control, fonts, fontSize, radius, shadowCard, spacing } from '../theme/appTheme';
import { api } from '../api/client';
import { confirmAction } from '../lib/ui';
import { friendlyError } from '../lib/errorMessages';
import { roleLabel } from '../lib/roles';
import { useTranslation } from '../i18n/useTranslation';

// The distributor's User Management screen: approve, decline, disable and
// reactivate other people's accounts. This is the only place an account is
// disabled - a user never disables their own from their profile.
const FILTERS = [
  { value: 'pending_approval', labelKey: 'acct.filterPending' },
  { value: 'active', labelKey: 'acct.filterActive' },
  { value: 'declined', labelKey: 'acct.filterDeclined' },
  { value: 'disabled', labelKey: 'acct.filterDisabled' },
  { value: 'unverified', labelKey: 'acct.filterUnverified' },
];

// What each action is called where the distributor can see it, so the confirm
// box reads like a sentence instead of a status code.
const ACTION_WORDING = {
  APPROVED: { verbKey: 'acct.verbApprove', titleKey: 'acct.approveTitle' },
  DECLINED: { verbKey: 'acct.verbDecline', titleKey: 'acct.declineTitle' },
  DISABLED: { verbKey: 'acct.verbDisable', titleKey: 'acct.disableTitle' },
  REACTIVATED: { verbKey: 'acct.verbTurnOn', titleKey: 'acct.turnOnTitle' },
};


export default function AccountManagementScreen({ navigation }) {
  const { t } = useTranslation();
  // Screen skips the bottom safe-area edge, so pad the scroll content instead.
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState('pending_approval');
  const [users, setUsers] = useState([]);
  const [pendingCount, setPendingCount] = useState(0); // last known size of the approval queue
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState({});
  const [loading, setLoading] = useState(false);
  const lock = useRef(false), generation = useRef(0);

  const load = async () => {
    const version = ++generation.current;
    setError(''); setLoading(true);
    try {
      const rows = await api.get(`/api/accounts?status=${status}`);
      if (version === generation.current) {
        setUsers(rows);
        if (status === 'pending_approval') setPendingCount(rows.length);
      }
    } catch (e) {
      if (version === generation.current) setError(friendlyError(e, t('acct.loadFailed')));
    } finally {
      if (version === generation.current) setLoading(false);
    }
  };

  useEffect(() => { setUsers([]); void load(); return () => { generation.current++; }; }, [status]);

  const act = (user, action) => {
    const reason = (reasons[user.id] || '').trim();
    const wording = ACTION_WORDING[action];
    if (['DECLINED', 'DISABLED'].includes(action) && !reason) {
      setError(t('acct.reasonFirst'));
      return;
    }
    confirmAction(
      t(wording.titleKey),
      `${t(wording.verbKey, { name: user.full_name })}${reason ? `\n\n${t('acct.reasonShown', { reason })}` : ''}`,
      async () => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError('');
        try {
          await api.post(`/api/accounts/${user.id}/transition`, { action, reason, version: user.status_version });
          await load();
        } catch (e) {
          setError(friendlyError(e, t('acct.updateFailed')));
        } finally {
          lock.current = false; setBusy(false);
        }
      },
    );
  };

  return (
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
      <ScreenHeader
        title={t('acct.title')}
        onBack={() => navigation.goBack()}
        right={(
          <TouchableOpacity
            onPress={load}
            disabled={busy || loading}
            accessibilityRole="button"
            accessibilityLabel={t('acct.refresh')}
            style={styles.headerBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="refresh-outline" size={rf(20)} color={colors.leaf700} />
          </TouchableOpacity>
        )}
      />
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        {/* No second "Accounts" title here - the header already says what
            this screen is. The chips scroll sideways so the longer labels
            stay readable instead of being squeezed together. */}
        <FilterChips options={FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey), count: f.value === 'pending_approval' ? pendingCount : 0 }))} value={status} onChange={setStatus} disabled={busy} />

        {!!error && <Text style={[s.error, styles.errorText]} accessibilityRole="alert">{error}</Text>}
        {loading && <ActivityIndicator accessibilityLabel={t('acct.loading')} color={colors.leaf700} style={styles.loader} />}
        {!loading && !users.length && <Text style={[s.note, styles.emptyNote]}>{t('acct.empty')}</Text>}

        {users.map((u) => (
          <View key={u.id} style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.name}>{u.full_name}</Text>
              <StatusBadge status={u.account_status || status} />
            </View>
            <Text style={styles.role}>{roleLabel(u.role)}</Text>
            <Text style={styles.meta}>{u.email} · {u.legacy_access ? t('acct.legacy') : t('acct.emailConfirmed')}</Text>
            {!!(u.farm_location || u.store_location || u.service_area) && (
              <Text style={styles.meta}>{u.farm_location || u.store_location || u.service_area}</Text>
            )}
            <Text style={styles.meta}>{t('acct.applied', { date: new Date(u.created_at).toLocaleString() })}</Text>
            {!!u.status_reason && <Text style={styles.meta}>{u.status_reason}</Text>}
            {!!u.unfinished_assignments?.length && (
              <Text style={[s.error, styles.warning]}>
                {u.unfinished_assignments.length === 1 ? t('acct.unfinishedOne') : t('acct.unfinishedMany', { n: u.unfinished_assignments.length })}
              </Text>
            )}

            {['active', 'pending_approval'].includes(status) && (
              <AuthInput
                style={styles.reasonInput}
                placeholder={t('acct.reasonPh')}
                maxLength={500}
                value={reasons[u.id] || ''}
                onChangeText={(v) => setReasons((r) => ({ ...r, [u.id]: v }))}
              />
            )}

            {status === 'pending_approval' && (
              <View style={styles.actionRow}>
                <View style={styles.actionSlot}>
                  <AuthButton title={t('acct.approve')} size="sm" disabled={busy} onPress={() => act(u, 'APPROVED')} />
                </View>
                <View style={styles.actionSlot}>
                  <AuthButton title={t('acct.decline')} size="sm" variant="danger" disabled={busy} onPress={() => act(u, 'DECLINED')} />
                </View>
              </View>
            )}
            {status === 'active' && (
              <View style={styles.actionRow}>
                <View style={styles.actionSlot}>
                  <AuthButton title={t('acct.disable')} size="sm" variant="danger" disabled={busy} onPress={() => act(u, 'DISABLED')} />
                </View>
              </View>
            )}
            {status === 'disabled' && (
              <>
                <View style={styles.actionRow}>
                  <View style={styles.actionSlot}>
                    <AuthButton title={t('acct.turnOn')} size="sm" disabled={busy} onPress={() => act(u, 'REACTIVATED')} />
                  </View>
                </View>
                <Text style={styles.meta}>{t('acct.signInAgain')}</Text>
              </>
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bgScreen },
  content: { padding: spacing.lg, paddingBottom: 40 },
  headerBtn: {
    width: control.minTouch, height: control.minTouch,
    alignItems: 'center', justifyContent: 'center',
  },
  card: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadowCard,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  // Each button fills its own half of the row, so Approve/Decline are the
  // same width instead of hugging their own labels.
  actionSlot: { flex: 1 },
  name: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink },
  role: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.leaf700, marginTop: 2 },
  meta: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: spacing.xs },
  warning: { marginVertical: spacing.sm },
  reasonInput: { marginTop: spacing.md, marginBottom: 0 },
  errorText: { marginTop: 0 },
  loader: { marginTop: spacing.lg },
  emptyNote: { textAlign: 'center', marginTop: spacing.xl },
});
