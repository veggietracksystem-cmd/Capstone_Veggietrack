import { rf } from '../lib/responsive';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, control, fonts, fontSize, spacing } from '../theme/appTheme';
import { useTranslation } from '../i18n/useTranslation';

// Shared header for every screen. The title is left-aligned after the back arrow
// and takes the space the right-hand actions do not need.
//
// Render it inside the screen's SafeAreaView, which supplies the top inset; set
// `topInset` only when the header is rendered outside a SafeAreaView.
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
    // Offsets the icon buttons' inner padding so icons align with the 16px gutter.
    paddingRight: 10,
  },
  // Keeps the back arrow on the 16px content gutter despite its 44px hit area.
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
