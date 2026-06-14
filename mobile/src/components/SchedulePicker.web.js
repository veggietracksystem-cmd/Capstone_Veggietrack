import { View, Text, StyleSheet } from 'react-native';

const PRIMARY = '#2e7d32';

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
          fontSize: 16,
          borderRadius: 8,
          border: '1px solid #ddd',
          backgroundColor: '#fff',
          color: '#222',
          boxSizing: 'border-box',
        }}
      />
      {!value ? <Text style={styles.hint}>Pick a date and time for delivery.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 4 },
  hint: { fontSize: 12, color: '#999', marginTop: 4 },
});
