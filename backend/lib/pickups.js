// Farmer pickup requests (sql/pickup_pricing_and_spoilage.sql). A request covers
// part or all of one harvest at the farmer's price per kg.
//
//   requested  Pending: waiting for the distributor
//   approved   Approved: price and quantity accepted, no rider yet
//   assigned   Ready for pickup: rider assigned
//   otw        In progress: rider on the way
//   picked_up  Successfully picked up (history)
//   declined   Declined by the distributor (history)
const { roundKg, hasStockPrecision } = require('./batches');

const OPEN_PICKUP_STATUSES = ['requested', 'approved', 'assigned', 'otw'];
const CLOSED_PICKUP_STATUSES = ['declined', 'cancelled'];
const MAX_PRICE_PER_KG = 100000;

const numberOrNull = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

// Kilograms a request claims. Older requests without a quantity took the whole harvest.
function requestedKg(request, harvest) {
  return numberOrNull(request?.quantity_kg) ?? numberOrNull(harvest?.quantity_kg) ?? 0;
}

// Kilograms of a harvest not yet claimed by a request that was not declined.
function harvestAvailability(harvest, requests = []) {
  const claimed = roundKg(requests
    .filter((request) => request.harvest_id === harvest.id && !CLOSED_PICKUP_STATUSES.includes(request.status))
    .reduce((sum, request) => sum + requestedKg(request, harvest), 0));
  const total = numberOrNull(harvest.quantity_kg) ?? 0;
  return { requested_kg: claimed, available_kg: Math.max(0, roundKg(total - claimed)) };
}

// Quantity x price in pesos, rounded half up to centavos; null when either is
// missing. Both have at most two decimals, so whole hundredths keep it exact
// (2.5 kg x 33.33 = 83.325 -> 83.33).
function estimatedTotal(quantity, price) {
  const kg = numberOrNull(quantity), perKg = numberOrNull(price);
  if (kg == null || perKg == null) return null;
  return Math.round((Math.round(kg * 100) * Math.round(perKg * 100)) / 100) / 100;
}

// Server-side check of the farmer's input before the database re-checks it under
// a row lock. Returns { field, error } or null.
function pickupInputError({ quantity_kg, price_per_kg }, availableKg) {
  const quantity = typeof quantity_kg === 'string' && quantity_kg.trim() !== '' ? Number(quantity_kg) : quantity_kg;
  const price = typeof price_per_kg === 'string' && price_per_kg.trim() !== '' ? Number(price_per_kg) : price_per_kg;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || !hasStockPrecision(quantity)) {
    return { field: 'quantity_kg', error: 'Enter a quantity greater than 0 kg (up to two decimal places).' };
  }
  if (availableKg != null && quantity > availableKg) {
    return { field: 'quantity_kg', error: `You can request up to ${availableKg} kg from this harvest.` };
  }
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price > MAX_PRICE_PER_KG || !hasStockPrecision(price)) {
    return { field: 'price_per_kg', error: 'Enter a price per kg greater than 0 (up to two decimal places).' };
  }
  return null;
}

module.exports = {
  OPEN_PICKUP_STATUSES, CLOSED_PICKUP_STATUSES, MAX_PRICE_PER_KG,
  requestedKg, harvestAvailability, estimatedTotal, pickupInputError,
};
