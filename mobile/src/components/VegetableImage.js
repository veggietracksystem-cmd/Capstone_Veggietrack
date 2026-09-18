import { Image } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../theme/appTheme';

const VEGETABLE_IMAGE_SCALE = new Map([
  [require('../../assets/vegetables/basil.png'), 1.12],
  [require('../../assets/vegetables/malunggay.png'), 1.12],
  [require('../../assets/vegetables/talbos-ng-kamote.png'), 1.08],
]);

export default function VegetableImage({ source, style, fallbackSize = 24 }) {
  const visualScale = VEGETABLE_IMAGE_SCALE.get(source) || 1;

  return source ? (
    <Image
      source={source}
      style={[style, visualScale === 1 ? null : { transform: [{ scale: visualScale }] }]}
      resizeMode="contain"
    />
  ) : (
    <MaterialCommunityIcons name="sprout" size={fallbackSize} color={colors.inkFaint} />
  );
}