import { showAlertModal, confirmActionModal } from '../components/AlertModalHost';

// Shared UI helpers. Both use the app's themed modal (AlertModalHost) instead of
// the native Alert/confirm dialogs.
export function showAlert(title, message, onPress) {
  showAlertModal(title, message, onPress);
}

// `options.danger` styles the confirm button red; `options.hideCloseIcon` hides
// the header X (used for Log Out).
export function confirmAction(title, message, onConfirm, options) {
  confirmActionModal(title, message, onConfirm, options);
}

// Peso currency formatter, e.g. ₱1,234.50
export const peso = (n) =>
  `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Truncate a UUID-ish id for display, e.g. "a1b2c3d4".
export const shortId = (id) => (id ? String(id).slice(0, 8) : '—');
