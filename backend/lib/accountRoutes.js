const { verifyToken, verifySession, TRUSTED_DISTRIBUTOR } = require('./auth');
const { accountNotice } = require('./accountNotices');
const safeFields = 'id,full_name,email,role,created_at,account_status,status_reason,status_version,legacy_access,farm_location,store_location,service_area,approved_at,disabled_at,avatar_url,profile_picture_updated_at';
function mountAccountRoutes(app, db) {
  app.get('/api/auth/me', verifySession, (req, res) => res.json({ user: req.profile }));
  app.get('/api/accounts', verifyToken, async (req, res) => {
    if (req.user.userId !== TRUSTED_DISTRIBUTOR || req.user.role !== 'distributor') return res.status(403).json({ error: 'Distributor access required.' });
    const status = req.query.status || 'pending_approval';
    if (!['unverified','pending_approval','active','declined','disabled'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const { data, error } = await db.from('users').select(safeFields).eq('account_status', status).neq('role','distributor').order('created_at');
    if (error) return res.status(503).json({ error: 'Accounts are unavailable.' });
    const ids = data.filter(u => u.role === 'delivery_personnel' && u.account_status === 'disabled').map(u => u.id);
    let work = [];
    if (ids.length) {
      const [orders, pickups] = await Promise.all([
        db.from('orders').select('id,delivery_personnel_id,status').in('delivery_personnel_id',ids).in('status',['pending','approved','picked_up','in_transit']),
        db.from('pickup_requests').select('id,delivery_personnel_id,status').in('delivery_personnel_id',ids).in('status',['requested','assigned','picked_up']),
      ]);
      if (orders.error || pickups.error) return res.status(503).json({ error: 'Unfinished assignments could not be checked.' });
      work = [...orders.data.map(x=>({...x,type:'order'})),...pickups.data.map(x=>({...x,type:'pickup'}))];
    }
    // The latest User Management action on each listed account (action, reason or
    // message, and when), from account_audit, so the distributor can review it.
    const latest = {};
    if (data.length) {
      const audit = await db.from('account_audit').select('target_id,action,reason,created_at').in('target_id', data.map(u => u.id)).order('created_at', { ascending: false });
      if (!audit.error) for (const row of audit.data || []) {
        const seen = latest[row.target_id];
        if (!seen || String(row.created_at) > String(seen.created_at)) latest[row.target_id] = { action: row.action, reason: row.reason || null, created_at: row.created_at };
      }
    }
    res.json(data.map(u=>({...u,unfinished_assignments:work.filter(w=>w.delivery_personnel_id===u.id),last_action:latest[u.id]||null})));
  });
  app.post('/api/accounts/:id/transition', verifyToken, async (req, res) => {
    if (req.user.userId !== TRUSTED_DISTRIBUTOR || req.user.role !== 'distributor') return res.status(403).json({ error: 'Distributor access required.' });
    if (!Number.isInteger(req.body.version)) return res.status(400).json({ error: 'Refresh the account and try again.' });
    // vt_admin_transition saves the action, its reason or message and the distributor
    // in account_audit, and a decline/disable reason on users.status_reason.
    // Approval takes no message; the audit still records who approved and when.
    const reason = req.body.action === 'APPROVED' ? null : (req.body.reason || null);
    const { data, error } = await db.rpc('vt_admin_transition', { p_actor:req.authUser.id,p_session:req.sessionId,p_target:req.params.id,p_action:req.body.action,p_reason:reason,p_version:req.body.version });
    // Log the database reason; the client only receives a generic message.
    if (error) {
      console.error('[POST /api/accounts/:id/transition] rejected:', req.params.id, req.body.action, '|', error.code || '', error.message, '|', error.details || '', error.hint || '');
      return res.status(409).json({ error: 'The action was rejected. Check the reason and refresh the account status.' });
    }
    // Approved and reactivated users can open the app, so they get an in-app
    // notification with the distributor's message. Declined and disabled users
    // cannot; they see the reason on the account status screen at sign-in. The
    // transition succeeds once per status_version, so a retry or refresh never
    // creates a second notification.
    const notice = accountNotice(req.body.action, reason);
    let notified = null;
    if (notice) {
      const row = { user_id: req.params.id, title: notice.title, message: notice.message, type: 'account' };
      let insert = await db.from('notifications').insert(row);
      if (insert.error) insert = await db.from('notifications').insert(row);
      notified = !insert.error;
      if (insert.error) console.error('[POST /api/accounts/:id/transition] notification not saved:', req.params.id, req.body.action, insert.error.message);
    }
    res.json({ ...data, notified });
  });
  app.get('/api/accounts/:id/audit', verifyToken, async (req, res) => {
    if (req.user.userId !== TRUSTED_DISTRIBUTOR || req.user.role !== 'distributor') return res.status(403).json({ error: 'Distributor access required.' });
    const { data, error } = await db.from('account_audit').select('*').eq('target_id',req.params.id).order('created_at',{ascending:false}).limit(100);
    if (error) return res.status(503).json({ error: 'Audit history unavailable.' });
    res.json(data);
  });
}
module.exports = { mountAccountRoutes };
