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
  const calls = [], alerts = [], storage = new Map();
  const changed = (old, next) => !old || !next || old.length !== next.length || old.some((value, index) => value !== next[index]);
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
  const native = new Proxy({ StyleSheet: { create: value => value, absoluteFill: {} }, Platform: { OS: 'web' }, Animated: { View: 'AnimatedView' } }, {
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
    '@react-native-async-storage/async-storage': { getItem: async key => storage.get(key) || null, setItem: async (key, value) => storage.set(key, value) },
  };
  const real = /^(screens\/(StocksScreen|RetailerDashboard|DistributorInventoryReportScreen|ApplicationStatusScreen)|components\/(AuthForm|CustomModal)|i18n\/|lib\/(vegetableNames|vegetables|cartStore)|theme\/appTheme)/;
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
      exports: exported, console, Date, setTimeout, clearTimeout,
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
        if (real.test(target)) return load(target);
        if (target === 'components/BottomNavBar') return { __esModule: true, default: 'BottomNavBar', useBottomNavSpace: () => 80 };
        if (target === 'components/ui/SegmentedTabs') return { SegmentedTabs: 'SegmentedTabs' };
        if (target.startsWith('components/')) return path.posix.basename(target);
        if (target === 'lib/textFormat') return { titleCaseWords: value => value };
        if (target === 'lib/errorMessages') return { friendlyError: error => error.message };
        if (target === 'lib/reportPdf') return {};
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
  return { load, render, data, calls, alerts, language, translation: () => provider.useLanguageContext() };
}

test('Inventory English → Tagalog → English updates labels and values while preserving complete metadata', async () => {
  const h = harness(); await flush();
  const { formatRow } = h.load('screens/DistributorInventoryReportScreen');
  const row = { product: 'Karot', batch_id: 'a12bc345-6789-0123-4567-89abcdef0123', batch_photo_url: 'https://example.test/carrot.jpg', batch_status: 'sold_out', quantity_received: 12, quantity_sold: 12, remaining_quantity: 0, farmer_name: 'Juan Kamatis', harvest_date: '2026-09-20T04:00:00Z', pickup_date: '2026-09-21T04:00:00Z', payment_status: 'Paid', order_status: 'delivered' };
  const output = [];
  for (const language of ['en', 'tl', 'en']) {
    h.language(language);
    const { t } = h.translation();
    const formatted = formatRow(row, language, t);
    output.push(formatted);
    assert.equal(formatted.batch_id, row.batch_id);
    assert.equal(formatted.farmer_name, row.farmer_name);
    assert.equal(formatted.batch_photo, row.batch_photo_url);
    assert.equal(formatted.remaining_quantity, '0 kg');
    assert.equal(t('inventoryReport.title'), language === 'tl' ? 'Ulat ng Imbentaryo' : 'Inventory Report');
    assert.equal(formatted.product, language === 'tl' ? 'Karot' : 'Carrot');
    assert.equal(formatted.batch_status, language === 'tl' ? 'Ubos na' : 'Sold out');
    assert.equal(formatted.payment_status, language === 'tl' ? 'Bayad na' : 'Paid');
  }
  assert.equal(output[0].harvest_date, output[1].harvest_date);
  assert.equal(output[0].pickup_date, output[1].pickup_date);
  assert.deepEqual(output[0], output[2]);
});

test('Stocks excludes sold-out, archived, rejected and inactive stock; Add Product submits registered farmer and both dates', async () => {
  const h = harness();
  h.data['/api/products'] = ['received', 'listed', 'sold_out', 'archived', 'rejected', 'inactive', 'unexpected'].map(status => ({ id: status, status, stock_kg: status === 'sold_out' ? 0 : 12 }));
  h.data['/api/farmers'] = [{ id: 'farmer-1', full_name: 'Juan Reyes' }];
  const screen = h.load('screens/StocksScreen').default;
  const render = () => h.render(screen, { navigation: {} });
  render(); await flush();
  let tree = render();
  assert.equal(named(tree, 'FlatList')[0].props.data.map(batch => batch.status).join(','), 'received');
  named(tree, 'SegmentedTabs')[0].props.onChange('products');
  tree = render();
  assert.equal(named(tree, 'FlatList')[0].props.data.map(batch => batch.status).join(','), 'listed');
  const header = named(tree, 'ScreenHeader')[0];
  header.props.right.props.onPress(); await flush();
  const addModal = () => named(render(), 'CustomModal').find(node => node.props.title === h.translation().t('stocks.addProductModalTitle'));
  let modal = addModal();
  const inputs = named(modal, 'AppTextInput');
  inputs[0].props.onChangeText('Carrot'); inputs[1].props.onChangeText('45'); inputs[2].props.onChangeText('12');
  await addModal().props.onConfirm();
  assert.equal(h.calls.length, 0, 'farmer is required');
  modal = addModal();
  named(modal, 'TouchableOpacity')[0].props.onPress();
  named(modal, 'BatchDateField')[0].props.onChange('2026-09-20');
  named(modal, 'BatchDateField')[1].props.onChange('2026-09-21');
  named(modal, 'BatchPhotoField')[0].props.onChange('https://example.test/carrot.jpg');
  await addModal().props.onConfirm();
  assert.equal(h.calls[0].route, '/api/products');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].body)), { vegetable_name: 'Carrot', price_per_kg: 45, stock_kg: 12, batch_photo_url: 'https://example.test/carrot.jpg', farmer_id: 'farmer-1', harvest_date: '2026-09-20', pickup_date: '2026-09-21' });
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
