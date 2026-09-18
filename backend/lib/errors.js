// Centralized handling for unexpected database/infra failures on generic
// CRUD routes: the real Postgres/PostgREST error is always logged server-side
// for debugging, but the client only ever receives a safe, generic message —
// never a raw constraint name, column name, or query fragment.
//
// Routes that raise their own intentional, already-safe messages (RPC
// ERRCODE 22023, request validation in lib/orderRules.js, lib/deliveryProof.js,
// lib/avatar.js, etc.) are untouched by this helper and keep returning their
// authored text directly.
function friendlyMessage(error) {
  switch (error?.code) {
    case '23505': return 'This record already exists.';
    case '23503': return 'This action refers to a record that no longer exists.';
    case '23514': return 'This value is not allowed.';
    case '22P02': return 'One of the submitted values is not valid.';
    default: return null;
  }
}

function sendDbError(res, error, fallback = 'Something went wrong. Please try again.') {
  console.error('[db error]', error?.message || error);
  return res.status(500).json({ error: friendlyMessage(error) || fallback });
}

module.exports = { sendDbError, friendlyMessage };
