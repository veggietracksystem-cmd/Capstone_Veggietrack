const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('../node_modules/@babel/core');

const sourceRoot = path.resolve(__dirname, '../src');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

// Runs the real useRiderLocation hook with a minimal React (state, refs, effects
// with cleanup), a fake expo-location and controllable timers, so watcher
// creation, cleanup and timeouts can be counted exactly.
function harness({ focused = true, servicesOn = true, lastKnown = null, freshFix = null, permission = { status: 'granted', granted: true, canAskAgain: true }, grantOnAsk = true } = {}) {
  const watches = [], posts = [], timers = new Map();
  let timerId = 0, slots = [], cursor = 0, pendingEffects = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => v !== b[i]);
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[index];
      return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(fn, deps) {
      const index = cursor++;
      if (!(index in slots) || changed(slots[index].deps, deps)) slots[index] = { deps, value: fn };
      return slots[index].value;
    },
    useEffect(fn, deps) {
      const index = cursor++;
      const slot = slots[index] || (slots[index] = { effect: true });
      if (changed(slot.deps, deps)) pendingEffects.push(() => { slot.cleanup?.(); slot.deps = deps; slot.cleanup = fn(); });
    },
  };
  const state = { focused, appState: 'active', servicesOn, lastKnown, freshFix, acquires: 0, permission, grantOnAsk, requests: 0, appStateListeners: [] };
  const Location = {
    Accuracy: { High: 4, Highest: 6 },
    getForegroundPermissionsAsync: async () => state.permission,
    // Like Android: asking always opens the system permission screen, which pauses
    // and later resumes the app (see pauseResume), whether or not access is granted.
    requestForegroundPermissionsAsync: async () => {
      state.requests++;
      state.pendingPauseResume = true;
      if (state.grantOnAsk) state.permission = { status: 'granted', granted: true, canAskAgain: true, android: state.permission.android };
      else state.permission = { status: 'denied', granted: false, canAskAgain: true };
      return state.permission;
    },
    hasServicesEnabledAsync: async () => state.servicesOn,
    getLastKnownPositionAsync: async () => state.lastKnown,
    watchPositionAsync: async (options, callback, onError) => {
      const watch = { options, callback, onError, removed: false, remove() { this.removed = true; } };
      watches.push(watch);
      return watch;
    },
  };
  const modules = {
    react,
    'react-native': { AppState: { currentState: 'active', addEventListener: (_, listener) => { state.appStateListeners.push(listener); return { remove() {} }; } }, Platform: { OS: 'android' } },
    'expo-location': Location,
    '@react-navigation/native': { useIsFocused: () => state.focused },
  };
  const loaded = new Map();
  function load(file) {
    if (loaded.has(file)) return loaded.get(file);
    if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(path.join(sourceRoot, file), 'utf8'));
    const module = { exports: {} };
    loaded.set(file, module.exports);
    const code = babel.transformSync(fs.readFileSync(path.join(sourceRoot, file), 'utf8'), {
      configFile: false, babelrc: false, plugins: [require.resolve('../node_modules/@babel/plugin-transform-modules-commonjs')],
    }).code;
    vm.runInNewContext(code, {
      exports: module.exports, module, console, Date, Promise, AbortController, process,
      setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
      clearTimeout: id => timers.delete(id),
      require(name) {
        if (modules[name]) return modules[name];
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), name));
        if (target === 'api/client') return { post: async (route, body) => { posts.push(body); return { success: true }; } };
        if (target === 'lib/errorMessages') return { friendlyError: (err, fallback) => err?.message || fallback };
        // One fresh fix for Reload GPS: a sample, or an error with a code.
        // The real permission helpers; only the one-fix GPS request is stubbed.
        if (target === 'lib/deviceLocation') return { ...load('lib/deviceLocation.js'), acquireDevicePosition: async () => {
          state.acquires++;
          const next = typeof state.freshFix === 'function' ? state.freshFix() : state.freshFix;
          if (next instanceof Error) throw next;
          return next;
        } };
        if (target === 'i18n/translate') return { tr: key => `T:${key}` };
        return load(target.endsWith('.json') ? target : `${target}.js`);
      },
    }, { filename: file });
    // Files using module.exports replace the exports object.
    loaded.set(file, module.exports);
    return module.exports;
  }
  const useRiderLocation = load('hooks/useRiderLocation.js').default;
  let result, props;
  const render = (orderId, enabled, options) => {
    if (orderId !== undefined) props = [orderId, enabled, options];
    cursor = 0;
    result = useRiderLocation(...props);
    const effects = pendingEffects; pendingEffects = [];
    effects.forEach(run => run());
    return result;
  };
  const unmount = () => { slots.filter(slot => slot?.effect).forEach(slot => slot.cleanup?.()); };
  const runTimers = ms => { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } };
  const fix = (overrides = {}) => ({ coords: { latitude: 14.07, longitude: 121.32, accuracy: 8, ...overrides }, timestamp: Date.now() });
  const active = () => watches.filter(watch => !watch.removed);
  // The app goes to the background and back (permission screen, another app, a chat head).
  const pauseResume = async () => {
    state.appStateListeners.forEach(listener => listener('background')); render(); await flush();
    state.appStateListeners.forEach(listener => listener('active')); render(); await flush(); render(); await flush();
  };
  const sample = (overrides = {}) => ({ latitude: 14.07, longitude: 121.32, accuracy: 8, timestamp: Date.now(), ...overrides });
  return { render, unmount, state, watches, active, posts, runTimers, fix, sample, pauseResume, get result() { return result; } };
}

test('one GPS watch, on a 5 s timer even when the rider is not moving', async () => {
  const h = harness();
  h.render('order-1', true); await flush(); h.render();
  assert.equal(h.watches.length, 1);
  assert.equal(h.watches[0].options.timeInterval, 5000);
  assert.equal(h.watches[0].options.distanceInterval, 0, 'a stopped rider keeps reporting, so the server keeps the route');
});

test('re-renders and refocusing never stack watchers, and leaving the screen stops the watch', async () => {
  const h = harness();
  h.render('order-1', true); await flush();
  for (let i = 0; i < 5; i++) { h.render(); await flush(); }
  assert.equal(h.active().length, 1, 'still one watch after re-renders');
  h.state.focused = false; h.render(); await flush();
  assert.equal(h.active().length, 0, 'screen in the background: no watch');
  h.state.focused = true; h.render(); await flush(); h.render();
  assert.equal(h.active().length, 1, 'back on screen: exactly one watch');
  h.unmount();
  assert.equal(h.active().length, 0, 'leaving the screen removes the watch');
});

test('no first fix within 20 s shows a retryable message instead of loading forever; a late fix clears it', async () => {
  const h = harness();
  h.render('order-1', true); await flush(); h.render();
  h.runTimers(20000); h.render();
  assert.equal(h.result.error, 'T:nav.gpsTimeout', 'Unable to get your current location. Check that GPS is turned on…');
  assert.equal(h.result.position, null);
  h.watches[0].callback(h.fix()); await flush(); h.render();
  assert.equal(h.result.error, '');
  assert.equal(h.result.position.latitude, 14.07);
});

test('the first saved location asks the screen to load the route once; uploads stay throttled', async () => {
  const h = harness();
  let shares = 0;
  h.render('order-1', true, { onFirstShare: () => { shares++; } }); await flush(); h.render();
  h.watches[0].callback(h.fix()); await flush();
  h.watches[0].callback(h.fix({ latitude: 14.0701 })); await flush();
  h.watches[0].callback(h.fix({ latitude: 14.0702 })); await flush(); h.render();
  assert.equal(shares, 1);
  assert.equal(h.posts.length, 1, 'fixes within 5 s are not each uploaded');
  assert.equal(h.result.position.latitude, 14.0702, 'the map still gets every fix');
});

test('disabled (not the assigned rider) watches nothing', async () => {
  const h = harness();
  h.render('order-1', false); await flush(); h.render();
  assert.equal(h.watches.length, 0);
});

test('GPS switched off on the phone: a clear message at once, no watch and no endless loading', async () => {
  const h = harness({ servicesOn: false });
  h.render('order-1', true); await flush(); h.render();
  assert.equal(h.watches.length, 0);
  assert.equal(h.result.error, 'T:nav.gpsOff');
});

test('a recent last known position is shown at once as approximate, and never uploaded', async () => {
  const h = harness({ lastKnown: { coords: { latitude: 14.05, longitude: 121.3, accuracy: 40 }, timestamp: Date.now() - 120000 } });
  h.render('order-1', true); await flush(); h.render();
  assert.equal(h.result.position.approximate, true);
  assert.equal(h.result.position.latitude, 14.05);
  assert.equal(h.posts.length, 0, 'the server only gets fresh fixes');
  h.watches[0].callback(h.fix()); await flush(); h.render();
  assert.equal(h.result.position.approximate, undefined, 'the first fresh fix replaces it');
  assert.equal(h.posts.length, 1);
});

test('Reload GPS replaces the watch instead of adding one, gets a fresh fix and stops loading either way', async () => {
  const h = harness({ freshFix: () => h.sample({ latitude: 14.08 }) });
  h.render('order-1', true); await flush(); h.render();
  const reload = h.result.reloadGps();
  h.render(); assert.equal(h.result.refreshing, true, 'button shows it is working');
  await reload; await flush(); h.render(); await flush(); h.render();
  assert.equal(h.watches.length, 2, 'the old watch was replaced');
  assert.equal(h.active().length, 1, 'still exactly one active watch');
  assert.equal(h.result.position.latitude, 14.08);
  assert.equal(h.result.refreshing, false);
  assert.equal(h.posts.at(-1).latitude, 14.08, 'the fresh fix is uploaded at once');
  // Two quick presses share one request.
  h.state.acquires = 0;
  await Promise.all([h.result.reloadGps(), h.result.reloadGps()]); await flush(); h.render();
  assert.equal(h.state.acquires, 1);
  // A weak signal says so in plain words; loading still stops.
  h.state.freshFix = Object.assign(new Error('raw'), { code: 'GPS_INACCURATE' });
  await h.result.reloadGps().catch(() => {}); await flush(); h.render(); await flush(); h.render();
  assert.equal(h.result.error, 'T:nav.gpsInaccurate');
  assert.equal(h.result.refreshing, false);
  assert.equal(h.active().length, 1);
});

test('returning from another app or a chat head keeps the rider on the map and restarts one watch', async () => {
  const h = harness();
  h.render('order-1', true); await flush(); h.render();
  h.watches[0].callback(h.fix()); await flush(); h.render();
  h.state.focused = false; h.render(); await flush();
  assert.equal(h.active().length, 0);
  h.state.focused = true; h.render(); await flush(); h.render();
  assert.equal(h.result.position?.latitude, 14.07, 'no "Finding your location" after coming back');
  assert.equal(h.active().length, 1);
});

test('a watch that fails later shows the GPS message instead of silently stopping', async () => {
  const h = harness();
  h.render('order-1', true); await flush(); h.render();
  h.watches[0].onError('Location services were turned off'); h.render();
  assert.equal(h.result.error, 'T:nav.gpsTimeout');
});

// Seen on a Redmi phone (Android 15) with location already allowed: asking again on
// every resume opened Android's permission screen 413 times in 40 s, the GPS watch
// never survived, and Android closed the app for "rapid activity launch".
test('location already allowed: never opens the permission screen, on open or on any resume, and keeps one watch', async () => {
  const h = harness();
  h.render('order-1', true); await flush(); h.render(); await flush();
  for (let n = 0; n < 6; n++) await h.pauseResume();
  assert.equal(h.state.requests, 0, 'no permission screen while access is granted');
  assert.equal(h.active().length, 1);
  h.watches.at(-1).callback(h.fix()); await flush(); h.render();
  assert.equal(h.result.position.latitude, 14.07, 'the rider appears');
});

test('not allowed yet: asks once; its own pause and resume never ask again; Reload GPS asks again', async () => {
  const h = harness({ permission: { status: 'undetermined', granted: false, canAskAgain: true }, grantOnAsk: false });
  h.render('order-1', true); await flush(); h.render();
  assert.equal(h.state.requests, 1);
  for (let n = 0; n < 5; n++) await h.pauseResume();
  assert.equal(h.state.requests, 1, 'no loop after a denial');
  assert.equal(h.result.error, 'T:nav.locationOff');
  assert.equal(h.active().length, 0);
  // The rider allows it from the prompt that Reload GPS shows.
  h.state.grantOnAsk = true;
  h.result.reloadGps().catch(() => {}); h.render(); await flush(); h.render(); await flush(); h.render(); await flush();
  assert.equal(h.state.requests, 2, 'Reload GPS asked once more');
  await h.pauseResume();
  assert.equal(h.state.requests, 2);
  assert.equal(h.active().length, 1, 'tracking starts once allowed');
});

test('approximate-only access says how to fix it and still tracks', async () => {
  const h = harness({ permission: { status: 'granted', granted: true, canAskAgain: true, android: { accuracy: 'coarse' } } });
  h.render('order-1', true); await flush(); h.render();
  assert.equal(h.result.error, 'T:nav.preciseOff');
  assert.equal(h.active().length, 1);
  h.watches[0].callback(h.fix({ accuracy: 1500 })); await flush(); h.render();
  assert.equal(h.result.error, 'T:nav.preciseOff', 'the warning stays after an upload');
  assert.equal(h.state.requests, 0);
});
