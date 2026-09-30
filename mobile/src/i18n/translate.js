import en from './translations/en.json';
import tl from './translations/tl.json';

// LanguageProvider synchronizes this translator for code outside React components.
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

export function statusLabel(status, translate = tr) {
  if (!status) return '';
  const key = `status.${status}`;
  const label = translate(key);
  return label === key ? String(status).replace(/_/g, ' ') : label;
}

export function trc(key, count, vars) {
  return tr(`${key}_${Number(count) === 1 ? 'one' : 'other'}`, { count, ...vars });
}
