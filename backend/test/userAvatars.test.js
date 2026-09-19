const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { validateAvatarUrl } = require('../lib/avatar');
const photo = 'https://res.cloudinary.com/veggietrack/image/upload/v123/profiles/avatar.jpg';

function routes(db) {
  const registered = [];
  const app = { use() {}, listen() {} };
  for (const method of ['get', 'post', 'put', 'delete']) app[method] = (...args) => registered.push({ method, args });
  const express = Object.assign(() => app, { json: () => () => {}, raw: () => () => {} });
  const realRequire = createRequire(path.join(__dirname, '../index.js'));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), {
    require: name => name === 'express' ? express : name === 'dotenv' ? { config() {} } :
      name === '@supabase/supabase-js' ? { createClient: () => db } :
      name === './lib/avatar' ? { validateAvatarUrl: value => validateAvatarUrl(value, 'veggietrack') } : realRequire(name),
    process: { env: {}, on() {} }, console, Date, URL, setTimeout, clearTimeout,
  });
  return (method, route) => registered.find(r => r.method === method && r.args[0] === route).args[2];
}
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('avatars only accept bounded original uploads from the configured cloud', () => {
  assert.equal(validateAvatarUrl(photo, 'veggietrack'), photo);
  assert.equal(validateAvatarUrl(null, 'veggietrack'), null);
  for (const value of ['', {}, 42, photo.replace('veggietrack', 'other'), photo+'?x=1', photo+'#x',
    photo.replace('/v123/', '/w_100/'), photo.replace('avatar.jpg', '../avatar.jpg'),
    photo.replace('https:', 'http:'), photo.replace('res.cloudinary.com', 'res.cloudinary.com.evil.test'), photo+'a'.repeat(2048)]) {
    assert.throws(() => validateAvatarUrl(value, 'veggietrack'), error => error.status === 400);
  }
  assert.throws(() => validateAvatarUrl(photo, ''), error => error.status === 503);
});

test('avatar updates preserve ownership, ignore timestamp/role spoofing and return saved profile', async () => {
  let written, selection; const filters = [];
  const db = { from: () => ({ update(value) { written = value; return this; }, eq(...args) { filters.push(args); return this; },
    select(value) { selection = value; return this; }, single: async () => ({ data: { id: 'me', avatar_url: photo, profile_picture_updated_at: 'server-time' } }) }) };
  const update = routes(db)('put', '/api/users/:id');
  const foreign = response();
  await update({ params: { id: 'other' }, user: { userId: 'me' }, body: { avatar_url: photo } }, foreign);
  assert.equal(foreign.statusCode, 403); assert.equal(written, undefined);
  const invalid = response();
  await update({ params: { id: 'me' }, user: { userId: 'me' }, body: { avatar_url: 'https://evil.test/photo.jpg' } }, invalid);
  assert.equal(invalid.statusCode, 400); assert.equal(written, undefined);
  const saved = response();
  await update({ params: { id: 'me' }, user: { userId: 'me' }, body: {
    avatar_url: photo, full_name: 'Farmer', profile_picture_updated_at: 'fake', role: 'distributor', account_status: 'active',
  } }, saved);
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(Object.keys(written).sort(), ['avatar_url', 'full_name']);
  assert.ok(filters.some(([field,value]) => field === 'id' && value === 'me'));
  assert.match(selection, /avatar_url/); assert.match(selection, /profile_picture_updated_at/);
  assert.equal(saved.body.user.avatar_url, photo);
  assert.equal(saved.body.user.profile_picture_updated_at, 'server-time');
  const legacy = response();
  await update({ params: { id: 'me' }, user: { userId: 'me' }, body: { full_name: 'Legacy' } }, legacy);
  assert.equal(legacy.statusCode, 200); assert.equal(Object.hasOwn(written, 'avatar_url'), false);
});

test('farmer contacts include avatars while retaining distributor-only filtering', async () => {
  let selection; const filters=[];
  const db={from(table){return {select(value){if(table==='users')selection=value;return this;},neq(){return this;},order(){return this;},
    eq(...args){filters.push([table,...args]);return this;},then(resolve){return Promise.resolve({data:table==='users'?[{id:'distributor',full_name:'Distributor',role:'distributor',avatar_url:photo}]:[]}).then(resolve);}};}};
  const res=response(); await routes(db)('get','/api/messages/contacts')({user:{userId:'farmer',role:'farmer'}},res);
  assert.equal(res.statusCode,200); assert.match(selection,/avatar_url/);
  assert.ok(filters.some(([table,key,value])=>table==='users'&&key==='role'&&value==='distributor'));
  assert.equal(res.body[0].avatar_url,photo);
});
