// Server-side validation for client-supplied quantities and prices.

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

// Allows exactly zero (e.g. reducing stock to 0), but not negative or non-finite values.
function isNonNegativeQuantity(value, max = 1_000_000) {
  const n = toFiniteNumber(value);
  return Number.isFinite(n) && n >= 0 && n <= max;
}

module.exports = { toFiniteNumber, isPositiveQuantity, isNonNegativeQuantity };
