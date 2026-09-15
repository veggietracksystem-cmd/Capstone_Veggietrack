const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('../../mobile/node_modules/@babel/core');
const path = require('node:path');

function loadModule(file, mocks = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../../mobile/src', file), 'utf8');
  const code = babel.transformSync(source, { configFile: false, babelrc: false, plugins: [require.resolve('../../mobile/node_modules/@babel/plugin-transform-modules-commonjs')] }).code;
  const moduleMocks = { ...mocks };
  if (file === 'lib/podCapture.js' && !moduleMocks['./deviceLocation']) {
    const trackingGeometry = loadModule('lib/trackingGeometry.js', {}, globals);
    const deliveryLocation = loadModule('lib/deliveryLocation.js', { './trackingGeometry': trackingGeometry }, globals);
    const locationSamples = loadModule('lib/locationSamples.js', { './trackingGeometry': trackingGeometry, './deliveryLocation': deliveryLocation }, globals);
    moduleMocks['./deliveryLocation'] = deliveryLocation;
    moduleMocks['./deviceLocation'] = loadModule('lib/deviceLocation.js', {
      'expo-location': mocks['expo-location'],
      'react-native': { Platform: { OS: 'android' } },
      './locationSamples': locationSamples,
    }, globals);
  }
  const module = { exports: {} };
  vm.runInNewContext(code, { exports: module.exports, module, require: name => moduleMocks[name], Date, setTimeout, clearTimeout, ...globals });
  return module.exports;
}
const t = key => key;
const position = () => ({ coords: { latitude: 7.1, longitude: 125.6, accuracy: 10 }, timestamp: Date.now() });
function location(overrides = {}) { return { Accuracy: { Highest: 6 }, requestForegroundPermissionsAsync: async () => ({ granted: true }), hasServicesEnabledAsync: async () => true, getCurrentPositionAsync: async () => position(), ...overrides }; }
test('device location capture requests fresh high accuracy GPS and attaches timestamp', async () => {
  let options;
  const api = location({ getCurrentPositionAsync: async value => { options = value; return position(); } });
  const result = await loadModule('lib/podCapture.js', { 'expo-location': api }).currentProofLocation(t);
  assert.equal(result.latitude, 7.1); assert.equal(result.accuracy, 10); assert.ok(Date.parse(result.captured_at));
  assert.equal(options.maximumAge, 0); assert.equal(options.accuracy, 6);
});
for (const [name, overrides, message] of [
  ['denied permission', { requestForegroundPermissionsAsync: async () => ({ granted: false }) }, 'permission'],
  ['disabled services', { hasServicesEnabledAsync: async () => false }, 'services'],
  ['unavailable GPS', { getCurrentPositionAsync: async () => { throw { code: 2 }; } }, 'unavailable'],
  ['GPS timeout', { getCurrentPositionAsync: async () => { throw { code: 3 }; } }, 'timeout'],
  ['poor accuracy', { getCurrentPositionAsync: async () => ({ ...position(), coords: { ...position().coords, accuracy: 200 } }) }, 'accuracy'],
  ['mocked GPS', { getCurrentPositionAsync: async () => ({ ...position(), mocked: true }) }, 'accuracy'],
  ['stale GPS', { getCurrentPositionAsync: async () => ({ ...position(), timestamp: Date.now() - 60000 }) }, 'stale'],
]) test(`device capture handles ${name}`, async () => {
  const { currentProofLocation } = loadModule('lib/podCapture.js', { 'expo-location': location(overrides) });
  await assert.rejects(currentProofLocation(t), new RegExp(`pod.${message}`));
});
test('hanging permission/GPS request times out and clears the timer', async () => {
  let cleared = false;
  const { currentProofLocation } = loadModule('lib/podCapture.js', { 'expo-location': location({ requestForegroundPermissionsAsync: () => new Promise(() => {}) }) },
    { setTimeout: fn => { queueMicrotask(fn); return 1; }, clearTimeout: () => { cleared = true; } });
  await assert.rejects(currentProofLocation(t), /pod.timeout/); assert.ok(cleared);
});
test('mobile and server scheduling parsers agree across timezone and midnight cases', () => {
  const mobile = loadModule('lib/deliverySchedule.js'), backend = require('../lib/deliveryProof');
  for (const value of ['2026-09-05T22:00', '2026-09-05T14:00Z', '2026-09-06T00:01+08:00', '2026-02-30T11:00', '2026-09-05T24:00']) assert.equal(mobile.scheduleInstant(value), backend.scheduleInstant(value));
  assert.equal(mobile.manilaDate(Date.parse('2026-09-05T16:01:00Z')), '2026-09-06');
});
test('camera capture and web selection attach GPS to the selected photo', async () => {
  const { captureProofPhoto } = loadModule('lib/podCapture.js', { 'expo-location': location() });
  const picker = { requestCameraPermissionsAsync: async () => ({ granted: true }), launchCameraAsync: async () => ({ assets: [{ uri: 'camera.jpg' }] }), launchImageLibraryAsync: async () => ({ assets: [{ uri: 'selected.jpg' }] }) };
  for (const platform of ['android', 'web']) {
    const photo = await captureProofPhoto(t, picker, platform);
    assert.ok(photo.uri); assert.equal(photo.pod.latitude, 7.1); assert.ok(photo.pod.captured_at);
  }
});
test('camera denied, cancellation, malformed result and capture failure never produce proof', async () => {
  const { captureProofPhoto } = loadModule('lib/podCapture.js', { 'expo-location': location() });
  await assert.rejects(captureProofPhoto(t, { requestCameraPermissionsAsync: async () => ({ granted: false }) }, 'android'), /cameraPermissionMessage/);
  assert.equal(await captureProofPhoto(t, { launchImageLibraryAsync: async () => ({ canceled: true }) }, 'web'), null);
  await assert.rejects(captureProofPhoto(t, { launchImageLibraryAsync: async () => ({ assets: [] }) }, 'web'), /cameraErrorFallback/);
  await assert.rejects(captureProofPhoto(t, { launchImageLibraryAsync: async () => { throw Error('capture failed'); } }, 'web'), /capture failed/);
});
test('all mobile source modules compile with the installed Expo Babel preset', () => {
  let count = 0;
  function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.js$/.test(file)) {
      babel.transformFileSync(file, { configFile: false, babelrc: false, presets: [require.resolve('../../mobile/node_modules/babel-preset-expo')] }); count++;
    }
  } }
  walk(path.join(__dirname, '../../mobile/src')); assert.ok(count > 70);
});
