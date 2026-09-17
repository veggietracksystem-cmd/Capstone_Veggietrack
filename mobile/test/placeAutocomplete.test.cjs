const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('../node_modules/@babel/core');
const root = path.join(__dirname, '../src');
const filename = path.join(root, 'hooks/usePlaceAutocomplete.js');
const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
  configFile: false, babelrc: false,
  plugins: [require.resolve('../node_modules/@babel/plugin-transform-modules-commonjs')],
}).code;

// Deterministic hook harness: real hook code, controlled timers and HTTP responses.
function harness(key = 'test-only') {
  let cursor = 0, now = 0, id = 0;
  const slots = [], effects = [], timers = new Map(), requests = [];
  const changed = (a, b) => !a || a.some((value, i) => value !== b[i]);
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useRef(initial) {
      const i = cursor++;
      return slots[i] ||= { current: initial };
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (changed(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: fn() };
      });
    },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, require: name => { assert.equal(name, 'react'); return react; },
    process: { env: { EXPO_PUBLIC_GEOAPIFY_API_KEY: key } }, AbortController,
    setTimeout: (fn, delay) => { timers.set(++id, { fn, at: now + delay }); return id; },
    clearTimeout: key => timers.delete(key),
    fetch: (url, options) => new Promise((resolve, reject) => requests.push({ url, ...options, resolve, reject })),
  });
  const render = (visible = true) => {
    cursor = 0;
    const result = exports.default(visible);
    effects.splice(0).forEach(fn => fn());
    return result;
  };
  render();
  return {
    render, requests,
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
    tick(ms) {
      now += ms;
      [...timers].forEach(([key, timer]) => {
        if (timer.at <= now) { timers.delete(key); timer.fn(); }
      });
    },
  };
}
const place = (name = 'San Pablo') => ({ place_id: name, formatted: name, lat: 14.0683, lon: 121.3256, country_code: 'ph' });
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
async function respond(request, results, status = 200) {
  request.resolve({ ok: status === 200, status, json: async () => ({ results }) });
  await flush();
}

test('3 characters and 400 ms debounce, PH filter, five results, no pinning side effects', async () => {
  const h = harness();
  h.render().changeQuery('S'); h.tick(500);
  h.render().changeQuery('Sa'); h.tick(500);
  assert.equal(h.requests.length, 0);
  h.render().changeQuery('San'); h.tick(399);
  assert.equal(h.requests.length, 0);
  h.render().changeQuery('San Pablo'); h.tick(400);
  assert.equal(h.requests.length, 1);
  const url = new URL(h.requests[0].url);
  assert.equal(url.hostname, 'api.geoapify.com');
  assert.equal(url.searchParams.get('text'), 'San Pablo');
  assert.equal(url.searchParams.get('filter'), 'countrycode:ph');
  assert.equal(url.searchParams.get('limit'), '5');
  await respond(h.requests[0], Array.from({ length: 8 }, (_, i) => place(`Place ${i}`)));
  assert.equal(h.render().results.length, 5);
  assert.equal(h.render().results[0].lat, 14.0683);
  assert.equal(h.render().results[0].lon, 121.3256);
});

test('old responses cannot replace a newer query, even when cancellation is ignored', async () => {
  const h = harness();
  h.render().changeQuery('San'); h.tick(400);
  h.render().changeQuery('San Pablo');
  assert.equal(h.requests[0].signal.aborted, true);
  await respond(h.requests[0], [place('Old')]);
  assert.equal(h.render().results.length, 0);
  assert.equal(h.render().searching, true);
  h.tick(400);
  await respond(h.requests[1], [place('New')]);
  assert.equal(h.render().results[0].display_name, 'New');
});

test('clear, close and unmount invalidate requests and cancel scheduled work', async () => {
  for (const action of ['clear', 'close', 'unmount']) {
    const h = harness();
    h.render().changeQuery('San'); h.tick(400);
    if (action === 'clear') h.render().changeQuery('');
    if (action === 'close') h.render(false);
    if (action === 'unmount') h.unmount();
    assert.equal(h.requests[0].signal.aborted, true);
    await respond(h.requests[0], [place()]);
    if (action !== 'unmount') {
      assert.equal(h.render(action !== 'close').results.length, 0);
      assert.equal(h.render(action !== 'close').showResults, false);
    }
  }
  const h = harness();
  h.render().changeQuery('San'); h.unmount(); h.tick(400);
  assert.equal(h.requests.length, 0);
});

test('selection closes suggestions and does not search the selected label again', async () => {
  const h = harness();
  h.render().changeQuery('San'); h.tick(400);
  await respond(h.requests[0], [place()]);
  h.render().selectResult(h.render().results[0]);
  h.tick(1000);
  assert.equal(h.render().query, 'San Pablo');
  assert.equal(h.render().showResults, false);
  assert.equal(h.requests.length, 1);
});

test('missing key makes no provider requests; empty and invalid results remain safe', async () => {
  const missing = harness('');
  missing.render().changeQuery('San Pablo'); missing.tick(1000);
  assert.equal(missing.requests.length, 0);
  assert.equal(missing.render().configured, false);
  const h = harness();
  h.render().changeQuery('San'); h.tick(400);
  await respond(h.requests[0], [{ ...place(), lat: null }, { ...place(), country_code: 'us' }]);
  assert.equal(h.render().results.length, 0);
  assert.equal(h.render().error, '');
  assert.equal(h.render().showResults, true);
});

test('quota/network errors settle loading and permit retry', async () => {
  const h = harness();
  h.render().changeQuery('San'); h.tick(400);
  await respond(h.requests[0], [], 429);
  assert.match(h.render().error, /limit reached/);
  assert.equal(h.render().searching, false);
  h.render().retry(); h.tick(400);
  h.requests[1].reject(new Error('offline')); await flush();
  assert.match(h.render().error, /pin on the map/);
  h.render().retry(); h.tick(400);
  await respond(h.requests[2], [place()]);
  assert.equal(h.render().error, '');
  assert.equal(h.render().results.length, 1);
});

test('both platform selection handlers preserve actual coordinates, address and map movement', () => {
  for (const platform of ['web', 'native']) {
    const source = fs.readFileSync(path.join(root, `components/MapPinningModal.${platform}.js`), 'utf8');
    const start = source.indexOf('  const handleSelectSearchResult');
    const end = source.indexOf('  const handleConfirm', start);
    let coords, address, moved, marker;
    const scope = {
      setPinnedCoords: value => { coords = value; }, setAddressName: value => { address = value; },
      flyToMap: (...args) => { moved = args; },
      mapRef: { current: { setView: (...args) => { moved = args; } } },
      markerRef: { current: { setLatLng: value => { marker = value; } } },
    };
    vm.runInNewContext(source.slice(start, end) + '\nhandleSelectSearchResult({lat:14.0683,lon:121.3256,display_name:"San Pablo"});', scope);
    assert.equal(coords.latitude, 14.0683);
    assert.equal(coords.longitude, 121.3256);
    assert.equal(address, 'San Pablo');
    assert.ok(moved);
    if (platform === 'web') assert.equal(marker[1], 121.3256);
    assert.ok(source.includes('<PlaceAutocomplete visible={visible} onSelect={handleSelectSearchResult} />'));
    assert.ok(!source.includes('nominatim.openstreetmap.org/search'));
  }
});
