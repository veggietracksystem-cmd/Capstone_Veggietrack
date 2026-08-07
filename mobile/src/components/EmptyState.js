import { rf } from '../lib/responsive';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, fonts, radius } from '../theme/appTheme';

const PRIMARY = colors.leaf700;

/**
 * Reusable empty-state placeholder for any list that can be empty.
 *
 * Props:
 *  - icon:     emoji/string shown above the title (default 🌱)
 *  - title:    bold headline (e.g. "No harvests yet")
 *  - message:  optional secondary line (e.g. "Tap + to add one.")
 *  - actionLabel + onAction: optional call-to-action button
 *
 * Usage:
 *   {list.length === 0
 *     ? <EmptyState icon="🥬" title="No harvests yet" message="Tap “Add Harvest Update”." />
 *     : list.map(...)}
 */
export default function EmptyState({ icon = '🌱', title, message, actionLabel, onAction }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.icon}>{icon}</Text>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.button} onPress={onAction} activeOpacity={0.85}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40, paddingHorizontal: 24 },
  icon: { fontSize: rf(44), marginBottom: 12 },
  title: { fontFamily: fonts.bodyBold, fontSize: rf(15), color: colors.inkSoft, textAlign: 'center' },
  message: { fontFamily: fonts.body, fontSize: rf(13.5), color: colors.inkFaint, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  button: { marginTop: 16, backgroundColor: PRIMARY, paddingVertical: 12, paddingHorizontal: 22, borderRadius: radius.ctrl },
  buttonText: { fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: rf(14) },
});
