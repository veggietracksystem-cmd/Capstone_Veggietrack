// Shared phone-number helpers — international, NOT Philippines-only.
//
// We accept any E.164-style number: a leading '+' followed by 10–15 digits.
// That covers every country code, e.g. +639171234567 (PH), +14155552671 (US),
// +447911123456 (UK). We deliberately do NOT hardcode +63 so any real user can
// sign up / log in / reset their password with their own number.
//
// Kept as a small regex (no extra dependency). If you later need strict
// per-country validation, swap isValidPhone's body for libphonenumber-js.

// E.164: '+' then 10–15 digits.
export const PHONE_RE = /^\+\d{10,15}$/;

// Hint shown in validation errors and field placeholders.
export const PHONE_HINT =
  'Use international format: + then country code and number, e.g. +639171234567';

// Strip spaces, dashes, parentheses and dots a user might type, keeping the
// leading '+'. Does not alter the digits themselves.
export function normalizePhone(phone) {
  return (phone || '').trim().replace(/[\s().-]/g, '');
}

// True when `phone` is a valid international number once normalized.
export function isValidPhone(phone) {
  return PHONE_RE.test(normalizePhone(phone));
}
