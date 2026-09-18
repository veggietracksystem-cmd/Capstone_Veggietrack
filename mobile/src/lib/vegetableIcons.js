// Shared vegetable image (+ tile background) lookup, keyed by the same keywords
// as the validation/category list in ./vegetables.js. English and Tagalog
// names for the same vegetable always resolve to the same icon so the UI
// stays consistent regardless of which language a product/harvest was named
// in.
//
// Longest keyword wins when a name matches more than one (e.g. "Talbos ng
// Kamote" must match before the generic "kamote" substring inside it) —
// mirrors the sort in ./vegetables.js.
const VEGETABLE_ICONS = [
  { keyword: 'tomato', source: require('../../assets/vegetables/tomato.png'), bg: '#ffebee' },
  { keyword: 'kamatis', source: require('../../assets/vegetables/tomato.png'), bg: '#ffebee' },
  { keyword: 'eggplant', source: require('../../assets/vegetables/eggplant.png'), bg: '#f3e5f5' },
  { keyword: 'talong', source: require('../../assets/vegetables/eggplant.png'), bg: '#f3e5f5' },
  { keyword: 'okra', source: require('../../assets/vegetables/okra.png'), bg: '#e8f5e9' },
  { keyword: 'cabbage', source: require('../../assets/vegetables/cabbage.png'), bg: '#e8f5e9' },
  { keyword: 'repolyo', source: require('../../assets/vegetables/cabbage.png'), bg: '#e8f5e9' },
  { keyword: 'lettuce', source: require('../../assets/vegetables/lettuce.png'), bg: '#e8f5e9' },
  { keyword: 'litsugas', source: require('../../assets/vegetables/lettuce.png'), bg: '#e8f5e9' },
  { keyword: 'spinach', source: require('../../assets/vegetables/spinach.png'), bg: '#e8f5e9' },
  { keyword: 'pechay', source: require('../../assets/vegetables/pechay.png'), bg: '#e8f5e9' },
  { keyword: 'kangkong', source: require('../../assets/vegetables/kangkong.png'), bg: '#e8f5e9' },
  { keyword: 'water spinach', source: require('../../assets/vegetables/kangkong.png'), bg: '#e8f5e9' },
  { keyword: 'broccoli', source: require('../../assets/vegetables/broccoli.png'), bg: '#e8f5e9' },
  { keyword: 'cauliflower', source: require('../../assets/vegetables/cauliflower.png'), bg: '#f5f5f5' },
  { keyword: 'bell pepper', source: require('../../assets/vegetables/bell-pepper.png'), bg: '#ffebee' },
  { keyword: 'chili pepper', source: require('../../assets/vegetables/chili-pepper.png'), bg: '#ffebee' },
  { keyword: 'sili', source: require('../../assets/vegetables/chili-pepper.png'), bg: '#ffebee' },
  { keyword: 'carrot', source: require('../../assets/vegetables/carrot.png'), bg: '#fff3e0' },
  { keyword: 'karot', source: require('../../assets/vegetables/carrot.png'), bg: '#fff3e0' },
  { keyword: 'sweet potato', source: require('../../assets/vegetables/sweet-potato.png'), bg: '#fbe9e7' },
  { keyword: 'kamote', source: require('../../assets/vegetables/sweet-potato.png'), bg: '#fbe9e7' },
  { keyword: 'potato', source: require('../../assets/vegetables/potato.png'), bg: '#fbe9e7' },
  { keyword: 'patatas', source: require('../../assets/vegetables/potato.png'), bg: '#fbe9e7' },
  { keyword: 'onion', source: require('../../assets/vegetables/onion.png'), bg: '#f3e5f5' },
  { keyword: 'sibuyas', source: require('../../assets/vegetables/onion.png'), bg: '#f3e5f5' },
  { keyword: 'garlic', source: require('../../assets/vegetables/garlic.png'), bg: '#f5f5f5' },
  { keyword: 'bawang', source: require('../../assets/vegetables/garlic.png'), bg: '#f5f5f5' },
  { keyword: 'squash', source: require('../../assets/vegetables/squash.png'), bg: '#fff3e0' },
  { keyword: 'kalabasa', source: require('../../assets/vegetables/squash.png'), bg: '#fff3e0' },
  { keyword: 'bitter gourd', source: require('../../assets/vegetables/bitter-gourd.png'), bg: '#e8f5e9' },
  { keyword: 'ampalaya', source: require('../../assets/vegetables/bitter-gourd.png'), bg: '#e8f5e9' },
  { keyword: 'bottle gourd', source: require('../../assets/vegetables/bottle-gourd.png'), bg: '#e8f5e9' },
  { keyword: 'upo', source: require('../../assets/vegetables/bottle-gourd.png'), bg: '#e8f5e9' },
  { keyword: 'sponge gourd', source: require('../../assets/vegetables/sponge-gourd.png'), bg: '#e8f5e9' },
  { keyword: 'patola', source: require('../../assets/vegetables/sponge-gourd.png'), bg: '#e8f5e9' },
  { keyword: 'chayote', source: require('../../assets/vegetables/chayote.png'), bg: '#e8f5e9' },
  { keyword: 'sayote', source: require('../../assets/vegetables/chayote.png'), bg: '#e8f5e9' },
  { keyword: 'string beans', source: require('../../assets/vegetables/string-beans.png'), bg: '#e8f5e9' },
  { keyword: 'sitaw', source: require('../../assets/vegetables/string-beans.png'), bg: '#e8f5e9' },
  { keyword: 'radish', source: require('../../assets/vegetables/radish.png'), bg: '#fce4ec' },
  { keyword: 'labanos', source: require('../../assets/vegetables/radish.png'), bg: '#fce4ec' },
  { keyword: 'cucumber', source: require('../../assets/vegetables/cucumber.png'), bg: '#e8f5e9' },
  { keyword: 'pipino', source: require('../../assets/vegetables/cucumber.png'), bg: '#e8f5e9' },
  { keyword: 'celery', source: require('../../assets/vegetables/celery.png'), bg: '#e8f5e9' },
  { keyword: 'mustard greens', source: require('../../assets/vegetables/mustard-greens.png'), bg: '#e8f5e9' },
  { keyword: 'mustasa', source: require('../../assets/vegetables/mustard-greens.png'), bg: '#e8f5e9' },
  { keyword: 'malunggay', source: require('../../assets/vegetables/malunggay.png'), bg: '#e8f5e9' },
  { keyword: 'talbos ng kamote', source: require('../../assets/vegetables/talbos-ng-kamote.png'), bg: '#e8f5e9' },
  { keyword: 'basil', source: require('../../assets/vegetables/basil.png'), bg: '#e8f5e9' },
  { keyword: 'oregano', source: require('../../assets/vegetables/oregano.png'), bg: '#e8f5e9' },
  { keyword: 'cilantro', source: require('../../assets/vegetables/cilantro.png'), bg: '#e8f5e9' },
  { keyword: 'wansoy', source: require('../../assets/vegetables/cilantro.png'), bg: '#e8f5e9' },
  { keyword: 'mint', source: require('../../assets/vegetables/mint.png'), bg: '#e8f5e9' },
  { keyword: 'parsley', source: require('../../assets/vegetables/parsley.png'), bg: '#e8f5e9' },
].sort((a, b) => b.keyword.length - a.keyword.length);

const DEFAULT_TILE = { source: null, bg: '#e8f5e9' };

// Returns { source, bg } for a vegetable name (English or Tagalog). Unknown
// names have no source so callers can render a neutral vector placeholder.
export function getVegetableTile(name) {
  const key = String(name || '').toLowerCase().trim();
  if (!key) return DEFAULT_TILE;
  const match = VEGETABLE_ICONS.find((v) => key.includes(v.keyword));
  return match ? { source: match.source, bg: match.bg } : DEFAULT_TILE;
}

export function getVegetableIcon(name) {
  return getVegetableTile(name).source;
}
