import { rf } from '../lib/responsive';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts, fontSize } from '../theme/appTheme';

// One header for every pushed screen, so height/background/title size/back
// button placement/padding/border are identical everywhere instead of each
// screen hand-rolling its own row. Rendered as the first child inside a
// screen's existing SafeAreaView (every screen already has one), which is
// what supplies the top notch/status-bar inset - set `topInset` only for the
// rare screen that renders its header outside any SafeAreaView.
export default function ScreenHeader({ title, onBack, right, topInset = false }) {
  return (
    <View style={[styles.container, topInset && styles.topInset]}>
      <TouchableOpacity
        onPress={onBack}
        disabled={!onBack}
        activeOpacity={0.7}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={styles.backHit}
        accessibilityRole={onBack ? 'button' : undefined}
        accessibilityLabel="Go back"
      >
        {onBack ? <Ionicons name="arrow-back" size={rf(20)} color={colors.ink} /> : null}
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={styles.rightSlot}>{right || null}</View>
    </View>
  );
}

const HEADER_HEIGHT = 52;

const styles = StyleSheet.create({
  container: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgScreen,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 6,
  },
  topInset: {
    paddingTop: 4,
  },
  backHit: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.heading,
    fontSize: rf(fontSize.title),
    color: colors.ink,
    marginHorizontal: 4,
  },
  rightSlot: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
