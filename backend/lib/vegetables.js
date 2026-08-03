// Centralized vegetable validation for POST/PUT routes that accept a
// free-text vegetable_name (harvests, products). Keep the keyword list in
// sync with mobile/src/lib/vegetables.js (same data, duplicated across the
// frontend/backend runtime boundary — not across routes on this side).

const VEGETABLE_KEYWORDS = [
  'tomato', 'kamatis', 'eggplant', 'talong', 'okra', 'cabbage', 'repolyo',
  'lettuce', 'litsugas', 'spinach', 'pechay', 'kangkong', 'water spinach',
  'broccoli', 'cauliflower', 'bell pepper', 'chili pepper',
  'carrot', 'karot', 'sweet potato', 'potato', 'onion', 'sibuyas', 'garlic',
  'bawang', 'squash', 'kalabasa',
  'bitter gourd', 'ampalaya', 'bottle gourd', 'upo', 'sponge gourd', 'patola',
  'chayote', 'sayote', 'string beans', 'sitaw', 'radish', 'cucumber',
  'celery', 'mustard greens', 'mustasa', 'malunggay', 'talbos ng kamote',
  'basil', 'oregano', 'cilantro', 'mint', 'parsley',
];

function isVegetable(name) {
  const key = String(name || '').toLowerCase().trim();
  if (!key) return false;
  return VEGETABLE_KEYWORDS.some((keyword) => key.includes(keyword));
}

const VEGETABLE_VALIDATION_MESSAGE = 'Only vegetable products are allowed in VeggieTrack.';

module.exports = { isVegetable, VEGETABLE_VALIDATION_MESSAGE };
