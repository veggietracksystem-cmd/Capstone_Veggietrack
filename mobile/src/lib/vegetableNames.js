// Match longer names first so "Talbos ng Kamote" remains distinct from "Kamote".
const VEGETABLE_NAMES = [
  { keywords: ['tomato', 'kamatis'], en: 'Tomato', tl: 'Kamatis' },
  { keywords: ['eggplant', 'talong'], en: 'Eggplant', tl: 'Talong' },
  { keywords: ['okra'], en: 'Okra', tl: 'Okra' },
  { keywords: ['cabbage', 'repolyo'], en: 'Cabbage', tl: 'Repolyo' },
  { keywords: ['lettuce', 'litsugas'], en: 'Lettuce', tl: 'Litsugas' },
  { keywords: ['spinach'], en: 'Spinach', tl: 'Spinach' },
  { keywords: ['pechay'], en: 'Pechay', tl: 'Pechay' },
  { keywords: ['kangkong', 'water spinach'], en: 'Water Spinach', tl: 'Kangkong' },
  { keywords: ['broccoli'], en: 'Broccoli', tl: 'Broccoli' },
  { keywords: ['cauliflower'], en: 'Cauliflower', tl: 'Cauliflower' },
  { keywords: ['bell pepper'], en: 'Bell Pepper', tl: 'Bell Pepper' },
  { keywords: ['chili pepper', 'sili'], en: 'Chili Pepper', tl: 'Sili' },
  { keywords: ['carrot', 'karot'], en: 'Carrot', tl: 'Karot' },
  { keywords: ['sweet potato', 'kamote'], en: 'Sweet Potato', tl: 'Kamote' },
  { keywords: ['potato', 'patatas'], en: 'Potato', tl: 'Patatas' },
  { keywords: ['onion', 'sibuyas'], en: 'Onion', tl: 'Sibuyas' },
  { keywords: ['garlic', 'bawang'], en: 'Garlic', tl: 'Bawang' },
  { keywords: ['squash', 'kalabasa'], en: 'Squash', tl: 'Kalabasa' },
  { keywords: ['bitter gourd', 'ampalaya'], en: 'Bitter Gourd', tl: 'Ampalaya' },
  { keywords: ['bottle gourd', 'upo'], en: 'Bottle Gourd', tl: 'Upo' },
  { keywords: ['sponge gourd', 'patola'], en: 'Sponge Gourd', tl: 'Patola' },
  { keywords: ['chayote', 'sayote'], en: 'Chayote', tl: 'Sayote' },
  { keywords: ['string beans', 'sitaw'], en: 'String Beans', tl: 'Sitaw' },
  { keywords: ['radish', 'labanos'], en: 'Radish', tl: 'Labanos' },
  { keywords: ['cucumber', 'pipino'], en: 'Cucumber', tl: 'Pipino' },
  { keywords: ['celery'], en: 'Celery', tl: 'Celery' },
  { keywords: ['mustard greens', 'mustasa'], en: 'Mustard Greens', tl: 'Mustasa' },
  { keywords: ['malunggay'], en: 'Malunggay', tl: 'Malunggay' },
  { keywords: ['talbos ng kamote', 'sweet potato leaves'], en: 'Sweet Potato Leaves', tl: 'Talbos ng Kamote' },
  { keywords: ['basil'], en: 'Basil', tl: 'Basil' },
  { keywords: ['oregano'], en: 'Oregano', tl: 'Oregano' },
  { keywords: ['cilantro', 'wansoy'], en: 'Cilantro', tl: 'Wansoy' },
  { keywords: ['mint'], en: 'Mint', tl: 'Mint' },
  { keywords: ['parsley'], en: 'Parsley', tl: 'Parsley' },
]
  .flatMap((entry) => entry.keywords.map((keyword) => ({ keyword, en: entry.en, tl: entry.tl })))
  .sort((a, b) => b.keyword.length - a.keyword.length);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesKeyword(key, keyword) {
  return new RegExp(`\\b${escapeRegExp(keyword)}(?:es|s)?\\b`).test(key);
}

export function localizeVegetableName(name, language) {
  const key = String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
  if (!key) return name;
  const match = VEGETABLE_NAMES.find((v) => matchesKeyword(key, v.keyword));
  if (!match) return name;
  return language === 'tl' ? match.tl : match.en;
}

// Same-vegetable key: "Kamatis", "tomato" and "Tomatoes" are one product.
// Matches vegetableKey() in backend/lib/vegetables.js.
export function vegetableKey(name) {
  return String(localizeVegetableName(name, 'en') || '').toLowerCase().trim().replace(/\s+/g, ' ');
}
