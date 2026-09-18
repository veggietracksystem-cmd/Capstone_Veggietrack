import { BACKEND_URL } from '@env';

const BASE_URL = BACKEND_URL || 'http://localhost:3000';
let authToken = null;
let generation = 0;
let onUnauthorized = null;
let onBlocked = null;
let tokenProvider = null;
export function setTokenProvider(fn) { tokenProvider = fn; }
export function setBlockedHandler(fn) { onBlocked = fn; }
export function setAuthToken(token) {
  if (token !== authToken) { authToken = token; generation += 1; }
}
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function responseData(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}
function failure(response, data) {
  return Object.assign(new Error(data?.error || `Request failed (${response.status})`), { status: response.status, data, code: data?.code });
}
async function request(path, { method = 'GET', body, headers = {}, signal, timeoutMs = 30000 } = {}) {
  if (tokenProvider) setAuthToken(await tokenProvider());
  const requestGeneration = generation;
  // Dynamic feeds must not be served from a browser/proxy cache. Offline
  // reads are handled explicitly by readThrough(), not by HTTP caching.
  const finalHeaders = { 'Content-Type': 'application/json', ...(method === 'GET' ? { 'Cache-Control': 'no-cache' } : {}), ...headers };
  if (authToken && !finalHeaders.Authorization) finalHeaders.Authorization = `Bearer ${authToken}`;
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  let rejectCancellation;
  const cancelled = new Promise((_, reject) => { rejectCancellation = reject; });
  const abort = () => {
    controller.abort();
    rejectCancellation(Object.assign(new Error('Request cancelled.'), { name: 'AbortError', code: 'REQUEST_ABORTED', status: 0 }));
  };
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true; controller.abort();
      reject(Object.assign(new Error('The request timed out. Please try again.'), { code: 'REQUEST_TIMEOUT', status: 0 }));
    }, timeoutMs);
  });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const options = { method, headers: finalHeaders, body: body !== undefined ? JSON.stringify(body) : undefined, signal: controller.signal };
  let response, data;
  try {
    [response, data] = await Promise.race([(async () => {
      if (signal?.aborted) throw Object.assign(new Error('Request cancelled.'), { name: 'AbortError' });
      const received = await fetch(`${BASE_URL}${path}`, options);
      return [received, await responseData(received)];
    })(), deadline, cancelled]);
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error('Request cancelled.'), { name: 'AbortError', code: 'REQUEST_ABORTED', status: 0 });
    if (timedOut) throw Object.assign(new Error('The request timed out. Please try again.'), { code: 'REQUEST_TIMEOUT', status: 0 });
    throw Object.assign(new Error('Server cannot be reached. Check your connection and try again.'), { code: 'BACKEND_UNREACHABLE', status: 0 });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
  const isPublicAuth = path.startsWith('/api/auth/') && path !== '/api/auth/me';
  if (response.status === 401 && !isPublicAuth && generation === requestGeneration) {
    onUnauthorized?.();
  }
  if (response.status === 403 && data?.code === 'ACCOUNT_BLOCKED' && generation === requestGeneration) onBlocked?.();
  if (!response.ok) throw failure(response, data);
  return data;
}
export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  delete: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
  baseUrl: BASE_URL,
};
export default api;
