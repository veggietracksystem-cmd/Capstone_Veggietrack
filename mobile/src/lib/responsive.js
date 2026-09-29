import { Dimensions, PixelRatio } from 'react-native';

// Scales a design font size to the screen width (like react-native-size-matters'
// moderateScale). `factor` dampens the scaling. Computed once at module load.
const BASE_WIDTH = 375; // standard small-phone design baseline (iPhone SE/8-ish)
// On web the window can be much wider than a phone, so the width is capped.
const MAX_WIDTH = 480;
const { width } = Dimensions.get('window');
const widthScale = Math.min(width, MAX_WIDTH) / BASE_WIDTH;

export function rf(size, factor = 0.5) {
  const scaled = size + (widthScale * size - size) * factor;
  return Math.round(PixelRatio.roundToNearestPixel(scaled));
}
