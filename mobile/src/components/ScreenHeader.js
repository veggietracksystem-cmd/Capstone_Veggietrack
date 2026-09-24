import { rf } from '../lib/responsive';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, control, fonts, fontSize, spacing } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

// One header for every screen in the app - pushed screens and dashboards
// alike - so height/background/title size/padding/border are identical
// everywhere instead of each screen hand-rolling its own row.
//
// The title is left-aligned: it sits right after the back arrow (or at the
// screen's 16px gutter when there is none) and takes all the space the
// right-hand actions don't need, so long titles get the most room possible.
//
// Rendered as the first child inside a screen's existing SafeAreaView (every
// screen already has one), which is what supplies the top notch/status-bar
// inset - set `topInset` only for the rare screen that renders its header
// outside any SafeAreaView.
export default function ScreenHeader({ title, onBack, left, right, topInset = false }) {
  const { t } = useTranslation();
  const leftContent = onBack ? (
    <TouchableOpacity
      onPress={onBack}
      activeOpacity={0.7}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={styles.backHit}
      accessibilityRole="button"
      accessibilityLabel={t('cmp.goBack')}
    >
      <Ionicons name="arrow-back" size={rf(22)} color={colors.ink} />
    </TouchableOpacity>
  ) : (left || null);

  return (
    <View style={[styles.container, leftContent ? styles.withLeft : null, topInset && styles.topInset]}>
      {leftContent ? <View style={styles.left}>{leftContent}</View> : null}
      <Text
        style={styles.title}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        accessibilityRole="header"
      >
        {title}
      </Text>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const HEADER_HEIGHT = 56;

const styles = StyleSheet.create({
  container: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgScreen,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingLeft: spacing.lg,
    // Right-hand icon buttons carry ~6px of inner padding, so this puts the
    // icons themselves on the same 16px gutter as the content.
    paddingRight: 10,
  },
  // The back button's 44px hit area is centred on its icon, so pull the row
  // in a little to keep the arrow itself on the 16px content gutter.
  withLeft: {
    paddingLeft: spacing.xs,
  },
  topInset: {
    paddingTop: 4,
  },
  left: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.xs,
  },
  right: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginLeft: spacing.sm,
  },
  backHit: {
    width: control.minTouch,
    height: control.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    minWidth: 0,
    textAlign: 'left',
    fontFamily: fonts.heading,
    fontSize: rf(fontSize.title),
    color: colors.ink,
  },
});
