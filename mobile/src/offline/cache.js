import { kvGet, kvSet } from './db';

// Generic read-through cache for list endpoints.
// fetchFn: async () => array (throws when offline / unreachable).
// Returns { list, source: 'network' | 'cache' }.
export async function readThrough(cacheKey, fetchFn) {
  try {
    const data = await fetchFn();
    const list = Array.isArray(data) ? data : [];
    await kvSet(cacheKey, list);
    return { list, source: 'network' };
  } catch (err) {
    const cached = (await kvGet(cacheKey)) || [];
    return { list: cached, source: 'cache', error: err };
  }
}
