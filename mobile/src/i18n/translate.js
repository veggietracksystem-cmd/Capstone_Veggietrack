import en from './translations/en.json';
import tl from './translations/tl.json';

// Non-hook translator for code that runs outside React components (error
// helpers, alert text built in lib/). LanguageProvider keeps `current` in sync
// with the selected language; the lookup rules match its `t()` exactly.
const DICTS = { en, tl };
let current = 'en';

export function setCurrentLanguage(lang) {
  if (DICTS[lang]) current = lang;
}

function resolve(dict, path) {
  return path.split('.').reduce(
    (acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined),
    dict
  );
}

export function tr(key, vars) {
  const value = resolve(DICTS[current], key);
  const fallback = resolve(DICTS.en, key);
  const str = typeof value === 'string' ? value : (typeof fallback === 'string' ? fallback : key);
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  ));
}

// Translated label for a raw status code (e.g. "in_transit"); unknown codes
// fall back to the code with underscores swapped for spaces.
export function statusLabel(status) {
  if (!status) return '';
  const key = `status.${status}`;
  const label = tr(key);
  return label === key ? String(status).replace(/_/g, ' ') : label;
}

// Count-aware translation: uses `<key>_one` when count is 1, otherwise
// `<key>_other`. `{count}` is filled in automatically.
export function trc(key, count, vars) {
  return tr(`${key}_${Number(count) === 1 ? 'one' : 'other'}`, { count, ...vars });
}
