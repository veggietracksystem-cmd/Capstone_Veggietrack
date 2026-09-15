import DeliveryTimeScroller from './DeliveryTimeScroller';
import { useTranslation } from '../i18n/useTranslation';
import { manilaDate, scheduleInstant } from '../lib/deliverySchedule';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { colors, fonts } from '../theme/appTheme';
import { rf } from '../lib/responsive';

const PRIMARY = colors.leaf700;

// Next 7 days as selectable chips, today first.
function nextDays(count = 7) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(`${manilaDate(Date.now() + i * 86400000)}T12:00:00+08:00`);
    let label;
    if (i === 0) label = 'Today';
    else if (i === 1) label = 'Tomorrow';
    else label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    out.push({ key: manilaDate(Date.now() + i * 86400000), label });
  }
  return out;
}

// Always-inline date + time chip pickers (no modal) so both fields are
// visible and editable directly on the Order Confirmation screen. `date`
// defaults to today (set by the caller); `time` has no default and is
// required before checkout can proceed.
export default function DeliveryDateTimeFields({ date, onDateChange, time, onTimeChange, disabled }) {
  const { t } = useTranslation();
  const days = nextDays();

  return (
    <View>
      <Text style={styles.label}>{t('checkout.deliveryDate')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {days.map((d) => {
          const sel = date === d.key;
          return (
            <TouchableOpacity
              key={d.key}
              style={[styles.chip, sel && styles.chipActive]}
              onPress={() => onDateChange(d.key)}
              disabled={disabled}
            >
              <Text style={[styles.chipText, sel && styles.chipTextActive]}>{d.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <Text style={[styles.label, styles.timeLabel]}>{t('checkout.deliveryTime')}</Text>
      <DeliveryTimeScroller date={date} time={time} onTimeChange={onTimeChange} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.bodySemiBold, fontSize: rf(12.5), color: colors.inkSoft, marginBottom: 8 },
  timeLabel: { marginTop: 14 },
  chipRow: { gap: 8, paddingRight: 8 },
  timeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipText: { fontFamily: fonts.body, color: colors.inkSoft, fontSize: rf(13.5) },
  chipTextActive: { fontFamily: fonts.bodySemiBold, color: '#fff' },
});
