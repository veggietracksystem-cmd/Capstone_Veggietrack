import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { rf } from '../../lib/responsive';
import { colors, control, fonts, fontSize, spacing } from '../../theme/appTheme';

// Shared filter-row components. Selected and unselected tabs are the same size;
// only the colours change, so selecting a tab never shifts the row.

// Count pill shared by every filter tab and chip. Hidden when the count is 0.
function CountBadge({ count }) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return (
    <View style={styles.badge} accessibilityLabel={`${n} new`}>
      <Text style={styles.badgeText}>{n > 9 ? '9+' : n}</Text>
    </View>
  );
}

// Options use { value, label, count? }; scroll lets long labels retain their width.
export function SegmentedTabs({ options, value, onChange, scroll = false, inset = 0, style, disabled = false }) {
  const tabs = options.map((option) => {
    const selected = option.value === value;
    return (
      <TouchableOpacity
        key={option.value}
        style={[styles.tab, !scroll && styles.tabEven, scroll && styles.tabScroll, selected && styles.tabSelected]}
        onPress={() => onChange(option.value)}
        disabled={disabled}
        activeOpacity={0.8}
        accessibilityRole="tab"
        accessibilityState={{ selected, disabled }}
      >
        <View style={[styles.labelRow, scroll && Number(option.count) > 0 && styles.labelRowBadge]}>
          <Text
            style={[styles.tabText, selected && styles.tabTextSelected, styles.labelShrink]}
            numberOfLines={scroll ? 1 : 2}
          >
            {option.label}
          </Text>
          <CountBadge count={option.count} />
        </View>
      </TouchableOpacity>
    );
  });

  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.track, styles.trackScroll, style]}
        contentContainerStyle={[styles.trackScrollContent, inset ? { paddingHorizontal: inset } : null]}
      >
        {tabs}
      </ScrollView>
    );
  }
  return <View style={[styles.track, style]}>{tabs}</View>;
}

// inset pads the scrolled content so a row can run to the screen edges.
export function FilterChips({ options, value, onChange, disabled = false, style, inset = 0 }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.chipRow, style]}
      contentContainerStyle={[styles.chipRowContent, inset ? { paddingHorizontal: inset } : null]}
      keyboardShouldPersistTaps="handled"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.chip, selected && styles.chipSelected]}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected, disabled }}
          >
            <View style={[styles.labelRow, Number(option.count) > 0 && styles.labelRowBadge]}>
              <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
                {option.label}
              </Text>
              <CountBadge count={option.count} />
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export default SegmentedTabs;

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  trackScroll: { flexGrow: 0 },
  trackScrollContent: { alignItems: 'center', gap: spacing.sm, paddingRight: spacing.xs },
  // minHeight lets longer translations wrap while tabs in a row keep equal height.
  tab: {
    minHeight: control.heightSm,
    paddingVertical: 4,
    borderRadius: control.heightSm / 2,
    borderWidth: 1,
    borderColor: colors.leaf700,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: control.paddingH,
  },
  tabEven: { flex: 1 },
  tabScroll: { paddingHorizontal: control.paddingH },
  tabSelected: { backgroundColor: colors.leaf700, borderColor: colors.leaf700 },
  tabText: {
    fontFamily: fonts.bodySemiBold,
    color: colors.leaf700,
    fontSize: rf(fontSize.sm),
    textAlign: 'center',
  },
  tabTextSelected: { color: '#fff' },

  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', maxWidth: '100%' },
  // Content-sized tabs grow to fit the badge without moving the label.
  labelRowBadge: { marginRight: 8 },
  labelShrink: { flexShrink: 1 },
  // Small red circle pinned to the label's top-right corner.
  badge: {
    position: 'absolute', top: -6, left: '100%', marginLeft: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { fontFamily: fonts.bodyBold, color: '#fff', fontSize: rf(11), lineHeight: rf(13), includeFontPadding: false },

  chipRow: { flexGrow: 0, marginBottom: spacing.md },
  chipRowContent: { gap: spacing.sm, alignItems: 'center', paddingRight: spacing.xs },
  chip: {
    height: control.heightSm,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: control.paddingH,
    borderRadius: control.heightSm / 2,
    borderWidth: 1,
    borderColor: colors.leaf700,
    backgroundColor: colors.card,
  },
  chipSelected: { backgroundColor: colors.leaf700, borderColor: colors.leaf700 },
  chipText: {
    fontFamily: fonts.bodySemiBold,
    color: colors.leaf700,
    fontSize: rf(fontSize.sm),
    textAlign: 'center',
  },
  chipTextSelected: { color: '#fff' },
});
