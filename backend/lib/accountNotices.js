// In-app notification for a User Management action the user can read in the app.
// Approval always sends the standard text; only turning an account back on can
// carry a message from the distributor.
// Declined and disabled accounts cannot open Notifications; they see the reason on
// the account status screen instead, so they get no notification here.
const NOTICES = {
  APPROVED: { title: 'Account Approved', message: 'Your account has been approved. You can now access VeggieTrack.' },
  REACTIVATED: { title: 'Account Reactivated', message: 'Your account has been reactivated. You can access VeggieTrack again.' },
};

function accountNotice(action, reason) {
  const notice = NOTICES[action];
  if (!notice) return null;
  const note = action === 'REACTIVATED' && typeof reason === 'string' ? reason.trim() : '';
  return { title: notice.title, message: note ? `${notice.message}\n\nMessage from the distributor: ${note}` : notice.message };
}

module.exports = { accountNotice };
