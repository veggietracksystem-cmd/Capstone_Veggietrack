// Shared vegetable icon (+ tile background) lookup, keyed by the same keywords
// as the validation/category list in ./vegetables.js. English and Tagalog
// names for the same vegetable always resolve to the same icon so the UI
// stays consistent regardless of which language a product/harvest was named
// in. When no exact emoji exists for a vegetable, the closest recognizable
// produce emoji is used instead (documented inline where it isn't obvious).
//
// Longest keyword wins when a name matches more than one (e.g. "Talbos ng
// Kamote" must match before the generic "kamote" substring inside it) —
// mirrors the sort in ./vegetables.js.
const VEGETABLE_ICONS = [
  { keyword: 'tomato', icon: '🍅', bg: '#ffebee' },
  { keyword: 'kamatis', icon: '🍅', bg: '#ffebee' },
  { keyword: 'eggplant', icon: '🍆', bg: '#f3e5f5' },
  { keyword: 'talong', icon: '🍆', bg: '#f3e5f5' },
  { keyword: 'okra', icon: '🫛', bg: '#e8f5e9' }, // no dedicated okra emoji — pea pod is the closest pod shape
  { keyword: 'cabbage', icon: '🥬', bg: '#e8f5e9' }, // no dedicated cabbage emoji — leafy-green is closest
  { keyword: 'repolyo', icon: '🥬', bg: '#e8f5e9' },
  { keyword: 'lettuce', icon: '🥬', bg: '#e8f5e9' },
  { keyword: 'litsugas', icon: '🥬', bg: '#e8f5e9' },
  { keyword: 'spinach', icon: '🥬', bg: '#e8f5e9' },
  { keyword: 'pechay', icon: '🥬', bg: '#e8f5e9' }, // bok choy — closest exact match to the leafy-green emoji
  { keyword: 'kangkong', icon: '🥬', bg: '#e8f5e9' },
  { keyword: 'water spinach', icon: '🥬', bg: '#e8f5e9' },
  { keyword: 'broccoli', icon: '🥦', bg: '#e8f5e9' },
  { keyword: 'cauliflower', icon: '🥦', bg: '#f5f5f5' }, // no cauliflower emoji — closest cruciferous relative
  { keyword: 'bell pepper', icon: '🫑', bg: '#ffebee' },
  { keyword: 'chili pepper', icon: '🌶️', bg: '#ffebee' },
  { keyword: 'carrot', icon: '🥕', bg: '#fff3e0' },
  { keyword: 'karot', icon: '🥕', bg: '#fff3e0' },
  { keyword: 'sweet potato', icon: '🍠', bg: '#fbe9e7' },
  { keyword: 'potato', icon: '🥔', bg: '#fbe9e7' },
  { keyword: 'onion', icon: '🧅', bg: '#f3e5f5' },
  { keyword: 'sibuyas', icon: '🧅', bg: '#f3e5f5' },
  { keyword: 'garlic', icon: '🧄', bg: '#f5f5f5' },
  { keyword: 'bawang', icon: '🧄', bg: '#f5f5f5' },
  { keyword: 'squash', icon: '🎃', bg: '#fff3e0' },
  { keyword: 'kalabasa', icon: '🎃', bg: '#fff3e0' },
  { keyword: 'bitter gourd', icon: '🥒', bg: '#e8f5e9' }, // no gourd emoji — cucumber is the closest elongated shape
  { keyword: 'ampalaya', icon: '🥒', bg: '#e8f5e9' },
  { keyword: 'bottle gourd', icon: '🥒', bg: '#e8f5e9' },
  { keyword: 'upo', icon: '🥒', bg: '#e8f5e9' },
  { keyword: 'sponge gourd', icon: '🥒', bg: '#e8f5e9' },
  { keyword: 'patola', icon: '🥒', bg: '#e8f5e9' },
  { keyword: 'chayote', icon: '🍏', bg: '#e8f5e9' }, // no chayote emoji — green apple is the closest round-fruit shape
  { keyword: 'sayote', icon: '🍏', bg: '#e8f5e9' },
  { keyword: 'string beans', icon: '🫛', bg: '#e8f5e9' },
  { keyword: 'sitaw', icon: '🫛', bg: '#e8f5e9' },
  { keyword: 'radish', icon: '🥕', bg: '#fce4ec' }, // no radish emoji — closest root-vegetable shape
  { keyword: 'cucumber', icon: '🥒', bg: '#e8f5e9' },
  { keyword: 'celery', icon: '🥬', bg: '#e8f5e9' },
  { keyword: 'mustard greens', icon: '🥬', bg: '#e8f5e9' },
  { keyword: 'mustasa', icon: '🥬', bg: '#e8f5e9' },
  { keyword: 'malunggay', icon: '🌿', bg: '#e8f5e9' },
  { keyword: 'talbos ng kamote', icon: '🍃', bg: '#e8f5e9' },
  { keyword: 'basil', icon: '🌿', bg: '#e8f5e9' },
  { keyword: 'oregano', icon: '🌿', bg: '#e8f5e9' },
  { keyword: 'cilantro', icon: '🌿', bg: '#e8f5e9' },
  { keyword: 'mint', icon: '🌿', bg: '#e8f5e9' },
  { keyword: 'parsley', icon: '🌿', bg: '#e8f5e9' },
].sort((a, b) => b.keyword.length - a.keyword.length);

const DEFAULT_TILE = { icon: '🥬', bg: '#e8f5e9' };

// Returns { icon, bg } for a vegetable name (English or Tagalog), falling
// back to a generic leafy-green tile for unrecognized names.
export function getVegetableTile(name) {
  const key = String(name || '').toLowerCase().trim();
  if (!key) return DEFAULT_TILE;
  const match = VEGETABLE_ICONS.find((v) => key.includes(v.keyword));
  return match ? { icon: match.icon, bg: match.bg } : DEFAULT_TILE;
}

export function getVegetableIcon(name) {
  return getVegetableTile(name).icon;
}
