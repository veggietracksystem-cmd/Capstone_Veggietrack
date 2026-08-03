// Centralized vegetable catalog: shared by the category filter (Browse/Product
// List) and the "only vegetables allowed" validation on product/harvest forms.
// Keep this in sync with backend/lib/vegetables.js (same keywords/categories —
// duplicated across the frontend/backend runtime boundary, not across screens).

export const CATEGORIES = [
  'All',
  'Leafy Greens',
  'Root Vegetables',
  'Fruiting Vegetables',
  'Cruciferous Vegetables',
  'Herbs',
];

// Longest keyword wins when a name matches more than one (e.g. "Talbos ng
// Kamote" must match before the generic "Kamote" substring inside it).
const VEGETABLE_KEYWORDS = [
  { keyword: 'tomato', category: 'Fruiting Vegetables' },
  { keyword: 'kamatis', category: 'Fruiting Vegetables' },
  { keyword: 'eggplant', category: 'Fruiting Vegetables' },
  { keyword: 'talong', category: 'Fruiting Vegetables' },
  { keyword: 'okra', category: 'Fruiting Vegetables' },
  { keyword: 'cabbage', category: 'Cruciferous Vegetables' },
  { keyword: 'repolyo', category: 'Cruciferous Vegetables' },
  { keyword: 'lettuce', category: 'Leafy Greens' },
  { keyword: 'litsugas', category: 'Leafy Greens' },
  { keyword: 'spinach', category: 'Leafy Greens' },
  { keyword: 'pechay', category: 'Leafy Greens' },
  { keyword: 'kangkong', category: 'Leafy Greens' },
  { keyword: 'water spinach', category: 'Leafy Greens' },
  { keyword: 'broccoli', category: 'Cruciferous Vegetables' },
  { keyword: 'cauliflower', category: 'Cruciferous Vegetables' },
  { keyword: 'bell pepper', category: 'Fruiting Vegetables' },
  { keyword: 'chili pepper', category: 'Fruiting Vegetables' },
  { keyword: 'carrot', category: 'Root Vegetables' },
  { keyword: 'karot', category: 'Root Vegetables' },
  { keyword: 'sweet potato', category: 'Root Vegetables' },
  { keyword: 'potato', category: 'Root Vegetables' },
  { keyword: 'onion', category: 'Root Vegetables' },
  { keyword: 'sibuyas', category: 'Root Vegetables' },
  { keyword: 'garlic', category: 'Root Vegetables' },
  { keyword: 'bawang', category: 'Root Vegetables' },
  { keyword: 'squash', category: 'Fruiting Vegetables' },
  { keyword: 'kalabasa', category: 'Fruiting Vegetables' },
  { keyword: 'bitter gourd', category: 'Fruiting Vegetables' },
  { keyword: 'ampalaya', category: 'Fruiting Vegetables' },
  { keyword: 'bottle gourd', category: 'Fruiting Vegetables' },
  { keyword: 'upo', category: 'Fruiting Vegetables' },
  { keyword: 'sponge gourd', category: 'Fruiting Vegetables' },
  { keyword: 'patola', category: 'Fruiting Vegetables' },
  { keyword: 'chayote', category: 'Fruiting Vegetables' },
  { keyword: 'sayote', category: 'Fruiting Vegetables' },
  { keyword: 'string beans', category: 'Fruiting Vegetables' },
  { keyword: 'sitaw', category: 'Fruiting Vegetables' },
  { keyword: 'radish', category: 'Root Vegetables' },
  { keyword: 'cucumber', category: 'Fruiting Vegetables' },
  { keyword: 'celery', category: 'Leafy Greens' },
  { keyword: 'mustard greens', category: 'Cruciferous Vegetables' },
  { keyword: 'mustasa', category: 'Cruciferous Vegetables' },
  { keyword: 'malunggay', category: 'Leafy Greens' },
  { keyword: 'talbos ng kamote', category: 'Leafy Greens' },
  { keyword: 'basil', category: 'Herbs' },
  { keyword: 'oregano', category: 'Herbs' },
  { keyword: 'cilantro', category: 'Herbs' },
  { keyword: 'mint', category: 'Herbs' },
  { keyword: 'parsley', category: 'Herbs' },
].sort((a, b) => b.keyword.length - a.keyword.length);

// Returns the matching category, or null if `name` doesn't look like a
// known vegetable.
export function getCategory(name) {
  const key = String(name || '').toLowerCase().trim();
  if (!key) return null;
  const match = VEGETABLE_KEYWORDS.find((v) => key.includes(v.keyword));
  return match ? match.category : null;
}

export function isVegetable(name) {
  return getCategory(name) !== null;
}

export const VEGETABLE_VALIDATION_MESSAGE = 'Only vegetable products are allowed in VeggieTrack.';
