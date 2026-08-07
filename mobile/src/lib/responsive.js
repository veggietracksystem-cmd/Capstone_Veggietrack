import { Dimensions, PixelRatio } from 'react-native';

// Scales a design-time font size against the device's actual screen width,
// same technique as react-native-size-matters' moderateScale (no extra
// dependency). `factor` dampens the scaling so text doesn't blow up on
// tablets/large phones or shrink too far on small ones.
// Computed once at module load from the window's initial dimensions — good
// enough for "scales per device," not meant to track live resizes.
const BASE_WIDTH = 375; // standard small-phone design baseline (iPhone SE/8-ish)
// On web, "window" is the browser viewport, which can be far wider than any
// phone (a maximized desktop window) — cap it so the scale reflects a
// phone-sized screen instead of blowing text up on wide windows.
const MAX_WIDTH = 480;
const { width } = Dimensions.get('window');
const widthScale = Math.min(width, MAX_WIDTH) / BASE_WIDTH;

export function rf(size, factor = 0.5) {
  const scaled = size + (widthScale * size - size) * factor;
  return Math.round(PixelRatio.roundToNearestPixel(scaled));
}
