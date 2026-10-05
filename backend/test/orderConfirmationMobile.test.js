const test = require('node:test');
const assert = require('node:assert/strict');
const { mountScreen, settle, translation } = require('./mobileScreenHarness');

// Retailer checkout: a saved order must never be reported as a failure.
function checkout({ post }) {
  const alerts = [], posts = [], cleared = [];
  const mocks = {
    '../api/client': { __esModule: true, default: {
      get: async () => [{ id: 'a1', label: 'Store', address: 'Main St', latitude: 14.1, longitude: 121.2, is_default: true }],
      post: async (...args) => { posts.push(args); return post(posts.length); },
    } },
    '../context/AuthContext': { useAuth: () => ({ user: { id: 'retailer-1' } }) },
    '../lib/cartStore': { clearCheckedOutCart: async (id) => { cleared.push(id); } },
    '../lib/ui': { showAlert: (title, message) => alerts.push([title, message]), peso: (n) => `PHP ${n}` },
    '../lib/errorMessages': { friendlyError: (err, fallback) => err?.message || fallback },
    '../lib/vegetableIcons': { getVegetableTile: () => ({ bg: '#fff', source: null }) },
    '../lib/deliverySchedule': { manilaDate: () => '2099-01-01', scheduleInstant: () => Date.parse('2099-01-01T10:00:00+08:00'), validateSchedule: () => true },
    '../i18n/useTranslation': translation,
  };
  const navigation = { addListener: () => () => {}, navigate() {}, goBack() {} };
  const route = { params: { cart: [{ vegetable_name: 'Tomato', name: 'Tomato', quantity: 6, price: 50 }], totalItems: 1, totalAmount: 300 } };
  const screen = mountScreen('screens/OrderConfirmationScreen.js', mocks, { navigation, route });
  const confirm = () => screen.findAll((props) => props.onPress?.name === 'confirmOrder')[0].props.onPress();
  const successVisible = () => screen.findAll((props) => props.title === 'dashboards.retailer.orderCompletedTitle')[0].props.visible;
  return { screen, confirm, successVisible, alerts, posts, cleared };
}

test('a successful order shows the success message, clears the cart once and shows no connection error', async () => {
  const c = checkout({ post: () => ({ message: 'Order placed successfully', order: { id: 'o1', status: 'pending' } }) });
  await settle(); c.screen.render();
  await c.confirm();
  await settle(); c.screen.render();
  assert.deepEqual(c.alerts, [], 'no error alert after the order is saved');
  assert.equal(c.successVisible(), true);
  assert.equal(c.posts.length, 1);
  assert.deepEqual(c.cleared, ['retailer-1'], 'the signed-in retailer’s cart is cleared');
  // The order is sent once, with the delivery date/time and the saved address.
  const [path, body, options] = c.posts[0];
  assert.equal(path, '/api/orders');
  assert.match(body.preferred_schedule, /^2099-01-01T.*\+08:00$/);
  assert.deepEqual([body.delivery_address, body.delivery_latitude, body.delivery_longitude], ['Main St', 14.1, 121.2]);
  assert.equal(options.timeoutMs, 60000);
  // Pressing again after success sends nothing.
  await c.confirm(); await settle();
  assert.equal(c.posts.length, 1);
});

test('a double tap while the order is being sent places only one order', async () => {
  let finish;
  const c = checkout({ post: () => new Promise((resolve) => { finish = () => resolve({ order: { id: 'o1' } }); }) });
  await settle(); c.screen.render();
  const first = c.confirm(); const second = c.confirm();
  finish(); await Promise.all([first, second]); await settle();
  assert.equal(c.posts.length, 1);
  assert.deepEqual(c.alerts, []);
});

test('no answer in time asks the retailer to check My Orders instead of reporting a connection error', async () => {
  const c = checkout({ post: () => { throw Object.assign(new Error('The request timed out.'), { code: 'REQUEST_TIMEOUT', status: 0 }); } });
  await settle(); c.screen.render();
  await c.confirm(); await settle(); c.screen.render();
  assert.deepEqual(c.alerts, [['dashboards.retailer.orderFailedTitle', 'addr.orderUnconfirmed']]);
  assert.equal(c.successVisible(), false);
  assert.deepEqual(c.cleared, [], 'the cart is kept');
});

test('a real failure is still reported, and a lost connection still shows the connection message', async () => {
  const rejected = checkout({ post: () => { throw Object.assign(new Error('Not enough stock available.'), { status: 409 }); } });
  await settle(); rejected.screen.render();
  await rejected.confirm(); await settle();
  assert.deepEqual(rejected.alerts, [['dashboards.retailer.orderFailedTitle', 'Not enough stock available.']]);
  const offline = checkout({ post: () => { throw Object.assign(new Error('Server cannot be reached.'), { code: 'BACKEND_UNREACHABLE', status: 0 }); } });
  await settle(); offline.screen.render();
  await offline.confirm(); await settle();
  assert.deepEqual(offline.alerts, [['dashboards.retailer.orderFailedTitle', 'errors.connection']]);
});
