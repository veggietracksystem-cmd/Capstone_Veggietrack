import { useTranslation } from '../i18n/useTranslation';
import { manilaDate } from '../lib/deliverySchedule';
import { Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { colors, fonts, typography } from '../theme/appTheme';
import { rf } from '../lib/responsive';

const PRIMARY = colors.leaf700;
const DAYS_BACK = 30;

// Harvest/pickup date picker using the same inline chips as DeliveryDateTimeFields,
// counting back from today. `minDate` hides earlier days. Value: 'YYYY-MM-DD'.
export default function BatchDateField({ value, onChange, minDate, disabled }) {
  const { t } = useTranslation();
  const days = [];
  for (let i = 0; i < DAYS_BACK; i++) {
    const key = manilaDate(Date.now() - i * 86400000);
    if (minDate && key < minDate) break;
    let label;
    if (i === 0) label = t('cmp.today');
    else if (i === 1) label = t('cmp.yesterday');
    else label = new Date(`${key}T12:00:00+08:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    days.push({ key, label });
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {days.map((d) => {
        const sel = value === d.key;
        return (
          <TouchableOpacity
            key={d.key}
            style={[styles.chip, sel && styles.chipActive]}
            onPress={() => onChange(d.key)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: sel }}
          >
            <Text style={[styles.chipText, sel && styles.chipTextActive]}>{d.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chipRow: { gap: 8, paddingRight: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipText: { ...typography.chip, color: colors.inkSoft },
  chipTextActive: { fontFamily: fonts.bodySemiBold, color: '#fff' },
});
