import { useState } from 'react';
import { rf } from '../lib/responsive';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, control, fonts, fontSize } from '../theme/appTheme';

// One header for every screen in the app - pushed screens and dashboards
// alike - so height/background/title size/padding/border are identical
// everywhere instead of each screen hand-rolling its own row.
//
// The title is always centred on screen. The two side slots keep the same
// width as each other: the wider side is measured, and the other side is
// padded to match, so a header with a back button on the left and three
// icons on the right still shows its title in the middle of the screen
// rather than pushed off to one side.
//
// Rendered as the first child inside a screen's existing SafeAreaView (every
// screen already has one), which is what supplies the top notch/status-bar
// inset - set `topInset` only for the rare screen that renders its header
// outside any SafeAreaView.
export default function ScreenHeader({ title, onBack, left, right, topInset = false }) {
  const [sideWidth, setSideWidth] = useState(control.minTouch);
  const measure = (event) => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    setSideWidth((current) => (width > current ? width : current));
  };
  const leftContent = onBack ? (
    <TouchableOpacity
      onPress={onBack}
      activeOpacity={0.7}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={styles.backHit}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Ionicons name="arrow-back" size={rf(20)} color={colors.ink} />
    </TouchableOpacity>
  ) : (left || null);

  return (
    <View style={[styles.container, topInset && styles.topInset]}>
      <View style={[styles.side, { minWidth: sideWidth }]} onLayout={measure}>{leftContent}</View>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={[styles.side, styles.sideRight, { minWidth: sideWidth }]} onLayout={measure}>{right || null}</View>
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
    paddingHorizontal: 8,
  },
  topInset: {
    paddingTop: 4,
  },
  // Both slots size to their own content and are then padded out to the
  // wider of the two, so the flexed title lands dead centre.
  side: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  sideRight: {
    justifyContent: 'flex-end',
  },
  backHit: {
    width: control.minTouch,
    height: control.minTouch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.heading,
    fontSize: rf(fontSize.title),
    color: colors.ink,
    marginHorizontal: 8,
  },
});
