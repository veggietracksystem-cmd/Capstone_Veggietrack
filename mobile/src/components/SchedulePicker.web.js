import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, radius } from '../theme/appTheme';

const PRIMARY = colors.leaf700;

// Local datetime string "YYYY-MM-DDTHH:mm" for the input's min (no past times).
function nowLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Web: a native browser datetime-local picker. On react-native-web a raw <input>
// is valid because the tree renders through react-dom. Value is "YYYY-MM-DDTHH:mm".
export default function SchedulePicker({ value, onChange, disabled }) {
  return (
    <View style={styles.wrap}>
      {/* eslint-disable-next-line react-native/no-raw-text */}
      <input
        type="datetime-local"
        value={value || ''}
        min={nowLocal()}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: 12,
          fontSize: 15,
          fontFamily: 'Inter_400Regular, sans-serif',
          borderRadius: radius.ctrl,
          border: `1.4px solid ${colors.border}`,
          backgroundColor: colors.card,
          color: colors.ink,
          boxSizing: 'border-box',
        }}
      />
      {!value ? <Text style={styles.hint}>Pick a date and time for delivery.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 4 },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.inkFaint, marginTop: 4 },
});
