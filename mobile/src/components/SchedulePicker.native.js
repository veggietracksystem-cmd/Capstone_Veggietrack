import { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet,
} from 'react-native';

const PRIMARY = '#2e7d32';

// Common delivery time slots (24h). Building a full clock picker would need a
// native datetime library, which isn't installed — these slots cover the
// realistic delivery windows without adding a dependency.
const TIME_SLOTS = ['08:00', '10:00', '12:00', '13:00', '15:00', '17:00'];

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Next 7 days as selectable chips.
function nextDays(count = 7) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    let label;
    if (i === 0) label = 'Today';
    else if (i === 1) label = 'Tomorrow';
    else label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    out.push({ key: dateKey(d), label });
  }
  return out;
}

// Pretty-print a stored "YYYY-MM-DDTHH:mm" value for the trigger button.
function prettyValue(value) {
  if (!value) return 'Select preferred date & time';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// Native: a modal with day + time-slot chips. onChange receives "YYYY-MM-DDTHH:mm".
export default function SchedulePicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const days = nextDays();
  const [day, setDay] = useState(value ? value.slice(0, 10) : days[0].key);
  const [time, setTime] = useState(value ? value.slice(11, 16) : null);

  const confirm = () => {
    if (!time) return;
    onChange(`${day}T${time}`);
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.trigger, !value && styles.triggerEmpty]}
        onPress={() => setOpen(true)}
        disabled={disabled}
        activeOpacity={0.8}
      >
        <Text style={[styles.triggerText, !value && styles.triggerTextEmpty]}>
          🕒  {prettyValue(value)}
        </Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Preferred delivery time</Text>

            <Text style={styles.label}>Day</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {days.map((d) => {
                const sel = day === d.key;
                return (
                  <TouchableOpacity
                    key={d.key}
                    style={[styles.chip, sel && styles.chipActive]}
                    onPress={() => setDay(d.key)}
                  >
                    <Text style={[styles.chipText, sel && styles.chipTextActive]}>{d.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.label}>Time</Text>
            <View style={styles.timeWrap}>
              {TIME_SLOTS.map((t) => {
                const sel = time === t;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[styles.chip, sel && styles.chipActive]}
                    onPress={() => setTime(t)}
                  >
                    <Text style={[styles.chipText, sel && styles.chipTextActive]}>{t}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={() => setOpen(false)}>
                <Text style={styles.btnOutlineText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, !time && styles.btnDisabled]}
                onPress={confirm}
                disabled={!time}
              >
                <Text style={styles.btnPrimaryText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 4 },
  trigger: { backgroundColor: '#fff', borderRadius: 8, padding: 14, borderWidth: 1, borderColor: PRIMARY },
  triggerEmpty: { borderColor: '#ddd' },
  triggerText: { fontSize: 16, color: '#222', fontWeight: '600' },
  triggerTextEmpty: { color: '#999', fontWeight: '400' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 28 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: '#222', marginBottom: 12 },
  label: { fontSize: 13, color: '#555', marginTop: 10, marginBottom: 8, fontWeight: '600' },
  chipRow: { gap: 8, paddingRight: 8 },
  timeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: '#ccc', backgroundColor: '#fafafa' },
  chipActive: { backgroundColor: PRIMARY, borderColor: PRIMARY },
  chipText: { color: '#555', fontSize: 14 },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  btnPrimary: { backgroundColor: PRIMARY },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnOutline: { borderWidth: 1, borderColor: PRIMARY },
  btnOutlineText: { color: PRIMARY, fontWeight: '600', fontSize: 16 },
  btnDisabled: { opacity: 0.5 },
});
