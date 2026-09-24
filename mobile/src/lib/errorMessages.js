// Turns whatever a failed request threw into one short, plain sentence a
// normal user can act on.
//
// The API client and the backend both attach technical detail to their errors
// ("Request failed (500)", "Server cannot be reached.", raw database or
// validation wording). Screens used to pass `err.message` straight into an
// alert, so users saw developer text. Every screen now routes errors through
// here instead: a clear backend message about *their* data still gets shown,
// because that is the part they can fix, while anything technical is replaced
// by a simple sentence.

import { tr } from '../i18n/translate';

// Read at call time so the text follows the selected language.
const GENERIC = () => tr('errors.generic');
const CONNECTION = () => tr('errors.connection');
const SESSION_ENDED = () => tr('errors.sessionEnded');
const NOT_ALLOWED = () => tr('errors.notAllowed');

// Anything that reads like server/developer wording never reaches the user.
const TECHNICAL = [
  /request failed/i,
  /\b(api|http|https|url|endpoint|payload|json|token|jwt|sql|database|schema|rpc|stack|null|undefined|uuid)\b/i,
  /\b(status|error|exception)\s*[:(]?\s*\d{3}\b/i,
  /^\s*\d{3}\b/,
  /supabase|postgres|fetch|network request/i,
  /unauthorized|unauthenticated|forbidden/i,
];

const CONNECTION_CODES = ['BACKEND_UNREACHABLE', 'REQUEST_TIMEOUT', 'REQUEST_ABORTED', 'NETWORK_ERROR'];

// Backend sentences that are accurate but written for developers (field names,
// role checks, raw status words). Each is swapped for plain wording; anything
// not listed still passes through the technical filter above.
const PLAIN_WORDING = [
  [/^only [\w\s-]+ can /i, () => NOT_ALLOWED()],
  [/access denied|not allowed|access required|cannot access this feature|not assigned to you|unauthorized to cancel|you can only (cancel|delete|update) your own/i, () => NOT_ALLOWED()],
  [/^failed to /i, () => GENERIC()],
  [/^location update failed/i, () => tr('errors.locationNotShared')],
  [/valid latitude and longitude|gps accuracy must be/i, () => tr('errors.needLocation')],
  [/order id and valid amount/i, () => tr('dashboards.distributor.invalidAmount')],
  [/invalid delivery status transition|status was already updated|order was already updated/i, () => tr('errors.alreadyUpdated')],
  [/cannot cancel order with status/i, () => tr('errors.cantCancel')],
  [/cannot reject a delivery with status/i, () => tr('errors.cantRejectDelivery')],
  [/pickup request cannot be (marked on the way|picked up)/i, () => tr('errors.alreadyUpdated')],
  [/only un-?listed batches can be deleted/i, () => tr('errors.unlistFirst')],
  [/endpoint does not exist|use supabase auth|^status must be|invalid message participant|no fields to update|^invalid (status|harvest_date)/i, () => GENERIC()],
];

function looksTechnical(message) {
  return TECHNICAL.some((pattern) => pattern.test(message)) || /\b[a-z]+_[a-z_]+\b/.test(message);
}

// Removes shorthand and leftover internal words from an otherwise friendly sentence.
function plainer(message) {
  return message
    .replace(/\s*\((?:status|code):[^)]*\)/gi, '')
    .replace(/\bGPS location\b/gi, 'location')
    .replace(/\bGPS\b/g, 'location');
}

/**
 * @param error     the thrown error (from `api`, Supabase, or anywhere else)
 * @param fallback  what to say when the real reason can't be shown as-is
 */
export function friendlyError(error, fallback = GENERIC()) {
  const status = error?.status;
  const code = error?.code;
  const message = typeof error?.message === 'string' ? error.message.trim() : '';

  if (CONNECTION_CODES.includes(code) || status === 0) return CONNECTION();
  if (status === 401) return SESSION_ENDED();
  if (status === 408 || status === 429) return tr('errors.tookTooLong');
  if (status >= 500) return tr('errors.cantReach');

  // A 400/403/404/409 usually carries a helpful sentence about the user's own
  // data ("A pickup has already been requested for this harvest."). Keep it,
  // unless it reads like developer output.
  const known = PLAIN_WORDING.find(([pattern]) => pattern.test(message));
  if (known) return known[1]();
  if (message && !looksTechnical(message)) return plainer(message);
  if (status === 403) return NOT_ALLOWED();
  return fallback;
}

export { GENERIC as GENERIC_ERROR, CONNECTION as CONNECTION_ERROR, SESSION_ENDED as SESSION_ENDED_ERROR };
