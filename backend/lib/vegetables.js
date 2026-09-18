// Centralized vegetable validation for POST/PUT routes that accept a
// free-text vegetable_name (harvests, products). Keep the keyword list in
// sync with mobile/src/lib/vegetables.js (same data, duplicated across the
// frontend/backend runtime boundary — not across routes on this side).

const VEGETABLE_KEYWORDS = [
  'tomato', 'kamatis', 'eggplant', 'talong', 'okra', 'cabbage', 'repolyo',
  'lettuce', 'litsugas', 'spinach', 'pechay', 'kangkong', 'water spinach',
  'broccoli', 'cauliflower', 'bell pepper', 'chili pepper', 'sili',
  'carrot', 'karot', 'sweet potato', 'kamote', 'potato', 'patatas', 'onion', 'sibuyas', 'garlic',
  'bawang', 'squash', 'kalabasa',
  'bitter gourd', 'ampalaya', 'bottle gourd', 'upo', 'sponge gourd', 'patola',
  'chayote', 'sayote', 'string beans', 'sitaw', 'radish', 'labanos', 'cucumber', 'pipino',
  'celery', 'mustard greens', 'mustasa', 'malunggay', 'talbos ng kamote',
  'basil', 'oregano', 'cilantro', 'wansoy', 'mint', 'parsley',
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whole-word match (with an optional plural suffix), not raw substring —
// "basilica" must not match "basil", "upon" must not match "upo", and
// "eggplantxyz" must not match "eggplant". "Fresh Tomato", "Red Onion" etc.
// still match because the keyword still appears as its own word.
function matchesKeyword(key, keyword) {
  return new RegExp(`\\b${escapeRegExp(keyword)}(?:es|s)?\\b`).test(key);
}

function isVegetable(name) {
  const key = String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!key || key.length > 80) return false;
  return VEGETABLE_KEYWORDS.some((keyword) => matchesKeyword(key, keyword));
}

const VEGETABLE_VALIDATION_MESSAGE = 'Only vegetable products are allowed in VeggieTrack.';

module.exports = { isVegetable, VEGETABLE_VALIDATION_MESSAGE, matchesKeyword };
