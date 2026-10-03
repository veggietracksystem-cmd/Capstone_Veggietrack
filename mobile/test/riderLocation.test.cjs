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
function harness({ focused = true } = {}) {
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
  const state = { focused, appState: 'active' };
  const Location = {
    Accuracy: { High: 4, Highest: 6 },
    requestForegroundPermissionsAsync: async () => ({ status: 'granted', granted: true }),
    watchPositionAsync: async (options, callback) => {
      const watch = { options, callback, removed: false, remove() { this.removed = true; } };
      watches.push(watch);
      return watch;
    },
  };
  const modules = {
    react,
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, Platform: { OS: 'android' } },
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
        if (target === 'lib/deviceLocation') return { acquireDevicePosition: async () => { throw new Error('not used'); } };
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
  return { render, unmount, state, watches, active, posts, runTimers, fix, get result() { return result; } };
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
  assert.equal(h.result.error, 'T:nav.gpsTimeout');
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
