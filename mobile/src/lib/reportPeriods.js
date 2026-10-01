// Report periods as Philippine calendar days (YYYY-MM-DD, inclusive), the same
// days the backend uses to filter transactions (backend/lib/chainTracking.js).

const DAY = 86400000;
const manilaToday = (now) => new Date(now + 8 * 3600000);
const iso = (date) => date.toISOString().slice(0, 10);

export const REPORT_PERIODS = ['week', 'month', 'year', 'custom'];

export function periodRange(period, now = Date.now()) {
  const today = manilaToday(now);
  const year = today.getUTCFullYear(), month = today.getUTCMonth();
  if (period === 'week') {
    // Monday to Sunday.
    const offset = (today.getUTCDay() + 6) % 7;
    return { from: iso(new Date(today.getTime() - offset * DAY)), to: iso(new Date(today.getTime() + (6 - offset) * DAY)) };
  }
  if (period === 'month') {
    return { from: iso(new Date(Date.UTC(year, month, 1))), to: iso(new Date(Date.UTC(year, month + 1, 0))) };
  }
  if (period === 'year') {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  return null;
}

// A custom range needs two valid days in order.
export function customRangeError(from, to) {
  const valid = (day) => /^\d{4}-\d{2}-\d{2}$/.test(day || '') && !Number.isNaN(Date.parse(`${day}T00:00:00Z`));
  if (!valid(from) || !valid(to)) return 'reports.pickDates';
  if (from > to) return 'reports.startAfterEnd';
  return null;
}

// "Sep 28, 2026 – Oct 4, 2026"
export function rangeLabel(range) {
  if (!range) return '';
  const format = (day) => new Date(`${day}T12:00:00+08:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
  return range.from === range.to ? format(range.from) : `${format(range.from)} – ${format(range.to)}`;
}
