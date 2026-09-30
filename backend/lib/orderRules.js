const { vegetableKey } = require('./vegetables');
const { hasStockPrecision, roundKg } = require('./batches');

function validateOrderItems(items) {
  if (!Array.isArray(items) || !items.length || items.some(i => !i || typeof i.vegetable_name !== 'string' || !i.vegetable_name.trim() || typeof i.quantity_kg !== 'number' || !Number.isFinite(i.quantity_kg) || i.quantity_kg <= 0)) {
    throw new Error('Each item must have a vegetable name and a positive numeric quantity in kg.');
  }
  if (items.reduce((sum, i) => sum + i.quantity_kg, 0) < 5) throw new Error('Minimum order is 5 kg in total.');
  if (items.some(i => i.quantity_kg > 1000000 || !hasStockPrecision(i.quantity_kg))) {
    throw new Error('Quantities must have at most two decimal places and be at most 1,000,000 kg.');
  }
  // Combine repeated vegetables (any spelling) so the same stock is not drawn twice.
  const combined = new Map();
  for (const i of items) {
    const key = vegetableKey(i.vegetable_name);
    const line = combined.get(key);
    if (line) line.quantity_kg = roundKg(line.quantity_kg + i.quantity_kg);
    else combined.set(key, { vegetable_name: i.vegetable_name, quantity_kg: i.quantity_kg });
  }
  return [...combined.values()];
}
module.exports = { validateOrderItems };
