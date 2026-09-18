// The active hosted distributor profile. The former seed UUID does not match
// the migrated profile, causing valid administrator sessions to be rejected.
const TRUSTED_DISTRIBUTOR = '86d9d317-b099-430c-be21-824d0a3434b6';
let admin;
function configureAuth(client) { admin = client; }
function createVerifier(client, statusOnly = false) {
  return async (req, res, next) => {
    const token = req.headers?.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token || !client) return res.status(401).json({ error: 'Please sign in.' });
    try {
      const { data, error } = await client.auth.getUser(token);
      if (error && (error.name === 'AuthRetryableFetchError' || error.status >= 500)) return res.status(503).json({ error: 'Authentication is temporarily unavailable.' });
      if (error || !data?.user) return res.status(401).json({ error: 'Please sign in again.' });
      // Decode only AFTER Supabase validated this exact token.
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      if (claims.sub !== data.user.id || !claims.session_id) return res.status(401).json({ error: 'Please sign in again.' });
      const result = await client.rpc('vt_account_context', { p_auth_id: data.user.id, p_session_id: claims.session_id });
      if (result.error) return res.status(503).json({ error: 'Account status is temporarily unavailable.' });
      if (!result.data) return res.status(401).json({ error: 'Please sign in again.' });
      req.profile = result.data; req.authUser = data.user; req.sessionId = claims.session_id;
      req.user = { userId: result.data.id, role: result.data.role };
      if (!statusOnly && !result.data.access_allowed) return res.status(403).json({ error: 'Your account cannot access this feature.', code: 'ACCOUNT_BLOCKED' });
      if (result.data.role === 'distributor' && result.data.id !== TRUSTED_DISTRIBUTOR) return res.status(403).json({ error: 'Access denied.' });
      next();
    } catch { return res.status(401).json({ error: 'Please sign in again.' }); }
  };
}
const verifyToken = (req, res, next) => createVerifier(admin)(req, res, next);
const verifySession = (req, res, next) => createVerifier(admin, true)(req, res, next);
module.exports = { configureAuth, createVerifier, verifyToken, verifySession, TRUSTED_DISTRIBUTOR };
