import { showAlertModal, confirmActionModal } from '../components/AlertModalHost';

// Shared UI helpers used across screens.
// Previously these were copy-pasted into every screen; keep the single source here.
// Both delegate to the app-wide branded modal (AlertModalHost) instead of the
// native/browser Alert/confirm dialogs, so every screen gets the same themed UI.
export function showAlert(title, message, onPress) {
  showAlertModal(title, message, onPress);
}

export function confirmAction(title, message, onConfirm) {
  confirmActionModal(title, message, onConfirm);
}

// Peso currency formatter, e.g. ₱1,234.50
export const peso = (n) =>
  `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Truncate a UUID-ish id for display, e.g. "a1b2c3d4".
export const shortId = (id) => (id ? String(id).slice(0, 8) : '—');
