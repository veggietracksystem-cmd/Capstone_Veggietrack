const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const mobileRequire = createRequire(path.join(__dirname, '../../mobile/package.json'));
const babel = mobileRequire('@babel/core');

function load(relative) {
  const filename = path.join(__dirname, '../../mobile', relative);
  const code = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false, presets: [mobileRequire.resolve('babel-preset-expo')],
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: mobileRequire });
  return module.exports;
}

const { rootBranch, rootInitialRoute } = load('src/lib/rootRoute.js');
const appSource = fs.readFileSync(path.join(__dirname, '../../mobile/App.js'), 'utf8');
// Literal <Stack.Screen name="X">, plus the role dashboards, which are rendered
// under a dynamic name taken from the ROLE_SCREENS table.
const declaredScreens = new Set([
  ...[...appSource.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map(m => m[1]),
  ...[...appSource.matchAll(/name:\s*'([A-Za-z]+Dashboard)'/g)].map(m => m[1]),
]);

const roleScreen = { name: 'DistributorDashboard', component: null };
const session = { access_token: 'token' };

test('every root state starts on a screen the root stack declares', () => {
  assert.ok(declaredScreens.size > 5, 'App.js screen names were parsed');
  for (const recoveryMode of [false, true])
    for (const activeSession of [null, session])
      for (const role of [null, roleScreen])
        for (const initialRoute of ['Landing', 'Login']) {
          const state = { recoveryMode, session: activeSession, roleScreen: role, initialRoute };
          const name = rootInitialRoute(state);
          assert.ok(declaredScreens.has(name), `${JSON.stringify({ recoveryMode, session: !!activeSession, role: !!role, initialRoute })} -> unknown screen '${name}'`);
        }
});

test('a session without an allowed role starts on the status screen, not the landing screen', () => {
  // This branch renders only ApplicationStatus, so 'Landing' is not a valid route.
  const state = { recoveryMode: false, session, roleScreen: null, initialRoute: 'Landing' };
  assert.equal(rootBranch(state), 'status');
  assert.equal(rootInitialRoute(state), 'ApplicationStatus');
});

test('the other branches keep their own entry points', () => {
  assert.equal(rootInitialRoute({ recoveryMode: true, session, roleScreen: null, initialRoute: 'Landing' }), 'ResetPassword');
  assert.equal(rootInitialRoute({ recoveryMode: false, session, roleScreen, initialRoute: 'Landing' }), 'DistributorDashboard');
  assert.equal(rootInitialRoute({ recoveryMode: false, session: null, roleScreen: null, initialRoute: 'Login' }), 'Login');
});

test('leaving password recovery starts the signed-out stack fresh at Log in', () => {
  // The signed-out branch also declares ResetPassword. Without a per-branch key the
  // navigator kept that route after recovery ended, with no screen to go back to.
  assert.match(appSource, /<Stack\.Navigator[\s\S]*?key=\{branch\}/);
  assert.equal(rootBranch({ recoveryMode: true, session, roleScreen: null }), 'recovery');
  assert.equal(rootInitialRoute({ recoveryMode: false, session: null, roleScreen: null, initialRoute: 'Login' }), 'Login');
});
