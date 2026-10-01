// Farmer pickup request inputs: quantity in kg (part or all of a harvest) and the
// farmer's price per kg. Mirrors backend/lib/pickups.js; the server checks again.

const twoDecimals = /^\d+(\.\d{1,2})?$/;

// Kilograms of a harvest still free to request (older API responses: the whole harvest).
export function availableKgOf(harvest) {
  const value = harvest?.available_kg ?? harvest?.quantity_kg;
  return Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
}

// A positive amount with up to two decimals, or null.
export function parseAmount(text) {
  const value = String(text ?? '').trim().replace(/,/g, '');
  if (!twoDecimals.test(value)) return null;
  const number = Number(value);
  return number > 0 ? number : null;
}

// Translation keys of the problems with one cart line, e.g. { quantity: 'pickupForm.quantityTooHigh' }.
export function pickupFieldErrors({ quantity, price }, availableKg) {
  const errors = {};
  const kg = parseAmount(quantity);
  if (kg == null) errors.quantity = 'pickupForm.quantityInvalid';
  else if (kg > availableKg) errors.quantity = 'pickupForm.quantityTooHigh';
  const perKg = parseAmount(price);
  if (perKg == null || perKg > 100000) errors.price = 'pickupForm.priceInvalid';
  return errors;
}

// Quantity x price in pesos, rounded half up to centavos; null until both are valid.
export function estimatedTotal(quantity, price) {
  const kg = typeof quantity === 'number' ? quantity : parseAmount(quantity);
  const perKg = typeof price === 'number' ? price : parseAmount(price);
  if (kg == null || perKg == null) return null;
  return Math.round((Math.round(kg * 100) * Math.round(perKg * 100)) / 100) / 100;
}
