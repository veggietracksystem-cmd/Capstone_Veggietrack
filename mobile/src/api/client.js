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
  return Object.assign(new Error(data?.error || `Request failed (${response.status})`), { status: response.status, data });
}
async function request(path, { method = 'GET', body, headers = {} } = {}) {
  if (tokenProvider) setAuthToken(await tokenProvider());
  const requestGeneration = generation;
  const finalHeaders = { 'Content-Type': 'application/json', ...headers };
  if (authToken && !finalHeaders.Authorization) finalHeaders.Authorization = `Bearer ${authToken}`;
  const options = { method, headers: finalHeaders, body: body !== undefined ? JSON.stringify(body) : undefined };
  let response;
  try { response = await fetch(`${BASE_URL}${path}`, options); }
  catch { throw Object.assign(new Error('Check your connection and try again.'), { status: 0 }); }
  let data = await responseData(response);
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
