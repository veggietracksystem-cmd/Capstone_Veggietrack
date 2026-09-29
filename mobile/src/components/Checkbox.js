import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/appTheme';

// Shared checkbox. The checked state shows a check mark rather than relying on
// colour alone; the parent row handles taps.
export const CHECKBOX_SIZE = 20;

export default function Checkbox({ checked, style }) {
  return (
    <View style={[styles.box, checked && styles.boxChecked, style]}>
      {checked ? <Ionicons name="checkmark" size={14} color="#fff" style={styles.check} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.leaf700,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: colors.leaf700 },
  check: { width: 14, height: 14, lineHeight: 14, textAlign: 'center' },
});
