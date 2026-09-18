import { Animated, Easing } from 'react-native';
import { useEffect, useRef } from 'react';

export const SCREEN_TRANSITION_DURATION = 200;
export const SCREEN_TRANSITION_DISTANCE = 6;
export const MODAL_TRANSITION_DURATION = 200;
export const MOTION_EASING = Easing.out(Easing.quad);

export const sharedScreenCardInterpolator = ({ current }) => {
  const opacity = current.progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const translateY = current.progress.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_TRANSITION_DISTANCE, 0],
  });

  return {
    cardStyle: {
      opacity,
      transform: [{ translateY }],
    },
  };
};

export function SharedScreenTransition({ visible = true, children, style }) {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(visible ? 0 : SCREEN_TRANSITION_DISTANCE)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: SCREEN_TRANSITION_DURATION,
        easing: MOTION_EASING,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: visible ? 0 : SCREEN_TRANSITION_DISTANCE,
        duration: SCREEN_TRANSITION_DURATION,
        easing: MOTION_EASING,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, opacity, translateY]);

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[{ opacity, transform: [{ translateY }] }, style]}
    >
      {children}
    </Animated.View>
  );
}

export function useSharedModalMotion(visible) {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const scale = useRef(new Animated.Value(visible ? 1 : 0.98)).current;
  const translateY = useRef(new Animated.Value(visible ? 0 : 6)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: MODAL_TRANSITION_DURATION,
        easing: MOTION_EASING,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: visible ? 1 : 0.98,
        duration: MODAL_TRANSITION_DURATION,
        easing: MOTION_EASING,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: visible ? 0 : 6,
        duration: MODAL_TRANSITION_DURATION,
        easing: MOTION_EASING,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, opacity, scale, translateY]);

  return {
    backdropStyle: { opacity },
    cardStyle: {
      opacity,
      transform: [{ scale }, { translateY }],
    },
  };
}

export function useBottomSheetMotion(visible) {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(visible ? 0 : 18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: MODAL_TRANSITION_DURATION,
        easing: MOTION_EASING,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: visible ? 0 : 18,
        duration: MODAL_TRANSITION_DURATION,
        easing: MOTION_EASING,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, opacity, translateY]);

  return {
    backdropStyle: { opacity },
    sheetStyle: {
      opacity,
      transform: [{ translateY }],
    },
  };
}
