const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { routeHarness } = require('./routeHarness');
const { accountNotice } = require('../lib/accountNotices');
const { TRUSTED_DISTRIBUTOR } = require('../lib/auth');

// User Management actions keep every reason or message: decline/disable reasons on
// the account (users.status_reason, shown at sign-in), approve/turn-back-on
// messages as one in-app notification, and every action in account_audit.

const HUB = TRUSTED_DISTRIBUTOR;
const AMY = '00000000-0000-0000-0000-0000000000a1', BOB = '00000000-0000-0000-0000-0000000000b2';
const HUB_AUTH = '00000000-0000-0000-0000-00000000aaaa', AMY_AUTH = '00000000-0000-0000-0000-00000000bbbb';
const HUB_SESSION = '00000000-0000-0000-0000-00000000cccc';

// The account functions exactly as live (sql/fix_account_rpcs_email_only.sql), on the
// columns they use.
async function accountDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY, user_id uuid, created_at timestamptz DEFAULT now());
    CREATE TABLE public.users(id uuid PRIMARY KEY, auth_user_id uuid, full_name text, role text, account_status text,
      status_version integer NOT NULL DEFAULT 0, status_reason text, approved_at timestamptz, approved_by uuid,
      disabled_at timestamptz, login_not_before timestamptz, password_hash text, reset_password_token text, reset_password_expires timestamptz);
    CREATE TABLE public.account_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target_id uuid, actor_id uuid, action text,
      previous_status text, resulting_status text, reason text, created_at timestamptz DEFAULT clock_timestamp());
    INSERT INTO public.users(id, auth_user_id, full_name, role, account_status) VALUES
      ('${HUB}', '${HUB_AUTH}', 'Hub', 'distributor', 'active'),
      ('${AMY}', '${AMY_AUTH}', 'Amy Farmer', 'farmer', 'pending_approval'),
      ('${BOB}', null, 'Bob Retailer', 'retailer', 'pending_approval');
    INSERT INTO auth.sessions VALUES ('${HUB_SESSION}', '${HUB_AUTH}', now() - interval '1 hour');
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../sql/fix_account_rpcs_email_only.sql'), 'utf8'));
  return db;
}
const user = async (db, id) => (await db.query('SELECT * FROM public.users WHERE id = $1', [id])).rows[0];
const transition = (db, target, action, reason, version) => db.query('SELECT public.vt_admin_transition($1,$2,$3,$4,$5,$6) AS r',
  [HUB_AUTH, HUB_SESSION, target, action, reason, version]).then((r) => r.rows[0].r);
const audit = (db, target) => db.query('SELECT action, reason, actor_id, resulting_status FROM public.account_audit WHERE target_id = $1 ORDER BY created_at', [target]).then((r) => r.rows);
// What /api/auth/me returns to the user signing in (vt_account_context).
const signIn = async (db, authId) => {
  const session = (await db.query('INSERT INTO auth.sessions(id, user_id, created_at) VALUES (gen_random_uuid(), $1, clock_timestamp()) RETURNING id', [authId])).rows[0].id;
  return (await db.query('SELECT public.vt_account_context($1,$2) AS c', [authId, session])).rows[0].c;
};

test('notices: approval is always the standard text; turn back on may carry a message; decline and disable send none', () => {
  const approved = { title: 'Account Approved', message: 'Your account has been approved. You can now access VeggieTrack.' };
  assert.deepEqual(accountNotice('APPROVED', ''), approved);
  assert.deepEqual(accountNotice('APPROVED', 'Welcome, Amy!'), approved, 'no distributor message on approval');
  assert.equal(accountNotice('REACTIVATED', null).title, 'Account Reactivated');
  assert.equal(accountNotice('REACTIVATED', ' Thanks for verifying. ').message,
    'Your account has been reactivated. You can access VeggieTrack again.\n\nMessage from the distributor: Thanks for verifying.');
  assert.equal(accountNotice('DECLINED', 'No'), null);
  assert.equal(accountNotice('DISABLED', 'No'), null);
});

test('lifecycle on PostgreSQL: pending -> approved -> disabled (sign-in shows reason) -> turned back on; every reason kept with user, action, actor and time', async () => {
  const db = await accountDb();
  try {
    await transition(db, AMY, 'APPROVED', null, 0);
    let amy = await user(db, AMY);
    assert.deepEqual([amy.account_status, amy.status_reason, amy.approved_by], ['active', null, HUB]);
    // A retry of the same action (same version) is rejected: no second record.
    await assert.rejects(transition(db, AMY, 'APPROVED', null, 0), /Stale/);
    await assert.rejects(transition(db, AMY, 'DISABLED', '   ', 1), /Reason required/, 'a blank reason is refused');

    await transition(db, AMY, 'DISABLED', 'Account information needs verification', 1);
    amy = await user(db, AMY);
    assert.deepEqual([amy.account_status, amy.status_reason, amy.disabled_at != null], ['disabled', 'Account information needs verification', true]);
    // Signing in: blocked from the app, with the reason for the status screen.
    const context = await signIn(db, AMY_AUTH);
    assert.deepEqual([context.account_status, context.access_allowed, context.status_reason], ['disabled', false, 'Account information needs verification']);
    assert.equal((await signIn(db, AMY_AUTH)).status_reason, 'Account information needs verification', 'still there after signing in again');

    await transition(db, AMY, 'REACTIVATED', 'Thanks for verifying.', 2);
    const back = await signIn(db, AMY_AUTH);
    assert.deepEqual([back.account_status, back.access_allowed, back.status_reason], ['active', true, null]);

    assert.deepEqual((await audit(db, AMY)).map((r) => [r.action, r.reason, r.actor_id, r.resulting_status]), [
      ['APPROVED', null, HUB, 'active'],
      ['DISABLED', 'Account information needs verification', HUB, 'disabled'],
      ['REACTIVATED', 'Thanks for verifying.', HUB, 'active'],
    ]);
  } finally { await db.close(); }
});

test('decline on PostgreSQL: the reason is required, saved on that account only and shown at sign-in', async () => {
  const db = await accountDb();
  try {
    await assert.rejects(transition(db, BOB, 'DECLINED', '', 0), /Reason required/);
    await transition(db, BOB, 'DECLINED', 'Store address could not be confirmed', 0);
    const bob = await user(db, BOB);
    assert.deepEqual([bob.account_status, bob.status_reason], ['declined', 'Store address could not be confirmed']);
    assert.equal((await user(db, AMY)).status_reason, null, 'another account is untouched');
    assert.deepEqual((await audit(db, BOB)).map((r) => [r.action, r.reason]), [['DECLINED', 'Store address could not be confirmed']]);
    await db.query('UPDATE public.users SET auth_user_id = $1 WHERE id = $2', ['00000000-0000-0000-0000-00000000dddd', BOB]);
    const context = await signIn(db, '00000000-0000-0000-0000-00000000dddd');
    assert.deepEqual([context.account_status, context.access_allowed, context.status_reason], ['declined', false, 'Store address could not be confirmed']);
  } finally { await db.close(); }
});

test('routes: one notification per approve/turn back on, none for decline/disable, none on retry; the list shows the latest reason', async () => {
  const data = {
    users: [
      { id: HUB, role: 'distributor', full_name: 'Hub', account_status: 'active' },
      { id: AMY, role: 'farmer', full_name: 'Amy Farmer', account_status: 'pending_approval', status_version: 0, created_at: '2026-10-01T00:00:00Z' },
      { id: BOB, role: 'retailer', full_name: 'Bob Retailer', account_status: 'pending_approval', status_version: 0, created_at: '2026-10-02T00:00:00Z' },
    ],
    notifications: [], account_audit: [],
  };
  // Same rules as vt_admin_transition: one transition per status_version, reason
  // required to decline or disable, every action recorded in account_audit.
  const NEXT = { APPROVED: ['pending_approval', 'active'], DECLINED: ['pending_approval', 'declined'], DISABLED: ['active', 'disabled'], REACTIVATED: ['disabled', 'active'] };
  let clock = Date.parse('2026-10-06T00:00:00Z');
  const reasons = [];
  const rpc = (name, args, store) => {
    assert.equal(name, 'vt_admin_transition');
    reasons.push([args.p_action, args.p_reason]);
    const target = store.users.find((u) => u.id === args.p_target);
    const [from, to] = NEXT[args.p_action] || [];
    if (!target || target.status_version !== args.p_version || target.account_status !== from) return { data: null, error: { message: 'Stale or ineligible account' } };
    const reason = (args.p_reason || '').trim();
    if (['DECLINED', 'DISABLED'].includes(args.p_action) && !reason) return { data: null, error: { message: 'Reason required' } };
    store.account_audit.push({ target_id: target.id, actor_id: HUB, action: args.p_action, reason: reason || null, created_at: new Date(clock += 60000).toISOString() });
    Object.assign(target, { account_status: to, status_version: target.status_version + 1, status_reason: ['DECLINED', 'DISABLED'].includes(args.p_action) ? reason : null });
    return { data: { id: target.id, account_status: to, status_version: target.status_version }, error: null };
  };
  const call = routeHarness(data, { rpc });
  const act = (id, action, reason, version) => call('post /api/accounts/:id/transition', HUB, { id, body: { action, reason, version } });
  const notes = (id) => data.notifications.filter((n) => n.user_id === id).map((n) => [n.title, n.message, n.type]);

  let res = await act(AMY, 'APPROVED', 'Welcome, Amy!', 0);
  assert.deepEqual([res.statusCode, res.body.notified], [200, true]);
  assert.equal((await act(AMY, 'APPROVED', 'Welcome, Amy!', 0)).statusCode, 409, 'a retry is rejected');
  await act(AMY, 'DISABLED', 'Account information needs verification', 1);
  assert.equal((await act(AMY, 'REACTIVATED', 'Thanks for verifying.', 2)).body.notified, true);
  await act(BOB, 'DECLINED', 'Store address could not be confirmed', 0);
  assert.equal((await act(BOB, 'DISABLED', 'x', 1)).statusCode, 409);

  assert.deepEqual(notes(AMY), [
    ['Account Approved', 'Your account has been approved. You can now access VeggieTrack.', 'account'],
    ['Account Reactivated', 'Your account has been reactivated. You can access VeggieTrack again.\n\nMessage from the distributor: Thanks for verifying.', 'account'],
  ], 'exactly one notification per approve and turn back on; none for the disable');
  assert.deepEqual(reasons[0], ['APPROVED', null], 'an approval message is never saved');
  assert.deepEqual(notes(BOB), [], 'a declined user cannot open the app, so the reason is on their account instead');

  // Each user reads only their own notifications.
  const amyInbox = (await call('get /api/notifications', AMY)).body;
  assert.deepEqual(amyInbox.map((n) => n.title).sort(), ['Account Approved', 'Account Reactivated']);
  assert.deepEqual((await call('get /api/notifications', BOB)).body, []);

  // The distributor sees the latest action, reason and date on each account.
  const declined = (await call('get /api/accounts', HUB, { query: { status: 'declined' } })).body;
  assert.deepEqual(declined.map((u) => [u.id, u.status_reason, u.last_action.action, u.last_action.reason]),
    [[BOB, 'Store address could not be confirmed', 'DECLINED', 'Store address could not be confirmed']]);
  const active = (await call('get /api/accounts', HUB, { query: { status: 'active' } })).body;
  assert.deepEqual(active.map((u) => [u.id, u.last_action.action]), [[AMY, 'REACTIVATED']]);
  assert.equal((await call('get /api/accounts', AMY, { query: { status: 'declined' } })).statusCode, 403, 'reasons are for the distributor only');
});
