import AsyncStorage from '@react-native-async-storage/async-storage';
import { vegetableKey } from './vegetableNames';

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
  const available = new Map(products.map(product => [vegetableKey(product.vegetable_name), product]));
  const merged = new Map();
  for (const item of cart) {
    const name = vegetableKey(item.vegetable_name || item.name);
    const product = available.get(name);
    const stock = Number(product?.available_kg);
    const quantity = Number(item.quantity);
    const price = Number(product?.price_per_kg);
    if (!Number.isFinite(stock) || stock <= 0 || !Number.isFinite(quantity) || quantity <= 0
      || !Number.isFinite(price) || price <= 0) continue;
    merged.set(name, {
      ...item,
      vegetable_name: product.vegetable_name,
      name: product.vegetable_name,
      price,
      stock,
      quantity: Math.min((merged.get(name)?.quantity || 0) + quantity, stock),
    });
  }
  return [...merged.values()];
}
