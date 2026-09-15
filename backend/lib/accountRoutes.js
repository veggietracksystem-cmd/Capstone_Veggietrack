const { verifyToken, verifySession, TRUSTED_DISTRIBUTOR } = require('./auth');
const safeFields = 'id,full_name,phone,role,created_at,account_status,status_reason,status_version,phone_verified_at,legacy_access,farm_location,store_location,service_area,approved_at,disabled_at,avatar_url,profile_picture_updated_at';
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
    res.json(data.map(u=>({...u,unfinished_assignments:work.filter(w=>w.delivery_personnel_id===u.id)})));
  });
  app.post('/api/accounts/:id/transition', verifyToken, async (req, res) => {
    if (req.user.userId !== TRUSTED_DISTRIBUTOR || req.user.role !== 'distributor') return res.status(403).json({ error: 'Distributor access required.' });
    if (!Number.isInteger(req.body.version)) return res.status(400).json({ error: 'Refresh the account and try again.' });
    const { data, error } = await db.rpc('vt_admin_transition', { p_actor:req.authUser.id,p_session:req.sessionId,p_target:req.params.id,p_action:req.body.action,p_reason:req.body.reason || null,p_version:req.body.version });
    if (error) return res.status(409).json({ error: 'The action was rejected. Check the reason and refresh the account status.' });
    res.json(data);
  });
  app.get('/api/accounts/:id/audit', verifyToken, async (req, res) => {
    if (req.user.userId !== TRUSTED_DISTRIBUTOR || req.user.role !== 'distributor') return res.status(403).json({ error: 'Distributor access required.' });
    const { data, error } = await db.from('account_audit').select('*').eq('target_id',req.params.id).order('created_at',{ascending:false}).limit(100);
    if (error) return res.status(503).json({ error: 'Audit history unavailable.' });
    res.json(data);
  });
}
module.exports = { mountAccountRoutes };
