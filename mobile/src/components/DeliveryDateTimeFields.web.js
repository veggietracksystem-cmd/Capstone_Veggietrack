import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, radius } from '../theme/appTheme';
import { rf } from '../lib/responsive';

// Local "YYYY-MM-DD" for the date input's min (no past dates).
function todayLocalDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Web: native browser date + time pickers. On react-native-web a raw <input>
// is valid because the tree renders through react-dom. `date` defaults to
// today (set by the caller); `time` has no default and is required.
export default function DeliveryDateTimeFields({ date, onDateChange, time, onTimeChange, disabled }) {
  return (
    <View>
      <Text style={styles.label}>Delivery date</Text>
      {/* eslint-disable-next-line react-native/no-raw-text */}
      <input
        type="date"
        value={date || ''}
        min={todayLocalDate()}
        disabled={disabled}
        onChange={(e) => onDateChange(e.target.value)}
        style={inputStyle}
      />

      <Text style={[styles.label, styles.timeLabel]}>Delivery time</Text>
      {/* eslint-disable-next-line react-native/no-raw-text */}
      <input
        type="time"
        value={time || ''}
        disabled={disabled}
        onChange={(e) => onTimeChange(e.target.value)}
        style={inputStyle}
      />
    </View>
  );
}

const inputStyle = {
  width: '100%',
  padding: 12,
  fontSize: rf(15),
  fontFamily: 'Poppins_400Regular, sans-serif',
  borderRadius: radius.ctrl,
  border: `1.4px solid ${colors.border}`,
  backgroundColor: colors.card,
  color: colors.ink,
  boxSizing: 'border-box',
};

const styles = StyleSheet.create({
  label: { fontFamily: fonts.bodySemiBold, fontSize: rf(12.5), color: colors.inkSoft, marginBottom: 8 },
  timeLabel: { marginTop: 14 },
});
