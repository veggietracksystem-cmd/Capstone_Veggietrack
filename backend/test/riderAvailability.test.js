const test = require('node:test');
const assert = require('node:assert/strict');
const { routeHarness } = require('./routeHarness');

const people = () => [
  { id: 'hub', role: 'distributor', full_name: 'Hub', account_status: 'active' },
  { id: 'farmer', role: 'farmer', full_name: 'Farmer', account_status: 'active' },
  { id: 'retailer', role: 'retailer', full_name: 'Retailer', account_status: 'active', is_available_for_delivery: true },
  { id: 'ana', role: 'delivery_personnel', full_name: 'Ana', account_status: 'active', is_available_for_delivery: true },
  { id: 'ben', role: 'delivery_personnel', full_name: 'Ben', account_status: 'active', is_available_for_delivery: false },
  { id: 'cy', role: 'delivery_personnel', full_name: 'Cy', account_status: 'disabled', is_available_for_delivery: true },
];
const plain = (value) => JSON.parse(JSON.stringify(value));
const listed = async (call) => (await call('get /api/delivery-personnel', 'hub')).body.map((rider) => rider.id).sort();

test('riders control Available for Deliveries and only available riders are listed for the distributor', async () => {
  const data = { users: people() };
  const call = routeHarness(data);

  assert.deepEqual(await listed(call), ['ana'], 'unavailable and disabled riders are not offered');

  // Ben turns availability on: saved on his account and read back the same way after a restart.
  assert.deepEqual(plain((await call('get /api/delivery/availability', 'ben')).body), { available: false });
  const on = await call('put /api/delivery/availability', 'ben', { body: { available: true } });
  assert.deepEqual([on.statusCode, plain(on.body)], [200, { available: true }]);
  assert.equal(data.users.find((u) => u.id === 'ben').is_available_for_delivery, true);
  assert.deepEqual(plain((await call('get /api/delivery/availability', 'ben')).body), { available: true });
  assert.deepEqual(await listed(call), ['ana', 'ben']);

  const off = await call('put /api/delivery/availability', 'ben', { body: { available: false } });
  assert.deepEqual(plain(off.body), { available: false });
  assert.deepEqual(await listed(call), ['ana']);

  // Only a boolean from the rider themself is accepted.
  assert.equal((await call('put /api/delivery/availability', 'ben', { body: { available: 'yes' } })).statusCode, 400);
  assert.equal((await call('put /api/delivery/availability', 'ben', { body: {} })).statusCode, 400);
  for (const other of ['hub', 'retailer', 'farmer']) {
    assert.equal((await call('put /api/delivery/availability', other, { body: { available: true } })).statusCode, 403, other);
    assert.equal((await call('get /api/delivery/availability', other)).statusCode, 403, other);
  }
  assert.equal((await call('get /api/delivery-personnel', 'ana')).statusCode, 403);
  assert.equal(data.users.find((u) => u.id === 'ben').is_available_for_delivery, false);
});

test('pickup assignment refuses unavailable riders on the server and keeps existing assignments when a rider goes unavailable', async () => {
  const data = {
    users: people(),
    harvests: [{ id: 'h1', farmer_id: 'farmer', vegetable_name: 'Tomato', quantity_kg: 10, status: 'available', recorded_at: '2026-10-01T00:00:00Z' }],
    pickup_requests: [
      { id: 'p1', farmer_id: 'farmer', harvest_id: 'h1', status: 'requested', quantity_kg: 10, price_per_kg: 30, requested_at: '2026-10-01T01:00:00Z' },
      { id: 'p2', farmer_id: 'farmer', harvest_id: 'h1', status: 'approved', quantity_kg: 5, price_per_kg: 30, requested_at: '2026-10-01T02:00:00Z' },
    ],
  };
  const call = routeHarness(data);

  // Bypassing the app with an unavailable or disabled rider changes nothing.
  for (const rider of ['ben', 'cy', 'retailer', 'nobody']) {
    const refused = await call('put /api/pickup-requests/:id/assign', 'hub', { body: { delivery_personnel_id: rider }, id: 'p1' });
    assert.ok(refused.statusCode === 409 || refused.statusCode === 400, `${rider}: ${refused.statusCode}`);
  }
  const unavailable = await call('put /api/pickup-requests/:id/assign', 'hub', { body: { delivery_personnel_id: 'ben' }, id: 'p2' });
  assert.deepEqual([unavailable.statusCode, unavailable.body.code], [409, 'RIDER_UNAVAILABLE']);
  assert.deepEqual(data.pickup_requests.map((p) => [p.status, p.delivery_personnel_id ?? null]), [['requested', null], ['approved', null]]);
  assert.equal((data.notifications || []).length, 0, 'no assignment notifications for a refused rider');

  // Approving and assigning an available rider works as before.
  const assigned = await call('put /api/pickup-requests/:id/assign', 'hub', { body: { delivery_personnel_id: 'ana' }, id: 'p1' });
  assert.equal(assigned.statusCode, 200);
  assert.deepEqual([data.pickup_requests[0].status, data.pickup_requests[0].delivery_personnel_id], ['assigned', 'ana']);

  // Ana goes unavailable: her pickup stays assigned and visible to her, but she
  // can no longer be chosen for the other pickup.
  await call('put /api/delivery/availability', 'ana', { body: { available: false } });
  assert.deepEqual([data.pickup_requests[0].status, data.pickup_requests[0].delivery_personnel_id], ['assigned', 'ana']);
  assert.deepEqual((await call('get /api/pickup-requests', 'ana')).body.map((p) => [p.id, p.status]), [['p1', 'assigned']]);
  assert.equal((await call('put /api/pickup-requests/:id/assign', 'hub', { body: { delivery_personnel_id: 'ana' }, id: 'p2' })).statusCode, 409);
  assert.deepEqual(await listed(call), [], 'nobody is available now');
  // She can still start the pickup she already has.
  assert.equal((await call('put /api/pickup-requests/:id/status', 'ana', { body: { status: 'otw' }, id: 'p1' })).statusCode, 200);
});

test('order assignment refuses unavailable riders; a rider going unavailable keeps the order and a retried assignment stays safe', async () => {
  const data = {
    users: people(),
    orders: [
      { id: 'o1', retailer_id: 'retailer', distributor_id: 'hub', status: 'approved', delivery_personnel_id: null, total_amount: 100, created_at: '2026-10-01T00:00:00Z' },
    ],
    deliveries: [{ id: 'd1', order_id: 'o1', delivery_personnel_id: null, status: 'pending' }],
  };
  const call = routeHarness(data);

  const refused = await call('put /api/orders/:id/assign', 'hub', { body: { delivery_personnel_id: 'ben' }, id: 'o1' });
  assert.deepEqual([refused.statusCode, refused.body.code], [409, 'RIDER_UNAVAILABLE']);
  assert.equal((await call('put /api/orders/:id/assign', 'hub', { body: { delivery_personnel_id: 'retailer' }, id: 'o1' })).statusCode, 400);
  assert.deepEqual([data.orders[0].delivery_personnel_id, data.deliveries[0].status], [null, 'pending']);

  assert.equal((await call('put /api/orders/:id/assign', 'hub', { body: { delivery_personnel_id: 'ana' }, id: 'o1' })).statusCode, 200);
  await call('put /api/delivery/availability', 'ana', { body: { available: false } });
  assert.deepEqual([data.orders[0].delivery_personnel_id, data.deliveries[0].status], ['ana', 'assigned']);
  assert.deepEqual((await call('get /api/delivery/orders', 'ana')).body.map((o) => o.id), ['o1']);
  // A double tap or network retry of the same assignment is still a no-op.
  assert.equal((await call('put /api/orders/:id/assign', 'hub', { body: { delivery_personnel_id: 'ana' }, id: 'o1' })).statusCode, 200);
  assert.equal(data.orders[0].delivery_personnel_id, 'ana');
});

test('before sql/rider_availability.sql runs, every active rider is listed and assignable and the toggle asks for the update', async () => {
  const data = { users: people().map(({ is_available_for_delivery, ...user }) => user),
    orders: [{ id: 'o1', retailer_id: 'retailer', distributor_id: 'hub', status: 'approved', delivery_personnel_id: null }],
    deliveries: [{ id: 'd1', order_id: 'o1', status: 'pending' }] };
  const call = routeHarness(data, { missingColumns: ['is_available_for_delivery'] });
  assert.deepEqual(await listed(call), ['ana', 'ben']);
  const toggle = await call('put /api/delivery/availability', 'ben', { body: { available: true } });
  assert.deepEqual([toggle.statusCode, toggle.body.code], [503, 'DATABASE_UPDATE_REQUIRED']);
  assert.equal((await call('get /api/delivery/availability', 'ben')).statusCode, 503);
  assert.equal((await call('put /api/orders/:id/assign', 'hub', { body: { delivery_personnel_id: 'ben' }, id: 'o1' })).statusCode, 200);
});
