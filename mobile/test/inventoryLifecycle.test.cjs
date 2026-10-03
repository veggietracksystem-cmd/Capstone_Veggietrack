const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('../node_modules/@babel/core');

const sourceRoot = path.resolve(__dirname, '../src');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree)
  ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const named = (tree, name) => nodes(tree).filter(node => (node.type?.name || node.type) === name);

// Execute the real screens and shared language provider with controlled native widgets and API responses.
function harness() {
  const modules = new Map(), componentSlots = new Map(), effects = [];
  let activeSlots, cursor;
  const data = { '/api/products': [], '/api/products/available': [], '/api/orders': [], '/api/farmers': [] };
  const calls = [], alerts = [], prints = [], storage = new Map();
  // Browser page for the web print path: a report frame prints its own document.
  const webDocument = {
    getElementById: () => null,
    createElement: () => {
      const frame = { style: {}, setAttribute() {}, remove() {} };
      frame.contentWindow = { focus() {}, addEventListener() {}, print: () => prints.push({ frame: frame.srcdoc }) };
      return frame;
    },
    body: { appendChild: frame => frame.onload() },
  };
  const changed =(old, next) => !old || !next || old.length !== next.length || old.some((value, index) => value !== next[index]);
  const react = {
    useState(initial) {
      const slots = activeSlots, index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useEffect(fn, deps) {
      const slots = activeSlots, index = cursor++;
      if (changed(slots[index]?.deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: fn() };
      });
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useRef(initial) { return react.useState(() => ({ current: initial }))[0]; },
    useMemo(fn, deps) {
      const index = cursor++;
      if (changed(activeSlots[index]?.deps, deps)) activeSlots[index] = { deps, value: fn() };
      return activeSlots[index].value;
    },
    createContext() { const context = {}; context.Provider = { context }; return context; },
    useContext(context) { return context.value; },
  };
  const jsx = (type, props) => {
    if (type?.context) type.context.value = props.value;
    return { type, props };
  };
  const native = new Proxy({ StyleSheet: { create: value => value, absoluteFill: {} }, Platform: { OS: 'web' }, Animated: { View: 'AnimatedView' }, BackHandler: { addEventListener: () => ({ remove() {} }) }, useWindowDimensions: () => ({ width: 400, height: 800 }) }, {
    get: (target, name) => target[name] || name,
  });
  const api = {
    get: async route => data[route] || [],
    post: async (route, body) => { calls.push({ route, body }); return { product: { id: 'new-batch', ...body, status: 'listed' } }; },
    put: async (route, body) => { calls.push({ route, body }); return {}; },
  };
  const exact = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@expo/vector-icons': { Ionicons: 'Ionicons', MaterialCommunityIcons: 'MaterialCommunityIcons' },
    // expo-print on web ignores `html` and prints the app screen; any call here is recorded as such.
    'expo-print': {
      printAsync: async options => prints.push({ expoPrint: options }),
      printToFileAsync: async options => { prints.push({ expoFile: options }); return { uri: 'file:///report.pdf' }; },
      Orientation: { landscape: 'landscape' },
    },
    'expo-sharing': { isAvailableAsync: async () => false },
    '@react-native-async-storage/async-storage': { getItem: async key => storage.get(key) || null, setItem: async (key, value) => storage.set(key, value) },
  };
  const real = /^(hooks\/useStockAlerts|screens\/(StocksScreen|DistributorDashboard|RetailerDashboard|DistributorInventoryReportScreen|ApplicationStatusScreen|ChainReportScreen|SpoiledProductsScreen|FarmerDashboard)|components\/(AuthForm|CustomModal|distributor\/)|i18n\/|lib\/(vegetableNames|vegetables|cartStore|orderStatus|reportPdf|pickupForm|pickupStatus|reportPeriods)|theme\/appTheme)/;
  function load(relative) {
    const file = relative.endsWith('.js') || relative.endsWith('.json') ? relative : `${relative}.js`;
    if (modules.has(file)) return modules.get(file);
    if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(path.join(sourceRoot, file), 'utf8'));
    const exported = {};
    modules.set(file, exported);
    const code = babel.transformSync(fs.readFileSync(path.join(sourceRoot, file), 'utf8'), {
      configFile: false, babelrc: false,
      plugins: [[require.resolve('../node_modules/@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], require.resolve('../node_modules/@babel/plugin-transform-modules-commonjs')],
    }).code;
    vm.runInNewContext(code, {
      exports: exported, console, Date, setTimeout, clearTimeout, document: webDocument,
      require(name) {
        if (exact[name]) return exact[name];
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), name));
        if (target === 'api/client') return api;
        if (target === 'lib/responsive') return { rf: value => value };
        if (target === 'lib/ui') return { showAlert: (...args) => alerts.push(args), confirmAction() {}, peso: value => `₱${Number(value).toFixed(2)}`, shortId: value => value?.slice(0, 8) };
        if (target === 'lib/vegetableIcons') return { getVegetableTile: () => ({ source: 'vegetable.png', bg: '#fff' }), getVegetableIcon: () => 'vegetable.png' };
        if (target === 'lib/motion') return { SharedScreenTransition: 'SharedScreenTransition', useSharedModalMotion: () => ({}) };
        if (target === 'context/AuthContext') return { useAuth: () => ({ user: { id: 'retailer', account_status: 'pending_approval' }, signOut: args => calls.push({ signOut: args }), refreshProfile() {} }) };
        if (target === 'offline/cache') return { readThrough: async (_, read) => ({ list: await read(), source: 'network' }) };
        if (target === 'sync/SyncProvider') return { useAutoSync: () => ({ syncState: 'online' }) };
        if (target === 'hooks/useLatestRequest') return () => () => () => true;
        if (target === 'hooks/useRequestLock') return () => ({ acquire: () => true, release() {} });
        if (target === 'hooks/useRefreshOnFocus') return () => {};
        if (target === 'offline/db') return { kvGet: async key => storage.get(key) ?? null, kvSet: async (key, value) => { storage.set(key, value); } };
        if (target === 'offline/harvestStore') return { fetchHarvests: async () => ({ list: data['/api/harvests'] || [] }), queueHarvest: async () => data['/api/harvests'] || [], syncPending: async () => ({ synced: 0, remaining: 0 }), getQueue: async () => [] };
        if (target === 'screens/FarmerProfileTab') return 'FarmerProfileTab';
        if (real.test(target)) return load(target);
        if (target === 'components/BottomNavBar') return { __esModule: true, default: 'BottomNavBar', useBottomNavSpace: () => 80, useBottomNavHeight: () => 64 };
        if (target === 'components/ui/SegmentedTabs') return { SegmentedTabs: 'SegmentedTabs', FilterChips: 'FilterChips' };
        if (target.startsWith('components/')) return path.posix.basename(target);
        if (target === 'lib/textFormat') return { titleCaseWords: value => value };
        if (target === 'lib/errorMessages') return { friendlyError: error => error.message };
        throw new Error(`Unexpected dependency ${target}`);
      },
    }, { filename: file });
    return exported;
  }
  function render(component, props = {}) {
    if (!componentSlots.has(component)) componentSlots.set(component, []);
    activeSlots = componentSlots.get(component); cursor = 0;
    const tree = component(props);
    effects.splice(0).forEach(run => run());
    return tree;
  }
  const provider = load('i18n/LanguageProvider');
  render(provider.LanguageProvider);
  function language(next) {
    provider.useLanguageContext().setLanguage(next);
    render(provider.LanguageProvider);
  }
  return { load, render, data, calls, alerts, prints, storage, language, translation: () => provider.useLanguageContext() };
}

// One Vegetable Chain Tracking batch as returned by GET /api/distributor/chain-tracking.
const chainBatch = (batch_id, vegetable_name, status, extra = {}) => ({
  batch_id, vegetable_name, status, farmer_name: null, harvest_date: '2026-09-20T04:00:00Z', in_stock_since: '2026-09-21T04:00:00Z',
  price_per_kg: 50, days_in_stock: null, batch_photo_url: null, pickup: null, sales: [], spoilage: [],
  totals: { received: 10, remaining: 10, sold: 0, on_order: 0, not_delivered: 0, spoiled: 0, adjusted: 0 }, ...extra,
});

test('Vegetable Chain Tracking English → Tagalog → English updates labels and values while preserving complete metadata', async () => {
  const h = harness(); await flush();
  const { formatBatch } = h.load('screens/DistributorInventoryReportScreen');
  const batch = chainBatch('a12bc345-6789-0123-4567-89abcdef0123', 'Karot', 'sold_out', {
    farmer_name: 'Juan Kamatis', totals: { received: 12, remaining: 0, sold: 12, on_order: 0, not_delivered: 0, spoiled: 0, adjusted: 0 },
    pickup: { farmer_price_per_kg: 30, picked_up_at: '2026-09-21T04:00:00Z' },
    sales: [{ stage: 'sold', retailer_name: 'Store One', quantity_kg: 12 }],
  });
  const output = [];
  for (const language of ['en', 'tl', 'en']) {
    h.language(language);
    const { t } = h.translation();
    const formatted = formatBatch(batch, language, t);
    output.push(formatted);
    assert.equal(formatted.batch_id, batch.batch_id);
    assert.equal(formatted.farmer_name, batch.farmer_name);
    assert.equal(formatted.remaining, '0 kg');
    assert.equal(formatted.retailers, 'Store One');
    assert.equal(t('chain.title'), 'Vegetable Chain Tracking');
    assert.equal(t('dashboards.distributor.tabInventory'), 'Chain Tracking');
    assert.equal(formatted.product, language === 'tl' ? 'Karot' : 'Carrot');
    assert.equal(formatted.status, language === 'tl' ? 'Ubos na' : 'Sold out');
    assert.equal(t('spoilage.reason.discarded'), language === 'tl' ? 'Itinapon ng Distributor' : 'Discarded by Distributor');
  }
  assert.equal(output[0].harvest_date, output[1].harvest_date);
  assert.equal(output[0].picked_up, output[1].picked_up);
  assert.deepEqual(output[0], output[2]);
});

const texts = tree => nodes(tree).filter(node => node.type === 'Text').map(node => [].concat(node.props.children).join(''));

test('Vegetable Chain Tracking lists batches in a compact table by status; View Details holds the full trace from farmer to retailer or spoilage', async () => {
  const h = harness();
  const tomato = '42410128-aaaa-4bbb-8ccc-000000000001';
  h.data['/api/distributor/chain-tracking'] = { batches: [
    chainBatch(tomato, 'Tomato', 'listed', {
      farmer_name: 'Juan Dela Cruz', price_per_kg: 100, days_in_stock: 3, batch_photo_url: 'https://example.test/tomato.jpg',
      totals: { received: 50, remaining: 32, sold: 10, on_order: 6, not_delivered: 0, spoiled: 2, adjusted: 0 },
      pickup: { quantity_kg: 50, farmer_price_per_kg: 35, estimated_total: 1750, requested_at: '2026-09-19T04:00:00Z',
        picked_up_at: '2026-09-21T04:00:00Z', rider_name: 'Rider Pick', proof_photo_url: 'https://example.test/pickup.jpg' },
      sales: [
        { order_id: 'o1', stage: 'sold', retailer_name: 'Store One', quantity_kg: 10, total_amount: 1000, order_status: 'delivered', payment_status: 'paid', delivered_at: '2026-09-23T04:00:00Z', proof_photo_url: 'https://example.test/pod.jpg' },
        { order_id: 'o2', stage: 'on_order', retailer_name: 'Store Two', quantity_kg: 6, total_amount: 600, order_status: 'approved', payment_status: 'unpaid' },
      ],
      spoilage: [{ id: 's1', quantity_kg: 2, reason: 'discarded', recorded_at: '2026-09-24T04:00:00Z' }],
    }),
    chainBatch('b', 'Carrot', 'sold_out', { totals: { received: 10, remaining: 0, sold: 10, on_order: 0, not_delivered: 0, spoiled: 0, adjusted: 0 } }),
    chainBatch('c', 'Okra', 'archived', { totals: { received: 10, remaining: 0, sold: 10, on_order: 0, not_delivered: 0, spoiled: 0, adjusted: 0 } }),
    chainBatch('d', 'Squash', 'received'),
    chainBatch('e', 'Pechay', 'rejected'),
    chainBatch('f', 'Cabbage', 'spoiled', { totals: { received: 8, remaining: 0, sold: 0, on_order: 0, not_delivered: 0, spoiled: 8, adjusted: 0 },
      spoilage: [{ id: 's2', quantity_kg: 8, reason: 'past_limit', recorded_at: '2026-09-29T16:05:00Z' }] }),
  ] };
  const navigated = [];
  const screen = h.load('screens/DistributorInventoryReportScreen').default;
  const render = () => h.render(screen, { navigation: { navigate: (name, params) => navigated.push([name, params]) } });
  render(); await flush();
  assert.equal(named(render(), 'ScreenHeader')[0].props.title, 'Vegetable Chain Tracking');
  const list = () => named(render(), 'FlatList')[0];
  const headerOf = () => list().props.ListHeaderComponent;
  assert.ok(list().props.refreshControl);
  const [reports, spoiled] = named(headerOf(), 'TouchableOpacity');
  reports.props.onPress(); spoiled.props.onPress();
  assert.deepEqual(navigated.map(n => n[0]), ['ChainReport', 'SpoiledProducts']);
  assert.ok(texts(headerOf()).includes('View Reports') && texts(headerOf()).includes('Spoiled Products'));
  const tabs = () => named(headerOf(), 'SegmentedTabs')[0];
  assert.deepEqual([...tabs().props.options.map(o => o.label)], ['Active', 'Sold out', 'Spoiled']);
  assert.deepEqual(texts(headerOf()).slice(-5), ['Vegetable / Batch', 'Received (kg)', 'Sold (kg)', 'Left (kg)', 'Status'], 'compact table columns on a phone');
  assert.deepEqual([...list().props.data.map(b => b.batch_id)], [tomato, 'd'], 'one row per batch, even with two orders');

  const row = list().props.renderItem({ item: list().props.data[0], index: 0 });
  const rowText = texts(row);
  for (const text of ['Tomato', '42410128...', 'Juan Dela Cruz', '50', '10', '32', 'View Details']) assert.ok(rowText.includes(text), text);
  assert.ok(!rowText.some(text => text.includes(tomato)), 'the full batch id stays out of the table');
  assert.ok(!rowText.includes('Store One'), 'order details stay out of the table');
  assert.equal(named(row, 'StatusBadge')[0].props.label, 'Active');

  row.props.onPress();
  const modal = named(render(), 'CustomModal')[0];
  assert.equal(modal.props.visible, true); assert.equal(modal.props.title, 'Tomato');
  const detail = {};
  for (const n of named(modal, 'DetailRow')) if (n.props.value !== undefined && !(n.props.label in detail)) detail[n.props.label] = n.props.value;
  assert.deepEqual([detail['Batch ID'], detail.Farmer, detail.Received, detail.Sold, detail['With orders on the way'], detail.Spoiled, detail.Remaining,
    detail["Farmer's Price"], detail['Estimated total'], detail['Pickup Rider'], detail['Days in stock']],
  [tomato, 'Juan Dela Cruz', '50 kg', '10 kg', '6 kg', '2 kg', '32 kg', '₱35.00 / kg', '₱1750.00', 'Rider Pick', '3 of 7 days']);
  assert.deepEqual(named(modal, 'RemoteImage').map(n => n.props.uri), ['https://example.test/tomato.jpg', 'https://example.test/pickup.jpg', 'https://example.test/pod.jpg']);
  assert.ok(texts(modal).includes('Sales to retailers (2)'));
  assert.deepEqual(named(modal, 'DetailRow').filter(n => n.props.label === 'Retailer').map(n => n.props.value), ['Store One', 'Store Two']);
  assert.deepEqual(named(modal, 'StatusBadge').map(n => n.props.label), ['Active', 'Paid', 'Delivered', 'Unpaid', 'Approved', 'Discarded by Distributor']);

  tabs().props.onChange('sold_out');
  assert.deepEqual([...list().props.data.map(b => b.batch_id)], ['b', 'c', 'e'], 'past batches stay available');
  const okra = list().props.renderItem({ item: list().props.data[1], index: 1 });
  assert.equal(named(okra, 'StatusBadge')[0].props.label, 'Sold out', 'a removed sold-out batch reads as Sold out, never Archived');
  tabs().props.onChange('spoiled');
  assert.deepEqual([...list().props.data.map(b => b.batch_id)], ['f']);
  list().props.renderItem({ item: list().props.data[0], index: 0 }).props.onPress();
  const cabbage = named(render(), 'CustomModal')[0];
  assert.ok(texts(cabbage).includes('Not sold to any retailer yet.'), 'no retailer is shown for a batch that was never sold');
  assert.deepEqual(named(cabbage, 'StatusBadge').map(n => n.props.label), ['Spoiled', 'Past Spoilage Limit']);
});

test('Stocks excludes sold-out, archived, rejected and inactive stock; Add Product takes an optional typed farmer name and both dates', async () => {
  const h = harness();
  h.data['/api/products'] = ['received', 'listed', 'sold_out', 'archived', 'rejected', 'inactive', 'unexpected'].map(status => ({ id: status, status, stock_kg: status === 'sold_out' ? 0 : 12 }));
  const screen = h.load('screens/StocksScreen').default;
  const render = () => h.render(screen, { navigation: {} });
  render(); await flush();
  let tree = render();
  assert.equal(named(tree, 'FlatList')[0].props.data.map(batch => batch.status).join(','), 'received');
  named(tree, 'SegmentedTabs')[0].props.onChange('products');
  tree = render();
  assert.equal(named(tree, 'FlatList')[0].props.data.map(batch => batch.status).join(','), 'listed');
  const addModal = () => named(render(), 'CustomModal').find(node => node.props.title === h.translation().t('stocks.addProductModalTitle'));
  const fillAndSave = async (farmer) => {
    named(render(), 'ScreenHeader')[0].props.right.props.onPress(); await flush();
    const inputs = named(addModal(), 'AppTextInput');
    assert.equal(inputs.length, 4, 'name, price, stock and farmer inputs only');
    assert.equal(inputs[3].props.placeholder, 'Enter farmer name (optional)');
    assert.equal(named(addModal(), 'TouchableOpacity').length, 0, 'no farmer dropdown or search');
    inputs[0].props.onChangeText('Carrot'); inputs[1].props.onChangeText('45'); inputs[2].props.onChangeText('12');
    if (farmer != null) inputs[3].props.onChangeText(farmer);
    const modal = addModal();
    named(modal, 'BatchDateField')[0].props.onChange('2026-09-20');
    named(modal, 'BatchDateField')[1].props.onChange('2026-09-21');
    named(modal, 'BatchPhotoField')[0].props.onChange('https://example.test/carrot.jpg');
    await addModal().props.onConfirm();
    return JSON.parse(JSON.stringify(h.calls.at(-1).body));
  };
  const base = { vegetable_name: 'Carrot', price_per_kg: 45, stock_kg: 12, batch_photo_url: 'https://example.test/carrot.jpg', harvest_date: '2026-09-20', pickup_date: '2026-09-21' };
  assert.deepEqual(await fillAndSave(null), { ...base, farmer_name: null }, 'a blank farmer still saves');
  assert.deepEqual(h.alerts.at(-1)[1], h.translation().t('stocks.addProductSuccess'));
  assert.deepEqual(await fillAndSave('  Juan Dela Cruz '), { ...base, farmer_name: 'Juan Dela Cruz' });
  assert.equal(h.calls.length, 2);
});

test('Retailer cart caps fractional stock and open product details follow refreshed availability and photos', async () => {
  const h = harness();
  const product = { vegetable_name: 'Tomato', available_kg: 1.5, price_per_kg: 50, batch_photos: ['photo-a', 'photo-b'] };
  h.data['/api/products/available'] = [product];
  const screen = h.load('screens/RetailerDashboard').default;
  const render = () => h.render(screen, { navigation: {}, route: { params: {} } });
  render(); await flush();
  let tree = render();
  named(tree, 'HomeTab')[0].props.onAdd(product);
  named(render(), 'HomeTab')[0].props.onAdd(product);
  assert.equal(named(render(), 'HomeTab')[0].props.cart[0].quantity, 1.5);
  named(render(), 'HomeTab')[0].props.onSelect(product);
  tree = render();
  assert.equal(named(tree, 'ProductPhotos')[0].props.product.batch_photos.length, 2);
  h.data['/api/products/available'] = [{ ...product, available_kg: 0, batch_photos: [] }];
  await named(tree, 'ScrollView')[0].props.refreshControl.props.onRefresh();
  tree = render(); await flush(); tree = render();
  assert.equal(named(tree, 'CustomModal')[0].props.confirmDisabled, true);
  assert.equal(named(tree, 'ProductPhotos')[0].props.product.batch_photos.length, 0);
  assert.equal(named(tree, 'HomeTab')[0].props.cart.length, 0);
  h.data['/api/products/available'] = [{ ...product, available_kg: 0.5, batch_photos: ['photo-c'] }];
  await named(tree, 'ScrollView')[0].props.refreshControl.props.onRefresh();
  tree = render();
  assert.equal(named(tree, 'CustomModal')[0].props.confirmDisabled, false);
  named(tree, 'HomeTab')[0].props.onAdd(h.data['/api/products/available'][0]);
  assert.equal(named(render(), 'HomeTab')[0].props.cart[0].quantity, 0.5);
});

test('Saved English/Tagalog cart aliases reconcile to one current listing and remove unavailable items', () => {
  const h = harness();
  const { reconcileCart } = h.load('lib/cartStore');
  const cart = reconcileCart([{ vegetable_name: 'Kamatis', quantity: 2 }, { vegetable_name: 'tomatoes', quantity: 3 }, { vegetable_name: 'Carrot', quantity: 1 }], [{ vegetable_name: 'Tomato', available_kg: 4, price_per_kg: 50 }, { vegetable_name: 'Carrot', available_kg: 0, price_per_kg: 40 }]);
  assert.equal(cart.length, 1);
  assert.equal(cart[0].vegetable_name, 'Tomato');
  assert.equal(cart[0].quantity, 4);
  assert.equal(cart[0].stock, 4);
});

test('Pending Approval logout uses shared red button metrics and calls signOut', () => {
  const h = harness();
  const { dangerButton, dangerButtonText, colors } = h.load('theme/appTheme');
  const screen = h.load('screens/ApplicationStatusScreen').default;
  const logout = named(h.render(screen), 'AuthButton').find(node => node.props.variant === 'danger');
  const rendered = h.render(logout.type, logout.props);
  const style = Object.assign({}, ...rendered.props.style.filter(Boolean));
  for (const [key, value] of Object.entries(dangerButton)) assert.equal(style[key], value);
  assert.equal(style.backgroundColor, colors.danger);
  const label = Object.assign({}, ...rendered.props.children.props.style.filter(Boolean));
  assert.equal(label.fontFamily, dangerButtonText.fontFamily);
  assert.equal(label.color, '#fff');
  const modal = h.load('components/CustomModal').default;
  const confirmation = h.render(modal, { visible: true, danger: true, confirmLabel: 'Logout', onConfirm() {} });
  const confirmButton = named(confirmation, 'TouchableOpacity').find(node => node.props.children?.props?.children === 'Logout');
  const confirmStyle = Object.assign({}, ...confirmButton.props.style.filter(Boolean));
  for (const key of ['backgroundColor', 'minHeight', 'paddingHorizontal', 'paddingVertical', 'borderRadius']) assert.equal(style[key], confirmStyle[key]);
  rendered.props.onPress();
  assert.equal(h.calls[0].signOut.redirectToLogin, true);
});

test('on web, Export PDF and Print send only the report table to the print dialog, never the app screen; one complete row per batch, headers repeated on every page', async () => {
  const h = harness();
  const id = n => `42410128-aaaa-4bbb-8ccc-${String(n).padStart(12, '0')}`;
  const batches = [];
  for (let n = 0; n < 60; n++) {
    batches.push(chainBatch(id(n), 'Tomato', 'listed', { farmer_name: n % 2 ? 'Juan Dela Cruz' : null, price_per_kg: 100,
      totals: { received: 50, remaining: 40, sold: 10, on_order: 0, not_delivered: 0, spoiled: 0, adjusted: 0 },
      pickup: { farmer_price_per_kg: 35, picked_up_at: '2026-09-21T04:00:00Z' },
      sales: [{ stage: 'sold', retailer_name: 'Store One' }, { stage: 'sold', retailer_name: 'Store Two' }], batch_photo_url: 'https://example.test/tomato.jpg' }));
  }
  batches.push(chainBatch(id(99), 'Carrot', 'archived', { price_per_kg: 40, totals: { received: 12, remaining: 0, sold: 12, on_order: 0, not_delivered: 0, spoiled: 0, adjusted: 0 } }));
  h.data['/api/distributor/chain-tracking'] = { batches };
  const screen = h.load('screens/DistributorInventoryReportScreen').default;
  const render = () => h.render(screen, { navigation: {} });
  render(); await flush();
  const buttons = () => named(named(render(), 'FlatList')[0].props.ListFooterComponent, 'TouchableOpacity');
  await buttons()[0].props.onPress(); // Export PDF
  await buttons()[1].props.onPress(); // Print
  assert.equal(h.prints.length, 2);
  assert.ok(h.prints.every(p => p.frame), 'both buttons print the report frame; expo-print (which prints the screen on web) is never called');
  const table = html => {
    const cells = row => [...row.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(c => c[1]);
    const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
    return { headers: [...html.matchAll(/<th>([^<]*)<\/th>/g)].map(m => m[1]), rows: [...body.matchAll(/<tr>(.*?)<\/tr>/gs)].map(m => cells(m[1])) };
  };
  for (const { frame: html } of h.prints) {
    assert.match(html, /VeggieTrack — Active Batches/);
    assert.doesNotMatch(html, /View Details|Export PDF/, 'no table rows from the screen or buttons');
    assert.match(html, /@page \{ size: A4 landscape/);
    assert.match(html, /thead \{ display: table-header-group; \}/, 'the header row repeats on each page');
    assert.match(html, /tr \{ page-break-inside: avoid/);
    assert.match(html, /overflow-wrap: anywhere/, 'long values wrap instead of being cut off');
    assert.doesNotMatch(html, /<img|\.jpg|\.png/i, 'text only, no photos or vegetable icons');
    const { headers, rows: lines } = table(html);
    assert.deepEqual(headers, ['Vegetable', 'Batch ID', 'Status', 'Farmer', 'Harvest Date', 'Pickup Date', 'Received', 'Sold', 'Spoiled', 'Remaining',
      "Farmer's Price", 'Selling Price', 'Retailers']);
    assert.equal(lines.length, 60, 'every active batch once, no sold-out rows');
    assert.deepEqual(lines[0].slice(0, 4).concat(lines[0].slice(6)), ['Tomato', id(0), 'Active', '—', '50 kg', '10 kg', '0 kg', '40 kg', '₱35.00', '₱100.00', 'Store One, Store Two'],
      'full batch id and batch details on every row');
    assert.equal(lines[1][3], 'Juan Dela Cruz');
  }

  named(named(render(), 'FlatList')[0].props.ListHeaderComponent, 'SegmentedTabs')[0].props.onChange('sold_out');
  await buttons()[0].props.onPress();
  const soldOut = h.prints.at(-1).frame;
  assert.match(soldOut, /VeggieTrack — Sold Out Batches/);
  assert.deepEqual(table(soldOut).rows.map(line => [line[0], line[2], line[9]]), [['Carrot', 'Sold out', '0 kg']]);
});

test('native PDF export uses an A4 landscape page for the inventory table; other reports keep their page', async () => {
  const pages = [];
  const code = babel.transformSync(fs.readFileSync(path.join(sourceRoot, 'lib/reportPdf.js'), 'utf8'), {
    configFile: false, babelrc: false, plugins: [require.resolve('../node_modules/@babel/plugin-transform-modules-commonjs')],
  }).code;
  const report = {};
  vm.runInNewContext(code, { exports: report, Date, require: name => ({
    'react-native': { Platform: { OS: 'android' } },
    'expo-print': { printToFileAsync: async options => { pages.push(options); return { uri: 'file:///r.pdf' }; }, printAsync: async options => pages.push(options), Orientation: { landscape: 'landscape' } },
    'expo-sharing': { isAvailableAsync: async () => false },
    '../i18n/translate': { tr: key => key },
  })[name] });
  const columns = [{ key: 'a', label: 'A' }];
  await report.exportReportPdf('Active Inventory', columns, [{ a: 1 }], undefined, { landscape: true });
  await report.printReport('Active Inventory', columns, [{ a: 1 }], undefined, { landscape: true });
  await report.exportReportPdf('Harvest report', columns, [{ a: 1 }]);
  assert.deepEqual([pages[0].width, pages[0].height], [842, 595]);
  assert.equal(pages[1].orientation, 'landscape');
  assert.ok(pages.every(page => /<table>/.test(page.html)), 'native print and PDF receive the report html');
  assert.equal(pages[2].width, undefined, 'the farmer harvest report keeps its page');
  assert.doesNotMatch(pages[2].html, /A4 landscape/);
});


// ---- New pickup, stock alert, report and spoilage screens: open each one with data
// and press its buttons, so a broken screen fails here instead of on a phone.
// Values built inside the screens come from another realm, so compare them as JSON.
const same = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);
const button = (tree, label) => named(tree, 'TouchableOpacity').find(node => texts(node).includes(label));

test('Farmer pickup request: quantity starts at the available kg, wrong values are blocked, quantity and price are sent', async () => {
  const h = harness();
  h.data['/api/harvests'] = [{ id: 'h1', vegetable_name: 'Pechay', quantity_kg: 50, requested_kg: 20, available_kg: 30, status: 'available', recorded_at: '2026-09-28T04:00:00Z' }];
  const screen = h.load('screens/FarmerDashboard').default;
  const render = () => h.render(screen, { navigation: { navigate() {} }, route: { params: {} } });
  render(); await flush(); render(); await flush();
  named(render(), 'BottomNavBar')[0].props.onTabPress({ id: 'pickup' });
  let tree = render();
  assert.ok(texts(tree).includes('30 kg available · Harvested Sep 28, 2026') || texts(tree).some(t => t.startsWith('30 kg available')), 'the pickup list shows the kg still free to request');
  button(tree, 'Select').props.onPress();
  tree = render();
  const sheet = () => named(render(), 'BottomSheet').find(n => n.props.title === h.translation().t('dashboards.farmer.pickupRequestSheetTitle'));
  const [quantity, price] = named(sheet(), 'AppTextInput');
  assert.equal(quantity.props.value, '30'); assert.equal(price.props.value, '');
  quantity.props.onChangeText('31');
  const submit = () => named(sheet(), 'TouchableOpacity').find(n => texts(n).includes('Request Pickup') || n.props.onPress?.name === 'submitPickupRequest');
  await (named(sheet(), 'TouchableOpacity').at(-1).props.onPress());
  assert.equal(h.alerts.at(-1)[1], 'Please check the quantity and price of each vegetable.');
  assert.ok(texts(sheet()).includes('You can request up to 30 kg from this harvest.'));
  assert.ok(texts(sheet()).some(t => t.startsWith('Enter a price per kg')));
  assert.equal(h.calls.filter(c => c.route === '/api/pickup-requests').length, 0, 'nothing is sent while a value is wrong');
  named(sheet(), 'AppTextInput')[0].props.onChangeText('20');
  named(sheet(), 'AppTextInput')[1].props.onChangeText('35');
  assert.ok(texts(sheet()).includes('20 kg × ₱35.00 = ₱700.00'));
  await (named(sheet(), 'TouchableOpacity').at(-1).props.onPress());
  same(h.calls.find(c => c.route === '/api/pickup-requests').body, { harvest_id: 'h1', quantity_kg: 20, price_per_kg: 35 });
  assert.equal(typeof submit, 'function');
});

test('Pickup Requests: price and quantity before approval, then approve, assign, decline, and completed history', async () => {
  const h = harness(); await flush();
  const panel = h.load('components/distributor/PickupRequestsPanel').default;
  const req = (n, status, extra = {}) => ({ id: `pickup-${n}`, status, farmer_name: 'Ana', harvests: { vegetable_name: 'Tomato' }, quantity_kg: 60,
    price_per_kg: 35, estimated_total: 2100, harvest_date: '2026-09-20T04:00:00Z', requested_at: '2026-09-21T04:00:00Z', ...extra });
  let changed = 0;
  const props = { loading: false, personnel: [{ id: 'rider', full_name: 'Rider R' }], onChanged: async () => { changed += 1; }, onViewProof() {},
    requests: [req(1, 'requested'), req(2, 'approved'), req(3, 'assigned', { rider_name: 'Rider R' }), req(4, 'otw', { rider_name: 'Rider R' }),
      req(5, 'picked_up', { batch_id: 'batch-5', rider_name: 'Rider R', proof_photo_url: 'https://example.test/p.jpg', received_at: '2026-09-22T04:00:00Z' }),
      req(6, 'declined', { decline_reason: 'Too far' })] };
  const render = () => h.render(panel, props);
  let tree = render();
  const tabs = () => named(render(), 'SegmentedTabs')[0];
  same(tabs().props.options.map(o => [o.label, o.count]), [['Pending', 1], ['Active', 0], ['Completed', 0], ['Declined', 0]]);
  for (const text of ['Ana', 'Tomato · 60 kg', '₱35.00 / kg', 'Total ₱2100.00']) assert.ok(texts(tree).includes(text), text);
  same(named(tree, 'PickupBadge').map(n => n.props.status), ['requested']);

  button(tree, 'Approve').props.onPress();
  const modal = title => named(render(), 'CustomModal').find(m => m.props.title === title);
  let approve = modal('Approve Pickup Request');
  assert.equal(approve.props.visible, true);
  same(named(approve, 'DetailRow').map(n => n.props.value), ['Ana', 'Tomato', '60 kg', '₱35.00 / kg', '₱2100.00']);
  assert.equal(approve.props.confirmLabel, 'Approve');
  await approve.props.onConfirm();
  assert.equal(h.calls.at(-1).route, '/api/pickup-requests/pickup-1/approve');

  tabs().props.onChange('pending');
  button(render(), 'Decline').props.onPress();
  let decline = modal('Decline Pickup Request');
  assert.equal(decline.props.danger, true); assert.equal(decline.props.confirmDisabled, true, 'a reason is required');
  named(decline, 'AppTextInput')[0].props.onChangeText('Price too high');
  decline = modal('Decline Pickup Request');
  await decline.props.onConfirm();
  same(h.calls.at(-1), { route: '/api/pickup-requests/pickup-1/decline', body: { reason: 'Price too high' } });

  tabs().props.onChange('active');
  tree = render();
  same(named(tree, 'PickupBadge').map(n => n.props.status), ['approved', 'assigned', 'otw']);
  button(tree, 'Assign Rider').props.onPress();
  let assign = modal('Assign a Rider');
  assert.equal(assign.props.confirmDisabled, true, 'a rider is required');
  button(assign, 'Rider R').props.onPress();
  assign = modal('Assign a Rider');
  await assign.props.onConfirm();
  same(h.calls.at(-1), { route: '/api/pickup-requests/pickup-2/assign', body: { delivery_personnel_id: 'rider' } });

  tabs().props.onChange('completed');
  tree = render();
  same(named(tree, 'PickupBadge').map(n => n.props.status), ['picked_up']);
  button(tree, 'View Details').props.onPress();
  const detail = named(render(), 'CustomModal').find(m => m.props.visible && m.props.title.startsWith('Pickup #'));
  const values = Object.fromEntries(named(detail, 'DetailRow').map(n => [n.props.label, n.props.value]));
  same([values['Batch ID'], values['Requested quantity'], values["Farmer's price"], values.Rider], ['batch-5', '60 kg', '₱35.00 / kg', 'Rider R']);
  assert.equal(named(detail, 'RemoteImage')[0].props.uri, 'https://example.test/p.jpg');
  tabs().props.onChange('declined');
  assert.ok(texts(render()).includes('Reason: Too far'));
  assert.ok(changed >= 3, 'the list reloads after each action');
});

const alertBatch = (id, vegetable_name, status, days_in_stock, stock_kg = 12) => ({ id, vegetable_name, status, days_in_stock, stock_kg, batch_photo_url: 'https://example.test/b.jpg' });
const stockAlert = (batch_id, vegetable_name, remaining_kg) => ({ batch_id, vegetable_name, remaining_kg, harvest_date: null, days_in_stock: 7 });

test('Home Stock Alert shortcut: badge only with alerts, real count that follows stock changes, opens Stocks filtered', async () => {
  const h = harness();
  h.data['/api/distributor/stock-alerts'] = [];
  const navigated = [];
  const navigation = { navigate: (...args) => navigated.push(args), addListener: () => () => {} };
  const dashboard = h.load('screens/DistributorDashboard').default;
  const home = () => {
    const node = named(h.render(dashboard, { navigation, route: { params: {} } }), 'HomeTab')[0];
    return { node, tree: h.render(node.type, node.props) };
  };
  home(); await flush();
  const shortcuts = () => named(home().tree, 'QuickAction');
  const stockShortcut = () => shortcuts().find(node => node.props.label === 'Stock Alert');
  const rendered = () => h.render(stockShortcut().type, stockShortcut().props);
  const badgeText = () => texts(rendered()).filter(text => /^(\d+|9\+)$/.test(text));
  assert.equal(shortcuts().map(node => node.props.label).join(' | '), 'Pickup Requests | Stock Alert | Account Management | Payment');
  assert.ok(!texts(home().tree).some(text => text.startsWith('Stock alert') || text.includes('7-day limit')), 'no separate alert section on Home');
  same(badgeText(), [], 'no alert → no badge');

  const refresh = async () => { await home().node.props.onStockChanged(); await flush(); };
  h.data['/api/distributor/stock-alerts'] = [stockAlert('b1', 'Tomato', 18)];
  await refresh();
  same(badgeText(), ['1']);
  assert.equal(rendered().props.accessibilityLabel, 'Stock Alert, 1 batch needs attention');

  h.data['/api/distributor/stock-alerts'] = [stockAlert('b1', 'Tomato', 18), stockAlert('b2', 'Squash', 5), stockAlert('b3', 'Okra', 2)];
  await refresh();
  same(badgeText(), ['3']);
  h.storage.set('stock_alerts_keep_selling', ['b3']);
  await refresh();
  same(badgeText(), ['2'], 'batches kept on sale are not counted');

  stockShortcut().props.onPress();
  same(navigated.at(-1), ['Stocks', { showStockAlerts: true }]);

  h.data['/api/distributor/stock-alerts'] = [];
  await refresh();
  same(badgeText(), [], 'resolved → badge disappears');
  stockShortcut().props.onPress();
  same(navigated.at(-1), ['Stocks', { showStockAlerts: false }]);
});

test('Stocks from Stock Alert shows only the alerted batches, marked, until each is kept on sale or discarded', async () => {
  const h = harness();
  h.data['/api/products'] = [alertBatch('b1', 'Tomato', 'received', 7, 18), alertBatch('b2', 'Squash', 'listed', 7, 5),
    alertBatch('b3', 'Carrot', 'listed', 2), alertBatch('b4', 'Okra', 'received', 3)];
  h.data['/api/distributor/stock-alerts'] = [stockAlert('b1', 'Tomato', 18), stockAlert('b2', 'Squash', 5)];
  const screen = h.load('screens/StocksScreen').default;
  const render = () => h.render(screen, { navigation: { setParams() {} }, route: { params: { showStockAlerts: true } } });
  render(); await flush();
  const listed = () => named(render(), 'FlatList')[0].props.data.map(batch => batch.id).join(',');
  const card = id => {
    const list = named(render(), 'FlatList')[0];
    return list.props.renderItem({ item: list.props.data.find(batch => batch.id === id) });
  };
  assert.equal(listed(), 'b1,b2', 'both alerted batches, from either segment');
  assert.equal(named(render(), 'SegmentedTabs').length, 0);
  assert.ok(texts(render()).includes('2 batches need attention'));
  for (const id of ['b1', 'b2']) {
    assert.ok(texts(card(id)).includes('Stock alert'));
    assert.ok(texts(card(id)).includes('Keep Selling'));
  }

  await named(card('b2'), 'TouchableOpacity').find(node => texts(node).includes('Keep Selling')).props.onPress();
  await flush();
  assert.equal(listed(), 'b1');
  assert.ok(texts(render()).includes('1 batch needs attention'));

  named(card('b1'), 'TouchableOpacity').find(node => texts(node).includes('Discard')).props.onPress();
  const confirm = named(render(), 'CustomModal').find(node => node.props.danger);
  assert.ok(texts(confirm).includes('Discard the remaining 18 kg of Tomato? This stock will no longer be available for sale.'));
  h.data['/api/products'] = h.data['/api/products'].map(batch => batch.id === 'b1' ? { ...batch, stock_kg: 0, status: 'spoiled' } : batch);
  h.data['/api/distributor/stock-alerts'] = [stockAlert('b2', 'Squash', 5)];
  await confirm.props.onConfirm(); await flush();
  assert.equal(h.calls.at(-1).route, '/api/products/b1/discard');
  render();
  assert.equal(named(render(), 'SegmentedTabs').length, 1, 'filter ends once every alert is resolved');
  assert.equal(listed(), 'b4');

  // Opened normally, an alerted batch is still marked in its segment.
  const plain = harness();
  plain.data['/api/products'] = h.data['/api/products'];
  plain.data['/api/distributor/stock-alerts'] = [stockAlert('b2', 'Squash', 5)];
  const plainScreen = plain.load('screens/StocksScreen').default;
  const renderPlain = () => plain.render(plainScreen, { navigation: {}, route: { params: {} } });
  renderPlain(); await flush();
  named(renderPlain(), 'SegmentedTabs')[0].props.onChange('products');
  const products = named(renderPlain(), 'FlatList')[0];
  assert.equal(products.props.data.map(batch => batch.id).join(','), 'b2,b3');
  assert.ok(texts(products.props.renderItem({ item: products.props.data[0] })).includes('Stock alert'));
  assert.ok(!texts(products.props.renderItem({ item: products.props.data[1] })).includes('Stock alert'));
});

test('View Reports: periods change the queried dates and totals; custom dates are checked; export prints the table', async () => {
  const h = harness(); await flush();
  const { periodRange } = h.load('lib/reportPeriods');
  const route = range => `/api/distributor/chain-report?from=${range.from}&to=${range.to}`;
  const week = periodRange('week'), month = periodRange('month');
  h.data[route(week)] = { summary: { received_kg: 60, sold_kg: 40, spoiled_kg: 18, sales_total: 2000, completed_transactions: 1, batches: 1 }, events: [
    { type: 'spoiled', date: '2026-09-29T16:05:00Z', batch_id: 'b1', vegetable_name: 'Tomato', farmer_name: 'Ana', quantity_kg: 18, status: 'past_limit' },
    { type: 'sold', date: '2026-09-24T04:00:00Z', batch_id: 'b1', vegetable_name: 'Tomato', farmer_name: 'Ana', party: 'Store One', quantity_kg: 40, amount: 2000, order_id: 'o1' },
    { type: 'received', date: '2026-09-21T04:00:00Z', batch_id: 'b1', vegetable_name: 'Tomato', farmer_name: 'Ana', party: 'Ana', quantity_kg: 60 }] };
  h.data[route(month)] = { summary: { received_kg: 100, sold_kg: 40, spoiled_kg: 18, sales_total: 2000, completed_transactions: 1, batches: 2 }, events: [] };
  const screen = h.load('screens/ChainReportScreen').default;
  const render = () => h.render(screen, { navigation: { goBack() {} } });
  render(); await flush();
  let list = named(render(), 'FlatList')[0];
  assert.equal(named(render(), 'ScreenHeader')[0].props.title, 'Transaction Reports');
  assert.ok(texts(list.props.ListHeaderComponent).includes('60 kg') && texts(list.props.ListHeaderComponent).includes('1 · ₱2000.00'));
  assert.equal(list.props.data.length, 3);
  assert.ok(texts(list.props.renderItem({ item: list.props.data[0], index: 0 })).some(t => t.includes('Past Spoilage Limit')));
  assert.ok(texts(list.props.renderItem({ item: list.props.data[1], index: 1 })).includes('To Store One'));
  await named(list.props.ListFooterComponent, 'TouchableOpacity')[1].props.onPress();
  assert.match(h.prints.at(-1).frame, /VeggieTrack — Transaction Report/);
  named(list.props.ListHeaderComponent, 'SegmentedTabs')[0].props.onChange('month');
  render(); await flush(); list = named(render(), 'FlatList')[0];
  assert.ok(texts(list.props.ListHeaderComponent).includes('100 kg'), 'This Month shows its own totals');
  named(list.props.ListHeaderComponent, 'SegmentedTabs')[0].props.onChange('custom');
  list = named(render(), 'FlatList')[0];
  const [from, to] = named(list.props.ListHeaderComponent, 'BatchDateField');
  from.props.onChange('2026-10-05'); named(named(render(), 'FlatList')[0].props.ListHeaderComponent, 'BatchDateField')[1].props.onChange('2026-10-01');
  assert.ok(texts(named(render(), 'FlatList')[0].props.ListHeaderComponent).includes('The start date cannot be after the end date.'));
  assert.equal(typeof to.props.onChange, 'function');
});

test('Transaction Reports vegetable filter: All Vegetables by default, chips from the report, totals and rows per vegetable with any period', async () => {
  const h = harness(); await flush();
  const { periodRange } = h.load('lib/reportPeriods');
  const route = (range, vegetable) => `/api/distributor/chain-report?from=${range.from}&to=${range.to}${vegetable ? `&vegetable=${vegetable}` : ''}`;
  const week = periodRange('week'), month = periodRange('month'), custom = { from: '2026-09-01', to: '2026-09-15' };
  const vegetables = ['Cucumber', 'Squash', 'Tomato'];
  const summary = (received_kg, sold_kg, spoiled_kg, completed_transactions, sales_total) => ({ received_kg, sold_kg, spoiled_kg, completed_transactions, sales_total, batches: 1 });
  const event = (type, vegetable_name, quantity_kg, extra = {}) => ({ type, date: '2026-09-24T04:00:00Z', batch_id: `${vegetable_name}-1`, vegetable_name, farmer_name: 'Ana', party: 'Store One', quantity_kg, ...extra });
  h.data[route(week)] = { vegetables, summary: summary(90, 40, 18, 2, 2600), events: [
    event('sold', 'Tomato', 40, { amount: 2000, order_id: 'o1' }), event('received', 'Cucumber', 30), event('sold', 'Cucumber', 12, { amount: 600, order_id: 'o2' })] };
  h.data[route(week, 'Tomato')] = { vegetables, summary: summary(60, 40, 18, 1, 2000), events: [event('sold', 'Tomato', 40, { amount: 2000, order_id: 'o1' })] };
  h.data[route(week, 'Squash')] = { vegetables, summary: summary(0, 0, 0, 0, 0), events: [] };
  h.data[route(month, 'Tomato')] = { vegetables, summary: summary(160, 70, 18, 3, 3500), events: [event('received', 'Tomato', 160)] };
  h.data[route(custom, 'Tomato')] = { vegetables, summary: summary(25, 0, 0, 0, 0), events: [event('received', 'Tomato', 25)] };
  const screen = h.load('screens/ChainReportScreen').default;
  const render = () => h.render(screen, { navigation: { goBack() {} } });
  const list = () => named(render(), 'FlatList')[0];
  const header = () => texts(list().props.ListHeaderComponent);
  const chips = () => named(list().props.ListHeaderComponent, 'FilterChips')[0];
  const pick = async (name) => { chips().props.onChange(name); render(); await flush(); };
  render(); await flush();

  same(chips().props.options.map(o => o.label), ['All Vegetables', 'Cucumber', 'Squash', 'Tomato']);
  assert.equal(chips().props.value, '', 'All Vegetables is selected by default');
  assert.ok(header().includes('90 kg') && header().includes('2 · ₱2600.00'));
  assert.equal(list().props.data.length, 3, 'All Vegetables shows every transaction');

  await pick('Tomato');
  assert.equal(chips().props.value, 'Tomato');
  same(list().props.data.map(e => e.vegetable_name), ['Tomato']);
  for (const value of ['60 kg', '40 kg', '18 kg', '1 · ₱2000.00']) assert.ok(header().includes(value), `Tomato summary shows ${value}`);
  await named(list().props.ListFooterComponent, 'TouchableOpacity')[1].props.onPress();
  assert.match(h.prints.at(-1).frame, /Tomato/, 'the export names the vegetable');

  await pick('Squash');
  same(list().props.data, [], 'another vegetable replaces the rows');
  assert.ok(header().includes('0 kg'));
  assert.equal(list().props.ListEmptyComponent.props.title, 'No transactions found for this vegetable.');

  await pick('Tomato');
  named(list().props.ListHeaderComponent, 'SegmentedTabs')[0].props.onChange('month');
  render(); await flush();
  assert.ok(header().includes('160 kg') && header().includes('3 · ₱3500.00'), 'This Month + Tomato');
  assert.equal(chips().props.value, 'Tomato', 'the vegetable stays selected when the period changes');

  named(list().props.ListHeaderComponent, 'SegmentedTabs')[0].props.onChange('custom');
  render();
  named(list().props.ListHeaderComponent, 'BatchDateField')[0].props.onChange(custom.from);
  render();
  named(list().props.ListHeaderComponent, 'BatchDateField')[1].props.onChange(custom.to);
  render(); await flush();
  assert.ok(header().includes('25 kg'), 'Custom dates + Tomato');
  same(list().props.data.map(e => [e.type, e.quantity_kg]), [['received', 25]]);

  await pick('');
  assert.equal(h.translation().t('reports.allVegetables'), 'All Vegetables');
  assert.equal(list().props.ListEmptyComponent.props.title, 'No transactions', 'All Vegetables uses the general empty message');
});

test('Transaction Reports: many vegetables use a dropdown list instead of chips', async () => {
  const h = harness(); await flush();
  const { periodRange } = h.load('lib/reportPeriods');
  const week = periodRange('week');
  const base = `/api/distributor/chain-report?from=${week.from}&to=${week.to}`;
  const vegetables = ['Cabbage', 'Carrot', 'Cucumber', 'Eggplant', 'Okra', 'Onion', 'Potato', 'Squash', 'Tomato'];
  h.data[base] = { vegetables, summary: { received_kg: 1, sold_kg: 0, spoiled_kg: 0, completed_transactions: 0, sales_total: 0 }, events: [] };
  h.data[`${base}&vegetable=Okra`] = { vegetables, summary: { received_kg: 7, sold_kg: 0, spoiled_kg: 0, completed_transactions: 0, sales_total: 0 }, events: [] };
  const screen = h.load('screens/ChainReportScreen').default;
  const render = () => h.render(screen, { navigation: { goBack() {} } });
  const headerTree = () => named(render(), 'FlatList')[0].props.ListHeaderComponent;
  const picker = () => named(render(), 'CustomModal').find(node => node.props.title === 'Vegetable');
  render(); await flush();
  assert.equal(named(headerTree(), 'FilterChips').length, 0);
  const select = named(headerTree(), 'TouchableOpacity').find(node => node.props.accessibilityLabel === 'Vegetable: All Vegetables');
  select.props.onPress();
  assert.equal(picker().props.visible, true);
  const options = named(picker(), 'TouchableOpacity');
  same(options.map(node => texts(node)[0]), ['All Vegetables', ...vegetables]);
  assert.equal(options[0].props.accessibilityState.selected, true);
  options.find(node => texts(node)[0] === 'Okra').props.onPress();
  render(); await flush();
  assert.equal(picker().props.visible, false);
  assert.ok(named(headerTree(), 'TouchableOpacity').some(node => node.props.accessibilityLabel === 'Vegetable: Okra'));
  assert.ok(texts(headerTree()).includes('7 kg'));
});

test("Spoiled Products: this week's spoilage total and both reasons, traced to the batch", async () => {
  const h = harness();
  h.data['/api/distributor/spoilage'] = { this_week: { from: '2026-09-28', to: '2026-10-04', kg: 42 }, records: [
    { id: 's1', batch_id: 'b1aaaaaaaa', vegetable_name: 'Tomato', farmer_name: 'Ana', harvest_date: '2026-09-20T04:00:00Z', quantity_kg: 18, reason: 'past_limit', recorded_at: '2026-09-29T16:05:00Z' },
    { id: 's2', batch_id: 'b2bbbbbbbb', vegetable_name: 'Squash', farmer_name: null, harvest_date: '2026-09-25T04:00:00Z', quantity_kg: 24, reason: 'discarded', recorded_at: '2026-09-28T04:00:00Z' }] };
  const screen = h.load('screens/SpoiledProductsScreen').default;
  const render = () => h.render(screen, { navigation: { goBack() {} } });
  render(); await flush();
  const list = named(render(), 'FlatList')[0];
  assert.ok(texts(list.props.ListHeaderComponent).includes("This Week's Spoilage") && texts(list.props.ListHeaderComponent).includes('42 kg'));
  const rows = list.props.data.map((item, index) => texts(list.props.renderItem({ item, index })));
  assert.ok(rows[0].includes('Past Spoilage Limit') && rows[0].includes('Batch ID: b1aaaaaa') && rows[0].includes('Farmer: Ana'));
  assert.ok(rows[1].includes('Discarded by Distributor') && rows[1].includes('18 kg') === false && rows[1].includes('24 kg'));
});
