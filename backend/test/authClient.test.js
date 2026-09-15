const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('../../mobile/node_modules/@babel/core');

function client(fetch) {
  const code = babel.transformSync(fs.readFileSync(path.join(__dirname, '../../mobile/src/api/client.js'), 'utf8'), {
    configFile: false, babelrc: false,
    plugins: [require.resolve('../../mobile/node_modules/@babel/plugin-transform-modules-commonjs')],
  }).code;
  const exports = {};
  vm.runInNewContext(code, { exports, fetch, require: () => ({ BACKEND_URL: 'https://api.test' }) });
  return exports;
}
const response = status => ({ status, ok: status === 200, text: async () => '{}' });

test('unauthorized requests sign out without attempting a custom token exchange', async () => {
  let calls = 0; let signouts = 0;
  const c = client(async () => { calls++; return response(401); });
  c.setAuthToken('old-session');
  c.setUnauthorizedHandler(() => signouts++);
  await assert.rejects(c.api.get('/api/orders'), { status: 401 });
  assert.equal(calls, 1);
  assert.equal(signouts, 1);
});

test('late unauthorized response cannot sign out a different session', async () => {
  let finish; let signouts = 0;
  const c = client(() => new Promise(resolve => { finish = resolve; }));
  c.setAuthToken('old-session');
  c.setUnauthorizedHandler(() => signouts++);
  const pending = c.api.get('/api/orders');
  c.setAuthToken(null);
  finish(response(401));
  await assert.rejects(pending, { status: 401 });
  assert.equal(signouts, 0);
});

test('network and service failures do not trigger signout', async () => {
  for (const fetch of [async () => { throw new Error('offline'); }, async () => response(503)]) {
    const c = client(fetch);
    c.setUnauthorizedHandler(() => assert.fail('temporary outage signed out'));
    await assert.rejects(c.api.get('/api/orders'));
  }
});
