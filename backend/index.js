const { validateOrderItems } = require('./lib/orderRules');
const { validateAvatarUrl, validateBatchPhotoUrl } = require('./lib/avatar');
const { validateSchedule, validateProof, validatePickupProof, proofImageUrl, ensureProofImage } = require('./lib/deliveryProof');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { verifyToken, configureAuth } = require('./lib/auth');
const { createSmsHook } = require('./lib/smsHook');
const { mountAccountRoutes } = require('./lib/accountRoutes');
const { isVegetable, VEGETABLE_VALIDATION_MESSAGE } = require('./lib/vegetables');
const { coordinate, destinationFor, loadDestination, createTrackingHandler, missingColumn } = require('./lib/deliveryTracking');
const { createPickupTrackingHandler } = require('./lib/pickupTracking');
const { STALE_LOCATION_SECONDS } = require('./lib/locationPolicy');
const { sendDbError } = require('./lib/errors');
const { isPositiveQuantity, isNonNegativeQuantity } = require('./lib/validation');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Allow the Expo web app (localhost:8081 / :19006) to call this API from the
// browser. Without this, the browser blocks the preflight OPTIONS request and
// the fetch fails silently — even though curl works fine.
app.use(cors());
// The mobile client deliberately owns its offline cache. Dynamic API reads
// must therefore reach Supabase instead of being replayed by a browser/proxy.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') res.set('Cache-Control', 'no-store, max-age=0');
  next();
});
// Raw body is required for Standard Webhooks signature verification.
app.post('/api/hooks/send-sms', express.raw({ type: 'application/json', limit: '32kb' }), createSmsHook());
app.use(express.json());

// Admin Supabase client (service_role) – bypasses RLS for authenticated API calls
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
configureAuth(supabaseAdmin);
mountAccountRoutes(app, supabaseAdmin);

// A schedule is a commitment only until delivery begins.  Check it on every
// order read/write so an expired pending assignment cannot stay actionable
// while the retailer app is closed.  In-transit and terminal orders are never
// touched here.
async function cancelExpiredRetailerOrders(retailerId = null) {
  let query = supabaseAdmin.from('orders').update({ status: 'cancelled' })
    .in('status', ['pending', 'approved', 'assigned'])
    .lt('preferred_schedule', new Date().toISOString());
  if (retailerId) query = query.eq('retailer_id', retailerId);
  const { error } = await query;
  if (error) console.error('Could not expire overdue orders:', error.message);
}


// ========== HELPER: CREATE NOTIFICATION ==========
async function createNotification(userId, title, message, type = 'info', itemId = null) {
  const insertData = {
    user_id: userId,
    title,
    message,
    type
  };
  if (itemId) {
    insertData.item_id = itemId;
  }
  await supabaseAdmin.from('notifications').insert(insertData);
}

// Authentication is paused until Supabase Auth is connected.
// Keep every business route protected; never accept legacy application tokens.
app.use('/api/auth', (req, res) => res.status(410).json({ error: 'Use Supabase Auth for authentication.' }));

// ========== FARMER HARVEST ROUTES ==========
app.post('/api/harvests', verifyToken, async (req, res) => {
  const { vegetable_name, quantity_kg, status, harvest_date, image_url, client_request_id } = req.body;
  const farmerId = req.user.userId;
  const role = req.user.role;

  if (role !== 'farmer') {
    return res.status(403).json({ error: 'Only farmers can add harvests' });
  }
  if (!vegetable_name || quantity_kg === undefined || quantity_kg === null) {
    return res.status(400).json({ error: 'Vegetable name and quantity required' });
  }
  if (!isPositiveQuantity(quantity_kg)) {
    return res.status(400).json({ error: 'Quantity must be a positive number in kg.' });
  }
  if (!isVegetable(vegetable_name)) {
    return res.status(400).json({ error: VEGETABLE_VALIDATION_MESSAGE });
  }

  // Idempotency: a queued offline "add" that actually reached the server but
  // whose response was lost (timeout, dropped connection) must not create a
  // second harvest when the client retries the same queued mutation.
  if (client_request_id) {
    const { data: existing, error: dupeError } = await supabaseAdmin
      .from('harvests')
      .select('*')
      .eq('farmer_id', farmerId)
      .eq('client_request_id', client_request_id)
      .maybeSingle();
    if (dupeError) return sendDbError(res, dupeError);
    if (existing) return res.status(200).json({ message: 'Harvest recorded', harvest: existing });
  }

  // The harvest date (recorded_at) is set once, here, by the farmer — never
  // re-entered anywhere downstream (pickup, stocks, listing, order, report).
  const insertPayload = {
    farmer_id: farmerId,
    vegetable_name,
    quantity_kg,
    status: status || 'available',
    client_request_id: client_request_id || null,
  };
  if (image_url) insertPayload.image_url = image_url;
  if (harvest_date) {
    const parsed = new Date(harvest_date);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'Invalid harvest_date' });
    }
    insertPayload.recorded_at = parsed;
  }

  const { data, error } = await supabaseAdmin
    .from('harvests')
    .insert(insertPayload)
    .select()
    .single();

  if (error) {
    // A concurrent retry of the same queued mutation can race past the check
    // above; the unique index is the actual guarantee — fall back to it.
    if (error.code === '23505' && client_request_id) {
      const { data: existing } = await supabaseAdmin.from('harvests').select('*')
        .eq('farmer_id', farmerId).eq('client_request_id', client_request_id).maybeSingle();
      if (existing) return res.status(200).json({ message: 'Harvest recorded', harvest: existing });
    }
    return sendDbError(res, error);
  }
  res.status(201).json({ message: 'Harvest recorded', harvest: data });
});

app.get('/api/harvests', verifyToken, async (req, res) => {
  if (req.user.role !== 'farmer') {
    return res.status(403).json({ error: 'Only farmers can access harvests' });
  }
  const { data, error } = await supabaseAdmin
    .from('harvests')
    .select('*')
    .eq('farmer_id', req.user.userId)
    .order('recorded_at', { ascending: false });

  if (error) return sendDbError(res, error);
  res.json(data);
});

app.get('/api/harvests/weekly-report', verifyToken, async (req, res) => {
  if (req.user.role !== 'farmer') {
    return res.status(403).json({ error: 'Only farmers can access weekly report' });
  }
  const fullRange = req.query.range === 'all';
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  let query = supabaseAdmin
    .from('harvests')
    .select('id, vegetable_name, quantity_kg, status, recorded_at')
    .eq('farmer_id', req.user.userId);
  if (!fullRange) query = query.gte('recorded_at', oneWeekAgo.toISOString());
  const { data, error } = await query;

  if (error) return sendDbError(res, error);

  const summary = {};
  data.forEach(item => {
    if (!summary[item.vegetable_name]) {
      summary[item.vegetable_name] = { total_kg: 0, count: 0 };
    }
    summary[item.vegetable_name].total_kg += item.quantity_kg;
    summary[item.vegetable_name].count += 1;
  });

  // Attach each harvest's pickup date/status/rider (if a pickup request
  // exists for it yet) so the report can show the full harvest -> pickup
  // timeline, including who collected it and which distributor received it.
  const harvestIds = data.map((h) => h.id);
  let pickupByHarvestId = {};
  if (harvestIds.length) {
    const { data: pickups } = await supabaseAdmin
      .from('pickup_requests')
      .select('harvest_id, status, received_at, delivery_personnel_id, received_by')
      .in('harvest_id', harvestIds);
    (pickups || []).forEach((p) => { pickupByHarvestId[p.harvest_id] = p; });
  }

  // Batch-resolve rider/distributor names for every pickup attached above.
  const peopleIds = [...new Set(
    Object.values(pickupByHarvestId).flatMap((p) => [p.delivery_personnel_id, p.received_by]).filter(Boolean)
  )];
  let peopleNameById = {};
  if (peopleIds.length) {
    const { data: people } = await supabaseAdmin.from('users').select('id, full_name').in('id', peopleIds);
    peopleNameById = Object.fromEntries((people || []).map((p) => [p.id, p.full_name]));
  }

  const details = data.map((h) => {
    const pickup = pickupByHarvestId[h.id];
    let status = 'Awaiting Pickup';
    if (pickup?.status === 'picked_up') status = 'Picked Up';
    else if (pickup?.status === 'assigned') status = 'Pickup Scheduled';
    else if (pickup?.status === 'requested') status = 'Pickup Requested';
    return {
      harvest_date: h.recorded_at,
      pickup_date: pickup?.received_at || null,
      vegetable_name: h.vegetable_name,
      quantity_kg: h.quantity_kg,
      status,
      rider_name: pickup?.delivery_personnel_id ? (peopleNameById[pickup.delivery_personnel_id] || null) : null,
      distributor_name: pickup?.received_by ? (peopleNameById[pickup.received_by] || null) : null,
    };
  });

  res.json({
    period: fullRange ? 'all time' : 'last 7 days',
    total_harvests: data.length,
    summary,
    details
  });
});

// Update one of the farmer's own harvests (vegetable_name, quantity_kg, status).
app.put('/api/harvests/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { vegetable_name, quantity_kg, status, image_url } = req.body;
  const farmerId = req.user.userId;

  if (req.user.role !== 'farmer') {
    return res.status(403).json({ error: 'Only farmers can update harvests' });
  }

  // Ownership check: the harvest must belong to this farmer.
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('harvests')
    .select('id, status')
    .eq('id', id)
    .eq('farmer_id', farmerId)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Harvest not found or not owned by you' });
  }
  if (vegetable_name !== undefined && !isVegetable(vegetable_name)) {
    return res.status(400).json({ error: VEGETABLE_VALIDATION_MESSAGE });
  }
  if (quantity_kg !== undefined && !isPositiveQuantity(quantity_kg)) {
    return res.status(400).json({ error: 'Quantity must be a positive number in kg.' });
  }

  // Once a pickup has been requested for this harvest (status 'for_pickup')
  // or it has actually been picked up ('picked_up'), its identity (name/qty)
  // is locked — a distributor is already reviewing or has already received
  // it. Editing is only allowed while still 'available'/'reserved'.
  if ((vegetable_name !== undefined || quantity_kg !== undefined) && ['for_pickup', 'picked_up'].includes(existing.status)) {
    return res.status(400).json({ error: 'This harvest is pending pickup or has already been picked up and can no longer be edited' });
  }

  const updates = {};
  if (vegetable_name !== undefined) updates.vegetable_name = vegetable_name;
  if (quantity_kg !== undefined) updates.quantity_kg = quantity_kg;
  if (status !== undefined) updates.status = status;
  if (image_url !== undefined) updates.image_url = image_url;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const { data, error } = await supabaseAdmin
    .from('harvests')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return sendDbError(res, error);
  res.json({ message: 'Harvest updated', harvest: data });
});

// Delete one of the farmer's own harvests.
app.delete('/api/harvests/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const farmerId = req.user.userId;

  if (req.user.role !== 'farmer') {
    return res.status(403).json({ error: 'Only farmers can delete harvests' });
  }

  // Ownership check: the harvest must belong to this farmer.
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('harvests')
    .select('id, status')
    .eq('id', id)
    .eq('farmer_id', farmerId)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Harvest not found or not owned by you' });
  }

  if (['for_pickup', 'picked_up'].includes(existing.status)) {
    return res.status(400).json({ error: 'This harvest is pending pickup or has already been picked up and can no longer be deleted' });
  }

  const { error } = await supabaseAdmin
    .from('harvests')
    .delete()
    .eq('id', id);

  if (error) return sendDbError(res, error);
  res.json({ message: 'Harvest deleted' });
});

// ========== PICKUP REQUESTS (Farmer -> Distributors) ==========
app.post('/api/pickup-requests', verifyToken, async (req, res) => {
  if (req.user.role !== 'farmer') {
    return res.status(403).json({ error: 'Only farmers can request pickups' });
  }
  const { harvest_id, note } = req.body || {};
  if (harvest_id) {
    const { data: ownedHarvest, error: ownershipError } = await supabaseAdmin.from('harvests')
      .select('id, status').eq('id', harvest_id).eq('farmer_id', req.user.userId).maybeSingle();
    if (ownershipError) return sendDbError(res, ownershipError);
    if (!ownedHarvest) return res.status(404).json({ error: 'Harvest not found or not owned by you' });
    if (ownedHarvest.status !== 'available') {
      return res.status(409).json({ error: 'A pickup has already been requested for this harvest.' });
    }
    // Atomically flip available -> for_pickup: the WHERE clause is the guard
    // against a double-tap or a retried request racing this exact check —
    // only one concurrent caller can ever win the conditional update.
    const { data: locked, error: lockError } = await supabaseAdmin.from('harvests')
      .update({ status: 'for_pickup' })
      .eq('id', harvest_id).eq('status', 'available')
      .select('id').maybeSingle();
    if (lockError) return sendDbError(res, lockError);
    if (!locked) return res.status(409).json({ error: 'A pickup has already been requested for this harvest.' });
  }

  const { data: request, error } = await supabaseAdmin
    .from('pickup_requests')
    .insert({
      farmer_id: req.user.userId,
      harvest_id: harvest_id || null,
      note: note || null,
      status: 'requested',
    })
    .select()
    .single();

  if (error) {
    // The harvest was already flipped to for_pickup above; if the pickup
    // request itself could not be created, that lock must not be left behind.
    if (harvest_id) await supabaseAdmin.from('harvests').update({ status: 'available' }).eq('id', harvest_id);
    return sendDbError(res, error);
  }

  // Build a label for the notification.
  let label = 'available harvests';
  if (harvest_id) {
    const { data: h } = await supabaseAdmin
      .from('harvests')
      .select('vegetable_name, quantity_kg')
      .eq('id', harvest_id)
      .single();
    if (h) label = `${h.vegetable_name} (${h.quantity_kg}kg)`;
  }

  const { data: farmer } = await supabaseAdmin
    .from('users').select('full_name').eq('id', req.user.userId).single();

  // Notify every distributor of the new pickup request.
  const { data: distributors } = await supabaseAdmin
    .from('users').select('id').eq('role', 'distributor');
  for (const d of (distributors || [])) {
    await createNotification(
      d.id,
      'Pickup Requested',
      `${farmer?.full_name || 'A farmer'} requested a pickup for ${label}.`,
      'pickup',
      request.id
    );
  }

  res.status(201).json({ message: 'Pickup requested', request });
});

app.get('/api/pickup-requests', verifyToken, async (req, res) => {
  const role = req.user.role;

  // Farmer: only their own requests.
  if (role === 'farmer') {
    const { data, error } = await supabaseAdmin
      .from('pickup_requests')
      .select('id, farmer_id, harvest_id, note, status, requested_at, delivery_personnel_id, received_by, received_at, proof_photo_url, pod, harvests (vegetable_name, quantity_kg)')
      .eq('farmer_id', req.user.userId)
      .order('requested_at', { ascending: false });
    if (error) return sendDbError(res, error);
    const participantIds = [...new Set((data || []).flatMap((p) => [p.delivery_personnel_id, p.received_by]).filter(Boolean))];
    let peopleById = {};
    if (participantIds.length) {
      const { data: people } = await supabaseAdmin.from('users')
        .select('id, full_name, phone').in('id', participantIds);
      peopleById = Object.fromEntries((people || []).map((person) => [person.id, person]));
    }
    const { data: farmerProfile } = await supabaseAdmin.from('users')
      .select('farm_location, latitude, longitude').eq('id', req.user.userId).maybeSingle();
    return res.json((data || []).map((pickup) => ({
      ...pickup,
      rider: pickup.delivery_personnel_id ? peopleById[pickup.delivery_personnel_id] || null : null,
      distributor: pickup.received_by ? peopleById[pickup.received_by] || null : null,
      // The farmer profile is the source of truth for this pickup location.
      pickup_location: { address: farmerProfile?.farm_location || null, latitude: farmerProfile?.latitude || null, longitude: farmerProfile?.longitude || null },
    })));
  }

  // Distributor sees ALL requests. Farmer names are attached.
  if (role === 'distributor') {
    const { data, error } = await supabaseAdmin
      .from('pickup_requests')
      .select('id, farmer_id, harvest_id, note, status, requested_at, harvests (vegetable_name, quantity_kg)')
      .order('requested_at', { ascending: false });
    if (error) return sendDbError(res, error);

    const farmerIds = [...new Set((data || []).map((r) => r.farmer_id).filter(Boolean))];
    let nameById = {};
    let avatarById = {};
    if (farmerIds.length) {
      const { data: farmers } = await supabaseAdmin
        .from('users').select('id, full_name, avatar_url').in('id', farmerIds);
      avatarById = Object.fromEntries((farmers || []).map((f) => [f.id, f.avatar_url]));
      nameById = Object.fromEntries((farmers || []).map((f) => [f.id, f.full_name]));
    }
    const list = (data || []).map((r) => ({
      ...r,
      farmer_name: nameById[r.farmer_id] || null,
      farmer_avatar_url: avatarById[r.farmer_id] || null,
      created_at: r.requested_at,
    }));
    return res.json(list);
  }

  // Delivery personnel (rider): only requests assigned to them.
  if (role === 'delivery_personnel') {
    const { data, error } = await supabaseAdmin
      .from('pickup_requests')
      .select('id, farmer_id, harvest_id, note, status, requested_at, harvests (vegetable_name, quantity_kg)')
      .eq('delivery_personnel_id', req.user.userId)
      .order('requested_at', { ascending: false });
    if (error) return sendDbError(res, error);

    const farmerIds = [...new Set((data || []).map((r) => r.farmer_id).filter(Boolean))];
    let nameById = {};
    let coordsById = {};
    let addressById = {};
    if (farmerIds.length) {
      const { data: farmers } = await supabaseAdmin
        .from('users').select('id, full_name, farm_location, latitude, longitude').in('id', farmerIds);
      nameById = Object.fromEntries((farmers || []).map((f) => [f.id, f.full_name]));
      coordsById = Object.fromEntries((farmers || []).map((f) => [f.id, { latitude: f.latitude, longitude: f.longitude }]));
      addressById = Object.fromEntries((farmers || []).map((f) => [f.id, f.farm_location]));
    }
    const list = (data || []).map((r) => ({
      ...r,
      farmer_name: nameById[r.farmer_id] || null,
      farmer_coords: coordsById[r.farmer_id] || null,
      farmer_address: addressById[r.farmer_id] || null,
      created_at: r.requested_at,
    }));
    return res.json(list);
  }

  return res.status(403).json({ error: 'Not allowed' });
});

app.put('/api/pickup-requests/:id/assign', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can assign riders to pickup requests' });
  }
  const { id } = req.params;
  const { delivery_personnel_id, price_per_kg } = req.body;

  if (!delivery_personnel_id) {
    return res.status(400).json({ error: 'delivery_personnel_id is required' });
  }

  const { data: request, error: fetchErr } = await supabaseAdmin
    .from('pickup_requests')
    .select('id, status, farmer_id, harvest_id')
    .eq('id', id)
    .single();

  if (fetchErr || !request) return res.status(404).json({ error: 'Pickup request not found' });
  if (request.status !== 'requested') {
    return res.status(400).json({ error: `Pickup request is already ${request.status}` });
  }

  // Atomic guard: a double-tap or retried assignment call can only ever win
  // this conditional update once — the WHERE clause re-checks 'requested' at
  // the moment of the write, not just at the read above, so two concurrent
  // assign calls can never both succeed and create conflicting assignments.
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('pickup_requests')
    .update({
      status: 'assigned',
      delivery_personnel_id,
      amount: price_per_kg ? Number(price_per_kg) : null,
      received_by: req.user.userId
    })
    .eq('id', id)
    .eq('status', 'requested')
    .select()
    .maybeSingle();

  if (updErr) return sendDbError(res, updErr);
  if (!updated) {
    return res.status(409).json({ error: 'This pickup request has already been assigned.' });
  }

  await createNotification(
    request.farmer_id,
    'Pickup Assigned',
    `A rider has been assigned to collect your vegetables.`,
    'pickup',
    id
  );

  await createNotification(
    delivery_personnel_id,
    'New Pickup Assignment',
    `You have been assigned to collect vegetables from a farmer.`,
    'pickup',
    id
  );

  res.json({ message: 'Rider assigned to pickup request', request: updated });
});

app.post('/api/pickup-requests/:id/pickup', verifyToken, async (req, res) => {
  if (req.user.role !== 'delivery_personnel') {
    return res.status(403).json({ error: 'Only riders can mark pickups as completed' });
  }
  const { id } = req.params;
  const { proof_photo_url } = req.body || {};

  const { data: request, error: fetchErr } = await supabaseAdmin
    .from('pickup_requests')
    .select(`
      id, status, farmer_id, harvest_id, amount, received_by, pod,
      harvests (vegetable_name, quantity_kg, recorded_at)
    `)
    .eq('id', id)
    .eq('delivery_personnel_id', req.user.userId)
    .single();

  if (fetchErr || !request) return res.status(404).json({ error: 'Pickup request not found' });
  if (request.status === 'picked_up') return res.json({ message: 'Pickup already completed', request, pod: request.pod });
  // Completion is allowed directly from 'assigned' as well as after the rider
  // has marked 'otw' — the on-the-way step is informational for the farmer,
  // not a mandatory gate the rider must pass through first.
  if (!['assigned', 'otw'].includes(request.status)) {
    return res.status(400).json({ error: `Pickup request cannot be picked up (status: ${request.status})` });
  }

  // Same proof-of-pickup requirement as delivery: GPS + photo + timestamp are
  // mandatory and validated before anything is persisted (see
  // complete_pickup_with_proof, which also checks proximity to the farmer's
  // saved location when one exists).
  let pod, photoUrl;
  try { pod = validatePickupProof(req.body); photoUrl = proofImageUrl(proof_photo_url, pod, undefined, 'Pickup'); }
  catch (err) { return res.status(422).json({ error: err.message, code: err.code || 'PROOF_IMAGE_INVALID' }); }
  try { await ensureProofImage(photoUrl); }
  catch { return res.status(503).json({ error: 'Proof was uploaded, but the pickup could not be completed. Please try again.', code: 'PROOF_IMAGE_UNAVAILABLE' }); }

  const { data: completedPod, error: completeError } = await supabaseAdmin.rpc('complete_pickup_with_proof', {
    p_pickup_id: id, p_rider_id: req.user.userId, p_photo_url: photoUrl, p_pod: pod,
  });
  if (completeError) return res.status(completeError.code === '22023' ? 422 : 500).json({ error: completeError.code === '22023' ? completeError.message : 'Could not save pickup proof. Retry; contact the administrator if this continues.' });

  const updated = { ...request, status: 'picked_up', proof_photo_url: photoUrl, pod: completedPod };

  if (request.harvest_id) {
    await supabaseAdmin
      .from('harvests')
      .update({ status: 'picked_up' })
      .eq('id', request.harvest_id);
  }

  const harvest = request.harvests;
  const qty = Number(harvest?.quantity_kg || 0);
  const vegName = harvest?.vegetable_name;

  let batchError = null;
  if (vegName && qty > 0) {
    const harvestDate = harvest.recorded_at || new Date();

    // This is the ONE place a batch is created. It lands in Stocks as
    // 'received' — not sellable yet — with the harvest date/id carried over
    // untouched. Price is intentionally left null until the distributor adds
    // it to the product list (see PUT /api/products/:id/list).
    const { error } = await supabaseAdmin.from('products').insert({
      distributor_id: request.received_by,
      vegetable_name: vegName,
      price_per_kg: null,
      stock_kg: qty,
      quantity_received: qty,
      harvest_date: harvestDate,
      harvest_id: request.harvest_id || null,
      pickup_request_id: id,
      farmer_id: request.farmer_id,
      status: 'received'
    });
    if (error) {
      // Never fail silently: the pickup itself already succeeded (farmer's
      // harvest is physically collected), but if this insert errors — e.g.
      // the FIFO migration hasn't been run yet, so these columns don't exist
      // — the batch never reaches Stocks with no trace of why. Surface it.
      console.error(`[pickup-complete] failed to create batch for pickup ${id}:`, error.message);
      batchError = error.message;
    }
  }

  await createNotification(
    request.farmer_id,
    'Vegetables Picked Up',
    `Your vegetables have been picked up by the rider.`,
    'pickup',
    id
  );

  await createNotification(
    request.received_by,
    'Pickup Collected',
    `The rider has picked up the vegetables from the farmer.`,
    'pickup',
    id
  );

  res.json({
    message: batchError
      ? 'Pickup marked complete, but the batch could not be added to Stocks — contact support'
      : 'Pickup completed successfully and inventory updated',
    request: updated,
    ...(batchError ? { batch_error: batchError } : {})
  });
});

// Rider marks "on the way" between being assigned and actually arriving to
// collect the harvest — the pickup equivalent of delivery's assigned -> picked_up
// -> in_transit granularity (PUT /api/deliveries/:id/status), so the farmer's
// tracking screen can show a distinct in-between state instead of jumping
// straight from "Rider Assigned" to "Picked Up".
app.put('/api/pickup-requests/:id/status', verifyToken, async (req, res) => {
  if (req.user.role !== 'delivery_personnel') {
    return res.status(403).json({ error: 'Only riders can update pickup status' });
  }
  const { id } = req.params;
  const { status } = req.body || {};
  if (status !== 'otw') {
    return res.status(400).json({ error: "status must be 'otw'" });
  }
  const { data: pickup, error: fetchErr } = await supabaseAdmin
    .from('pickup_requests')
    .select('id, status, farmer_id')
    .eq('id', id)
    .eq('delivery_personnel_id', req.user.userId)
    .single();
  if (fetchErr || !pickup) return res.status(404).json({ error: 'Pickup request not found or not assigned to you' });
  if (pickup.status === 'otw') return res.json({ message: 'Pickup marked on the way' });
  if (pickup.status !== 'assigned') {
    return res.status(400).json({ error: `Pickup request cannot be marked on the way (status: ${pickup.status})` });
  }
  const { data: updated, error: updErr } = await supabaseAdmin
    .from('pickup_requests')
    .update({ status: 'otw' })
    .eq('id', id)
    .eq('status', 'assigned')
    .select()
    .maybeSingle();
  if (updErr) return sendDbError(res, updErr);
  if (!updated) return res.status(409).json({ error: 'Pickup status was already updated. Refresh and retry.' });
  await createNotification(pickup.farmer_id, 'Rider On The Way', 'Your rider is on the way to collect your vegetables.', 'pickup', id);
  res.json({ message: 'Pickup marked on the way', request: updated });
});

// Farmer/distributor/assigned-rider pickup tracking — same map-ready JSON
// contract as GET /api/delivery/tracking/:orderId (see lib/pickupTracking.js).
app.get('/api/pickup-requests/:id/tracking', verifyToken, createPickupTrackingHandler({ db: supabaseAdmin }));

// B5: DISABLED — this debug route let any authenticated user enumerate every
// user's phone number (a privacy leak). Removed from the API surface. If you
// ever need an admin-only user list, gate it behind a real admin role check.
// app.get('/api/users', verifyToken, async (req, res) => {
//   const { data, error } = await supabasePublic.from('users').select('id, full_name, phone, role');
//   if (error) return sendDbError(res, error);
//   res.json(data);
// });

app.get('/', (req, res) => {
  res.json({ message: 'VeggieTrack API is running!' });
});

// ========== DISTRIBUTOR INVENTORY ROUTES ==========
// `products` doubles as the batch/lot table: every row is one pickup's worth
// of stock (status: received -> listed -> sold_out). This legacy freeform
// creation route is kept for backward compatibility but is no longer called
// by the distributor UI — every batch must now originate from a completed
// pickup (see POST /api/pickup-requests/:id/pickup) so harvest_date/farmer
// traceability is never lost.
app.post('/api/products', verifyToken, async (req, res) => {
  const { vegetable_name, price_per_kg, stock_kg, batch_photo_url } = req.body;
  const distributorId = req.user.userId;
  const role = req.user.role;

  if (role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can add products' });
  }
  if (!vegetable_name || price_per_kg === undefined || stock_kg === undefined) {
    return res.status(400).json({ error: 'Vegetable name, price, and stock are required' });
  }
  if (!isVegetable(vegetable_name)) {
    return res.status(400).json({ error: VEGETABLE_VALIDATION_MESSAGE });
  }
  if (!isPositiveQuantity(price_per_kg)) {
    return res.status(400).json({ error: 'Price must be a positive number.' });
  }
  if (!isPositiveQuantity(stock_kg)) {
    return res.status(400).json({ error: 'Stock must be a positive number in kg.' });
  }
  let batchPhotoUrl;
  try { batchPhotoUrl = validateBatchPhotoUrl(batch_photo_url); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }

  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      distributor_id: distributorId,
      vegetable_name,
      price_per_kg,
      stock_kg,
      batch_photo_url: batchPhotoUrl,
      quantity_received: stock_kg,
      status: 'listed'
    })
    .select()
    .single();

  if (error) return sendDbError(res, error);
  res.status(201).json({ message: 'Product added', product: data });
});

// STOCKS: every batch the distributor has received, oldest harvest first.
// Farmer name + pickup date are attached with separate lookups (not an
// embedded PostgREST join) — same resilience reasoning as GET /api/orders:
// a missing/renamed relationship must never blank out the whole list.
app.get('/api/products', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view their products' });
  }
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('distributor_id', req.user.userId)
    .order('harvest_date', { ascending: true });

  if (error) return sendDbError(res, error);

  const farmerIds = [...new Set((data || []).map((p) => p.farmer_id).filter(Boolean))];
  const pickupIds = [...new Set((data || []).map((p) => p.pickup_request_id).filter(Boolean))];

  const [{ data: farmers }, { data: pickups }] = await Promise.all([
    farmerIds.length
      ? supabaseAdmin.from('users').select('id, full_name').in('id', farmerIds)
      : Promise.resolve({ data: [] }),
    pickupIds.length
      ? supabaseAdmin.from('pickup_requests').select('id, received_at').in('id', pickupIds)
      : Promise.resolve({ data: [] }),
  ]);

  const farmerNameById = Object.fromEntries((farmers || []).map((f) => [f.id, f.full_name]));
  const pickupDateById = Object.fromEntries((pickups || []).map((p) => [p.id, p.received_at]));

  const list = (data || []).map((p) => ({
    ...p,
    farmer_name: farmerNameById[p.farmer_id] || null,
    pickup_date: pickupDateById[p.pickup_request_id] || null,
  }));
  res.json(list);
});

// "Add to Product List" — the only way a received batch becomes sellable.
// Batches of the same vegetable share one price: if the vegetable already
// has other listed/sold_out batches, their price wins over whatever the
// distributor sent, so the price never diverges batch-to-batch.
app.put('/api/products/:id/list', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { price_per_kg } = req.body;
  const distributorId = req.user.userId;

  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can list products' });
  }

  const { data: batch, error: fetchError } = await supabaseAdmin
    .from('products')
    .select('id, vegetable_name, status, batch_photo_url')
    .eq('id', id)
    .eq('distributor_id', distributorId)
    .single();

  if (fetchError || !batch) {
    return res.status(404).json({ error: 'Batch not found or not owned by you' });
  }
  // Treat anything not already listed/sold_out as listable — covers both the
  // normal 'received' state and legacy rows from before batch statuses existed.
  if (batch.status === 'listed' || batch.status === 'sold_out') {
    return res.status(400).json({ error: `Batch is already ${batch.status}` });
  }
  if (!batch.batch_photo_url) {
    return res.status(400).json({ error: 'Upload a recent batch photo in Edit before adding this batch to the product list.' });
  }

  const { data: sibling } = await supabaseAdmin
    .from('products')
    .select('price_per_kg')
    .eq('distributor_id', distributorId)
    .eq('vegetable_name', batch.vegetable_name)
    .in('status', ['listed', 'sold_out'])
    .limit(1)
    .maybeSingle();

  const resolvedPrice = sibling ? sibling.price_per_kg : Number(price_per_kg);
  if (!sibling && !isPositiveQuantity(price_per_kg)) {
    return res.status(400).json({ error: 'A valid positive price_per_kg is required for the first batch of a vegetable' });
  }

  const { data, error } = await supabaseAdmin
    .from('products')
    .update({ status: 'listed', price_per_kg: resolvedPrice, updated_at: new Date() })
    .eq('id', id)
    .select()
    .single();

  if (error) return sendDbError(res, error);
  res.json({ message: 'Added to product list', product: data });
});

// The received-batch photo belongs to one product row (one FIFO lot).  It is
// deliberately not cascaded to similarly named batches.
app.put('/api/products/:id/batch-photo', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can update batch photos' });
  }
  let batchPhotoUrl;
  try { batchPhotoUrl = validateBatchPhotoUrl(req.body?.batch_photo_url); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }

  const { data, error } = await supabaseAdmin
    .from('products')
    .update({ batch_photo_url: batchPhotoUrl, updated_at: new Date() })
    .eq('id', req.params.id)
    .eq('distributor_id', req.user.userId)
    .select()
    .single();
  if (error || !data) return res.status(error ? 500 : 404).json({ error: error ? error.message : 'Batch not found or not owned by you' });
  res.json({ message: 'Recent batch photo saved', product: data });
});

// A received batch may have its staged photo removed and replaced. Listed
// batches retain one so the retailer menu never loses its actual product photo.
app.delete('/api/products/:id/batch-photo', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can remove batch photos' });
  }
  const { data: batch, error: fetchError } = await supabaseAdmin
    .from('products')
    .select('id, status')
    .eq('id', req.params.id)
    .eq('distributor_id', req.user.userId)
    .single();
  if (fetchError || !batch) return res.status(404).json({ error: 'Batch not found or not owned by you' });
  if (batch.status === 'listed' || batch.status === 'sold_out') {
    return res.status(400).json({ error: 'Listed batches must retain a recent batch photo. Unlist the product before removing it.' });
  }
  const { data, error } = await supabaseAdmin
    .from('products')
    .update({ batch_photo_url: null, updated_at: new Date() })
    .eq('id', batch.id)
    .select()
    .single();
  if (error) return sendDbError(res, error);
  res.json({ message: 'Recent batch photo removed', product: data });
});

// Price edits from the Product List screen. Stock is intentionally not
// editable here anymore — it only ever changes via pickups, orders, and
// order cancellations, never a manual override.
app.put('/api/products/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { price_per_kg } = req.body;
  const distributorId = req.user.userId;
  const role = req.user.role;

  if (role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can update products' });
  }

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('products')
    .select('id, vegetable_name')
    .eq('id', id)
    .eq('distributor_id', distributorId)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Product not found or not owned by you' });
  }

  if (price_per_kg === undefined) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  if (!isPositiveQuantity(price_per_kg)) {
    return res.status(400).json({ error: 'Price must be a positive number.' });
  }

  // Cascade to every batch of this vegetable so the shared price stays in sync.
  const { data, error } = await supabaseAdmin
    .from('products')
    .update({ price_per_kg, updated_at: new Date() })
    .eq('distributor_id', distributorId)
    .eq('vegetable_name', existing.vegetable_name)
    .in('status', ['listed', 'sold_out'])
    .select();

  if (error) return sendDbError(res, error);
  res.json({ message: 'Product updated', products: data });
});

// "Remove Product" from the distributor's live Product List — a soft
// delist, not a destructive delete: every listed/sold_out batch of this
// vegetable reverts to 'received' so FIFO/order history stays intact, and
// the vegetable simply reappears in Stocks ready to be re-added later.
app.put('/api/products/:id/unlist', verifyToken, async (req, res) => {
  const { id } = req.params;
  const distributorId = req.user.userId;

  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can remove products' });
  }

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('products')
    .select('id, vegetable_name')
    .eq('id', id)
    .eq('distributor_id', distributorId)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Product not found or not owned by you' });
  }

  const { data, error } = await supabaseAdmin
    .from('products')
    .update({ status: 'received', updated_at: new Date() })
    .eq('distributor_id', distributorId)
    .eq('vegetable_name', existing.vegetable_name)
    .in('status', ['listed', 'sold_out'])
    .select();

  if (error) return sendDbError(res, error);
  res.json({ message: 'Product removed from list', products: data });
});

// "Edit Quantity" from the Product List — corrects the total available kg
// downward only (spoilage, miscount), never up (new stock only ever comes
// from a harvest pickup). Deducts oldest-batch-first, mirroring the FIFO
// draw used at order time (POST /api/orders).
app.put('/api/products/:id/reduce-quantity', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { new_total_kg } = req.body;
  const distributorId = req.user.userId;

  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can update products' });
  }

  if (!isNonNegativeQuantity(new_total_kg)) {
    return res.status(400).json({ error: 'A valid new_total_kg is required' });
  }
  const newTotal = Number(new_total_kg);

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('products')
    .select('id, vegetable_name')
    .eq('id', id)
    .eq('distributor_id', distributorId)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Product not found or not owned by you' });
  }

  const { data: batches, error: batchError } = await supabaseAdmin
    .from('products')
    .select('id, stock_kg')
    .eq('distributor_id', distributorId)
    .eq('vegetable_name', existing.vegetable_name)
    .eq('status', 'listed')
    .gt('stock_kg', 0)
    .order('harvest_date', { ascending: true });

  if (batchError) return sendDbError(res, batchError);

  const currentTotal = (batches || []).reduce((sum, b) => sum + Number(b.stock_kg), 0);
  if (newTotal >= currentTotal) {
    return res.status(400).json({ error: 'New quantity must be less than the current available quantity' });
  }

  let remaining = currentTotal - newTotal;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const drawFromBatch = Math.min(remaining, Number(batch.stock_kg));
    const newStock = Number(batch.stock_kg) - drawFromBatch;
    const { error: updateError } = await supabaseAdmin
      .from('products')
      .update({ stock_kg: newStock, status: newStock <= 0 ? 'sold_out' : 'listed', updated_at: new Date() })
      .eq('id', batch.id);
    if (updateError) return sendDbError(res, updateError);
    remaining -= drawFromBatch;
  }

  res.json({ message: 'Quantity updated' });
});

// Delete a batch that hasn't been listed yet (nothing sold from it, so
// nothing to protect). Listed/sold_out batches can't be deleted — they're
// load-bearing for FIFO history and the inventory report.
app.delete('/api/products/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const distributorId = req.user.userId;

  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can delete products' });
  }

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('products')
    .select('id, status')
    .eq('id', id)
    .eq('distributor_id', distributorId)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Product not found or not owned by you' });
  }
  if (existing.status === 'listed' || existing.status === 'sold_out') {
    return res.status(400).json({ error: 'Only un-listed batches can be deleted' });
  }

  const { error } = await supabaseAdmin
    .from('products')
    .delete()
    .eq('id', id);

  if (error) return sendDbError(res, error);
  res.json({ message: 'Product deleted' });
});

// PRODUCT LIST (distributor view): batches aggregated by vegetable — one row
// per vegetable, total remaining stock across all its listed/sold_out batches.
app.get('/api/products/listings', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view their product list' });
  }
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('id, vegetable_name, price_per_kg, stock_kg, status')
    .eq('distributor_id', req.user.userId)
    .in('status', ['listed', 'sold_out']);

  if (error) return sendDbError(res, error);

  const byVeg = {};
  (data || []).forEach((row) => {
    if (!byVeg[row.vegetable_name]) {
      // Any batch id of this vegetable works as the price-edit target — the
      // backend cascades a price change across every batch sharing the name.
      byVeg[row.vegetable_name] = { id: row.id, vegetable_name: row.vegetable_name, price_per_kg: row.price_per_kg, available_kg: 0 };
    }
    byVeg[row.vegetable_name].available_kg += Number(row.stock_kg);
  });
  const listings = Object.values(byVeg).map((v) => ({
    ...v,
    status: v.available_kg > 0 ? 'Listed' : 'Sold Out'
  }));
  res.json(listings);
});

// RETAILER-FACING: aggregated availability only — no batch id, harvest date,
// or farmer info leaks through here (see requirement: retailers never see
// internal inventory detail). FIFO batch selection happens server-side at
// order time (POST /api/orders), not here.
app.get('/api/products/available', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('vegetable_name, price_per_kg, stock_kg, batch_photo_url, harvest_date')
    .eq('status', 'listed')
    .gt('stock_kg', 0)
    .order('harvest_date', { ascending: true });

  if (error) return sendDbError(res, error);

  const byVeg = {};
  (data || []).forEach((row) => {
    if (!byVeg[row.vegetable_name]) {
      // Rows are ordered below so this is the oldest sellable (FIFO) batch.
      byVeg[row.vegetable_name] = { vegetable_name: row.vegetable_name, price_per_kg: row.price_per_kg, available_kg: 0, batch_photo_url: row.batch_photo_url };
    }
    byVeg[row.vegetable_name].available_kg += Number(row.stock_kg);
  });
  res.json(Object.values(byVeg));
});

// ========== RETAILER ORDER ROUTES ==========
app.post('/api/orders', verifyToken, async (req, res) => {
  const { delivery_address } = req.body || {};
  let items;
  const retailerId = req.user.userId;
  const role = req.user.role;

  if (role !== 'retailer') {
    return res.status(403).json({ error: 'Only retailers can place orders' });
  }
  let preferred_schedule;
  try { preferred_schedule = validateSchedule(req.body?.preferred_schedule); }
  catch (err) { return res.status(422).json({ error: err.message, field: 'preferred_schedule' }); }
  try { items = validateOrderItems(req.body?.items); }
  catch (err) { return res.status(422).json({ error: err.message, field: 'items' }); }
  if (!delivery_address) {
    return res.status(400).json({ error: 'Delivery address is required' });
  }

  try {
    // FIFO: the retailer only names a vegetable + quantity — the server picks
    // which batches to draw from, oldest harvest_date first, splitting across
    // batches only when the oldest one alone isn't enough.
    let total_amount = 0;
    const consumptions = []; // { batch, quantity_kg } — one entry per batch drawn from

    for (const item of items) {
      const { vegetable_name, quantity_kg } = item;
      if (!vegetable_name || !quantity_kg || quantity_kg <= 0) {
        throw new Error('Each item must have vegetable_name and positive quantity_kg');
      }

      const { data: batches, error: batchError } = await supabaseAdmin
        .from('products')
        .select('id, vegetable_name, price_per_kg, stock_kg, distributor_id, harvest_date')
        .eq('vegetable_name', vegetable_name)
        .eq('status', 'listed')
        .gt('stock_kg', 0)
        .order('harvest_date', { ascending: true });

      if (batchError) throw new Error(batchError.message);

      const totalAvailable = (batches || []).reduce((sum, b) => sum + Number(b.stock_kg), 0);
      if (totalAvailable < quantity_kg) {
        return res.status(409).json({ error: `There is not enough ${vegetable_name} in stock. Available: ${totalAvailable} kg.`, code: 'INSUFFICIENT_STOCK', field: 'items' });
      }

      let remaining = Number(quantity_kg);
      for (const batch of batches) {
        if (remaining <= 0) break;
        const drawFromBatch = Math.min(remaining, Number(batch.stock_kg));
        total_amount += Number(batch.price_per_kg) * drawFromBatch;
        consumptions.push({ batch, quantity_kg: drawFromBatch });
        remaining -= drawFromBatch;
      }
    }

    const distributorId = consumptions[0].batch.distributor_id;

    // Step 1: create the order first. If this fails, no stock has been touched.
    const deliveryCoords = coordinate({ latitude: req.body.delivery_latitude, longitude: req.body.delivery_longitude });
    if (!deliveryCoords) return res.status(422).json({ error: 'Your saved delivery address needs a map location. Update it in Manage Address before placing your order.', code: 'ADDRESS_LOCATION_REQUIRED', field: 'delivery_address' });
    try { preferred_schedule = validateSchedule(preferred_schedule); }
    catch (err) { return res.status(422).json({ error: err.message, field: 'preferred_schedule' }); }
    // Save the destination in the existing address book before creating the order.
    // A failed address write must not produce a successful checkout with a lost address.
    const { data: savedAddresses, error: addressReadError } = await supabaseAdmin.from('delivery_addresses')
      .select('id, address, latitude, longitude').eq('user_id', retailerId);
    if (addressReadError) throw new Error('Could not save delivery address. Please retry.');
    const existingAddress = (savedAddresses || []).find(a =>
      a.address.trim().toLowerCase() === delivery_address.trim().toLowerCase() &&
      a.latitude != null && a.longitude != null &&
      Number(a.latitude) === deliveryCoords.latitude && Number(a.longitude) === deliveryCoords.longitude);
    if (!existingAddress) {
      const { error: addressError } = await supabaseAdmin.from('delivery_addresses').insert({
        user_id: retailerId, label: 'Delivery', address: delivery_address.trim(),
        latitude: deliveryCoords.latitude, longitude: deliveryCoords.longitude,
        is_default: savedAddresses.length === 0,
      });
      if (addressError) throw new Error('Could not save delivery address. Please retry.');
    }
    const orderValues = { retailer_id: retailerId, distributor_id: distributorId, total_amount,
      delivery_address, preferred_schedule: preferred_schedule || null, status: 'pending',
      ...(deliveryCoords ? { delivery_latitude: deliveryCoords.latitude, delivery_longitude: deliveryCoords.longitude } : {}) };
    const insertOrder = values => supabaseAdmin.from('orders').insert(values).select().single();
    let orderResult = await insertOrder(orderValues);
    const { data: order, error: orderError } = orderResult;

    if (orderError?.code === '22023') return res.status(422).json({ error: orderError.message, field: 'preferred_schedule' });
    if (orderError || !order) throw new Error('Failed to create order');

    // Step 2: one order_item per batch consumed — carries product_id so
    // cancellation and the inventory report can trace back to the exact
    // batch (and therefore the exact farmer/harvest date) later.
    const orderItemsToInsert = consumptions.map(({ batch, quantity_kg }) => ({
      order_id: order.id,
      product_id: batch.id,
      vegetable_name: batch.vegetable_name,
      quantity_kg,
      price_at_order: batch.price_per_kg
    }));

    const { error: itemsError } = await supabaseAdmin
      .from('order_items')
      .insert(orderItemsToInsert);

    if (itemsError) {
      await supabaseAdmin.from('orders').delete().eq('id', order.id);
      throw new Error('Failed to insert order items');
    }

    // Step 3: decrement stock LAST, atomically per batch, with best-effort
    // rollback. Each decrement is a single guarded UPDATE (see
    // sql/stock_safety.sql) so a concurrent order racing for the same batch
    // can never both succeed — one of them will see insufficient stock here
    // and this whole order rolls back, rather than silently overselling.
    const decremented = [];
    for (const { batch, quantity_kg } of consumptions) {
      const { data: decrementedBatch, error: updateError } = await supabaseAdmin
        .rpc('decrement_product_stock', { p_product_id: batch.id, p_quantity: quantity_kg });

      if (updateError || !decrementedBatch) {
        for (const d of decremented) {
          await supabaseAdmin.rpc('restore_product_stock', { p_product_id: d.batch.id, p_quantity: d.quantity_kg });
        }
        await supabaseAdmin.from('order_items').delete().eq('order_id', order.id);
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        if (updateError) throw new Error(`Failed to update stock for ${batch.vegetable_name}`);
        // No error but no row: another order consumed this batch's stock first.
        return res.status(409).json({ error: `There is not enough ${batch.vegetable_name} in stock. Please review your cart and try again.`, code: 'INSUFFICIENT_STOCK', field: 'items' });
      }
      decremented.push({ batch, quantity_kg });
    }

    res.status(201).json({
      message: 'Order placed successfully',
      order: {
        id: order.id,
        status: order.status,
        total_amount,
        delivery_address,
        preferred_schedule,
        created_at: order.created_at
      }
    });

  } catch (err) {
    console.error('Retailer order creation failed:', err.message);
    return res.status(500).json({ error: 'We could not create your order right now. Please try again.', code: 'ORDER_CREATE_FAILED' });
  }
});

app.get('/api/orders', verifyToken, async (req, res) => {
  if (req.user.role !== 'retailer') {
    return res.status(403).json({ error: 'Only retailers can view their orders' });
  }
  await cancelExpiredRetailerOrders(req.user.userId);

  // Issue 6: fetch the orders on their own first. A previous version embedded
  // order_items + deliveries in one select; if PostgREST can't resolve one of
  // those relationships the WHOLE query errors and the client (read-through
  // cache) silently shows an empty list. Fetching separately and merging is
  // resilient — the order list always renders even if a join is unavailable.
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select('id, status, total_amount, delivery_address, preferred_schedule, created_at')
    .eq('retailer_id', req.user.userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[GET /api/orders] failed:', error.message);
    return sendDbError(res, error);
  }

  const orderIds = (orders || []).map((o) => o.id);
  if (orderIds.length === 0) return res.json([]);

  const [{ data: items }, { data: deliveries }] = await Promise.all([
    supabaseAdmin
      .from('order_items')
      .select('order_id, vegetable_name, quantity_kg, price_at_order')
      .in('order_id', orderIds),
    supabaseAdmin
      .from('deliveries')
      .select('order_id, status, proof_photo_url, delivered_at, pod')
      .in('order_id', orderIds),
  ]);

  const itemsByOrder = {};
  (items || []).forEach((it) => {
    (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(it);
  });
  const deliveriesByOrder = {};
  (deliveries || []).forEach((d) => {
    (deliveriesByOrder[d.order_id] = deliveriesByOrder[d.order_id] || []).push(d);
  });

  const result = orders.map((o) => ({
    ...o,
    order_items: itemsByOrder[o.id] || [],
    deliveries: deliveriesByOrder[o.id] || [],
  }));
  res.json(result);
});

// ========== ORDER APPROVAL & DELIVERY ROUTES ==========
app.get('/api/orders/pending', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view pending orders' });
  }
  // Expire overdue schedules here too, not only when the retailer's own app is
  // open — otherwise a distributor can approve/assign an order whose delivery
  // window has already passed simply because the retailer never reopened the app.
  await cancelExpiredRetailerOrders();
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(`
      *,
      order_items (vegetable_name, quantity_kg, price_at_order)
    `)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: true });

  if (error) return sendDbError(res, error);
  
  // Keep pending orders + approved orders that do not have a rider assigned yet
  const list = (data || []).filter(o => o.status === 'pending' || !o.delivery_personnel_id);
  res.json(list);
});

// UNPAID ORDERS (specific, before /:id)
app.get('/api/orders/unpaid', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view unpaid orders' });
  }

  const { data: orders, error: ordersError } = await supabaseAdmin
    .from('orders')
    .select(`
      id,
      total_amount,
      delivery_address,
      created_at,
      status,
      retailer_id
    `)
    .eq('distributor_id', req.user.userId)
    .in('status', ['approved', 'picked_up', 'in_transit', 'delivered']);

  if (ordersError) return sendDbError(res, ordersError);

  const { data: paidOrders } = await supabaseAdmin
    .from('payments')
    .select('order_id')
    .eq('distributor_id', req.user.userId);

  const paidOrderIds = paidOrders ? paidOrders.map(p => p.order_id) : [];
  const unpaidOrders = orders.filter(o => !paidOrderIds.includes(o.id));
  res.json(unpaidOrders);
});

// ACTIVE ORDERS (Issue 9): orders that have been approved and are now in the
// delivery pipeline. Without this the distributor loses sight of an order the
// moment it leaves the "pending" list after assignment. Must stay BEFORE /:id.
app.get('/api/orders/active', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view active orders' });
  }
  await cancelExpiredRetailerOrders();
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select(`
      *,
      order_items (vegetable_name, quantity_kg, price_at_order),
      deliveries (id, status, delivery_personnel_id, proof_photo_url, delivered_at, pod)
    `)
    .eq('distributor_id', req.user.userId)
    .in('status', ['approved', 'picked_up', 'in_transit', 'delivered', 'cancelled'])
    .order('created_at', { ascending: false });

  if (error) return sendDbError(res, error);

  // Attach the assigned personnel's name without an embed relationship.
  const ids = [...new Set((orders || []).map((o) => o.delivery_personnel_id).filter(Boolean))];
  let nameById = {};
  if (ids.length) {
    const { data: people } = await supabaseAdmin.from('users').select('id, full_name').in('id', ids);
    nameById = Object.fromEntries((people || []).map((p) => [p.id, p.full_name]));
  }
  const list = (orders || []).map((o) => ({
    ...o,
    delivery_personnel_name: nameById[o.delivery_personnel_id] || null,
  }));
  res.json(list);
});

// DYNAMIC order details (must be after all specific routes)
app.get('/api/orders/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;
  const role = req.user.role;

  let query = supabaseAdmin.from('orders').select(`
    *,
    order_items (*), deliveries (id, status, proof_photo_url, delivered_at, pod)
  `).eq('id', id);

  if (role === 'retailer') {
    query = query.eq('retailer_id', userId);
 } else if (role === 'distributor') {
  query = query.eq('distributor_id', userId);
}
else {
    return res.status(403).json({ error: 'Access denied' });
  }

  const { data, error } = await query.single();
  if (error) return sendDbError(res, error);
  if (!data) return res.status(404).json({ error: 'Order not found' });
  res.json(data);
});

// Cancel/Reject Order (Retailer or Distributor)
app.put('/api/orders/:id/cancel', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  const userId = req.user.userId;
  const role = req.user.role;

  try {
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (orderErr || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Only the retailer who placed the order or the distributor can cancel/reject it.
    if (role === 'retailer' && order.retailer_id !== userId) {
      return res.status(403).json({ error: 'You can only cancel your own orders' });
    }
    if (role !== 'retailer' && role !== 'distributor') {
      return res.status(403).json({ error: 'Unauthorized to cancel this order' });
    }
    if (role === 'distributor' && !reason) {
      return res.status(400).json({ error: 'A cancellation reason is required' });
    }

    // Can only cancel pending orders
    if (order.status !== 'pending') {
      return res.status(400).json({ error: `Cannot cancel order with status '${order.status}'` });
    }

    const { data: items, error: itemsErr } = await supabaseAdmin
      .from('order_items')
      .select('product_id, vegetable_name, quantity_kg')
      .eq('order_id', id);

    if (itemsErr) {
      return res.status(500).json({ error: 'Failed to retrieve order items' });
    }

    // Atomic guard: re-checks status = 'pending' at write time so a
    // concurrent duplicate cancel call cannot pass this check twice and
    // restore stock to the same batches twice.
    const { data: updatedOrder, error: updateErr } = await supabaseAdmin
      .from('orders')
      .update({ status: 'cancelled', cancellation_reason: reason || null })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    if (updateErr) {
      return sendDbError(res, updateErr);
    }
    if (!updatedOrder) {
      return res.status(409).json({ error: 'This order was already updated. Refresh and try again.' });
    }

    // Restore stock to the EXACT batch each item was drawn from (order_items
    // now carries product_id — no more guessing by vegetable_name match).
    // Each restore is the same atomic RPC used to decrement at order time, so
    // a cancellation racing another write to the same batch can't lose an update.
    if (items && items.length > 0) {
      for (const item of items) {
        if (!item.product_id) continue; // legacy pre-FIFO order_item, nothing to restore to
        await supabaseAdmin.rpc('restore_product_stock', { p_product_id: item.product_id, p_quantity: item.quantity_kg });
      }
    }

    // Notify the counterpart
    if (role === 'retailer') {
      await createNotification(
        order.distributor_id,
        'Order Cancelled',
        `Order ${id.slice(0, 8)} has been cancelled by the retailer.`,
        'order',
        id
      );
    } else {
      await createNotification(
        order.retailer_id,
        'Order Cancelled',
        `Your order ${id.slice(0, 8)} has been rejected/cancelled by the distributor. Reason: ${reason}`,
        'order',
        id
      );
    }

    res.json({ message: 'Order cancelled successfully', order: updatedOrder });
  } catch (err) {
    sendDbError(res, err);
  }
});


// Approve order
app.put('/api/orders/:id/approve', verifyToken, async (req, res) => {
  const { id } = req.params;
  const distributorId = req.user.userId;
  const role = req.user.role;

  if (role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can approve orders' });
  }

  const { data: order, error: fetchError } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('id', id)
    .eq('distributor_id', distributorId)
    .single();

  if (fetchError || !order) {
    return res.status(404).json({ error: 'Order not found or not owned by you' });
  }
  if (order.status !== 'pending') {
    return res.status(400).json({ error: `Order is already ${order.status}` });
  }

  const { data: updatedOrder, error: updateError } = await supabaseAdmin
    .from('orders')
    .update({ status: 'approved' })
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  if (updateError) return sendDbError(res, updateError);
  if (!updatedOrder) return res.status(409).json({ error: 'This order was already updated. Refresh and try again.' });

  const { error: deliveryError } = await supabaseAdmin
    .from('deliveries')
    .insert({
      order_id: id,
      delivery_personnel_id: null,
      status: 'pending'
    });

  if (deliveryError) {
    await supabaseAdmin.from('orders').update({ status: 'pending' }).eq('id', id);
    return res.status(500).json({ error: 'Failed to create delivery record' });
  }

  await createNotification(order.retailer_id, 'Order Approved', `Your order ${id.slice(0,8)} has been approved and will be delivered soon.`, 'order', id);

  res.json({ message: 'Order approved successfully', order: updatedOrder });
});

app.get('/api/delivery-personnel', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can access delivery personnel list' });
  }
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, full_name, phone, service_area')
    .eq('role', 'delivery_personnel')
    .eq('account_status', 'active');

  if (error) return sendDbError(res, error);
  res.json(data);
});

app.put('/api/orders/:id/assign', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { delivery_personnel_id } = req.body;
  const distributorId = req.user.userId;
  const role = req.user.role;

  if (role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can assign delivery personnel' });
  }
  if (!delivery_personnel_id) {
    return res.status(400).json({ error: 'Delivery personnel ID is required' });
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, status, retailer_id, delivery_personnel_id')
    .eq('id', id)
    .eq('distributor_id', distributorId)
    .single();

  if (orderError || !order) {
    return res.status(404).json({ error: 'Order not found or not owned by you' });
  }
  if (order.status !== 'approved') {
    return res.status(400).json({ error: 'Order must be approved before assigning delivery' });
  }
  if (order.delivery_personnel_id) {
    // Idempotent retry of the exact same assignment (double-tap, network
    // retry) is a safe no-op; assigning a *different* rider on top of an
    // existing one is rejected rather than silently overwriting it.
    if (order.delivery_personnel_id === delivery_personnel_id) {
      return res.json({ message: 'Delivery personnel assigned successfully' });
    }
    return res.status(409).json({ error: 'This order has already been assigned to a rider.' });
  }

  // Atomic guard: the WHERE clause re-checks delivery_personnel_id IS NULL at
  // write time, so two concurrent assign calls can never both succeed.
  const { data: claimed, error: updateOrderError } = await supabaseAdmin
    .from('orders')
    .update({ delivery_personnel_id, assigned_at: new Date().toISOString() })
    .eq('id', id)
    .is('delivery_personnel_id', null)
    .select('id')
    .maybeSingle();

  if (updateOrderError) return sendDbError(res, updateOrderError);
  if (!claimed) return res.status(409).json({ error: 'This order has already been assigned to a rider.' });

  const { error: updateDeliveryError } = await supabaseAdmin
    .from('deliveries')
    .update({ delivery_personnel_id, status: 'assigned' })
    .eq('order_id', id);

  if (updateDeliveryError) return sendDbError(res, updateDeliveryError);

  await createNotification(delivery_personnel_id, 'New Delivery Assignment', `You have been assigned to deliver order ${id.slice(0,8)}. Please check the order details.`, 'delivery', id);
  await createNotification(order.retailer_id, 'Delivery Assigned', `A delivery person has been assigned to your order ${id.slice(0,8)}.`, 'delivery', id);

  res.json({ message: 'Delivery personnel assigned successfully' });
});

app.get('/api/delivery/orders', verifyToken, async (req, res) => {
  if (req.user.role !== 'delivery_personnel') {
    return res.status(403).json({ error: 'Access denied' });
  }
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select(`
      *,
      order_items (vegetable_name, quantity_kg, price_at_order),
      deliveries (id, status, proof_photo_url, delivered_at, pod)
    `)
    .eq('delivery_personnel_id', req.user.userId)
    .order('created_at', { ascending: false });

  if (error) return sendDbError(res, error);

  try {
    const userIds = [
      ...new Set([
        ...(orders || []).map((o) => o.retailer_id),
        ...(orders || []).map((o) => o.distributor_id)
      ])
    ].filter(Boolean);

    let usersInfo = {};
    if (userIds.length) {
      const { data: users, error: usersErr } = await supabaseAdmin
        .from('users')
        .select('id, full_name, store_location, warehouse_location, latitude, longitude')
        .in('id', userIds);

      if (usersErr) throw usersErr;

      users.forEach((u) => {
        usersInfo[u.id] = u;
      });
    }

    const retailerIds = [...new Set((orders || []).map(o => o.retailer_id))].filter(Boolean);
    const addressResult = retailerIds.length ? await supabaseAdmin.from('delivery_addresses')
      .select('user_id, address, latitude, longitude').in('user_id', retailerIds) : { data: [] };
    if (addressResult.error) throw addressResult.error;
    const list = (orders || []).map((o) => {
      const ret = usersInfo[o.retailer_id] || {};
      const dist = usersInfo[o.distributor_id] || {};
      const destination = destinationFor(o, ret, (addressResult.data || []).filter(address => address.user_id === o.retailer_id));

      return {
        ...o,
        retailer_name: ret.full_name || 'Retailer',
        retailer_address: o.delivery_address || ret.store_location || 'Retailer address',
        retailer_coords: coordinate(destination), delivery_location: destination,
        delivery_coordinate_source: destination.coordinate_source,
        distributor_name: dist.full_name || 'Distributor',
        distributor_address: dist.warehouse_location || 'Distributor warehouse',
        distributor_coords: coordinate(dist),
      };
    });

    res.json(list);
  } catch (err) {
    sendDbError(res, err);
  }
});

// ========== FINANCIAL TRACKING ==========
app.post('/api/payments', verifyToken, async (req, res) => {
  const { order_id, amount } = req.body;
  const distributorId = req.user.userId;
  const role = req.user.role;

  if (role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can record payments' });
  }
  if (!order_id || !isPositiveQuantity(amount)) {
    return res.status(400).json({ error: 'Order ID and valid amount required' });
  }

  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('id, total_amount, retailer_id')
    .eq('id', order_id)
    .eq('distributor_id', distributorId)
    .single();

  if (orderError || !order) {
    return res.status(404).json({ error: 'Order not found or not owned by you' });
  }

  const { data: existingPayment } = await supabaseAdmin
    .from('payments')
    .select('id')
    .eq('order_id', order_id)
    .maybeSingle();

  if (existingPayment) {
    return res.status(400).json({ error: 'Payment already recorded for this order' });
  }

  const { data: payment, error: insertError } = await supabaseAdmin
    .from('payments')
    .insert({
      order_id,
      distributor_id: distributorId,
      amount,
      status: 'paid'
    })
    .select()
    .single();

  if (insertError) return sendDbError(res, insertError);

  await createNotification(order.retailer_id, 'Payment Received', `Your payment of ₱${amount} for order ${order_id.slice(0,8)} has been recorded.`, 'payment', order_id);

  res.status(201).json({ message: 'Payment recorded', payment });
});

app.get('/api/payments', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view payments' });
  }
  const { status } = req.query;
  let query = supabaseAdmin.from('payments').select(`
    *,
    orders (id, total_amount, delivery_address, created_at, retailer_id)
  `).eq('distributor_id', req.user.userId);

  if (status && (status === 'paid' || status === 'unpaid')) {
    query = query.eq('status', status);
  }

  const { data, error } = await query.order('recorded_at', { ascending: false });
  if (error) return sendDbError(res, error);
  res.json(data);
});

// ========== NOTIFICATIONS API ==========
app.get('/api/notifications', verifyToken, async (req, res) => {
  const userId = req.user.userId;
  const { unread_only } = req.query;

  let query = supabaseAdmin.from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (unread_only === 'true') {
    query = query.eq('is_read', false);
  }

  const { data, error } = await query;
  if (error) return sendDbError(res, error);
  res.json(data);
});

app.put('/api/notifications/:id/read', verifyToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId;

  const { data, error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true })
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) return sendDbError(res, error);
  if (!data) return res.status(404).json({ error: 'Notification not found' });
  res.json({ message: 'Marked as read', notification: data });
});

app.put('/api/notifications/read-all', verifyToken, async (req, res) => {
  const userId = req.user.userId;

  const { error } = await supabaseAdmin
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('is_read', false);

  if (error) return sendDbError(res, error);
  res.json({ message: 'All notifications marked as read' });
});

// ========== IN-APP MESSAGING ==========
// Specific routes BEFORE the dynamic /:userId route so they aren't captured.
app.get('/api/messages/contacts', verifyToken, async (req, res) => {
  try {
    // Messaging permission matrix:
    //  - farmer            -> the distributor only
    //  - distributor       -> farmers, retailers, delivery personnel
    //  - retailer          -> the distributor + delivery personnel assigned to their own orders
    //  - delivery_personnel -> the distributor + retailers whose orders they've been assigned
    let query = supabaseAdmin
      .from('users')
      .select('id, full_name, role, avatar_url, profile_picture_updated_at')
      .neq('id', req.user.userId)
      .order('full_name', { ascending: true });

    if (req.user.role === 'farmer') {
      query = query.eq('role', 'distributor');
    } else if (req.user.role === 'distributor') {
      query = query.in('role', ['farmer', 'retailer', 'delivery_personnel']);
    } else if (req.user.role === 'retailer') {
      const { data: assignedOrders, error: ordersErr } = await supabaseAdmin
        .from('orders')
        .select('delivery_personnel_id')
        .eq('retailer_id', req.user.userId)
        .not('delivery_personnel_id', 'is', null);
      if (ordersErr) throw ordersErr;
      const deliveryIds = [...new Set((assignedOrders || []).map((o) => o.delivery_personnel_id))];
      query = query.or(`role.eq.distributor,id.in.(${deliveryIds.length ? deliveryIds.join(',') : '00000000-0000-0000-0000-000000000000'})`);
    } else if (req.user.role === 'delivery_personnel') {
      const { data: assignedOrders, error: ordersErr } = await supabaseAdmin
        .from('orders')
        .select('retailer_id')
        .eq('delivery_personnel_id', req.user.userId);
      if (ordersErr) throw ordersErr;
      const retailerIds = [...new Set((assignedOrders || []).map((o) => o.retailer_id))];
      query = query.or(`role.eq.distributor,id.in.(${retailerIds.length ? retailerIds.join(',') : '00000000-0000-0000-0000-000000000000'})`);
    }

    const { data, error } = await query;
    if (error) throw error;
    const { data: unreadMsgs, error: unreadErr } = await supabaseAdmin
      .from('messages')
      .select('sender_id')
      .eq('recipient_id', req.user.userId)
      .eq('is_read', false);

    if (unreadErr) throw unreadErr;

    const unreadMap = {};
    if (unreadMsgs) {
      unreadMsgs.forEach(m => {
        unreadMap[m.sender_id] = (unreadMap[m.sender_id] || 0) + 1;
      });
    }

    const formattedData = data.map(c => ({
      ...c,
      unread_count: unreadMap[c.id] || 0
    }));

    res.json(formattedData);
  } catch (err) {
    sendDbError(res, err);
  }
});

app.get('/api/messages/unread-count', verifyToken, async (req, res) => {
  const { count, error } = await supabaseAdmin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', req.user.userId)
    .eq('is_read', false);
  if (error) return sendDbError(res, error);
  res.json({ count: count || 0 });
});

app.get('/api/messages/:userId', verifyToken, async (req, res) => {
  const me = req.user.userId;
  const other = req.params.userId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(other)) {
    return res.status(400).json({ error: 'Invalid message participant' });
  }

  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('*')
    .or(`and(sender_id.eq.${me},recipient_id.eq.${other}),and(sender_id.eq.${other},recipient_id.eq.${me})`)
    .order('created_at', { ascending: true });
  if (error) return sendDbError(res, error);

  // Mark the other person's messages to me as read.
  await supabaseAdmin
    .from('messages')
    .update({ is_read: true })
    .eq('sender_id', other)
    .eq('recipient_id', me)
    .eq('is_read', false);

  res.json(data);
});

app.post('/api/messages', verifyToken, async (req, res) => {
  const { recipient_id, body } = req.body || {};
  if (!recipient_id || !body || !body.trim()) {
    return res.status(400).json({ error: 'recipient_id and body are required' });
  }
  const { data, error } = await supabaseAdmin
    .from('messages')
    .insert({ sender_id: req.user.userId, recipient_id, body: body.trim() })
    .select()
    .single();
  if (error) return sendDbError(res, error);
  res.status(201).json({ message: 'Sent', data });
});

// ========== DELIVERY PROGRESS (Issue 10) ==========
// Delivery personnel advance an order: picked_up → in_transit. The status is
// mirrored onto the parent order so the retailer/distributor trackers move in
// near-real-time (they poll, Issue 11).
app.put('/api/deliveries/:id/status', verifyToken, async (req, res) => {
  if (req.user.role !== 'delivery_personnel') {
    return res.status(403).json({ error: 'Only delivery personnel can update delivery status' });
  }
  const { id } = req.params;
  const { status } = req.body || {};
  const allowed = ['picked_up', 'in_transit'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }

  const { data: delivery, error: dErr } = await supabaseAdmin
    .from('deliveries')
    .select('id, order_id, status')
    .eq('id', id)
    .eq('delivery_personnel_id', req.user.userId)
    .single();
  if (dErr || !delivery) {
    return res.status(404).json({ error: 'Delivery not found or not assigned to you' });
  }

  if (!(delivery.status === status || (delivery.status === 'assigned' && status === 'picked_up') || (delivery.status === 'picked_up' && status === 'in_transit'))) return res.status(409).json({ error: 'Invalid delivery status transition. Refresh and retry.' });
  const { error: progressError } = await supabaseAdmin.rpc('advance_delivery_status', { p_delivery_id: id, p_rider_id: req.user.userId, p_status: status });
  if (progressError) return res.status(progressError.code === '22023' ? 409 : 500).json({ error: 'Unable to update delivery status. Refresh and retry.' });
  // Once the rider picks up the order it is, from the retailer/distributor's
  // point of view, already on its way — so the parent order jumps straight to
  // "in_transit" instead of surfacing the rider-only "picked_up" step.

  const { data: order } = await supabaseAdmin
    .from('orders').select('retailer_id').eq('id', delivery.order_id).single();
  if (order) {
    const label = status === 'picked_up' ? 'picked up' : 'on the way';
    await createNotification(
      order.retailer_id,
      'Delivery Update',
      `Your order ${delivery.order_id.slice(0, 8)} has been ${label}.`,
      'delivery',
      delivery.order_id
    );
  }
  res.json({ message: `Delivery marked ${status}` });
});

// Reject an assigned delivery before starting it (only while still
// 'assigned' — once picked_up/in_transit it can no longer be declined).
// Clears the assignment on both the delivery and its parent order so it
// reappears in the distributor's pending list, ready for reassignment.
app.put('/api/deliveries/:id/reject', verifyToken, async (req, res) => {
  if (req.user.role !== 'delivery_personnel') {
    return res.status(403).json({ error: 'Only delivery personnel can reject deliveries' });
  }
  const { id } = req.params;
  const { reason } = req.body || {};
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'A reason is required to reject a delivery' });
  }

  const { data: delivery, error: dErr } = await supabaseAdmin
    .from('deliveries')
    .select('id, order_id, status')
    .eq('id', id)
    .eq('delivery_personnel_id', req.user.userId)
    .single();
  if (dErr || !delivery) {
    return res.status(404).json({ error: 'Delivery not found or not assigned to you' });
  }
  if (delivery.status !== 'assigned') {
    return res.status(400).json({ error: `Cannot reject a delivery with status '${delivery.status}'` });
  }

  await supabaseAdmin
    .from('deliveries')
    .update({
      delivery_personnel_id: null,
      status: 'pending',
      rejection_reason: reason.trim().slice(0, 500),
      rejected_at: new Date(),
    })
    .eq('id', id);

  await supabaseAdmin
    .from('orders')
    .update({ delivery_personnel_id: null })
    .eq('id', delivery.order_id);

  const { data: order } = await supabaseAdmin
    .from('orders').select('distributor_id').eq('id', delivery.order_id).single();
  if (order) {
    await createNotification(
      order.distributor_id,
      'Delivery Rejected',
      `A rider declined the delivery for order ${delivery.order_id.slice(0, 8)}. Reason: ${reason.trim()}`,
      'delivery',
      delivery.order_id
    );
  }

  res.json({ message: 'Delivery rejected' });
});

// ========== DELIVERY COMPLETION ==========
app.put('/api/deliveries/:id/complete', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { proof_photo_url } = req.body || {};
  const deliveryPersonId = req.user.userId;
  const role = req.user.role;

  if (role !== 'delivery_personnel') {
    return res.status(403).json({ error: 'Only delivery personnel can complete deliveries' });
  }

  const { data: delivery, error: deliveryError } = await supabaseAdmin
    .from('deliveries')
    .select('*, order_id')
    .eq('id', id)
    .eq('delivery_personnel_id', deliveryPersonId)
    .single();

  if (deliveryError || !delivery) {
    return res.status(404).json({ error: 'Delivery not found or not assigned to you' });
  }

  const { data: order, error: orderError } = await supabaseAdmin.from('orders').select('*').eq('id', delivery.order_id).single();
  if (orderError || !order) return res.status(500).json({ error: 'Unable to load delivery destination. Retry.' });
  if (delivery.status === 'delivered' && order.status === 'delivered') return res.json({ message: 'Delivery already completed', pod: delivery.pod });
  if (delivery.status !== 'in_transit' || order.status !== 'in_transit') return res.status(409).json({ error: 'Delivery must be in transit before submitting proof.' });
  let pod, photoUrl;
  let destination;
  try { destination = await loadDestination(supabaseAdmin, order); }
  catch { return res.status(503).json({ error: 'Unable to load delivery destination. Retry.', code: 'DELIVERY_DESTINATION_LOOKUP_FAILED' }); }
  try {
    pod = validateProof(req.body, destination);
    photoUrl = proofImageUrl(proof_photo_url, pod);
  } catch (err) { return res.status(422).json({ error: err.message, code: err.code || 'PROOF_IMAGE_INVALID' }); }
  try { await ensureProofImage(photoUrl); }
  catch { return res.status(503).json({ error: 'Proof was uploaded, but the delivery could not be completed. Please try again.', code: 'PROOF_IMAGE_UNAVAILABLE' }); }
  const { error: completeError } = await supabaseAdmin.rpc('complete_delivery_with_proof', {
    p_delivery_id: id, p_rider_id: deliveryPersonId, p_photo_url: photoUrl, p_pod: pod,
  });
  if (completeError) return res.status(completeError.code === '22023' ? 422 : 500).json({ error: completeError.code === '22023' ? completeError.message : 'Could not save delivery proof. Retry; contact the administrator if this continues.' });

  const orderIdShort = delivery.order_id.slice(0,8);
  await createNotification(order.retailer_id, 'Order Delivered', `Your order ${orderIdShort} has been delivered. Thank you!`, 'delivery', delivery.order_id);
  await createNotification(order.distributor_id, 'Order Completed', `Order ${orderIdShort} was delivered successfully.`, 'delivery', delivery.order_id);

  res.json({ message: 'Delivery marked as completed' });
});

// Distributor weekly report (last 7 days of orders and products)
app.get('/api/distributor/weekly-report', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can access this report' });
  }
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  // Orders in last 7 days
  const { data: orders, error: ordersError } = await supabaseAdmin
    .from('orders')
    .select('total_amount, status, created_at')
    .eq('distributor_id', req.user.userId)
    .gte('created_at', oneWeekAgo.toISOString());

  if (ordersError) return sendDbError(res, ordersError);

  const totalRevenue = orders.reduce((sum, o) => sum + o.total_amount, 0);
  const completedOrders = orders.filter(o => o.status === 'delivered').length;

  // Products (current inventory)
  const { data: products, error: productsError } = await supabaseAdmin
    .from('products')
    .select('vegetable_name, stock_kg')
    .eq('distributor_id', req.user.userId);

  if (productsError) return sendDbError(res, productsError);

  res.json({
    period: 'last 7 days',
    total_orders: orders.length,
    completed_orders: completedOrders,
    total_revenue: totalRevenue,
    current_inventory: products
  });
});

// Full farm-to-delivery traceability, one row per (batch x consuming order),
// so nothing sold is ever lost — batches with no orders yet still appear,
// with the retailer/delivery columns left blank.
app.get('/api/distributor/inventory-report', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can access this report' });
  }
  const distributorId = req.user.userId;

  const { data: batches, error: batchesError } = await supabaseAdmin
    .from('products')
    .select('id, vegetable_name, farmer_id, harvest_date, pickup_request_id, quantity_received, stock_kg, status, price_per_kg')
    .eq('distributor_id', distributorId)
    .order('harvest_date', { ascending: true });

  if (batchesError) return sendDbError(res, batchesError);

  const batchIds = (batches || []).map((b) => b.id);
  const farmerIds = [...new Set((batches || []).map((b) => b.farmer_id).filter(Boolean))];
  const pickupIds = [...new Set((batches || []).map((b) => b.pickup_request_id).filter(Boolean))];

  const [{ data: farmers }, { data: pickups }, { data: orderItems }] = await Promise.all([
    farmerIds.length ? supabaseAdmin.from('users').select('id, full_name').in('id', farmerIds) : Promise.resolve({ data: [] }),
    pickupIds.length ? supabaseAdmin.from('pickup_requests').select('id, received_at, delivery_personnel_id').in('id', pickupIds) : Promise.resolve({ data: [] }),
    batchIds.length ? supabaseAdmin.from('order_items').select('product_id, order_id, quantity_kg').in('product_id', batchIds) : Promise.resolve({ data: [] }),
  ]);

  const farmerNameById = Object.fromEntries((farmers || []).map((f) => [f.id, f.full_name]));
  const pickupDateById = Object.fromEntries((pickups || []).map((p) => [p.id, p.received_at]));
  const pickupRiderIdById = Object.fromEntries((pickups || []).map((p) => [p.id, p.delivery_personnel_id]));

  // Pickup-side rider names (who collected the harvest from the farmer) —
  // resolved separately since it's needed regardless of whether the batch
  // has been sold yet.
  const pickupRiderIds = [...new Set((pickups || []).map((p) => p.delivery_personnel_id).filter(Boolean))];
  let pickupRiderNameById = {};
  if (pickupRiderIds.length) {
    const { data: riders } = await supabaseAdmin.from('users').select('id, full_name').in('id', pickupRiderIds);
    pickupRiderNameById = Object.fromEntries((riders || []).map((r) => [r.id, r.full_name]));
  }

  const orderIds = [...new Set((orderItems || []).map((it) => it.order_id))];
  let orderById = {};
  let deliveryByOrderId = {};
  let peopleNameById = {};
  let paidOrderIds = new Set();
  if (orderIds.length) {
    const { data: orders } = await supabaseAdmin
      .from('orders')
      .select('id, retailer_id, delivery_personnel_id, status')
      .in('id', orderIds);
    orderById = Object.fromEntries((orders || []).map((o) => [o.id, o]));

    const { data: deliveries } = await supabaseAdmin
      .from('deliveries')
      .select('order_id, delivered_at')
      .in('order_id', orderIds);
    deliveryByOrderId = Object.fromEntries((deliveries || []).map((d) => [d.order_id, d.delivered_at]));

    const { data: paidPayments } = await supabaseAdmin
      .from('payments')
      .select('order_id')
      .in('order_id', orderIds);
    paidOrderIds = new Set((paidPayments || []).map((p) => p.order_id));

    const peopleIds = [...new Set((orders || []).flatMap((o) => [o.retailer_id, o.delivery_personnel_id]).filter(Boolean))];
    if (peopleIds.length) {
      const { data: people } = await supabaseAdmin.from('users').select('id, full_name').in('id', peopleIds);
      peopleNameById = Object.fromEntries((people || []).map((p) => [p.id, p.full_name]));
    }
  }

  const itemsByBatch = {};
  (orderItems || []).forEach((it) => {
    (itemsByBatch[it.product_id] = itemsByBatch[it.product_id] || []).push(it);
  });

  const rows = [];
  for (const batch of batches || []) {
    const consumptions = itemsByBatch[batch.id] || [];
    const riderId = pickupRiderIdById[batch.pickup_request_id];
    const base = {
      product: batch.vegetable_name,
      farmer_name: farmerNameById[batch.farmer_id] || null,
      harvest_date: batch.harvest_date,
      pickup_date: pickupDateById[batch.pickup_request_id] || null,
      pickup_rider_name: riderId ? (pickupRiderNameById[riderId] || null) : null,
      quantity_received: batch.quantity_received,
      remaining_quantity: batch.stock_kg,
      price_per_kg: batch.price_per_kg,
    };
    if (consumptions.length === 0) {
      rows.push({
        ...base, quantity_sold: 0, total_amount: 0, retailer_name: null,
        delivery_personnel: null, delivery_date: null, order_status: null, payment_status: null,
      });
      continue;
    }
    for (const item of consumptions) {
      const order = orderById[item.order_id];
      rows.push({
        ...base,
        quantity_sold: item.quantity_kg,
        total_amount: Number(item.quantity_kg) * Number(batch.price_per_kg || 0),
        retailer_name: order ? peopleNameById[order.retailer_id] || null : null,
        delivery_personnel: order?.delivery_personnel_id ? peopleNameById[order.delivery_personnel_id] || null : null,
        delivery_date: deliveryByOrderId[item.order_id] || null,
        order_status: order?.status || null,
        payment_status: order ? (paidOrderIds.has(item.order_id) ? 'Paid' : 'Unpaid') : null,
      });
    }
  }

  res.json(rows);
});

// ========== USER PROFILE ROUTES ==========
app.put('/api/users/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  if (req.user.userId !== id) {
    return res.status(403).json({ error: 'You can only update your own profile' });
  }

  const {
    full_name, email, farm_location, warehouse_location, store_location, service_area,
    latitude, longitude, avatar_url,
  } = req.body;
  const updates = {};
  if (avatar_url !== undefined) {
    try { updates.avatar_url = validateAvatarUrl(avatar_url); }
    catch (error) { return res.status(error.status).json({ error: error.message }); }
  }
  if (full_name !== undefined) updates.full_name = full_name;
  if (email !== undefined) updates.email = email;
  if (farm_location !== undefined) updates.farm_location = farm_location;
  if (warehouse_location !== undefined) updates.warehouse_location = warehouse_location;
  if (store_location !== undefined) updates.store_location = store_location;
  if (service_area !== undefined) updates.service_area = service_area;
  if (latitude !== undefined) updates.latitude = latitude;
  if (longitude !== undefined) updates.longitude = longitude;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', id)
    .select('id, full_name, phone, role, email, farm_location, warehouse_location, store_location, service_area, latitude, longitude, avatar_url, profile_picture_updated_at')
    .single();

  if (error) return sendDbError(res, error);
  res.json({ message: 'Profile updated', user: data });
});

app.put('/api/users/:id/password', verifyToken, (req, res) =>
  res.status(410).json({ error: 'Password changes are unavailable.' }));
app.put('/api/users/:id/phone', verifyToken, (req, res) =>
  res.status(410).json({ error: 'Phone changes are temporarily unavailable.' }));

app.delete('/api/users/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  if (req.user.userId !== id) {
    return res.status(403).json({ error: 'You can only delete your own account' });
  }

  // Historical relationships use cascading foreign keys. Ordinary account closure
  // is handled by distributor disabling, never by deleting the profile.
  res.status(409).json({ error: 'Contact the distributor to disable your account and preserve your transaction history.' });
});

// ========== RIDER LOCATION ==========
app.post('/api/delivery/update-location', verifyToken, async (req, res) => {
  try {
    const riderId = req.user.userId;
    if (req.user.role !== 'delivery_personnel') return res.status(403).json({ error: 'Only riders can publish delivery GPS' });
    const coords = coordinate(req.body);
    if (!coords) return res.status(400).json({ error: 'Valid latitude and longitude are required' });
    const { delivery_id, accuracy, captured_at, timestamp: deviceTimestamp } = req.body;
    if (delivery_id) {
      const { data: order } = await supabaseAdmin.from('orders').select('delivery_personnel_id').eq('id', delivery_id).single();
      if (!order || order.delivery_personnel_id !== riderId) return res.status(403).json({ error: 'This delivery is not assigned to you' });
    }
    if (accuracy != null && (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy < 0)) {
      return res.status(400).json({ error: 'GPS accuracy must be a non-negative number' });
    }
    const precision = accuracy ?? null;
    // Existing clients without a capture time retain receipt-time compatibility.
    const captured = captured_at != null ? (typeof captured_at === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(captured_at) ? Date.parse(captured_at) : NaN) :
      deviceTimestamp != null ? (typeof deviceTimestamp === 'number' ? deviceTimestamp : NaN) : Date.now();
    if (!Number.isFinite(captured) || Date.now() - captured > STALE_LOCATION_SECONDS * 1000 || captured - Date.now() > 30000) {
      return res.status(422).json({ error: 'Your GPS location has expired. Refresh your location and try again.', code: 'GPS_STALE' });
    }
    const timestamp = new Date(captured).toISOString();
    const updates = { current_latitude: coords.latitude, current_longitude: coords.longitude,
      current_location_accuracy: precision, last_location_update: timestamp };
    const saveLocation = () => supabaseAdmin.from('users').update(updates).eq('id', riderId)
      .or(`last_location_update.is.null,last_location_update.lt.${timestamp}`).select('last_location_update');
    let result = await saveLocation();
    if (missingColumn(result.error, ['current_location_accuracy'])) {
      delete updates.current_location_accuracy;
      result = await saveLocation();
    }
    if (result.error) return res.status(500).json({ error: 'Failed to save rider location' });
    if (!result.data?.length) return res.json({ success: true, ignored: true, timestamp });
    if (delivery_id) {
      const { error } = await supabaseAdmin.from('delivery_tracking').insert({ delivery_id,
        rider_id: riderId, ...coords, status: 'en_route' });
      if (error) console.warn('Tracking history insert failed:', error.message);
    }
    return res.json({ success: true, timestamp });
  } catch (error) { console.error('Location update failed:', error.message); return res.status(500).json({ error: 'Location update failed' }); }
});
// ============================================
// START SERVER
// ============================================
// ============================================
// // ============================================
// GET TRACKING DATA (FIXED FOR YOUR TABLE)
// ============================================

app.get('/api/delivery/tracking/:orderId', verifyToken, createTrackingHandler({ db: supabaseAdmin }));

// Helper: Format ETA time
function formatETATime(seconds) {
    if (!seconds) return 'Calculating...';
    if (seconds < 60) return `${Math.round(seconds)} sec`;
    if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        return `${mins} min${mins > 1 ? 's' : ''}`;
    }
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs}h ${mins}m`;
}

// ============================================
// DELIVERY ADDRESSES CRUD
// ============================================

// GET /api/addresses - Get all addresses for the logged-in user
app.get('/api/addresses', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        const { data, error } = await supabaseAdmin
            .from('delivery_addresses')
            .select('*')
            .eq('user_id', userId)
            .order('is_default', { ascending: false })
            .order('created_at', { ascending: true });

        if (error) {
            return sendDbError(res, error);
        }

        res.json(data || []);
    } catch (err) {
        console.error('GET /api/addresses error:', err);
        res.status(500).json({ error: 'Failed to fetch addresses' });
    }
});

// POST /api/addresses - Create a new address
app.post('/api/addresses', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { label, address, latitude, longitude, is_default } = req.body;

        if (!label || !address) {
            return res.status(400).json({ error: 'Label and address are required' });
        }

        // If this address is set as default, unset any existing default
        if (is_default) {
            await supabaseAdmin
                .from('delivery_addresses')
                .update({ is_default: false })
                .eq('user_id', userId);
        }

        const { data, error } = await supabaseAdmin
            .from('delivery_addresses')
            .insert({
                user_id: userId,
                label,
                address,
                latitude: latitude || null,
                longitude: longitude || null,
                is_default: is_default || false,
            })
            .select()
            .single();

        if (error) {
            return sendDbError(res, error);
        }

        res.status(201).json(data);
    } catch (err) {
        console.error('POST /api/addresses error:', err);
        res.status(500).json({ error: 'Failed to create address' });
    }
});

// PUT /api/addresses/:id - Update an address
app.put('/api/addresses/:id', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;
        const { label, address, latitude, longitude, is_default } = req.body;

        const { data: existing, error: checkError } = await supabaseAdmin
            .from('delivery_addresses')
            .select('id')
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (checkError || !existing) {
            return res.status(404).json({ error: 'Address not found' });
        }

        if (is_default) {
            await supabaseAdmin
                .from('delivery_addresses')
                .update({ is_default: false })
                .eq('user_id', userId)
                .neq('id', id);
        }

        const updates = {};
        if (label !== undefined) updates.label = label;
        if (address !== undefined) updates.address = address;
        if (latitude !== undefined) updates.latitude = latitude;
        if (longitude !== undefined) updates.longitude = longitude;
        if (is_default !== undefined) updates.is_default = is_default;
        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabaseAdmin
            .from('delivery_addresses')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            return sendDbError(res, error);
        }

        res.json(data);
    } catch (err) {
        console.error('PUT /api/addresses/:id error:', err);
        res.status(500).json({ error: 'Failed to update address' });
    }
});

// DELETE /api/addresses/:id - Delete an address
app.delete('/api/addresses/:id', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;

        const { data: existing, error: checkError } = await supabaseAdmin
            .from('delivery_addresses')
            .select('id, is_default')
            .eq('id', id)
            .eq('user_id', userId)
            .single();

        if (checkError || !existing) {
            return res.status(404).json({ error: 'Address not found' });
        }

        const { error } = await supabaseAdmin
            .from('delivery_addresses')
            .delete()
            .eq('id', id);

        if (error) {
            return sendDbError(res, error);
        }

        if (existing.is_default) {
            const { data: remaining } = await supabaseAdmin
                .from('delivery_addresses')
                .select('id')
                .eq('user_id', userId)
                .limit(1);

            if (remaining && remaining.length > 0) {
                await supabaseAdmin
                    .from('delivery_addresses')
                    .update({ is_default: true })
                    .eq('id', remaining[0].id);
            }
        }

        res.json({ message: 'Address deleted successfully' });
    } catch (err) {
        console.error('DELETE /api/addresses/:id error:', err);
        res.status(500).json({ error: 'Failed to delete address' });
    }
});
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
