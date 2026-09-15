// Shared by mobile and server; Metro supports CommonJS.
const PHONE_RE = /^\+639\d{9}$/;
const PHONE_HINT = 'Enter a Philippine mobile number, e.g. 09171234567.';
function normalizePhone(value) {
 let p = typeof value === 'string' ? value.trim().replace(/[\s().-]/g, '') : '';
 if (/^09\d{9}$/.test(p)) p = '+63' + p.slice(1);
 else if (/^9\d{9}$/.test(p)) p = '+63' + p;
 else if (/^639\d{9}$/.test(p)) p = '+' + p;
 return p;
}
const isValidPhone = value => PHONE_RE.test(normalizePhone(value));
const maskPhone = value => isValidPhone(value) ? '+63 *** *** ' + normalizePhone(value).slice(-4) : '';
module.exports = { PHONE_RE, PHONE_HINT, normalizePhone, isValidPhone, maskPhone };
