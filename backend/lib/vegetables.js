// Vegetable name validation for routes that accept a free-text vegetable_name.
// Keep in sync with mobile/src/lib/vegetables.js and mobile/src/lib/vegetableNames.js.

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

// Whole-word match with an optional plural suffix, so "basilica" does not match "basil".
function matchesKeyword(key, keyword) {
  return new RegExp(`\\b${escapeRegExp(keyword)}(?:es|s)?\\b`).test(key);
}

function isVegetable(name) {
  const key = String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!key || key.length > 80) return false;
  return VEGETABLE_KEYWORDS.some((keyword) => matchesKeyword(key, keyword));
}

const VEGETABLE_VALIDATION_MESSAGE = 'Only vegetable products are allowed in VeggieTrack.';

// English/Tagalog names for the same vegetable, so stock, FIFO and prices treat
// them as one product. Mirrors mobile/src/lib/vegetableNames.js; longest keyword wins.
const VEGETABLE_NAMES = [
  { keywords: ['tomato', 'kamatis'], en: 'Tomato' },
  { keywords: ['eggplant', 'talong'], en: 'Eggplant' },
  { keywords: ['okra'], en: 'Okra' },
  { keywords: ['cabbage', 'repolyo'], en: 'Cabbage' },
  { keywords: ['lettuce', 'litsugas'], en: 'Lettuce' },
  { keywords: ['spinach'], en: 'Spinach' },
  { keywords: ['pechay'], en: 'Pechay' },
  { keywords: ['kangkong', 'water spinach'], en: 'Water Spinach' },
  { keywords: ['broccoli'], en: 'Broccoli' },
  { keywords: ['cauliflower'], en: 'Cauliflower' },
  { keywords: ['bell pepper'], en: 'Bell Pepper' },
  { keywords: ['chili pepper', 'sili'], en: 'Chili Pepper' },
  { keywords: ['carrot', 'karot'], en: 'Carrot' },
  { keywords: ['sweet potato', 'kamote'], en: 'Sweet Potato' },
  { keywords: ['potato', 'patatas'], en: 'Potato' },
  { keywords: ['onion', 'sibuyas'], en: 'Onion' },
  { keywords: ['garlic', 'bawang'], en: 'Garlic' },
  { keywords: ['squash', 'kalabasa'], en: 'Squash' },
  { keywords: ['bitter gourd', 'ampalaya'], en: 'Bitter Gourd' },
  { keywords: ['bottle gourd', 'upo'], en: 'Bottle Gourd' },
  { keywords: ['sponge gourd', 'patola'], en: 'Sponge Gourd' },
  { keywords: ['chayote', 'sayote'], en: 'Chayote' },
  { keywords: ['string beans', 'sitaw'], en: 'String Beans' },
  { keywords: ['radish', 'labanos'], en: 'Radish' },
  { keywords: ['cucumber', 'pipino'], en: 'Cucumber' },
  { keywords: ['celery'], en: 'Celery' },
  { keywords: ['mustard greens', 'mustasa'], en: 'Mustard Greens' },
  { keywords: ['malunggay'], en: 'Malunggay' },
  { keywords: ['talbos ng kamote', 'sweet potato leaves'], en: 'Sweet Potato Leaves' },
  { keywords: ['basil'], en: 'Basil' },
  { keywords: ['oregano'], en: 'Oregano' },
  { keywords: ['cilantro', 'wansoy'], en: 'Cilantro' },
  { keywords: ['mint'], en: 'Mint' },
  { keywords: ['parsley'], en: 'Parsley' },
]
  .flatMap((entry) => entry.keywords.map((keyword) => ({ keyword, en: entry.en })))
  .sort((a, b) => b.keyword.length - a.keyword.length);

// One display name per vegetable ("Kamatis" -> "Tomato"). Unknown names come
// back trimmed and unchanged.
function canonicalVegetableName(name) {
  const trimmed = String(name || '').trim().replace(/\s+/g, ' ');
  const key = trimmed.toLowerCase();
  const match = key && VEGETABLE_NAMES.find((v) => matchesKeyword(key, v.keyword));
  return match ? match.en : trimmed;
}

// Grouping key: batches whose names share this key are the same product.
function vegetableKey(name) {
  return canonicalVegetableName(name).toLowerCase();
}

module.exports = { isVegetable, VEGETABLE_VALIDATION_MESSAGE, matchesKeyword, canonicalVegetableName, vegetableKey };
