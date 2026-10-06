import { StyleSheet, Text, View } from 'react-native';
import { rf } from '../../lib/responsive';
import { colors, fonts } from '../../theme/appTheme';

// The one red count badge, styled like the notification badge: red, white bold
// number, circular for one digit and wider for more ("9+", "12"). Every count in
// the app uses it; only its placement differs per component.

// Badge height; also its width for a single digit.
export const COUNT_BADGE_SIZE = Math.max(18, rf(18));

// Floating placement over the top-right corner of a tab, chip or card. The
// component receiving the badge is the positioning container. A row that holds
// such components reserves BADGE_OVERHANG on top (and on the right when it
// scrolls, since a ScrollView clips) so the badge is never cut off.
export const BADGE_OVERHANG = { top: 9, right: 6 };
export const floatingBadge = { position: 'absolute', top: -BADGE_OVERHANG.top, right: -BADGE_OVERHANG.right, zIndex: 2, elevation: 2 };

// "1".."9", then "9+" (or `${max}+`). Null when there is nothing to count.
export function formatCount(count, max = 9) {
  const n = Math.floor(Number(count));
  if (!(n > 0)) return null;
  return n > max ? `${max}+` : String(n);
}

export default function CountBadge({ count, max = 9, style, accessibilityLabel }) {
  const text = formatCount(count, max);
  if (!text) return null;
  return (
    <View
      style={[styles.badge, style]}
      pointerEvents="none"
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.text} numberOfLines={1} allowFontScaling={false}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: COUNT_BADGE_SIZE,
    height: COUNT_BADGE_SIZE,
    borderRadius: COUNT_BADGE_SIZE / 2,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: fonts.bodyBold,
    color: '#fff',
    fontSize: rf(11),
    lineHeight: rf(11) + 3,
    textAlign: 'center',
    includeFontPadding: false,
  },
});
