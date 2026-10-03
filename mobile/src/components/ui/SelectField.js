import { useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CustomModal from '../CustomModal';
import { rf } from '../../lib/responsive';
import { colors, control, fonts, fontSize, radius } from '../../theme/appTheme';

// Labelled dropdown: the field shows the chosen option; tapping it opens the
// list in a modal, with the chosen option highlighted. Options are { value, label }.
export default function SelectField({ label, value, options, onChange, style }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) || options[0];
  const choose = (next) => { setOpen(false); if (next !== value) onChange(next); };
  return (
    <View style={style}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.field} onPress={() => setOpen(true)} activeOpacity={0.8}
        accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label || ''}`}>
        <Text style={styles.value} numberOfLines={1}>{selected?.label}</Text>
        <Ionicons name="chevron-down" size={rf(16)} color={colors.leaf700} />
      </TouchableOpacity>
      <CustomModal visible={open} title={label} onCancel={() => setOpen(false)}>
        {options.map((option) => {
          const chosen = option.value === selected?.value;
          return (
            <TouchableOpacity key={String(option.value) || 'all'} style={[styles.option, chosen && styles.optionChosen]}
              onPress={() => choose(option.value)} accessibilityRole="button" accessibilityState={{ selected: chosen }}>
              <Text style={[styles.optionText, chosen && styles.optionTextChosen]}>{option.label}</Text>
              {chosen && <Ionicons name="checkmark" size={rf(18)} color="#fff" />}
            </TouchableOpacity>
          );
        })}
      </CustomModal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.xs), color: colors.inkSoft, marginBottom: 4 },
  field: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: control.heightSm,
    paddingHorizontal: control.paddingH, borderRadius: control.heightSm / 2, borderWidth: 1, borderColor: colors.leaf700,
    backgroundColor: colors.card,
  },
  value: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.sm), color: colors.leaf700 },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: control.height,
    paddingHorizontal: 14, borderRadius: radius.ctrl, marginBottom: 6, borderWidth: 1, borderColor: colors.border,
  },
  optionChosen: { backgroundColor: colors.leaf700, borderColor: colors.leaf700 },
  optionText: { fontFamily: fonts.bodySemiBold, fontSize: rf(fontSize.md), color: colors.ink },
  optionTextChosen: { color: '#fff' },
});
