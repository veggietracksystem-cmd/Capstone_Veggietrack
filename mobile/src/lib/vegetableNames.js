// Localizes a stored vegetable name (freeform text, entered in either
// English or Tagalog — see ./vegetables.js) to the user's currently selected
// display language. Pairs mirror the English/Tagalog keyword pairs already
// validated as equivalent in ./vegetables.js, so a name typed in one
// language always reads back in whichever language the app is set to.
//
// Longest keyword wins when a name matches more than one (e.g. "Talbos ng
// Kamote" must match before the generic "Kamote" substring inside it) —
// same sort rule as ./vegetables.js and ./vegetableIcons.js.
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
  { keywords: ['chili pepper'], en: 'Chili Pepper', tl: 'Sili' },
  { keywords: ['carrot', 'karot'], en: 'Carrot', tl: 'Karot' },
  { keywords: ['sweet potato'], en: 'Sweet Potato', tl: 'Kamote' },
  { keywords: ['potato'], en: 'Potato', tl: 'Patatas' },
  { keywords: ['onion', 'sibuyas'], en: 'Onion', tl: 'Sibuyas' },
  { keywords: ['garlic', 'bawang'], en: 'Garlic', tl: 'Bawang' },
  { keywords: ['squash', 'kalabasa'], en: 'Squash', tl: 'Kalabasa' },
  { keywords: ['bitter gourd', 'ampalaya'], en: 'Bitter Gourd', tl: 'Ampalaya' },
  { keywords: ['bottle gourd', 'upo'], en: 'Bottle Gourd', tl: 'Upo' },
  { keywords: ['sponge gourd', 'patola'], en: 'Sponge Gourd', tl: 'Patola' },
  { keywords: ['chayote', 'sayote'], en: 'Chayote', tl: 'Sayote' },
  { keywords: ['string beans', 'sitaw'], en: 'String Beans', tl: 'Sitaw' },
  { keywords: ['radish'], en: 'Radish', tl: 'Labanos' },
  { keywords: ['cucumber'], en: 'Cucumber', tl: 'Pipino' },
  { keywords: ['celery'], en: 'Celery', tl: 'Celery' },
  { keywords: ['mustard greens', 'mustasa'], en: 'Mustard Greens', tl: 'Mustasa' },
  { keywords: ['malunggay'], en: 'Malunggay', tl: 'Malunggay' },
  { keywords: ['talbos ng kamote'], en: 'Sweet Potato Leaves', tl: 'Talbos ng Kamote' },
  { keywords: ['basil'], en: 'Basil', tl: 'Basil' },
  { keywords: ['oregano'], en: 'Oregano', tl: 'Oregano' },
  { keywords: ['cilantro'], en: 'Cilantro', tl: 'Wansoy' },
  { keywords: ['mint'], en: 'Mint', tl: 'Mint' },
  { keywords: ['parsley'], en: 'Parsley', tl: 'Parsley' },
]
  .flatMap((entry) => entry.keywords.map((keyword) => ({ keyword, en: entry.en, tl: entry.tl })))
  .sort((a, b) => b.keyword.length - a.keyword.length);

// Returns `name` rewritten in `language` ('en' | 'tl') when it matches a
// known vegetable, otherwise returns `name` unchanged.
export function localizeVegetableName(name, language) {
  const key = String(name || '').toLowerCase().trim();
  if (!key) return name;
  const match = VEGETABLE_NAMES.find((v) => key.includes(v.keyword));
  if (!match) return name;
  return language === 'tl' ? match.tl : match.en;
}
