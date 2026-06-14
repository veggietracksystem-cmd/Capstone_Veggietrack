import { Platform, Alert } from 'react-native';

// Shared UI helpers used across screens.
// Previously these were copy-pasted into every screen; keep the single source here.

// react-native's Alert.alert is a no-op on react-native-web, so use window.alert there.
export function showAlert(title, message) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

// Confirm dialog that also works on web (Alert.alert is a no-op there).
export function confirmAction(title, message, onConfirm) {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Confirm', style: 'destructive', onPress: onConfirm },
  ]);
}

// Peso currency formatter, e.g. ₱1,234.50
export const peso = (n) =>
  `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Truncate a UUID-ish id for display, e.g. "a1b2c3d4".
export const shortId = (id) => (id ? String(id).slice(0, 8) : '—');
