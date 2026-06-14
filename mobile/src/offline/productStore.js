import api from '../api/client';
import { kvGet, kvSet } from './db';
import { isOnline } from './net';

const CACHE_KEY = 'products_cache';
const QUEUE_KEY = 'products_queue';

export async function getCachedProducts() {
  return (await kvGet(CACHE_KEY)) || [];
}
async function setCachedProducts(list) {
  await kvSet(CACHE_KEY, list);
}
export async function getQueue() {
  return (await kvGet(QUEUE_KEY)) || [];
}
async function setQueue(q) {
  await kvSet(QUEUE_KEY, q);
}

const newQid = () => `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// Read-through: refresh from network, fall back to cache when offline.
export async function fetchProducts() {
  try {
    const data = await api.get('/api/products');
    const list = Array.isArray(data) ? data : [];
    const pending = (await getCachedProducts()).filter((p) => p._pending);
    const merged = [...pending, ...list.filter((s) => !pending.some((p) => p.id === s.id))];
    await setCachedProducts(list);
    return { list: merged, source: 'network' };
  } catch (err) {
    return { list: await getCachedProducts(), source: 'cache', error: err };
  }
}

// Queue an add/edit and optimistically update the cache.
// mutation = { type: 'add', payload } | { type: 'edit', id, payload }
export async function queueProduct(mutation) {
  let queue = await getQueue();
  let cache = await getCachedProducts();

  if (mutation.type === 'edit' && String(mutation.id).startsWith('q-')) {
    // Editing a not-yet-synced product → merge into its pending add.
    queue = queue.map((m) =>
      m._qid === mutation.id && m.type === 'add'
        ? { ...m, payload: { ...m.payload, ...mutation.payload } }
        : m
    );
    cache = cache.map((p) => (p.id === mutation.id ? { ...p, ...mutation.payload } : p));
  } else {
    const entry = { ...mutation, _qid: newQid() };
    queue.push(entry);
    if (mutation.type === 'add') {
      cache = [{ id: entry._qid, ...mutation.payload, _pending: true }, ...cache];
    } else {
      cache = cache.map((p) =>
        p.id === mutation.id ? { ...p, ...mutation.payload, _pending: true } : p
      );
    }
  }

  await setQueue(queue);
  await setCachedProducts(cache);
  return cache;
}

// Replay queued writes oldest-first; stop on first failure.
export async function syncPending() {
  let queue = await getQueue();
  if (queue.length === 0) return { synced: 0, remaining: 0 };
  if (!(await isOnline())) return { synced: 0, remaining: queue.length, offline: true };

  let synced = 0;
  for (const m of [...queue]) {
    try {
      if (m.type === 'add') {
        await api.post('/api/products', m.payload);
      } else if (m.type === 'edit') {
        // Backend PUT only updates price + stock.
        await api.put(`/api/products/${m.id}`, {
          price_per_kg: m.payload.price_per_kg,
          stock_kg: m.payload.stock_kg,
        });
      }
      queue = queue.filter((x) => x._qid !== m._qid);
      await setQueue(queue);
      synced += 1;
    } catch (err) {
      console.warn('[offline] product sync stopped on', m, err);
      break;
    }
  }
  return { synced, remaining: queue.length };
}
