function validateOrderItems(items) {
  if (!Array.isArray(items) || !items.length || items.some(i => !i || typeof i.vegetable_name !== 'string' || !i.vegetable_name.trim() || typeof i.quantity_kg !== 'number' || !Number.isFinite(i.quantity_kg) || i.quantity_kg <= 0)) {
    throw new Error('Each item must have a vegetable name and a positive numeric quantity in kg.');
  }
  if (items.reduce((sum, i) => sum + i.quantity_kg, 0) < 5) throw new Error('Minimum order is 5 kg in total.');
  // Combine repeated vegetables before FIFO allocation to avoid drawing the same stock twice.
  const quantities = new Map();
  for (const i of items) quantities.set(i.vegetable_name, (quantities.get(i.vegetable_name) || 0) + i.quantity_kg);
  return [...quantities].map(([vegetable_name, quantity_kg]) => ({ vegetable_name, quantity_kg }));
}
module.exports = { validateOrderItems };
