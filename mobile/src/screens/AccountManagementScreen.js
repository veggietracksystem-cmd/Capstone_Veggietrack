import { rf } from '../lib/responsive';
import { useState, useEffect, useRef } from 'react';
import { Text, View, ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuthButton, AuthInput, authStyles as s } from '../components/AuthForm';
import CustomModal from '../components/CustomModal';
import ScreenHeader from '../components/ScreenHeader';
import { FilterChips } from '../components/ui/SegmentedTabs';
import StatusBadge from '../components/ui/StatusBadge';
import { colors, control, fonts, fontSize, radius, shadowCard, spacing, typography } from '../theme/appTheme';
import { api } from '../api/client';
import { friendlyError } from '../lib/errorMessages';
import { roleLabel } from '../lib/roles';
import { useTranslation } from '../i18n/useTranslation';

// Distributor User Management: approve, decline, disable and reactivate accounts.
// Accounts are disabled only here, never by the account owner.
const FILTERS = [
  { value: 'pending_approval', labelKey: 'acct.filterPending' },
  { value: 'active', labelKey: 'acct.filterActive' },
  { value: 'declined', labelKey: 'acct.filterDeclined' },
  { value: 'disabled', labelKey: 'acct.filterDisabled' },
  { value: 'unverified', labelKey: 'acct.filterUnverified' },
];

// Each action is confirmed in its own modal. Decline and disable need a reason, which
// the user sees on the account status screen at sign-in. Approve takes no message
// (the user gets the standard approval notification); turn back on takes an
// optional message, sent with its in-app notification.
const ACTION_WORDING = {
  APPROVED: { verbKey: 'acct.verbApprove', titleKey: 'acct.approveTitle', buttonKey: 'acct.approve', hintKey: 'acct.approveHint' },
  DECLINED: { verbKey: 'acct.verbDecline', titleKey: 'acct.declineTitle', buttonKey: 'acct.decline', inputKey: 'acct.reasonDecline', hintKey: 'acct.reasonHint', required: true, danger: true },
  DISABLED: { verbKey: 'acct.verbDisable', titleKey: 'acct.disableTitle', buttonKey: 'acct.disable', inputKey: 'acct.reasonDisable', hintKey: 'acct.reasonHint', required: true, danger: true },
  REACTIVATED: { verbKey: 'acct.verbTurnOn', titleKey: 'acct.turnOnTitle', buttonKey: 'acct.turnOn', inputKey: 'acct.messageOptional', hintKey: 'acct.messageHint' },
};
const formatDay = (value) => (value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

export default function AccountManagementScreen({ navigation }) {
  const { t } = useTranslation();
  // Screen skips the bottom safe-area edge, so pad the scroll content instead.
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState('pending_approval');
  const [users, setUsers] = useState([]);
  const [pendingCount, setPendingCount] = useState(0); // last known size of the approval queue
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The action being confirmed ({ user, action }) and what the distributor typed for it.
  const [pending, setPending] = useState(null);
  const [note, setNote] = useState('');
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

  const openAction = (user, action) => { setError(''); setNote(''); setPending({ user, action }); };
  const closeAction = () => { if (!busy) setPending(null); };
  const wording = pending ? ACTION_WORDING[pending.action] : null;
  const trimmedNote = note.trim();
  const submitAction = async () => {
    if (!pending || lock.current || (wording.required && !trimmedNote)) return;
    const { user, action } = pending;
    lock.current = true; setBusy(true); setError('');
    try {
      const body = { action, version: user.status_version };
      if (wording.inputKey) body.reason = trimmedNote || null;
      await api.post(`/api/accounts/${user.id}/transition`, body);
      setPending(null);
      await load();
    } catch (e) {
      // The modal stays open with the typed text so the action can be retried.
      setError(friendlyError(e, t('acct.updateFailed')));
    } finally {
      lock.current = false; setBusy(false);
    }
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
            {/* The latest action on this account and its reason or message, from account_audit. */}
            {/* Approvals carry no message; older approval messages are not shown. */}
            {!!((u.last_action?.reason && u.last_action.action !== 'APPROVED') || u.status_reason) && (
              <View style={styles.lastAction}>
                <Text style={styles.lastActionHead}>
                  {u.last_action ? `${t(`acct.actionName.${u.last_action.action}`)} · ${formatDay(u.last_action.created_at)}` : t(`status.${u.account_status}`)}
                </Text>
                <Text style={styles.lastActionText}>
                  {['DECLINED', 'DISABLED'].includes(u.last_action?.action) || !u.last_action
                    ? t('acct.reasonLine', { reason: u.last_action?.reason || u.status_reason })
                    : t('acct.messageLine', { message: u.last_action.reason })}
                </Text>
              </View>
            )}
            {!!u.unfinished_assignments?.length && (
              <Text style={[s.error, styles.warning]}>
                {u.unfinished_assignments.length === 1 ? t('acct.unfinishedOne') : t('acct.unfinishedMany', { n: u.unfinished_assignments.length })}
              </Text>
            )}

            {status === 'pending_approval' && (
              <View style={styles.actionRow}>
                <View style={styles.actionSlot}>
                  <AuthButton title={t('acct.approve')} size="sm" disabled={busy} onPress={() => openAction(u, 'APPROVED')} />
                </View>
                <View style={styles.actionSlot}>
                  <AuthButton title={t('acct.decline')} size="sm" variant="danger" disabled={busy} onPress={() => openAction(u, 'DECLINED')} />
                </View>
              </View>
            )}
            {status === 'active' && (
              <View style={styles.actionRow}>
                <View style={styles.actionSlot}>
                  <AuthButton title={t('acct.disable')} size="sm" variant="danger" disabled={busy} onPress={() => openAction(u, 'DISABLED')} />
                </View>
              </View>
            )}
            {status === 'disabled' && (
              <>
                <View style={styles.actionRow}>
                  <View style={styles.actionSlot}>
                    <AuthButton title={t('acct.turnOn')} size="sm" disabled={busy} onPress={() => openAction(u, 'REACTIVATED')} />
                  </View>
                </View>
                <Text style={styles.meta}>{t('acct.signInAgain')}</Text>
              </>
            )}
          </View>
        ))}
      </ScrollView>

      <CustomModal
        visible={!!pending}
        title={wording ? t(wording.titleKey) : ''}
        onCancel={closeAction}
        onConfirm={submitAction}
        confirmLabel={wording ? t(wording.buttonKey) : undefined}
        confirmDisabled={!!wording?.required && !trimmedNote}
        danger={!!wording?.danger}
        busy={busy}
      >
        {!!pending && (
          <>
            <Text style={styles.modalText}>{t(wording.verbKey, { name: pending.user.full_name })}</Text>
            {!!wording.inputKey && (
              <>
                <Text style={styles.inputLabel}>{t(wording.inputKey)}</Text>
                <AuthInput
                  style={styles.noteInput}
                  value={note}
                  onChangeText={setNote}
                  maxLength={500}
                  multiline
                  autoCapitalize="sentences"
                  accessibilityLabel={t(wording.inputKey)}
                />
              </>
            )}
            <Text style={styles.inputHint}>{t(wording.hintKey)}</Text>
            {!!error && <Text style={[s.error, styles.modalError]} accessibilityRole="alert">{error}</Text>}
          </>
        )}
      </CustomModal>
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
  actionSlot: { flex: 1 },
  name: { ...typography.cardTitle, flex: 1, color: colors.ink },
  role: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.leaf700, marginTop: 2 },
  meta: { fontFamily: fonts.body, fontSize: rf(fontSize.sm), color: colors.inkSoft, marginTop: spacing.xs },
  warning: { marginVertical: spacing.sm },
  lastAction: { marginTop: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.ctrl, backgroundColor: colors.bgScreen, borderWidth: 1, borderColor: colors.border },
  lastActionHead: { ...typography.smallLabel, color: colors.inkFaint },
  lastActionText: { ...typography.body, color: colors.ink, marginTop: 2 },
  modalText: { ...typography.body, color: colors.ink, marginBottom: spacing.md },
  inputLabel: { ...typography.label, color: colors.labelInk, marginBottom: 6 },
  noteInput: { marginBottom: 6, minHeight: 88, textAlignVertical: 'top' },
  inputHint: { ...typography.helper, color: colors.inkSoft },
  modalError: { marginBottom: 0 },
  errorText: { marginTop: 0 },
  loader: { marginTop: spacing.lg },
  emptyNote: { textAlign: 'center', marginTop: spacing.xl },
});
