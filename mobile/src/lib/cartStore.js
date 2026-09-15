import AsyncStorage from '@react-native-async-storage/async-storage';

const queues = new Map();
const listeners = new Map();
const key = id => `veggietrack:cart:${id}`;
export async function readCart(id) {
  await queues.get(id);
  const raw = await AsyncStorage.getItem(key(id));
  const cart = raw ? JSON.parse(raw) : [];
  return Array.isArray(cart) ? cart : [];
}
export function saveCart(id, cart) {
  const write = (queues.get(id) || Promise.resolve()).catch(() => {}).then(() => AsyncStorage.setItem(key(id), JSON.stringify(cart)));
  queues.set(id, write);
  return write;
}
export function subscribeCart(id, listener) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(listener);
  return () => listeners.get(id)?.delete(listener);
}
export async function clearCheckedOutCart(id) {
  // Notify the mounted dashboard immediately, before navigation or another render.
  listeners.get(id)?.forEach(listener => listener([]));
  await saveCart(id, []);
}
export function reconcileCart(cart, products) {
  return cart.flatMap(item => {
    const product = products.find(p => p.vegetable_name === item.vegetable_name);
    if (!product || !(Number(product.available_kg) > 0)) return [];
    return [{ ...item, price: Number(product.price_per_kg), stock: Number(product.available_kg), quantity: Math.min(item.quantity, Number(product.available_kg)) }];
  });
}
