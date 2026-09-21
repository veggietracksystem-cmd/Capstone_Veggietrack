import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { rf } from '../../lib/responsive';
import { colors, control, fonts, fontSize, radius, shadowCard, spacing } from '../../theme/appTheme';

// The app's two filter-row patterns, in one place so every screen's tabs are
// the same height, use the same padding and radius, and centre their labels.
//
// Selected and unselected tabs are deliberately identical in size - only the
// background and text colour change - so tapping a tab never nudges the row.

/**
 * Segmented control: a single grey track with a white "selected" pill.
 * Use for a small, fixed set of views (Batches/Products, Unpaid/Paid).
 *
 * @param options  [{ value, label }]
 * @param value    the selected option's value
 * @param onChange called with the new value
 * @param scroll   true when the labels are long enough to need scrolling
 *                 instead of being squeezed into equal columns
 */
export function SegmentedTabs({ options, value, onChange, scroll = false, style }) {
  const tabs = options.map((option) => {
    const selected = option.value === value;
    return (
      <TouchableOpacity
        key={option.value}
        style={[styles.tab, !scroll && styles.tabEven, scroll && styles.tabScroll, selected && styles.tabSelected]}
        onPress={() => onChange(option.value)}
        activeOpacity={0.8}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
      >
        <Text
          style={[styles.tabText, selected && styles.tabTextSelected]}
          numberOfLines={1}
        >
          {option.label}
        </Text>
      </TouchableOpacity>
    );
  });

  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.track, styles.trackScroll, style]}
        contentContainerStyle={styles.trackScrollContent}
      >
        {tabs}
      </ScrollView>
    );
  }
  return <View style={[styles.track, style]}>{tabs}</View>;
}

/**
 * Pill chips: a scrolling row of rounded filters (product categories, account
 * statuses). Scrolls sideways rather than squeezing long labels together.
 */
export function FilterChips({ options, value, onChange, disabled = false, style }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.chipRow, style]}
      contentContainerStyle={styles.chipRowContent}
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
    backgroundColor: colors.soil300,
    borderRadius: radius.ctrl,
    padding: 3,
    marginBottom: spacing.md,
  },
  trackScroll: { flexGrow: 0 },
  trackScrollContent: { alignItems: 'center' },
  tab: {
    height: control.heightSm,
    borderRadius: radius.ctrl - 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  tabEven: { flex: 1 },
  tabScroll: { paddingHorizontal: control.paddingH },
  tabSelected: { backgroundColor: colors.card, ...shadowCard },
  tabText: {
    fontFamily: fonts.bodySemiBold,
    color: colors.inkSoft,
    fontSize: rf(fontSize.md),
    textAlign: 'center',
  },
  tabTextSelected: { color: colors.leaf900 },

  chipRow: { flexGrow: 0, marginBottom: spacing.md },
  chipRowContent: { gap: spacing.sm, alignItems: 'center', paddingRight: spacing.xs },
  chip: {
    height: control.heightSm,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: control.paddingH,
    borderRadius: control.heightSm / 2,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipSelected: { backgroundColor: colors.leaf700, borderColor: colors.leaf700 },
  chipText: {
    fontFamily: fonts.bodySemiBold,
    color: colors.inkSoft,
    fontSize: rf(fontSize.sm),
    textAlign: 'center',
  },
  chipTextSelected: { color: '#fff' },
});
