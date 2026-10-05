const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const mobileRequire = createRequire(path.join(__dirname, '../../mobile/package.json'));
const babel = mobileRequire('@babel/core');

// Compiles one mobile source file (JSX/ESM) and returns its exports. Imports are
// served from `mocks`, then React's JSX runtime and Babel helpers, then `fallback`.
function loadModule(file, mocks, fallback = () => { throw new Error(`Missing mock in ${file}`); }) {
  const filename = path.join(__dirname, '../../mobile/src', file);
  const source = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false, presets: [mobileRequire.resolve('babel-preset-expo')],
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, console, Promise, setTimeout, clearTimeout,
    // Screen timers (clocks, cooldowns) are not needed by these tests.
    setInterval: () => 0, clearInterval() {},
    require: (name) => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('react/') || name.startsWith('@babel/runtime')) return mobileRequire(name);
      return fallback(name);
    } });
  return module.exports;
}

// Renders a mobile screen function with minimal hook support (no renderer), so
// a test can read the element tree and press its handlers. `mocks` maps import
// specifiers to modules; any other non-React import becomes inert stubs.
function mountScreen(file, mocks, props = {}, exportName = 'default') {
  const values = []; let cursor = 0; const effects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
      return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useRef(initial) { const index = cursor++; if (!(index in values)) values[index] = { current: initial }; return values[index]; },
    // Runs after the render when the dependencies change, like React (cleanup first).
    useEffect(effect, deps) {
      const index = cursor++; const previous = values[index];
      if (previous && deps && previous.deps && deps.length === previous.deps.length && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
      const slot = { deps }; values[index] = slot;
      effects.push(() => { if (typeof previous?.cleanup === 'function') previous.cleanup(); slot.cleanup = effect(); });
    },
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
    useMemo(make, deps) {
      const index = cursor++; const previous = values[index];
      if (previous && deps && previous.deps && deps.length === previous.deps.length && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return previous.value;
      values[index] = { deps, value: make() };
      return values[index].value;
    },
    createContext: () => ({ Provider: 'Provider' }),
    useContext: () => null,
  };
  const stubs = new Proxy({}, { get: (_, name) => (name === '__esModule' ? true : Object.assign(() => null, { displayName: String(name) })) });
  const reactNative = new Proxy({ StyleSheet: { create: (styles) => styles, absoluteFill: {} }, Platform: { OS: 'android', select: (o) => o.android ?? o.default },
    useWindowDimensions: () => ({ width: 360, height: 760 }) },
    { get: (target, name) => (name in target ? target[name] : stubs[name]) });
  // The real double-tap guard (lib/requestLock.js), one per mounted screen like the hook.
  const { createRequestLock } = loadModule('lib/requestLock.js', {});
  const defaults = { '../hooks/useRequestLock': { __esModule: true, default: () => {
    const lock = react.useRef(null); if (!lock.current) lock.current = createRequestLock(); return lock.current;
  } } };
  const module = loadModule(file, { ...defaults, ...mocks }, (name) => {
    if (name === 'react') return react;
    if (name === 'react-native') return reactNative;
    return stubs;
  });
  const Screen = module[exportName];
  let tree = null;
  const render = () => {
    cursor = 0; tree = Screen(props);
    while (effects.length) effects.shift()();
    return tree;
  };
  // Every element in the last render whose props match `predicate`.
  const walk = (predicate, node, found) => {
    if (Array.isArray(node)) node.forEach((child) => walk(predicate, child, found));
    else if (node && typeof node === 'object' && node.props) {
      if (predicate(node.props, node)) found.push(node);
      walk(predicate, [node.props.children, node.props.ListHeaderComponent, node.props.ListEmptyComponent, node.props.ListFooterComponent], found);
    }
    return found;
  };
  const findAll = (predicate) => walk(predicate, tree, []);
  // Text content of the last render (string children only).
  const textOf = (node) => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join(' ');
    return node?.props ? textOf([node.props.children, node.props.ListHeaderComponent, node.props.ListEmptyComponent, node.props.ListFooterComponent]) : '';
  };
  const text = () => textOf(tree);
  render();
  const unmount = () => values.forEach((slot) => typeof slot?.cleanup === 'function' && slot.cleanup());
  return { render, findAll, text, unmount };
}

// Lets queued promise callbacks and setTimeout(0) work run to completion.
const settle = async (rounds = 10) => { for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
// Translator stub: returns the key, so tests check which message was chosen.
const t = (key) => key;
const translation = { useTranslation: () => ({ t, tc: t, language: 'en' }) };

module.exports = { loadModule, mountScreen, settle, translation };
