const test = require('node:test');
const assert = require('node:assert/strict');
const { mountScreen, settle, translation } = require('./mobileScreenHarness');

const reactNative = (extra = {}) => new Proxy({
  StyleSheet: { create: (styles) => styles, absoluteFill: {} }, Platform: { OS: 'android' },
  BackHandler: { addEventListener: () => ({ remove() {} }) }, useWindowDimensions: () => ({ width: 400, height: 800 }), ...extra,
}, { get: (target, name) => (name in target ? target[name] : name === '__esModule' ? true : Object.assign(() => null, { displayName: String(name) })) });
const shared = (api, alerts = []) => ({
  'react-native': reactNative(),
  '../api/client': { __esModule: true, default: api },
  '../offline/cache': { readThrough: async (key, read) => ({ list: await read() }) },
  '../hooks/useLatestRequest': { __esModule: true, default: () => () => () => true },
  '../sync/SyncProvider': { useAutoSync: () => ({ syncState: 'online' }) },
  '../lib/ui': { showAlert: (title, message) => alerts.push([title, message]), confirmAction() {}, peso: (n) => `PHP ${n}`, shortId: (id) => String(id).slice(0, 8) },
  '../lib/errorMessages': { friendlyError: (err, fallback) => err?.message || fallback },
  '../i18n/useTranslation': translation,
});

function distributor(db) {
  const reads = [];
  const api = { get: async (path) => { reads.push(path); if (!(path in db)) throw new Error(`unexpected ${path}`); return db[path](); } };
  const stockAlerts = { alerts: [], reload: async () => {} };
  let onFocus = null;
  const navigation = { addListener: (event, fn) => { if (event === 'focus') onFocus = fn; return () => {}; }, navigate() {} };
  const screen = mountScreen('screens/DistributorDashboard.js', {
    ...shared(api), '../hooks/useStockAlerts': { __esModule: true, default: () => stockAlerts },
  }, { navigation, route: { params: {} } });
  const home = () => screen.findAll((props) => 'pickupActionCount' in props)[0];
  // Quick Action badges by label, from the Home tab's own render.
  const badges = () => {
    const tab = home();
    const tree = tab.type(tab.props);
    const walk = (node, out) => {
      if (Array.isArray(node)) node.forEach((child) => walk(child, out));
      else if (node?.props) { if (node.type?.name === 'QuickAction') out[node.props.label] = node.props.badge; walk(node.props.children, out); }
      return out;
    };
    return walk(tree, {});
  };
  return { screen, reads, badges, home, focus: async () => { onFocus(); await settle(); screen.render(); } };
}

test('Distributor Quick Actions show counts from real data, hide at zero and update after actions', async () => {
  let pickups = ['requested', 'requested', 'approved', 'assigned', 'otw', 'picked_up', 'declined'].map((status, i) => ({ id: `p${i}`, status }));
  let accounts = [{ id: 'a1' }, { id: 'a2' }];
  let unpaid = [{ id: 'o1', total_amount: 100 }];
  const d = distributor({
    '/api/orders/pending': () => [], '/api/orders/active': () => [], '/api/payments': () => [],
    '/api/pickup-requests': () => pickups, '/api/accounts?status=pending_approval': () => accounts,
    '/api/orders/unpaid': () => unpaid, '/api/delivery-personnel': () => [{ id: 'ana', full_name: 'Ana' }],
  });
  await settle(); d.screen.render();
  assert.deepEqual(d.badges(), {
    'dashboards.distributor.pickupRequests': 3, // 2 to approve or decline + 1 approved waiting for a rider
    'dashboards.distributor.stockAlertAction': 0,
    'dashboards.distributor.accountManagement': 2,
    'dashboards.distributor.paymentAction': 1,
  });

  // The distributor assigns the riders, approves both accounts and records the payment.
  pickups = pickups.map((p) => (['requested', 'approved'].includes(p.status) ? { ...p, status: 'assigned' } : p));
  accounts = []; unpaid = [];
  await d.focus();
  assert.deepEqual(Object.values(d.badges()), [0, 0, 0, 0]);
});

test('a Quick Action shows its red count only when there is something to do', async () => {
  const d = distributor({
    '/api/orders/pending': () => [], '/api/orders/active': () => [], '/api/payments': () => [], '/api/pickup-requests': () => [],
    '/api/accounts?status=pending_approval': () => [], '/api/orders/unpaid': () => [], '/api/delivery-personnel': () => [],
  });
  await settle(); d.screen.render();
  const tab = d.home();
  const quickAction = tab.type(tab.props).props.children.find((child) => child?.props?.children?.some?.((c) => c?.type?.name === 'QuickAction'));
  const QuickAction = quickAction.props.children.find((c) => c?.type?.name === 'QuickAction').type;
  // The card hands its count to the shared CountBadge, which shows "9+" above 9 and
  // nothing at 0 (mobile/test/inventoryLifecycle.test.cjs checks the badge itself).
  const shown = (badge) => JSON.stringify(QuickAction({ icon: 'x', label: 'Payment', badge, badgeLabel: 'n' }));
  assert.ok(shown(3).includes('"count":3'));
  assert.ok(shown(12).includes('"count":12'));
  assert.equal(shown(0), JSON.stringify(QuickAction({ icon: 'x', label: 'Payment', badgeLabel: 'n' })), 'at 0 it renders exactly like a card without a badge');
});

test('the rider list is re-read when the distributor opens Pickup Requests or Orders', async () => {
  let riders = [{ id: 'ana', full_name: 'Ana' }, { id: 'ben', full_name: 'Ben' }];
  const d = distributor({
    '/api/orders/pending': () => [], '/api/orders/active': () => [], '/api/payments': () => [], '/api/pickup-requests': () => [],
    '/api/accounts?status=pending_approval': () => [], '/api/orders/unpaid': () => [], '/api/delivery-personnel': () => riders,
  });
  await settle(); d.screen.render();
  const before = d.reads.filter((p) => p === '/api/delivery-personnel').length;
  riders = [{ id: 'ana', full_name: 'Ana' }]; // Ben turned availability off
  d.home().props.onViewPickups();
  d.screen.render(); await settle(); d.screen.render();
  assert.equal(d.reads.filter((p) => p === '/api/delivery-personnel').length, before + 1);
  const panel = d.screen.findAll((props) => 'onOpenRiderPicker' in props)[0];
  assert.deepEqual(panel.props.personnel.map((r) => r.id), ['ana']);
});

test('Pickup Requests shows "No riders are currently available." and re-reads riders when the picker opens', async () => {
  let reloads = 0;
  const screen = mountScreen('components/distributor/PickupRequestsPanel.js', {
    'react-native': reactNative(),
    '../../api/client': { __esModule: true, default: { put: async () => ({}) } },
    '../../lib/ui': { showAlert() {}, peso: (n) => `PHP ${n}`, shortId: (id) => id },
    '../../lib/errorMessages': { friendlyError: (err) => err.message },
    '../../i18n/useTranslation': translation,
    '../../lib/pickupStatus': { PICKUP_TABS: ['pending', 'active', 'completed', 'declined'], pickupTabOf: (s) => (s === 'requested' ? 'pending' : 'active'), pickupBadge: () => ({ tone: 'pending' }) },
  }, { requests: [{ id: 'p1', status: 'requested', harvests: { vegetable_name: 'Tomato' } }], personnel: [], onChanged: async () => {}, onOpenRiderPicker: () => { reloads++; } });
  const approve = screen.findAll((props) => typeof props.onPress === 'function' && JSON.stringify(props.children || '').includes('dashboards.distributor.approve'))[0];
  approve.props.onPress();
  screen.render();
  assert.equal(reloads, 1, 'riders are re-read as the dialog opens');
  assert.match(screen.text(), /dashboards\.distributor\.noPersonnelAvailable/);
});

test('Rider Home shows Available for Deliveries from the account and saves changes on the server', async () => {
  let saved = false; const puts = []; const alerts = [];
  let failNext = false;
  const api = {
    get: async (path) => (path === '/api/delivery/availability' ? { available: saved } : []),
    put: async (path, body) => {
      puts.push([path, body]);
      if (failNext) { failNext = false; throw Object.assign(new Error('Server cannot be reached.'), { status: 0 }); }
      saved = body.available; return { available: saved };
    },
  };
  const mount = () => mountScreen('screens/DeliveryDashboard.js', { ...shared(api, alerts), '../hooks/useRiderLocation': { __esModule: true, default: () => null } },
    { navigation: { addListener: () => () => {}, navigate() {} }, route: { params: {} } });
  const toggle = (screen) => screen.findAll((props) => props.accessibilityLabel === 'dashboards.delivery.availabilityTitle')[0]?.props;

  let screen = mount();
  await settle(); screen.render();
  assert.match(screen.text(), /dashboards\.delivery\.availabilityTitle/);
  assert.match(screen.text(), /dashboards\.delivery\.availabilityOff/);
  assert.equal(toggle(screen).value, false);
  // The card sits between Active Deliveries and Pending Pickups.
  const order = ['plural.activeDeliveries', 'dashboards.delivery.availabilityTitle', 'plural.pendingPickups'].map((key) => screen.text().indexOf(key));
  assert.ok(order[0] >= 0 && order[0] < order[1] && order[1] < order[2], `section order ${order}`);

  await toggle(screen).onValueChange(true); await settle(); screen.render();
  assert.deepEqual(JSON.parse(JSON.stringify(puts)), [['/api/delivery/availability', { available: true }]]);
  assert.equal(toggle(screen).value, true);
  assert.match(screen.text(), /dashboards\.delivery\.availabilityOnHint/);

  // Reopening the app reads the saved status again.
  screen.unmount(); screen = mount(); await settle(); screen.render();
  assert.equal(toggle(screen).value, true);

  // A failed save keeps the status the server has and tells the rider.
  failNext = true;
  await toggle(screen).onValueChange(false); await settle(); screen.render();
  assert.equal(toggle(screen).value, true);
  assert.equal(saved, true);
  assert.equal(alerts.length, 1);
});
