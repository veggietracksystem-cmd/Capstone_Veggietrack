// Logs unexpected database errors server-side and returns a generic message, so
// constraint names, columns and query fragments never reach the client.
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
