const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('../../mobile/node_modules/@babel/core');
function load(file, mocks = {}, globals = {}) {
  const absolute = path.resolve(__dirname, '../../mobile/src', file);
  const code = babel.transformSync(fs.readFileSync(absolute, 'utf8'), { configFile: false, babelrc: false,
    plugins: [require.resolve('../../mobile/node_modules/@babel/plugin-transform-modules-commonjs')] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date, console, setTimeout, clearTimeout, AbortController,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : load(path.relative(path.resolve(__dirname, '../../mobile/src'), path.resolve(path.dirname(absolute), name + '.js')), mocks, globals), ...globals });
  return module.exports;
}
const { createProofSubmission, proofFailureMessage, POD_MESSAGES } = load('lib/podSubmission.js');
const photo = { uri: 'file:///proof.jpg', mimeType: 'image/jpeg' };
const location = async () => ({ latitude: 0, longitude: 0, accuracy: 10, captured_at: new Date().toISOString() });
test('Cloudinary failure never completes, and duplicate taps share one active submission', async () => {
  let uploads = 0, completions = 0, release;
  const wait = new Promise(resolve => { release = resolve; });
  const controller = createProofSubmission({ isOnline: async () => true, upload: async () => { uploads++; await wait; throw Error('upload rejected'); }, complete: async () => { completions++; } });
  const first = controller.submit({ photo, getLocation: location });
  const duplicate = controller.submit({ photo, getLocation: location });
  assert.equal(first, duplicate); release();
  await assert.rejects(first, error => { assert.equal(proofFailureMessage(error), POD_MESSAGES.upload); return true; });
  assert.equal(uploads, 1); assert.equal(completions, 0); assert.equal(controller.isSubmitting(), false);
});
test('backend rejection preserves uploaded proof for a safe retry and retains rejection details', async () => {
  let uploads = 0, attempts = 0;
  const controller = createProofSubmission({ isOnline: async () => true, upload: async () => { uploads++; return 'hosted-photo'; }, complete: async body => {
    assert.equal(body.proof_photo_url, 'hosted-photo');
    if (++attempts === 1) throw Object.assign(Error('rejected'), { status: 422, data: { error: 'Move closer.' } });
    return { status: 'delivered' };
  } });
  await assert.rejects(controller.submit({ photo, getLocation: location }), error => { assert.equal(proofFailureMessage(error), POD_MESSAGES.completion + '\n\nMove closer.'); return true; });
  await controller.submit({ photo, getLocation: location });
  await controller.submit({ photo, getLocation: location });
  assert.equal(uploads, 1); assert.equal(attempts, 2);
});
test('offline is only reported when connectivity says offline; server/401/5xx/timeout remain distinct', async () => {
  const controller = createProofSubmission({ isOnline: async () => false, upload: () => assert.fail(), complete: () => assert.fail() });
  await assert.rejects(controller.submit({ photo, getLocation: location }), error => { assert.equal(proofFailureMessage(error), POD_MESSAGES.offline); return true; });
  for (const [error, expected] of [
    [{ code: 'BACKEND_UNREACHABLE', status: 0, stage: 'complete' }, POD_MESSAGES.unreachable],
    [{ status: 401, stage: 'complete' }, POD_MESSAGES.session],
    [{ status: 503, stage: 'complete' }, POD_MESSAGES.completion],
    [{ code: 'REQUEST_TIMEOUT', status: 0, stage: 'complete' }, POD_MESSAGES.completion + '\n\n' + POD_MESSAGES.timeout],
  ]) assert.equal(proofFailureMessage(error), expected);
});
test('NetInfo unknown/error states do not claim offline', async () => {
  for (const state of [{}, { isConnected: true }, { isConnected: false }, { isInternetReachable: false }]) {
    const net = load('offline/net.js', { '@react-native-community/netinfo': { fetch: async () => state } });
    assert.equal(await net.isOnline(), state.isConnected !== false && state.isInternetReachable !== false);
  }
  assert.equal(await load('offline/net.js', { '@react-native-community/netinfo': { fetch: async () => { throw Error(); } } }).isOnline(), true);
});
test('a malformed successful response never fabricates delivery completion', async () => {
  const controller = createProofSubmission({ isOnline: async () => true, upload: async () => 'hosted', complete: async () => null });
  await assert.rejects(controller.submit({ photo, getLocation: location }), { code: 'COMPLETION_UNCONFIRMED' });
});

// A photo uploaded for a completion the server then rejects is orphaned in
// Cloudinary forever. The pre-flight runs the server's own checks first so the
// common rejections - wrong status, stale or inaccurate GPS, standing too far
// from the farm - cost nothing.
test('a rejected pre-flight completes nothing and, crucially, uploads nothing', async () => {
  let uploads = 0, completions = 0, prechecks = 0;
  const controller = createProofSubmission({ isOnline: async () => true,
    precheck: async body => { prechecks++; assert.equal(body.accuracy, 10); throw Object.assign(Error('rejected'), { status: 422, data: { error: 'Move closer.' } }); },
    upload: async () => { uploads++; return 'hosted'; }, complete: async () => { completions++; } });
  await assert.rejects(controller.submit({ photo, getLocation: location }), error => {
    assert.equal(error.stage, 'precheck');
    const message = proofFailureMessage(error);
    assert.equal(message, POD_MESSAGES.precheck + String.fromCharCode(10, 10) + 'Move closer.');
    assert.ok(!message.includes('uploaded, but'), 'must not claim a photo was uploaded');
    return true;
  });
  assert.equal(uploads, 0); assert.equal(completions, 0); assert.equal(prechecks, 1);
});
test('a backend without the pre-flight route never blocks a completion it would have accepted', async () => {
  let uploads = 0;
  // The generic JSON 404 for an unknown path carries no code of its own; a real
  // "not found" from the pre-flight always does.
  const controller = createProofSubmission({ isOnline: async () => true,
    precheck: async () => { throw Object.assign(Error('That endpoint does not exist.'), { status: 404, data: { error: 'That endpoint does not exist.' } }); },
    upload: async () => { uploads++; return 'hosted'; }, complete: async () => ({ status: 'delivered' }) });
  await controller.submit({ photo, getLocation: location });
  assert.equal(uploads, 1);
});
test('a real pre-flight 404 still stops the attempt, and a retry after a rejected completion skips it', async () => {
  let prechecks = 0, uploads = 0, attempts = 0;
  const missing = createProofSubmission({ isOnline: async () => true,
    precheck: async () => { throw Object.assign(Error('Delivery not found or not assigned to you'), { status: 404, code: 'DELIVERY_NOT_FOUND', data: { error: 'Delivery not found or not assigned to you', code: 'DELIVERY_NOT_FOUND' } }); },
    upload: () => assert.fail('nothing may be uploaded for a delivery the rider does not own'), complete: () => assert.fail() });
  await assert.rejects(missing.submit({ photo, getLocation: location }), { stage: 'precheck' });

  const controller = createProofSubmission({ isOnline: async () => true,
    precheck: async () => { prechecks++; }, upload: async () => { uploads++; return 'hosted'; },
    complete: async () => { if (++attempts === 1) throw Object.assign(Error('rejected'), { status: 503 }); return { status: 'delivered' }; } });
  await assert.rejects(controller.submit({ photo, getLocation: location }), { stage: 'complete' });
  await controller.submit({ photo, getLocation: location });
  // The upload is already paid for on the retry, so re-checking buys nothing.
  assert.equal(prechecks, 1); assert.equal(uploads, 1); assert.equal(attempts, 2);
});
function uploadModule(fetch, env = { CLOUDINARY_CLOUD_NAME: 'test-cloud', CLOUDINARY_UPLOAD_PRESET: 'unsigned-test' }) {
  return load('lib/cloudinary.js', { 'react-native': { Platform: { OS: 'android' } }, '@env': env,
    'expo-file-system': { File: class { constructor(uri) { this.uri = uri; } } } }, { fetch,
    FormData: class { append() {} } });
}
test('native URI/MIME preparation, multipart boundary, upload errors/configuration and timeout', async () => {
  const module = uploadModule(async (_, options) => {
    assert.equal(options.headers, undefined); assert.ok(options.signal);
    return { ok: true, text: async () => JSON.stringify({ secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/proof.jpg' }) };
  });
  assert.equal(module.prepareNativeImage({ uri: '/cache/image.png' }).type, 'image/png');
  assert.equal(module.prepareNativeImage({ uri: 'content://media/123', mimeType: 'image/heic' }).uri, 'content://media/123');
  assert.throws(() => module.prepareNativeImage({ uri: 'content://media/123' }), { code: 'IMAGE_PREPARATION_FAILED' });
  await module.uploadToCloudinary(photo);
  for (const [response, code] of [
    [{ ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'Upload preset must be unsigned' } }) }, 'CLOUDINARY_CONFIGURATION'],
    [{ ok: false, status: 500, text: async () => '<html>Error</html>' }, 'CLOUDINARY_UPLOAD_FAILED'],
  ]) await assert.rejects(uploadModule(async () => response).uploadToCloudinary(photo), { code });
  await assert.rejects(uploadModule(() => assert.fail(), {}).uploadToCloudinary(photo), { code: 'CLOUDINARY_CONFIGURATION' });
  await assert.rejects(uploadModule(() => new Promise(() => {})).uploadToCloudinary(photo, { timeoutMs: 5 }), { code: 'UPLOAD_TIMEOUT' });
});
test('fresh GPS refinement requires multiple observations, ignores stale and inaccurate samples, keeps best acceptable', async () => {
  const { refineLocation } = load('lib/locationSamples.js');
  let now = 100000, reads = 0;
  const readings = [
    { timestamp: 1, coords: { latitude: 0, longitude: 0, accuracy: 5 } },
    { timestamp: 100001, coords: { latitude: 0, longitude: 0, accuracy: 1000 } },
    { timestamp: 100002, coords: { latitude: 0, longitude: 0, accuracy: 18 } },
    { timestamp: 100003, coords: { latitude: 0, longitude: 0, accuracy: 9 } },
  ];
  const best = await refineLocation(async () => readings[reads++], { now: () => now, pause: async ms => { now += ms; } });
  assert.equal(reads, 4); assert.equal(best.accuracy, 9);
  await assert.rejects(refineLocation(async () => readings[3], { now: () => now, timeoutMs: 5, pause: async ms => { now += ms; } }), { code: 'GPS_UNCONFIRMED' });
});
test('a stationary phone repeating one fix captured after the request is accepted', async () => {
  const { refineLocation } = load('lib/locationSamples.js');
  let now = 200000;
  const fix = { timestamp: 200500, coords: { latitude: 0, longitude: 0, accuracy: 20 } };
  const result = await refineLocation(async () => fix, { now: () => now, timeoutMs: 3000, pause: async ms => { now += ms; } });
  assert.equal(result.timestamp, 200500); assert.equal(result.accuracy, 20);
});
test('current-leg ETA never uses static duration; routing failure leaves fresh GPS usable', () => {
  const { activeJourney, liveEtaSeconds, isLivePosition } = load('lib/trackingJourney.js');
  const pickup = { latitude: 0, longitude: 0 }, delivery = { latitude: 1, longitude: 1 };
  for (const [status, phase, target] of [['approved', 'pickup', pickup], ['in_transit', 'delivery', delivery]]) {
    const journey = activeJourney({ status, retailer_view: { pickup, delivery, tracking: { navigation_phase: phase, route: { coordinates: [] }, eta_seconds: 720, estimated_route_seconds: 3600 } } });
    assert.equal(journey.target, target); assert.equal(liveEtaSeconds(journey, { live: true }), 720);
  }
  const legacy = activeJourney({ retailer_view: { tracking: { route: {}, eta_seconds: 3600 } } });
  assert.equal(liveEtaSeconds(legacy, { live: true }), null);
  const failed = activeJourney({ retailer_view: { tracking: { navigation_phase: 'delivery', route: null, eta_seconds: null } } });
  assert.equal(liveEtaSeconds(failed, { live: true }), null);
  assert.equal(isLivePosition({ latitude: 0, longitude: 0, timestamp: Date.now() }), true);
});
