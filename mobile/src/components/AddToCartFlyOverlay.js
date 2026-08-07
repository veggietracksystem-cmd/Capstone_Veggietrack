import { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet, Dimensions, Platform } from 'react-native';
import { rf } from '../lib/responsive';

// Renders a short-lived "flying" emoji for each active add-to-cart tap,
// animating from the tapped card to the Cart tab in the bottom nav bar as a
// visual confirmation. `target` is the Cart tab icon's real on-screen center,
// measured by BottomNavBar via measureInWindow and passed down from
// RetailerDashboard, so the flight lands exactly on the icon. The fallback
// below (an evenly-spaced-tab approximation) only covers the brief window
// before that first measurement arrives.
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const NAV_BAR_HEIGHT = Platform.OS === 'ios' ? 84 : 74;
const CART_TAB_INDEX = 1;
const TAB_COUNT = 4;
const FALLBACK_TARGET = {
  x: SCREEN_WIDTH * ((CART_TAB_INDEX + 0.5) / TAB_COUNT),
  y: SCREEN_HEIGHT - NAV_BAR_HEIGHT / 2,
};

function Flight({ flight, target, onDone }) {
  const pos = useRef(new Animated.ValueXY({ x: flight.startX, y: flight.startY })).current;
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onDone(flight.id);
    };

    const to = target || FALLBACK_TARGET;
    Animated.parallel([
      Animated.timing(pos, {
        toValue: { x: to.x, y: to.y },
        duration: 650,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(scale, { toValue: 0.2, duration: 650, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 300, delay: 350, useNativeDriver: true }),
    ]).start(finish);

    // Safety net: if the animation's own completion callback never fires
    // (e.g. the tab is backgrounded and rAF is throttled), don't leave the
    // flight stuck on screen forever.
    const timeoutId = setTimeout(finish, 1200);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.flight,
        {
          opacity,
          transform: [
            { translateX: pos.x },
            { translateY: pos.y },
            { scale },
          ],
        },
      ]}
    >
      <Text style={styles.flightIcon}>{flight.icon}</Text>
    </Animated.View>
  );
}

export default function AddToCartFlyOverlay({ flights, target, onDone }) {
  if (!flights || flights.length === 0) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {flights.map((f) => (
        <Flight key={f.id} flight={f} target={target} onDone={onDone} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flight: { position: 'absolute', left: -18, top: -18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  flightIcon: { fontSize: rf(26) },
});
