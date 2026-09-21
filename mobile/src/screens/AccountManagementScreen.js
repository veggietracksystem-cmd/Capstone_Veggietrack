import { rf } from '../lib/responsive';
import { useState, useEffect, useRef } from 'react';
import { Text, View, ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

// The distributor's User Management screen: approve, decline, disable and
// reactivate other people's accounts. This is the only place an account is
// disabled - a user never disables their own from their profile.
const FILTERS = [
  { value: 'pending_approval', label: 'Waiting for approval' },
  { value: 'active', label: 'Active' },
  { value: 'declined', label: 'Declined' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'unverified', label: 'Not confirmed' },
];

// What each action is called where the distributor can see it, so the confirm
// box reads like a sentence instead of a status code.
const ACTION_WORDING = {
  APPROVED: { verb: 'Approve', title: 'Approve this account?' },
  DECLINED: { verb: 'Decline', title: 'Decline this account?' },
  DISABLED: { verb: 'Disable', title: 'Disable this account?' },
  REACTIVATED: { verb: 'Turn back on', title: 'Turn this account back on?' },
};

export default function AccountManagementScreen({ navigation }) {
  const [status, setStatus] = useState('pending_approval');
  const [users, setUsers] = useState([]);
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
      if (version === generation.current) setUsers(rows);
    } catch (e) {
      if (version === generation.current) setError(friendlyError(e, 'We couldn’t load these accounts right now.'));
    } finally {
      if (version === generation.current) setLoading(false);
    }
  };

  useEffect(() => { setUsers([]); void load(); return () => { generation.current++; }; }, [status]);

  const act = (user, action) => {
    const reason = (reasons[user.id] || '').trim();
    const wording = ACTION_WORDING[action];
    if (['DECLINED', 'DISABLED'].includes(action) && !reason) {
      setError('Please write a short reason first. This user will see it.');
      return;
    }
    confirmAction(
      wording.title,
      `${wording.verb} ${user.full_name}.${reason ? `\n\nReason they will see: ${reason}` : ''}`,
      async () => {
        if (lock.current) return;
        lock.current = true; setBusy(true); setError('');
        try {
          await api.post(`/api/accounts/${user.id}/transition`, { action, reason, version: user.status_version });
          await load();
        } catch (e) {
          setError(friendlyError(e, 'We couldn’t update this account. Please try again.'));
        } finally {
          lock.current = false; setBusy(false);
        }
      },
    );
  };

  return (
    <SafeAreaView style={styles.page} edges={['top', 'left', 'right']}>
      <ScreenHeader
        title="User Management"
        onBack={() => navigation.goBack()}
        right={(
          <TouchableOpacity
            onPress={load}
            disabled={busy || loading}
            accessibilityRole="button"
            accessibilityLabel="Refresh"
            style={styles.headerBtn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="refresh-outline" size={rf(20)} color={colors.leaf700} />
          </TouchableOpacity>
        )}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* No second "Accounts" title here - the header already says what
            this screen is. The chips scroll sideways so the longer labels
            stay readable instead of being squeezed together. */}
        <FilterChips options={FILTERS} value={status} onChange={setStatus} disabled={busy} />

        {!!error && <Text style={[s.error, styles.errorText]} accessibilityRole="alert">{error}</Text>}
        {loading && <ActivityIndicator accessibilityLabel="Loading accounts" color={colors.leaf700} style={styles.loader} />}
        {!loading && !users.length && <Text style={[s.note, styles.emptyNote]}>There are no accounts in this list.</Text>}

        {users.map((u) => (
          <View key={u.id} style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.name}>{u.full_name}</Text>
              <StatusBadge status={u.account_status || status} />
            </View>
            <Text style={styles.role}>{roleLabel(u.role)}</Text>
            <Text style={styles.meta}>{u.email} · {u.legacy_access ? 'Existing account' : 'Email confirmed'}</Text>
            {!!(u.farm_location || u.store_location || u.service_area) && (
              <Text style={styles.meta}>{u.farm_location || u.store_location || u.service_area}</Text>
            )}
            <Text style={styles.meta}>Applied: {new Date(u.created_at).toLocaleString()}</Text>
            {!!u.status_reason && <Text style={styles.meta}>{u.status_reason}</Text>}
            {!!u.unfinished_assignments?.length && (
              <Text style={[s.error, styles.warning]}>
                This user still has {u.unfinished_assignments.length} unfinished {u.unfinished_assignments.length === 1 ? 'job' : 'jobs'}.
                Please reassign {u.unfinished_assignments.length === 1 ? 'it' : 'them'} before disabling this account.
              </Text>
            )}

            {['active', 'pending_approval'].includes(status) && (
              <AuthInput
                style={styles.reasonInput}
                placeholder="Reason (this user will see it)"
                maxLength={500}
                value={reasons[u.id] || ''}
                onChangeText={(v) => setReasons((r) => ({ ...r, [u.id]: v }))}
              />
            )}

            {status === 'pending_approval' && (
              <View style={styles.actionRow}>
                <View style={styles.actionSlot}>
                  <AuthButton title="Approve" size="sm" disabled={busy} onPress={() => act(u, 'APPROVED')} />
                </View>
                <View style={styles.actionSlot}>
                  <AuthButton title="Decline" size="sm" variant="danger" disabled={busy} onPress={() => act(u, 'DECLINED')} />
                </View>
              </View>
            )}
            {status === 'active' && (
              <View style={styles.actionRow}>
                <View style={styles.actionSlot}>
                  <AuthButton title="Disable" size="sm" variant="danger" disabled={busy} onPress={() => act(u, 'DISABLED')} />
                </View>
              </View>
            )}
            {status === 'disabled' && (
              <>
                <View style={styles.actionRow}>
                  <View style={styles.actionSlot}>
                    <AuthButton title="Turn back on" size="sm" disabled={busy} onPress={() => act(u, 'REACTIVATED')} />
                  </View>
                </View>
                <Text style={styles.meta}>They will need to sign in again.</Text>
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
    backgroundColor: colors.card,
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
