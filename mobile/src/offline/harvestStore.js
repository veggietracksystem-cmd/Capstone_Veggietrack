import NetInfo from '@react-native-community/netinfo';
import api from '../api/client';
import { kvGet, kvSet } from './db';

const CACHE_KEY = 'harvests_cache';
const QUEUE_KEY = 'harvests_queue';

// ---- connectivity ----
export async function isOnline() {
  try {
    const state = await NetInfo.fetch();
    // Treat unknown as online; only explicit false means offline.
    return state.isConnected !== false && state.isInternetReachable !== false;
  } catch {
    return true;
  }
}

// ---- cache + queue accessors ----
export async function getCachedHarvests() {
  return (await kvGet(CACHE_KEY)) || [];
}
async function setCachedHarvests(list) {
  await kvSet(CACHE_KEY, list);
}
export async function getQueue() {
  return (await kvGet(QUEUE_KEY)) || [];
}
async function setQueue(q) {
  await kvSet(QUEUE_KEY, q);
}

const newQid = () => `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// Read-through: fetch from network and refresh cache; on failure use cache.
export async function fetchHarvests() {
  try {
    const data = await api.get('/api/harvests');
    const list = Array.isArray(data) ? data : [];
    // Preserve any still-pending local items so they don't vanish before sync.
    const pending = (await getCachedHarvests()).filter((h) => h._pending);
    const merged = [...pending, ...list.filter((s) => !pending.some((p) => p.id === s.id))];
    await setCachedHarvests(list); // cache the clean server truth
    return { list: merged, source: 'network' };
  } catch (err) {
    const cached = await getCachedHarvests();
    return { list: cached, source: 'cache', error: err };
  }
}

// Queue an add/edit, optimistically update the cache, and return the new list.
// mutation = { type: 'add', payload } | { type: 'edit', id, payload }
export async function queueHarvest(mutation) {
  let queue = await getQueue();
  let cache = await getCachedHarvests();

  // Editing an item that hasn't synced yet → merge into its pending "add".
  if (mutation.type === 'edit' && String(mutation.id).startsWith('q-')) {
    queue = queue.map((m) =>
      m._qid === mutation.id && m.type === 'add'
        ? { ...m, payload: { ...m.payload, ...mutation.payload } }
        : m
    );
    cache = cache.map((h) => (h.id === mutation.id ? { ...h, ...mutation.payload } : h));
  } else {
    const entry = { ...mutation, _qid: newQid() };
    queue.push(entry);
    if (mutation.type === 'add') {
      cache = [
        { id: entry._qid, recorded_at: new Date().toISOString(), ...mutation.payload, _pending: true },
        ...cache,
      ];
    } else {
      cache = cache.map((h) =>
        h.id === mutation.id ? { ...h, ...mutation.payload, _pending: true } : h
      );
    }
  }

  await setQueue(queue);
  await setCachedHarvests(cache);
  return cache;
}

// Replay queued mutations to the backend, oldest first. Stops on first failure.
export async function syncPending() {
  let queue = await getQueue();
  if (queue.length === 0) return { synced: 0, remaining: 0 };
  if (!(await isOnline())) return { synced: 0, remaining: queue.length, offline: true };

  let synced = 0;
  for (const m of [...queue]) {
    try {
      if (m.type === 'add') {
        await api.post('/api/harvests', m.payload);
      } else if (m.type === 'edit') {
        await api.put(`/api/harvests/${m.id}`, m.payload);
      }
      queue = queue.filter((x) => x._qid !== m._qid);
      await setQueue(queue);
      synced += 1;
    } catch (err) {
      // Likely offline again or a server/validation error → stop and keep the rest.
      console.warn('[offline] sync stopped on mutation', m, err);
      break;
    }
  }
  return { synced, remaining: queue.length };
}

// Subscribe to connectivity changes; calls cb() when the device comes online.
export function onReconnect(cb) {
  return NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) cb();
  });
}
