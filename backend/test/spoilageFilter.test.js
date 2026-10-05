const test = require('node:test');
const assert = require('node:assert/strict');
const { routeHarness } = require('./routeHarness');

const batch = (id, vegetable, created) => ({ id, distributor_id: 'hub', vegetable_name: vegetable, stock_kg: 0, quantity_received: 20,
  price_per_kg: 40, status: 'spoiled', harvest_date: created, created_at: created, farmer_name: 'Farmer' });
const data = () => ({
  users: [{ id: 'hub', role: 'distributor', full_name: 'Hub' }, { id: 'retailer', role: 'retailer' }],
  products: [
    batch('tomato-1', 'Tomato', '2026-09-01T00:00:00Z'), batch('kamatis-1', 'Kamatis', '2026-09-20T00:00:00Z'),
    batch('squash-1', 'Squash', '2026-09-05T00:00:00Z'), batch('cabbage-1', 'Cabbage', '2026-09-05T00:00:00Z'),
  ],
  stock_spoilage: [
    { id: 's1', product_id: 'tomato-1', quantity_kg: 5, reason: 'discarded', recorded_at: '2026-09-10T02:00:00Z' },
    // 2026-09-30 23:30 in Manila is still 30 September there.
    { id: 's2', product_id: 'kamatis-1', quantity_kg: 3, reason: 'past_limit', recorded_at: '2026-09-30T15:30:00Z' },
    { id: 's3', product_id: 'squash-1', quantity_kg: 7.5, reason: 'discarded', recorded_at: '2026-10-02T03:00:00Z' },
  ],
});
const ids = (res) => res.body.records.map((record) => record.id);

test('Spoiled Products filters by date range and vegetable, separately and together', async () => {
  const call = routeHarness(data());
  const spoilage = (query = {}) => call('get /api/distributor/spoilage', 'hub', { query });

  // All records, newest first; only vegetables that have a record are offered.
  const all = await spoilage();
  assert.deepEqual(ids(all), ['s3', 's2', 's1']);
  assert.deepEqual([...all.body.vegetables], ['Squash', 'Tomato']);
  assert.equal(all.body.total_kg, 15.5);
  assert.ok(all.body.this_week, 'the weekly summary is still returned');

  // Date range only (inclusive Manila days).
  assert.deepEqual(ids(await spoilage({ from: '2026-09-01', to: '2026-09-30' })), ['s2', 's1']);
  assert.deepEqual(ids(await spoilage({ from: '2026-10-01', to: '2026-10-01' })), []);
  assert.deepEqual(ids(await spoilage({ from: '2026-10-02', to: '2026-10-02' })), ['s3']);

  // Vegetable only: English and Tagalog names are the same vegetable.
  const tomato = await spoilage({ vegetable: 'Tomato' });
  assert.deepEqual(ids(tomato), ['s2', 's1']);
  assert.equal(tomato.body.total_kg, 8);
  assert.deepEqual(ids(await spoilage({ vegetable: 'kamatis' })), ['s2', 's1']);
  assert.deepEqual(ids(await spoilage({ vegetable: 'Cabbage' })), [], 'a vegetable without spoilage lists nothing');

  // Both together.
  const both = await spoilage({ from: '2026-09-15', to: '2026-09-30', vegetable: 'Tomato' });
  assert.deepEqual(ids(both), ['s2']);
  assert.equal(both.body.total_kg, 3);
  assert.deepEqual([...both.body.vegetables], ['Squash', 'Tomato'], 'options do not shrink with the filter');

  // Invalid custom ranges are rejected the same way as on View Reports.
  assert.equal((await spoilage({ from: '2026-09-30', to: '2026-09-01' })).statusCode, 400);
  assert.equal((await spoilage({ from: 'yesterday' })).statusCode, 400);
  assert.equal((await call('get /api/distributor/spoilage', 'retailer')).statusCode, 403);
});
