const test = require('node:test');
const assert = require('node:assert/strict');
const { loadModule, mountScreen, settle, translation } = require('./mobileScreenHarness');
const { rootBranch } = loadModule('lib/rootRoute.js', {});

const tr = { tr: (key) => key };
const authErrors = () => loadModule('lib/authErrors.js', { '../i18n/translate': tr });
// Supabase's answers, as returned by supabase-js.
const NO_ACCOUNT = { code: 'otp_disabled', status: 422, message: 'Signups not allowed for otp' };
const BAD_CODE = { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' };

test('recovery errors use simple wording and never show the technical reason', () => {
  const { recoveryError } = authErrors();
  assert.equal(recoveryError(NO_ACCOUNT), 'authx.accountNotFound');
  assert.equal(recoveryError(BAD_CODE), 'authx.codeInvalid');
  assert.equal(recoveryError({ status: 429, code: 'over_email_send_rate_limit' }), 'authErr.tooManyTries');
  assert.equal(recoveryError({ code: 'same_password' }), 'authErr.samePassword');
  assert.equal(recoveryError({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }), 'authx.resetFailed');
  assert.equal(recoveryError(new Error('relation "users" does not exist')), 'authx.resetFailed');
});

function forgotPassword({ send, verify }) {
  const sent = [], verified = [];
  const mocks = {
    '../lib/supabase': { authConfigured: true, supabase: { auth: { signInWithOtp: async (args) => { sent.push(args); return { error: send(args.email) }; } } } },
    '../lib/authErrors': authErrors(),
    '../context/AuthContext': { useAuth: () => ({ verifyRecoveryCode: async (email, code) => { verified.push([email, code]); const error = verify(code); if (error) throw error; } }) },
    '../lib/ui': { showAlert() {} },
    '../i18n/useTranslation': translation,
  };
  const screen = mountScreen('screens/ForgotPasswordScreen.js', mocks, { navigation: { goBack() {} }, route: { params: {} } });
  const button = (title) => screen.findAll((props) => props.title === title)[0].props;
  const field = (label) => screen.findAll((props) => props.accessibilityLabel === label)[0].props;
  const step = async (fn) => { fn(); screen.render(); await settle(); return screen.render(); };
  return { screen, sent, verified, button, field, step, text: () => screen.text() };
}

test('Forgot Password: an unknown email says "Account not found." and sends nothing further', async () => {
  const f = forgotPassword({ send: () => NO_ACCOUNT, verify: () => null });
  await f.step(() => f.field('authx.email').onChangeText('nobody@example.com'));
  await f.step(() => f.button('authx.sendCode').onPress());
  assert.match(f.text(), /authx\.accountNotFound/);
  assert.deepEqual(f.sent.map((s) => [s.email, s.options.shouldCreateUser]), [['nobody@example.com', false]], 'never creates an account');
  assert.equal(f.screen.findAll((props) => props.accessibilityLabel === 'authx.codeLabel').length, 0, 'the code step is not shown');
});

test('Forgot Password: a registered email gets a code; a wrong code is refused and the right one opens Reset Password', async () => {
  const f = forgotPassword({ send: () => null, verify: (code) => (code === '123456' ? null : BAD_CODE) });
  await f.step(() => f.field('authx.email').onChangeText(' Farmer@Example.com '));
  await f.step(() => f.button('authx.sendCode').onPress());
  assert.deepEqual(f.sent.map((s) => s.email), ['farmer@example.com']);
  assert.match(f.text(), /authx\.resetCodeSent/);

  await f.step(() => f.field('authx.codeLabel').onChangeText('999999'));
  await f.step(() => f.button('authx.verify').onPress());
  assert.match(f.text(), /authx\.codeInvalid/);

  await f.step(() => f.field('authx.codeLabel').onChangeText('123456'));
  await f.step(() => f.button('authx.verify').onPress());
  assert.deepEqual(f.verified, [['farmer@example.com', '999999'], ['farmer@example.com', '123456']]);
  assert.doesNotMatch(f.text(), /authx\.codeInvalid/);
});

function authProvider({ verifyOtp, initialUrl = null }) {
  let current = null; const listeners = []; const exchanged = []; const profileReads = [];
  let provider;
  const supabase = { auth: {
    getSession: async () => ({ data: { session: current }, error: null }),
    verifyOtp: async (args) => {
      const error = verifyOtp(args);
      if (!error) { current = { access_token: 'recovery-session' }; listeners.forEach((fn) => fn('SIGNED_IN')); }
      return { error };
    },
    exchangeCodeForSession: async (code) => { exchanged.push(code); current = { access_token: 'link-session' }; return { error: null }; },
    signOut: async () => { current = null; return { error: null }; },
    onAuthStateChange: (fn) => { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    startAutoRefresh() {}, stopAutoRefresh() {},
  } };
  const mocks = {
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    'expo-linking': { getInitialURL: async () => initialUrl, addEventListener: () => ({ remove() {} }) },
    '../api/client': { api: { get: async () => {
      // Record the branch the app would show at the moment the profile is published.
      const value = provider.render().props.value;
      profileReads.push(rootBranch({ recoveryMode: value.recoveryMode, session: value.session, roleScreen: null }));
      return { user: { id: 'u1', role: 'farmer', access_allowed: true } };
    } }, setAuthToken() {}, setUnauthorizedHandler() {}, setBlockedHandler() {}, setTokenProvider() {} },
    '../lib/supabase': { supabase, authConfigured: true, clearStoredSession: async () => {} },
    '../offline/db': { clearAll: async () => {} },
  };
  provider = mountScreen('context/AuthContext.js', mocks, { children: null }, 'AuthProvider');
  return { value: () => provider.render().props.value, exchanged, profileReads };
}

test('a verified recovery code opens recovery mode, never the signed-in screens', async () => {
  const auth = authProvider({ verifyOtp: ({ token }) => (token === '123456' ? null : BAD_CODE) });
  await settle();
  await assert.rejects(auth.value().verifyRecoveryCode('farmer@example.com', '000000'));
  await settle();
  assert.equal(auth.value().recoveryMode, false);
  assert.equal(auth.value().session, null, 'a wrong code opens no session');

  await auth.value().verifyRecoveryCode('farmer@example.com', '123456');
  await settle();
  const value = auth.value();
  assert.equal(value.recoveryMode, true);
  assert.ok(value.session);
  assert.equal(rootBranch({ recoveryMode: value.recoveryMode, session: value.session, roleScreen: { name: 'FarmerDashboard' } }), 'recovery');
  assert.ok(auth.profileReads.length >= 1);
  assert.ok(auth.profileReads.every((branch) => branch === 'recovery'), `branches seen: ${auth.profileReads}`);
});

test('a reset link opened in the native app is recognised (veggietrack:// and Expo Go links)', async () => {
  for (const url of ['veggietrack://reset-password?code=abc%2D123', 'exp://192.168.1.5:8081/--/reset-password?code=abc%2D123']) {
    const auth = authProvider({ verifyOtp: () => null, initialUrl: url });
    await settle();
    assert.deepEqual(auth.exchanged, ['abc-123'], url);
    assert.equal(auth.value().recoveryMode, true, url);
  }
  const other = authProvider({ verifyOtp: () => null, initialUrl: 'veggietrack://orders?code=abc' });
  await settle();
  assert.deepEqual(other.exchanged, []);
});

test('Reset Password validates the new password, saves it, signs out and confirms the change', async () => {
  const updates = [], alerts = []; let signedOut = null;
  const mocks = {
    '../lib/supabase': { authConfigured: true, supabase: { auth: {
      getSession: async () => ({ data: { session: { access_token: 'recovery-session' } } }),
      updateUser: async (args) => { updates.push(args); return { error: null }; },
    } } },
    '../lib/authErrors': authErrors(),
    '../context/AuthContext': { useAuth: () => ({ recoveryMode: true, signOut: async (opts) => { signedOut = opts; } }) },
    '../lib/ui': { showAlert: (title, message) => alerts.push([title, message]) },
    '../i18n/useTranslation': translation,
  };
  const screen = mountScreen('screens/ResetPasswordScreen.js', mocks, { navigation: { goBack() {} } });
  const field = (label) => screen.findAll((props) => props.accessibilityLabel === label)[0].props;
  const save = async () => { screen.findAll((props) => props.title === 'authx.saveNewPassword')[0].props.onPress(); await settle(); screen.render(); };

  field('authx.newPassword').onChangeText('short'); field('authx.confirmNewPassword').onChangeText('short'); screen.render();
  await save();
  assert.match(screen.text(), /authx\.pwShort/);
  field('authx.newPassword').onChangeText('NewPassword1'); field('authx.confirmNewPassword').onChangeText('NewPassword2'); screen.render();
  await save();
  assert.match(screen.text(), /authx\.pwMismatch/);
  assert.equal(updates.length, 0);

  field('authx.confirmNewPassword').onChangeText('NewPassword1'); screen.render();
  await save();
  assert.deepEqual(JSON.parse(JSON.stringify(updates)), [{ password: 'NewPassword1' }]);
  assert.deepEqual({ ...signedOut }, { redirectToLogin: true }, 'back to Log in to use the new password');
  assert.deepEqual(alerts, [['authx.passwordUpdated', 'authx.passwordUpdatedMsg']]);
});
