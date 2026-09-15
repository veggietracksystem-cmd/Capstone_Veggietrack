const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function routes(db) {
  const registered = [];
  const app = { use: (...args) => registered.push({ method: 'use', args }), listen() {} };
  for (const method of ['get', 'post', 'put', 'delete']) app[method] = (...args) => registered.push({ method, args });
  const express = Object.assign(() => app, { json: () => () => {}, raw: () => () => {} });
  const realRequire = createRequire(path.join(__dirname, '../index.js'));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), {
    require: name => name === 'express' ? express : name === 'dotenv' ? { config() {} } : name === '@supabase/supabase-js' ? { createClient: () => db } : realRequire(name),
    process: { env: {} }, console, Date, URL, setTimeout, clearTimeout,
  });
  return registered;
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
test('every private route keeps authentication and all obsolete authentication paths fail closed', async () => {
  const registered = routes({});
  const publicPaths = ['/', '/api/products/available', '/api/hooks/send-sms'];
  for (const route of registered.filter(r => r.method !== 'use')) {
    const [name, ...handlers] = route.args;
    if (!publicPaths.includes(name)) {
      assert.equal(handlers.length, 2, `${name} must have authentication`);
      for (const headers of [{}, { authorization: 'Bearer legacy-session' }, { authorization: 'Bearer arbitrary-token' }]) {
        const res = response();
        await handlers[0]({ headers }, res, () => assert.fail(`${name} accepted credentials during auth transition`));
        assert.equal(res.statusCode, 401);
      }
    }
    assert.ok(!name.startsWith('/api/debug'));
  }
  const retired = registered.find(r => r.method === 'use' && r.args[0] === '/api/auth').args[1];
  for (const name of ['login','register','send-otp','verify-otp','verify-registration','resend-otp','refresh-token','reset-password','forgot-password','forgot-password-email','reset-password-web']) {
    assert.ok(!registered.some(r => r.method !== 'use' && r.args[0] === `/api/auth/${name}`));
    const res = response(); retired({}, res); assert.equal(res.statusCode, 410);
  }
});
test('farmers cannot request another farmer harvest and riders cannot complete another rider pickup', async () => {
  const filters = []; let writes = 0;
  const db = { from(table) { return { select() { return this; }, eq(field, value) { filters.push([table, field, value]); return this; },
    maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }), insert() { writes++; return this; }, update() { writes++; return this; } }; } };
  const registered = routes(db);
  for (const [route, req, expectedFilter] of [
    ['/api/pickup-requests', { body: { harvest_id: 'someone-elses-harvest' }, user: { role: 'farmer', userId: 'farmer1' } }, ['harvests', 'farmer_id', 'farmer1']],
    ['/api/pickup-requests/:id/pickup', { params: { id: 'someone-elses-pickup' }, user: { role: 'delivery_personnel', userId: 'rider1' } }, ['pickup_requests', 'delivery_personnel_id', 'rider1']],
  ]) {
    const handler = registered.find(r => r.method === 'post' && r.args[0] === route).args[2];
    const res = response(); await handler(req, res); assert.equal(res.statusCode, 404);
    assert.ok(filters.some(filter => JSON.stringify(filter) === JSON.stringify(expectedFilter)));
  }
  assert.equal(writes, 0);
});
test('profile IDOR and message filter injection fail before querying data', async () => {
  const registered = routes({ from: () => assert.fail('No database query expected') });
  const profile = registered.find(r => r.method === 'put' && r.args[0] === '/api/users/:id').args[2];
  const res = response(); await profile({ params: { id: 'other' }, user: { userId: 'me' } }, res); assert.equal(res.statusCode, 403);
  const messages = registered.find(r => r.method === 'get' && r.args[0] === '/api/messages/:userId').args[2];
  const invalid = response(); await messages({ params: { userId: 'x),sender_id.neq.x' }, user: { userId: 'me' } }, invalid); assert.equal(invalid.statusCode, 400);
});
