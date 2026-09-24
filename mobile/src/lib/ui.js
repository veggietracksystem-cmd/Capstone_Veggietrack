import { showAlertModal, confirmActionModal } from '../components/AlertModalHost';

// Shared UI helpers used across screens.
// Previously these were copy-pasted into every screen; keep the single source here.
// Both delegate to the app-wide branded modal (AlertModalHost) instead of the
// native/browser Alert/confirm dialogs, so every screen gets the same themed UI.
export function showAlert(title, message, onPress) {
  showAlertModal(title, message, onPress);
}

// `options.danger`: style the confirm button red instead of green, for
// destructive actions (e.g. Log Out). `options.hideCloseIcon`: hide the
// header's X so Cancel/Confirm are the only way out - used for Log Out so
// there's exactly one way to dismiss without a redundant close control.
export function confirmAction(title, message, onConfirm, options) {
  confirmActionModal(title, message, onConfirm, options);
}

// Peso currency formatter, e.g. ₱1,234.50
export const peso = (n) =>
  `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Truncate a UUID-ish id for display, e.g. "a1b2c3d4".
export const shortId = (id) => (id ? String(id).slice(0, 8) : '—');
