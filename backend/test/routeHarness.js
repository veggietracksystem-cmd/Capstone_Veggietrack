const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Runs the real index.js route handlers against an in-memory table store, the
// same way crossRoleSmoke.test.js does. `missingColumns` makes any query naming
// one of those columns fail like PostgREST does before a migration (42703).
function routeHarness(data, { missingColumns = [] } = {}) {
  let sequence = 0;
  const missing = (text) => missingColumns.find((column) => new RegExp(`\\b${column}\\b`).test(text));
  const db = {
    from(table) {
      const rows = data[table] ||= [];
      const filters = []; const named = [];
      let mode = 'read', values, singular = false;
      const query = {
        select(columns = '*') { named.push(columns); return query; },
        eq(k, v) { named.push(k); filters.push((row) => row[k] === v); return query; },
        neq(k, v) { named.push(k); filters.push((row) => row[k] !== v); return query; },
        is(k, v) { named.push(k); filters.push((row) => (row[k] ?? null) === v); return query; },
        in(k, list) { named.push(k); filters.push((row) => list.includes(row[k])); return query; },
        order() { return query; }, limit() { return query; },
        insert(v) { mode = 'insert'; values = v; return query; },
        update(v) { mode = 'update'; values = v; named.push(...Object.keys(v)); return query; },
        single() { singular = true; return query; }, maybeSingle() { singular = true; return query; },
        then(resolve, reject) {
          const absent = missing(named.join(' '));
          if (absent) return Promise.resolve({ data: null, error: { code: '42703', message: `column ${absent} does not exist` } }).then(resolve, reject);
          let result = rows.filter((row) => filters.every((filter) => filter(row)));
          if (mode === 'insert') {
            result = (Array.isArray(values) ? values : [values]).map((value) => ({ id: `id-${++sequence}`, ...value }));
            rows.push(...result);
          }
          if (mode === 'update') result.forEach((row) => Object.assign(row, values));
          const joined = result.map((row) => (table === 'pickup_requests'
            ? { ...row, harvests: (data.harvests || []).find((h) => h.id === row.harvest_id) || null } : { ...row }));
          return Promise.resolve({ data: singular ? joined[0] || null : joined, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc() { return { data: null, error: null }; },
  };
  const handlers = new Map(); const app = { use() {}, listen() {} };
  for (const method of ['get', 'post', 'put', 'delete']) app[method] = (route, ...callbacks) => handlers.set(`${method} ${route}`, callbacks.at(-1));
  const express = Object.assign(() => app, { json: () => () => {}, raw: () => () => {} });
  const realRequire = createRequire(path.join(__dirname, '../index.js'));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), {
    require: (name) => (name === 'express' ? express : name === 'dotenv' ? { config() {} } : name === '@supabase/supabase-js' ? { createClient: () => db } : realRequire(name)),
    process: { env: {}, on() {} }, console, Date, URL, setTimeout, clearTimeout,
  });
  return async function call(key, userId, { body = {}, id, query = {} } = {}) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
    const user = (data.users || []).find((row) => row.id === userId);
    await handlers.get(key)({ user: { userId, role: user?.role }, body, params: { id }, query }, res);
    return res;
  };
}

module.exports = { routeHarness };
