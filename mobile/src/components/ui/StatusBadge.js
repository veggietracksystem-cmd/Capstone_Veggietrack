import { rf } from '../../lib/responsive';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, fontSize, radius } from '../../theme/appTheme';
import { useTranslation } from '../../i18n/useTranslation';

// One status color system for the whole app (display-only - callers keep their
// own business logic and just pass the status string through):
//   done     solid dark green, white text     - completed / active / paid
//   progress solid medium green, white text   - approved, assigned, on the way
//   pending  light green, dark green text     - waiting / not yet started
//   danger   light red, red text              - declined, cancelled, disabled, out of stock
//   neutral  soft gray, dark text             - informational / unknown
const TONES = {
  done: { bg: colors.leaf700, fg: '#fff' },
  progress: { bg: colors.leaf500, fg: '#fff' },
  pending: { bg: colors.leaf100, fg: colors.leaf700 },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  neutral: { bg: colors.soil300, fg: colors.soil800 },
};

// Common status strings used across accounts/orders/pickups/deliveries in
// this app. Anything not listed falls back to a neutral tone with the raw
// status text - never breaks on values that go through this that we didn't
// enumerate.
const STATUS_TONE = {
  unverified: 'neutral',
  pending_approval: 'pending',
  pending: 'pending',
  unpaid: 'pending',
  for_pickup: 'pending',
  available: 'pending',
  reserved: 'pending',
  approved: 'progress',
  assigned: 'progress',
  otw: 'progress',
  picked_up: 'progress',
  in_transit: 'progress',
  out_for_delivery: 'progress',
  active: 'done',
  delivered: 'done',
  completed: 'done',
  paid: 'done',
  declined: 'danger',
  disabled: 'danger',
  cancelled: 'danger',
  rejected: 'danger',
  out_of_stock: 'danger',
};

// One badge size everywhere. `compact` is accepted for existing callers but no
// longer changes the size, so badges look identical across every screen.
export default function StatusBadge({ status, label }) {
  const { t } = useTranslation();
  const tone = TONES[STATUS_TONE[status]] || TONES.neutral;
  const known = STATUS_TONE[status] ? t(`status.${status}`) : null;
  const text = label || known || String(status || '').replace(/_/g, ' ');
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.text, { color: tone.fg }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.ctrl,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 24,
    justifyContent: 'center',
  },
  text: {
    fontFamily: fonts.bodySemiBold,
    fontSize: rf(fontSize.xs),
    lineHeight: 16,
    textTransform: 'capitalize',
    textAlign: 'center',
  },
});
