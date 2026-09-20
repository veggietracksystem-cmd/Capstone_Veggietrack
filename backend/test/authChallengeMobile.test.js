const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const mobileRequire = createRequire(path.join(__dirname, '../../mobile/package.json'));
const babel = mobileRequire('@babel/core');

// Drives AuthProvider's hooks directly - the provider holds the login state
// machine, and a renderer would only add a dependency without adding coverage.
function provider(mocks) {
  const values = []; let cursor = 0; const cleanups = [];
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    useContext: () => null,
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = initial;
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    useEffect(effect) { const index = cursor++; if (!(index in values)) { values[index] = true; cleanups.push(effect()); } },
  };
  const filename = path.join(__dirname, '../../mobile/src/context/AuthContext.js');
  const source = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false, presets: [mobileRequire.resolve('babel-preset-expo')],
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, setTimeout, clearTimeout, setInterval, clearInterval, Promise, console,
    require: name => {
      if (name in mocks) return mocks[name];
      if (name === 'react') return react;
      if (name === 'react-native') return { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } };
      return mobileRequire(name);
    } });
  return { value() { cursor = 0; return module.exports.AuthProvider({ children: null }).props.value; },
    unmount() { cleanups.forEach(fn => fn?.()); } };
}

// Lets queued setTimeout(...,0) callbacks and their awaits run to completion.
const settle = async (rounds = 8) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => setTimeout(resolve, 0)); };

function harness({ me } = {}) {
  const calls = [];
  let current = null;
  const listeners = [];
  const emit = event => listeners.forEach(fn => fn(event));
  const supabase = { auth: {
    getSession: async () => ({ data: { session: current } }),
    signInWithPassword: async () => { current = { access_token: 'password-session' }; emit('SIGNED_IN'); return { error: null }; },
    signInWithOtp: async () => ({ error: null }),
    signOut: async () => { current = null; emit('SIGNED_OUT'); return { error: null }; },
    onAuthStateChange: fn => { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    startAutoRefresh() {}, stopAutoRefresh() {},
  } };
  const mocks = {
    '../api/client': { api: { get: async path => { calls.push(path); return me(calls.length); } },
      setAuthToken() {}, setUnauthorizedHandler() {}, setBlockedHandler() {}, setTokenProvider() {} },
    '../lib/supabase': { supabase, authConfigured: true, clearStoredSession: async () => {} },
    '../offline/db': { clearAll: async () => {} },
    'expo-linking': { parse: () => ({}), getInitialURL: async () => null, addEventListener: () => ({ remove() {} }) },
  };
  return { mocks, calls, session: () => current };
}

test('the email challenge never publishes its password session', async () => {
  const { mocks, calls } = harness({ me: () => ({ user: { id: 'u', role: 'distributor', access_allowed: true } }) });
  const auth = provider(mocks);
  await settle();
  assert.deepEqual(calls, [], 'no session at launch means no profile read');

  await auth.value().signInWithEmail('distributor@example.com', 'secret');
  await settle();

  const after = auth.value();
  // A published session swaps the navigator to the signed-in stack, which no
  // longer contains VerifyEmail - the code screen would never be reached.
  assert.equal(after.session, null, 'the transient password session must stay unpublished');
  assert.equal(after.user, null, 'no profile may be adopted before the code is verified');
  assert.deepEqual(calls, [], 'the challenge must not read the profile');
  assert.equal(after.statusError, '', 'the challenge must not surface a status error');
  auth.unmount();
});

test('verifying the code then adopts the profile normally', async () => {
  const { mocks, calls } = harness({ me: () => ({ user: { id: 'u', role: 'farmer', access_allowed: true } }) });
  const auth = provider(mocks);
  await settle();
  await auth.value().signInWithEmail('farmer@example.com', 'secret');
  await settle();

  // VerifyEmailScreen calls refreshProfile() once verifyOtp() restores a session.
  mocks['../lib/supabase'].supabase.auth.signInWithPassword();
  await auth.value().refreshProfile();
  await settle();

  const after = auth.value();
  assert.ok(after.session, 'the verified session is published');
  assert.equal(after.user.role, 'farmer');
  // The explicit refresh and the restored session's own event may both read.
  assert.ok(calls.length >= 1 && calls.every(path => path === '/api/auth/me'));
  auth.unmount();
});

test('a transport blip retries quietly instead of showing a status screen', async () => {
  const unreachable = Object.assign(new Error('Server cannot be reached.'), { code: 'BACKEND_UNREACHABLE', status: 0 });
  const { mocks, calls } = harness({ me: attempt => { if (attempt === 1) throw unreachable; return { user: { id: 'u', role: 'retailer', access_allowed: true } }; } });
  const auth = provider(mocks);
  await settle();
  mocks['../lib/supabase'].supabase.auth.signInWithPassword();
  await auth.value().refreshProfile();
  await settle();

  const after = auth.value();
  assert.deepEqual(calls, ['/api/auth/me', '/api/auth/me'], 'the first failure is retried');
  assert.equal(after.statusError, '', 'a retried blip never reaches the user');
  assert.equal(after.user.role, 'retailer');
  auth.unmount();
});
