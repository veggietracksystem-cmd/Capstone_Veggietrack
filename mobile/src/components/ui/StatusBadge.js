import { rf } from '../../lib/responsive';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, fontSize, radius } from '../../theme/appTheme';

// Display-only mapping from a status string to a themed color + label.
// Does not decide which statuses exist or when they change - callers keep
// their own business logic and just pass the status string through.
const TONES = {
  neutral: { bg: colors.soil300, fg: colors.soil800 },
  info: { bg: colors.infoSoft, fg: colors.info },
  warning: { bg: colors.gold100, fg: colors.gold700 },
  success: { bg: colors.leaf100, fg: colors.leaf700 },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  purple: { bg: colors.purpleSoft, fg: colors.purple },
};

// Common status strings used across accounts/orders/pickups/deliveries in
// this app. Anything not listed falls back to a neutral tone with the raw
// status text - never breaks on values that go through this that we didn't
// enumerate.
const STATUS_TONE = {
  unverified: 'neutral',
  pending_approval: 'warning',
  pending: 'warning',
  active: 'success',
  approved: 'info',
  assigned: 'info',
  picked_up: 'info',
  in_transit: 'purple',
  out_for_delivery: 'purple',
  delivered: 'success',
  completed: 'success',
  declined: 'danger',
  disabled: 'danger',
  cancelled: 'danger',
  rejected: 'danger',
};

export default function StatusBadge({ status, label }) {
  const tone = TONES[STATUS_TONE[status]] || TONES.neutral;
  const text = label || String(status || '').replace(/_/g, ' ');
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
  },
  text: {
    fontFamily: fonts.bodySemiBold,
    fontSize: rf(fontSize.xs),
    textTransform: 'capitalize',
  },
});
