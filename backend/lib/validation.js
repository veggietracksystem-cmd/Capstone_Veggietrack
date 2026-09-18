// Shared numeric validation for quantity/price fields accepted from clients.
// Never trust the frontend: a direct API request must be rejected server-side
// for non-numeric, zero/negative, NaN, Infinity and unreasonably large values.

function toFiniteNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

// quantity_kg, price_per_kg, payment amounts: must be a real positive number.
function isPositiveQuantity(value, max = 1_000_000) {
  const n = toFiniteNumber(value);
  return Number.isFinite(n) && n > 0 && n <= max;
}

// Edits that may legitimately reduce a quantity to exactly zero (e.g. "reduce
// stock to 0"), but never negative/NaN/Infinity.
function isNonNegativeQuantity(value, max = 1_000_000) {
  const n = toFiniteNumber(value);
  return Number.isFinite(n) && n >= 0 && n <= max;
}

module.exports = { toFiniteNumber, isPositiveQuantity, isNonNegativeQuantity };
