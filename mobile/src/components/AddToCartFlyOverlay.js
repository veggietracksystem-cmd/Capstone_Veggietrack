import { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet, Dimensions, Platform } from 'react-native';
import { rf } from '../lib/responsive';
import VegetableImage from './VegetableImage';

// Animates a vegetable image from the tapped card to the Cart tab. `target` is the
// Cart icon's measured centre (from BottomNavBar); the fallback estimate below is
// used only until that measurement arrives.
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
    const useNativeDriver = Platform.OS !== 'web';
    Animated.parallel([
      Animated.timing(pos, {
        toValue: { x: to.x, y: to.y },
        duration: 650,
        easing: Easing.out(Easing.quad),
        useNativeDriver,
      }),
      Animated.timing(scale, { toValue: 0.2, duration: 650, easing: Easing.out(Easing.quad), useNativeDriver }),
      Animated.timing(opacity, { toValue: 0, duration: 300, delay: 350, useNativeDriver }),
    ]).start(finish);

    // Fallback in case the animation callback never fires (e.g. throttled in the background).
    const timeoutId = setTimeout(finish, 1200);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
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
      <VegetableImage source={flight.source} style={styles.flightIcon} fallbackSize={rf(26)} />
    </Animated.View>
  );
}

export default function AddToCartFlyOverlay({ flights, target, onDone }) {
  if (!flights || flights.length === 0) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]}>
      {flights.map((f) => (
        <Flight key={f.id} flight={f} target={target} onDone={onDone} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flight: { position: 'absolute', left: -18, top: -18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  overlay: { pointerEvents: 'none' },
  flightIcon: { width: 32, height: 32 },
});
