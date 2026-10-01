const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('../../mobile/node_modules/@babel/core');
const root = path.join(__dirname, '../../mobile/src');

function load(file, mocks = {}) {
  const filename = path.join(root, file);
  const source = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    configFile: false, babelrc: false,
    plugins: [require.resolve('../../mobile/node_modules/@babel/plugin-transform-modules-commonjs')],
  }).code;
  const exports = {};
  vm.runInNewContext(source, { exports, console, require: name => {
    if (name in mocks) return mocks[name];
    // Unmocked app modules (e.g. the translator and its JSON dictionaries) load for real.
    if (name.startsWith('.')) {
      const target = path.resolve(path.dirname(filename), name);
      if (target.endsWith('.json')) return JSON.parse(fs.readFileSync(target, 'utf8'));
      return load(path.relative(root, `${target}.js`), mocks);
    }
    throw new Error(`Missing mock: ${name}`);
  } });
  return exports;
}
const newLock = () => load('lib/requestLock.js').createRequestLock();
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

// Execute actual screen handlers with controlled HTTP completion order.
function handler(screen, name, scope) {
  const source = fs.readFileSync(path.join(root, 'screens', `${screen}.js`), 'utf8');
  const ast = babel.parseSync(source, { configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  let found;
  function visit(node) {
    if (!node || typeof node !== 'object' || found) return;
    if (node.type === 'VariableDeclarator' && node.id.name === name) { found = node.init; return; }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit); else if (value?.type) visit(value);
    }
  }
  visit(ast);
  assert.ok(found, name);
  return vm.runInNewContext(`(${source.slice(found.start, found.end)})`, scope);
}
function base() {
  // Screen handlers format errors with friendlyError(), so it must be in scope.
  const { friendlyError } = load('lib/errorMessages.js');
  return { requestLock: newLock(), t: key => key, showAlert() {}, beginRead() {}, shortId: id => id, friendlyError };
}

test('synchronous locks block duplicate requests and permit retry after release', () => {
  const lock = newLock();
  assert.equal(lock.acquire('submit'), true);
  assert.equal(lock.acquire('submit'), false);
  assert.equal(lock.acquire('unrelated'), true);
  lock.release('submit');
  assert.equal(lock.acquire('submit'), true);
});

test('latest read ignores out-of-order completion, isolates lists and invalidates on unmount', () => {
  let cleanup;
  const { default: hook } = load('hooks/useLatestRequest.js', { react: {
    useRef: current => ({ current }), useCallback: fn => fn,
    useEffect: fn => { cleanup = fn(); },
  } });
  const begin = hook();
  const old = begin('orders'), stock = begin('stock'), latest = begin('orders');
  assert.equal(old(), false); assert.equal(latest(), true); assert.equal(stock(), true);
  cleanup(); assert.equal(latest(), false); assert.equal(stock(), false);
});

test('farmer harvest add sends once on rapid taps and releases on failure without clearing form', async () => {
  const pending = deferred(); let writes = 0, resets = 0, busy = false;
  const submit = handler('FarmerDashboard', 'submitAddForm', {
    ...base(), vegetableName: 'Carrot', quantityKg: '8', status: 'available',
    isVegetable: () => true, queueHarvest: () => { writes++; return pending.promise; },
    setSubmitting: v => { busy=v; }, setHarvests() {}, refreshPendingCount: async () => {},
    resetAddForm: () => resets++, setShowAddSheet() {}, trySync: async () => ({}),
  });
  const first = submit(); await submit(); assert.equal(writes, 1); assert.equal(busy, true);
  pending.reject(new Error('storage unavailable')); await first;
  assert.equal(busy, false); assert.equal(resets, 0);
});

test('distributor approval updates the affected order only, refreshes stock and prevents overlapping writes', async () => {
  const pending = deferred(); let writes = 0, stockRefreshes = 0, rows = [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }];
  const approve = handler('DistributorDashboard', 'approveOrder', {
    ...base(), api: { put: () => { writes++; return pending.promise; } },
    personnel: [{}], setBusyOrderId() {}, setOrders: fn => { rows=fn(rows); },
    refreshProducts: { current: () => { stockRefreshes++; } },
  });
  const first = approve(rows[0]); await approve(rows[0]); assert.equal(writes, 1);
  pending.resolve({}); await first;
  assert.equal(rows[0].status, 'approved'); assert.equal(rows[1].status, 'pending');
  assert.equal(stockRefreshes, 1, 'approval draws stock, so the product list reloads');
});

test('every role derives the same order status; closed statuses beat a stale delivery record', () => {
  const { effectiveOrderStatus, isClosedOrderStatus } = load('lib/orderStatus.js');
  const order = (status, deliveryStatus) => ({ status, deliveries: deliveryStatus ? [{ status: deliveryStatus }] : [] });
  assert.equal(effectiveOrderStatus(order('unsuccessful', 'assigned')), 'unsuccessful');
  assert.equal(effectiveOrderStatus(order('cancelled', 'pending')), 'cancelled');
  assert.equal(effectiveOrderStatus(order('approved', 'assigned')), 'assigned', 'open orders show delivery progress');
  assert.equal(effectiveOrderStatus(order('pending')), 'pending');
  assert.deepEqual(['delivered', 'cancelled', 'unsuccessful', 'in_transit'].map(isClosedOrderStatus), [true, true, true, false]);
  // Distributor, rider and retailer screens share this helper instead of their own copies.
  for (const screen of fs.readdirSync(path.join(root, 'screens')).filter(f => f.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'screens', screen), 'utf8'), /function effectiveStatus\(/, screen);
  }
  const statuses = ['en', 'tl'].map(lang => JSON.parse(fs.readFileSync(path.join(root, `i18n/translations/${lang}.json`), 'utf8')).status.unsuccessful);
  assert.deepEqual(statuses, ['Unsuccessful Delivery', 'Hindi Naihatid']);
});

test('retailer checkout sends once and preserves cart on server rejection', async () => {
  const pending = deferred(); let writes = 0, clears = 0, success = false, busy = false;
  const submit = handler('OrderConfirmationScreen', 'confirmOrder', {
    ...base(), confirming: false, success: false, weightValid: true,
    getFinalAddress: () => 'Store', validateSchedule() {}, date: '2026-10-01', time: '10:00',
    cart: [{ vegetable_name: 'Carrot', quantity: 8 }], latitude: 1, longitude: 2, user: { id: 'r' },
    setConfirming: v => { busy=v; }, setSuccess: v => { success=v; },
    clearCheckedOutCart: async () => { clears++; },
    api: { post: () => { writes++; return pending.promise; } },
  });
  const first = submit(); await submit(); assert.equal(writes, 1);
  pending.reject(new Error('insufficient stock')); await first;
  assert.equal(clears, 0); assert.equal(success, false); assert.equal(busy, false);
});

test('rider pickup completion submits proof once, refreshes both lists and blocks a duplicate tap while in flight', async () => {
  const pending = deferred(); let writes = 0, refreshes = 0;
  const loadOrders = async () => refreshes++, loadPickups = async () => refreshes++;
  const submit = handler('DeliveryDashboard', 'confirmPickupCompletion', {
    ...base(), setPickupBusy() {}, setPickups() {}, setPickupProofVisible() {}, setPickupPhoto() {},
    setActivePickup() {}, proofFailureMessage: e => e.message,
    activePickup: { id: 'pickup' }, pickupPhoto: { uri: 'file:///proof.jpg' },
    pickupActionRef: { current: null }, pickupSubmissionRef: { current: null },
    uploadToCloudinary: async () => 'hosted-url', isOnline: async () => true,
    acquirePickupLocation: async () => ({ latitude: 1, longitude: 2, accuracy: 5, captured_at: new Date().toISOString() }),
    // Deduplication is handled by confirmPickupCompletion's own guard; this stub
    // only calls through to complete().
    createProofSubmission: ({ complete }) => ({ submit: async () => complete({}) }),
    api: { post: () => { writes++; return pending.promise; } },
    loadOrders, loadPickups,
    // Mirrors the screen's loadAll: a silent refresh of both lists.
    loadAll: async ({ silent }) => { assert.equal(silent, true); await Promise.all([loadOrders(), loadPickups()]); },
  });
  const first = submit(); await submit(); assert.equal(writes, 1);
  pending.resolve({ message: 'Pickup completed successfully and inventory updated' }); await first;
  assert.equal(refreshes, 2);
});

test('stock price dialog remains open on failure and closes only after confirmation', async () => {
  for (const saved of [false, true]) {
    let closed = false, busy = false;
    const confirm = handler('StocksScreen', 'confirmPrice', {
      ...base(), priceInput: '25', priceBatch: { id: 'batch' },
      setPriceBusy: v => { busy=v; }, submitListing: async () => saved,
      setPriceBatch: () => { closed=true; },
    });
    await confirm(); assert.equal(closed, saved); assert.equal(busy, false);
  }
});

test('message send cannot append to a different conversation after switching contacts', async () => {
  const pending = deferred(); let writes = 0, appended = 0, cleared = 0;
  const activeId = { current: 'first' };
  const send = handler('MessagesScreen', 'send', {
    ...base(), input: 'Hello', active: { id: 'first' }, activeId,
    mounted: { current: true }, threadVersion: { current: 0 }, setSending() {},
    setThread: () => appended++, setInput: () => cleared++,
    api: { post: () => { writes++; return pending.promise; } },
  });
  const first = send(); await send(); activeId.current = 'second';
  pending.resolve({ data: { id: 'message' } }); await first;
  assert.equal(writes, 1); assert.equal(appended, 0); assert.equal(cleared, 0);
});

test('rider pickup card renders its existing completion action and disables repeat taps', () => {
  const source = fs.readFileSync(path.join(root, 'screens/DeliveryDashboard.js'), 'utf8');
  const start = source.indexOf('  const renderPickupCard = ');
  const end = source.indexOf('\n  const modeToggle', start);
  assert.ok(start > 0 && end > start);
  const code = babel.transformSync(`${source.slice(start, end)}\nresult = renderPickupCard;`, {
    configFile: false, babelrc: false,
    plugins: [require.resolve('../../mobile/node_modules/@babel/plugin-transform-react-jsx')],
  }).code;
  let picked, started;
  const scope = {
    ...base(), result: null, React: { createElement: (type, props, ...children) => ({ type, props, children }) },
    View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', ActivityIndicator: 'ActivityIndicator', StatusBadge: 'StatusBadge',
    styles: {}, busyId: 'another', PRIMARY: 'green', formatStatus: s => s, language: 'en',
    localizeVegetableName: n => n, openPickupProof: pickup => { picked = pickup.id; },
    handleStartPickup: id => { started = id; },
    navigation: { navigate: (name, params) => { navigated = { name, params }; } },
  };
  let navigated;
  vm.runInNewContext(code, scope);
  const buttons = node => node?.type === 'TouchableOpacity' ? [node] : (node?.children || []).flat().flatMap(buttons);

  // Still 'assigned': Navigate opens the shared rider navigation, and the status
  // action starts the pickup (marks 'otw').
  const assigned = { id: 'pickup', status: 'assigned', harvests: { vegetable_name: 'Carrot', quantity_kg: 8 } };
  const [navigate, startAction] = buttons(scope.result(assigned, { actionable: true }));
  navigate.props.onPress(); assert.equal(navigated.name, 'PickupNavigation'); assert.equal(navigated.params.pickupId, 'pickup');
  assert.ok(startAction); assert.equal(startAction.props.disabled, true);
  startAction.props.onPress(); assert.equal(started, 'pickup');

  // 'otw': the status action now opens the proof-of-pickup capture flow.
  const [, completeAction] = buttons(scope.result({ ...assigned, status: 'otw' }, { actionable: true }));
  assert.ok(completeAction); assert.equal(completeAction.props.disabled, true);
  completeAction.props.onPress(); assert.equal(picked, 'pickup');
});

test('overlapping offline sync and queue writes neither replay twice nor lose a new harvest', async () => {
  const storage = new Map(); const pending = deferred(); let writes = 0;
  const store = load('offline/harvestStore.js', {
    '@react-native-community/netinfo': { fetch: async () => ({ isConnected: true }) },
    '../api/client': { post: async () => { writes++; if (writes === 1) await pending.promise; } },
    './db': { kvGet: async key => storage.get(key), kvSet: async (key, value) => storage.set(key, value) },
  });
  await store.queueHarvest({ type: 'add', payload: { vegetable_name: 'Carrot' } });
  const first = store.syncPending(), second = store.syncPending();
  const add = store.queueHarvest({ type: 'add', payload: { vegetable_name: 'Potato' } });
  pending.resolve(); await Promise.all([first, second, add]);
  assert.equal(writes, 1); assert.equal((await store.getQueue()).length, 1);
  await store.syncPending(); assert.equal(writes, 2); assert.equal((await store.getQueue()).length, 0);
});
