export function scheduleInstant(value) {
  if (typeof value !== 'string') return NaN;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!m || Number(m[2].slice(0, 2)) > 23 || Number(m[2].slice(3)) > 59 || Number(m[3] || 0) > 59) return NaN;
  const day = new Date(`${m[1]}T00:00:00Z`);
  if (!Number.isFinite(+day) || day.toISOString().slice(0, 10) !== m[1]) return NaN;
  return Date.parse(value + (m[5] ? '' : '+08:00'));
}
export function validateSchedule(value, now = Date.now()) {
  const instant = scheduleInstant(value);
  if (!Number.isFinite(instant)) throw new Error('Select a valid delivery date and time.');
  if (instant <= now) throw new Error('Delivery date and time cannot be in the past.');
  return new Date(instant).toISOString();
}

export function manilaDate(now = Date.now()) { return new Date(now + 8 * 3600000).toISOString().slice(0, 10); }
export function manilaSchedule(value) {
  const instant = scheduleInstant(value);
  return Number.isFinite(instant) ? new Date(instant).toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}
