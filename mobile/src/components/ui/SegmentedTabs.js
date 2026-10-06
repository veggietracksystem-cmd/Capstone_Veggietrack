import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { rf } from '../../lib/responsive';
import { colors, control, fonts, fontSize, spacing } from '../../theme/appTheme';
import CountBadge, { BADGE_OVERHANG, floatingBadge } from './CountBadge';

// Shared filter-row components. Selected and unselected tabs are the same size;
// only the colours change, so selecting a tab never shifts the row.

// A tab's count floats over its own top-right corner, outside the label. Rows
// that can show counts reserve the badge's overhang so it is never clipped and
// the row height does not change when a count appears or reaches 0.
const hasCounts = (options) => options.some((option) => option.count !== undefined);
// Scrolled rows: the end padding must also hold the last tab's badge.
const scrollRoom = (inset) => ({ paddingTop: BADGE_OVERHANG.top, paddingRight: Math.max(inset || spacing.xs, BADGE_OVERHANG.right + spacing.xs) });
const TabCount = ({ count }) => (
  <CountBadge count={count} style={floatingBadge} accessibilityLabel={`${Number(count)} new`} />
);

// Options use { value, label, count? }; scroll lets long labels retain their width.
export function SegmentedTabs({ options, value, onChange, scroll = false, inset = 0, style, disabled = false }) {
  const counted = hasCounts(options);
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
        <Text style={[styles.tabText, selected && styles.tabTextSelected]} numberOfLines={scroll ? 1 : 2}>
          {option.label}
        </Text>
        <TabCount count={option.count} />
      </TouchableOpacity>
    );
  });

  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.track, styles.trackScroll, style]}
        contentContainerStyle={[styles.trackScrollContent, inset ? { paddingHorizontal: inset } : null, counted && scrollRoom(inset)]}
      >
        {tabs}
      </ScrollView>
    );
  }
  return <View style={[styles.track, counted && styles.roomForBadge, style]}>{tabs}</View>;
}

// inset pads the scrolled content so a row can run to the screen edges.
export function FilterChips({ options, value, onChange, disabled = false, style, inset = 0 }) {
  const counted = hasCounts(options);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.chipRow, style]}
      contentContainerStyle={[styles.chipRowContent, inset ? { paddingHorizontal: inset } : null, counted && scrollRoom(inset)]}
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
            <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
              {option.label}
            </Text>
            <TabCount count={option.count} />
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

  // Room above the row for a floating count badge.
  roomForBadge: { paddingTop: BADGE_OVERHANG.top },

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
