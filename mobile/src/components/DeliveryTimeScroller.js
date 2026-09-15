import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { scheduleInstant } from '../lib/deliverySchedule';
import { useTranslation } from '../i18n/useTranslation';
import { colors, fonts } from '../theme/appTheme';

const pad = value => String(value).padStart(2, '0');
// All 24 hours and all 60 minutes are available; no fixed delivery slots.
export default function DeliveryTimeScroller({ date, time, onTimeChange, disabled }) {
  const { t } = useTranslation();
  const [hour, minute] = (time || '').split(':');
  const future = (h, m) => scheduleInstant(`${date}T${h}:${m}`) > Date.now();
  const chooseHour = h => {
    const m = Array.from({ length: 60 }, (_, i) => pad(i)).find(m => future(h, m));
    if (m !== undefined) onTimeChange(`${h}:${future(h, minute) ? minute : m}`);
  };
  return <View style={styles.row}>
    {[{ label: t('checkout.hour'), count: 24, selected: hour, choose: chooseHour,
      available: value => future(value, '59') },
    { label: t('checkout.minute'), count: 60, selected: minute, choose: m => onTimeChange(`${hour}:${m}`),
      available: value => !!hour && future(hour, value) }].map(column =>
      <View key={column.label} style={styles.column}>
        <Text style={styles.label}>{column.label}</Text>
        <ScrollView style={styles.scroll} nestedScrollEnabled showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
          {Array.from({ length: column.count }, (_, i) => pad(i)).map(value => {
            const selected = value === column.selected;
            const unavailable = disabled || !column.available(value);
            return <TouchableOpacity key={value} accessibilityRole="button"
              accessibilityLabel={`${column.label} ${value}`} accessibilityState={{ selected, disabled: unavailable }}
              disabled={unavailable} onPress={() => column.choose(value)}
              style={[styles.option, selected && styles.selected, unavailable && { opacity: 0.35 }]}>
              <Text style={[styles.value, selected && { color: '#fff' }]}>{value}</Text>
            </TouchableOpacity>;
          })}
        </ScrollView>
      </View>)}
  </View>;
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12 }, column: { flex: 1 },
  label: { fontFamily: fonts.bodySemiBold, color: colors.inkSoft, marginBottom: 6 },
  scroll: { height: 150, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  option: { padding: 10, alignItems: 'center' }, selected: { backgroundColor: colors.leaf700, borderRadius: 10 },
  value: { fontFamily: fonts.body, color: colors.ink },
});
