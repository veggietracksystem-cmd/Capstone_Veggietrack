const test = require('node:test');
const assert = require('node:assert/strict');
const { isPositiveQuantity, isNonNegativeQuantity } = require('../lib/validation');
const { isVegetable } = require('../lib/vegetables');
const { sendDbError, friendlyMessage } = require('../lib/errors');

test('isPositiveQuantity rejects zero, negative, decimal-but-valid stays accepted, NaN, Infinity, missing, non-numeric strings and oversized values', () => {
  assert.equal(isPositiveQuantity(0), false);
  assert.equal(isPositiveQuantity(-5), false);
  assert.equal(isPositiveQuantity(2.5), true);
  assert.equal(isPositiveQuantity(NaN), false);
  assert.equal(isPositiveQuantity(Infinity), false);
  assert.equal(isPositiveQuantity(-Infinity), false);
  assert.equal(isPositiveQuantity(undefined), false);
  assert.equal(isPositiveQuantity(null), false);
  assert.equal(isPositiveQuantity(''), false);
  assert.equal(isPositiveQuantity('abc'), false);
  assert.equal(isPositiveQuantity('5'), true); // numeric strings from form fields are still valid
  assert.equal(isPositiveQuantity(5), true);
  assert.equal(isPositiveQuantity(1_000_001), false); // absurd/overflow-style values are capped
  assert.equal(isPositiveQuantity(1_000_000), true);
  assert.equal(isPositiveQuantity({}), false);
  assert.equal(isPositiveQuantity([5]), false);
});

test('isNonNegativeQuantity allows exactly zero but still rejects negative/NaN/Infinity', () => {
  assert.equal(isNonNegativeQuantity(0), true);
  assert.equal(isNonNegativeQuantity(-0.01), false);
  assert.equal(isNonNegativeQuantity(NaN), false);
  assert.equal(isNonNegativeQuantity(Infinity), false);
  assert.equal(isNonNegativeQuantity(3.2), true);
});

test('isVegetable accepts English and Tagalog names, capitalization/whitespace variants, and descriptive modifiers', () => {
  for (const name of ['Tomato', ' tomato ', 'TOMATO', 'Kamatis', 'Fresh Tomato', 'Red  Onion', 'Sweet Potato', 'Kamote', 'Ampalaya', 'Talbos ng Kamote', 'tomatoes', 'onions']) {
    assert.equal(isVegetable(name), true, `expected "${name}" to be accepted`);
  }
});

test('isVegetable rejects non-vegetables and does not false-positive on substrings embedded in unrelated words', () => {
  for (const name of ['Basilica', 'Upon Request', 'eggplantxyz', 'Peppermint Candy', 'iPhone', 'Rice', 'Beef', 'Chicken', '', '   ', 'Tom']) {
    assert.equal(isVegetable(name), false, `expected "${name}" to be rejected`);
  }
});

test('isVegetable rejects absurdly long input and is not fooled by script-like payloads without a real vegetable word', () => {
  assert.equal(isVegetable('a'.repeat(500)), false);
  assert.equal(isVegetable('<script>alert(1)</script>'), false);
});

test('sendDbError logs the real error but only ever returns a safe generic/mapped message to the client', () => {
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const capture = () => { let body, code; return { res: { status(c) { code = c; return this; }, json(b) { body = b; return this; } }, get: () => ({ code, body }) }; };
    let c = capture(); sendDbError(c.res, new Error('duplicate key value violates unique constraint "products_pkey"'));
    assert.equal(c.get().code, 500);
    assert.doesNotMatch(c.get().body.error, /constraint|pkey|duplicate key/);

    c = capture(); sendDbError(c.res, { code: '23505', message: 'duplicate key value violates unique constraint' });
    assert.match(c.get().body.error, /already exists/);

    c = capture(); sendDbError(c.res, { code: '23503', message: 'violates foreign key constraint "orders_retailer_id_fkey"' });
    assert.doesNotMatch(c.get().body.error, /foreign key|fkey/);
    assert.match(c.get().body.error, /no longer exists/);

    c = capture(); sendDbError(c.res, { code: '23514', message: 'violates check constraint "products_stock_kg_non_negative"' });
    assert.doesNotMatch(c.get().body.error, /check constraint/);

    c = capture(); sendDbError(c.res, new Error('relation "orders" does not exist'), 'Could not load orders.');
    assert.equal(c.get().body.error, 'Could not load orders.');

    assert.ok(logs.length === 5, 'every failure must still be logged server-side for debugging');
    assert.ok(logs.some(args => /pkey|constraint/.test(args.join(' '))));
  } finally { console.error = originalError; }
});

test('friendlyMessage returns null for unmapped codes so callers fall back to their own default', () => {
  assert.equal(friendlyMessage({ code: '42P01' }), null);
  assert.equal(friendlyMessage(new Error('generic failure')), null);
});
