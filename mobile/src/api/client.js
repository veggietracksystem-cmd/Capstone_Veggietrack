import { BACKEND_URL } from '@env';

// react-native-dotenv inlines BACKEND_URL at build time; fallback keeps web working.
const BASE_URL = BACKEND_URL || 'http://localhost:3000';

// Module-level token kept in sync by AuthContext via setAuthToken().
// This lets any screen call api.get/post without threading the token through props.
let authToken = null;
export function setAuthToken(token) {
  authToken = token;
}

// Optional hook so the client can force a logout on 401 (set by AuthProvider).
let onUnauthorized = null;
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const url = `${BASE_URL}${path}`;
  const finalHeaders = { 'Content-Type': 'application/json', ...headers };
  if (authToken) finalHeaders.Authorization = `Bearer ${authToken}`;

  console.log(`[api] ${method} ${url}`);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    // Connection refused / wrong host / offline.
    console.error('[api] network error:', networkErr);
    throw new Error('Network error — is the backend running and reachable?');
  }

  // Some endpoints (or errors) may not return JSON; guard the parse.
  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (response.status === 401 && onUnauthorized) {
    // Token expired/invalid → let the app sign out.
    onUnauthorized();
  }

  if (!response.ok) {
    const message = (data && data.error) || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  delete: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
  baseUrl: BASE_URL,
};

// Default export so `import api from '../api/client'` also works.
export default api;
