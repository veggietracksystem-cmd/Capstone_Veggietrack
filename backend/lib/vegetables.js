// Centralized vegetable validation for POST/PUT routes that accept a
// free-text vegetable_name (harvests, products). Keep the keyword list in
// sync with mobile/src/lib/vegetables.js (same data, duplicated across the
// frontend/backend runtime boundary — not across routes on this side).

const VEGETABLE_KEYWORDS = [
  'tomato', 'eggplant', 'okra', 'cabbage', 'lettuce', 'spinach', 'pechay',
  'kangkong', 'broccoli', 'cauliflower', 'bell pepper', 'chili pepper',
  'carrot', 'sweet potato', 'potato', 'onion', 'garlic', 'squash',
  'bitter gourd', 'ampalaya', 'bottle gourd', 'upo', 'sponge gourd', 'patola',
  'chayote', 'sayote', 'string beans', 'sitaw', 'radish', 'cucumber',
  'celery', 'mustard greens', 'malunggay', 'talbos ng kamote',
  'basil', 'oregano', 'cilantro', 'mint', 'parsley',
];

function isVegetable(name) {
  const key = String(name || '').toLowerCase().trim();
  if (!key) return false;
  return VEGETABLE_KEYWORDS.some((keyword) => key.includes(keyword));
}

const VEGETABLE_VALIDATION_MESSAGE = 'Only vegetable products are allowed in VeggieTrack.';

module.exports = { isVegetable, VEGETABLE_VALIDATION_MESSAGE };
