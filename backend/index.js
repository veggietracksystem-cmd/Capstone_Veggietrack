const { validateOrderItems } = require('./lib/orderRules');
const { validateAvatarUrl, validateBatchPhotoUrl } = require('./lib/avatar');
const { validateSchedule, proofImageUrl, ensureProofImage } = require('./lib/deliveryProof');
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const { verifyToken, configureAuth } = require('./lib/auth');
const { mountAccountRoutes } = require('./lib/accountRoutes');
const { isVegetable, VEGETABLE_VALIDATION_MESSAGE, canonicalVegetableName } = require('./lib/vegetables');
const {
  COMPLETED_STATUSES, roundKg, hasStockPrecision, isActiveBatch, isReceivedBatch, isSellableBatch,
  compareFifo, sameVegetableAs, retailerProducts, distributorListings, batchStatus, batchDate, manilaToday,
  daysInStock, needsStockAlert, isPastSpoilageLimit, stockSince, STOCK_ALERT_DAYS,
} = require('./lib/batches');
const { OPEN_PICKUP_STATUSES, harvestAvailability, estimatedTotal, pickupInputError, requestedKg } = require('./lib/pickups');
const { buildChainBatches, reportFilter, chainEvents, reportSummary, reportVegetables, manilaWeek } = require('./lib/chainTracking');
const { coordinate, destinationFor, createRouteService, createTrackingHandler, missingColumn } = require('./lib/deliveryTracking');
const { createPickupTrackingHandler } = require('./lib/pickupTracking');
const { STALE_LOCATION_SECONDS } = require('./lib/locationPolicy');
const { deliveryCompletionGuard, pickupCompletionGuard, pickupProximityRejection, oneAtATime } = require('./lib/proofGuards');
const { sendDbError } = require('./lib/errors');
const { isPositiveQuantity, isNonNegativeQuantity } = require('./lib/validation');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
// Disable HTTP caching for API reads; the mobile app manages its own offline cache.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') res.set('Cache-Control', 'no-store, max-age=0');
  next();
});
app.use(express.json());

// Service-role Supabase client (bypasses RLS).
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
configureAuth(supabaseAdmin);
mountAccountRoutes(app, supabaseAdmin);
// One road-routing service for delivery and pickup tracking, so both share its
// cache and its one-request-per-second limit on the public OSRM server.
const routeService = createRouteService();

// Marks orders not delivered by the end of their scheduled day as 'unsuccessful'
// before orders are read, so every role sees the same status even between the
// pg_cron runs. Same RPC as the job; safe to repeat (sql/inventory_transactions.sql).
async function markOverdueOrdersUnsuccessful() {
  const { error } = await supabaseAdmin.rpc('cancel_expired_retailer_orders');
  if (error) console.error('Could not update overdue orders:', error.message);
}

// Stock past the 7-day limit is no longer moved to Spoiled Products by the app
// (sql/manual_spoilage.sql): it stays in its batch for the distributor to review,
// and lib/batches.js and the checkout/approval functions keep it out of sale.

// A missing database function or column means sql/pickup_pricing_and_spoilage.sql
// has not been applied yet.
const needsMigration = (error) => !!error && ['PGRST202', '42883', 'PGRST204', '42703', 'PGRST200', 'PGRST205', '42P01'].includes(error.code);
function sendMigrationRequired(res) {
  return res.status(503).json({ error: 'This feature needs the latest database update. Please contact the administrator.', code: 'DATABASE_UPDATE_REQUIRED' });
}
// Database function errors raised with a plain message for the user.
function sendWorkflowError(res, error) {
  if (needsMigration(error)) return sendMigrationRequired(res);
  const statuses = { P0001: 409, P0002: 404, '22023': 422, '42501': 403 };
  if (statuses[error.code]) return res.status(statuses[error.code]).json({ error: error.message });
  return sendDbError(res, error);
}
const philippineDate = (value) => new Date(value).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });

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

// Legacy auth endpoints are retired; clients authenticate through Supabase Auth.
app.use('/api/auth', (req, res) => res.status(410).json({ error: 'Use Supabase Auth for authentication.' }));

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
  if (!isPositiveQuantity(quantity_kg) || !hasStockPrecision(quantity_kg)) {
    return res.status(400).json({ error: 'Quantity must be a positive number in kg.' });
  }
  if (!isVegetable(vegetable_name)) {
    return res.status(400).json({ error: VEGETABLE_VALIDATION_MESSAGE });
  }
  if (status !== undefined && status !== 'available') {
    return res.status(400).json({ error: 'New harvests must be available.' });
  }

  // Idempotency: a retried offline mutation must not create a duplicate harvest.
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

  // The harvest date is recorded once here and carried through to all downstream records.
  const insertPayload = {
    farmer_id: farmerId,
    vegetable_name,
    quantity_kg,
    status: 'available',
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
    // A concurrent retry can pass the check above; the unique index is the final guard.
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
  // Kilograms still free to request, after every pickup request that was not declined.
  const requests = await farmerPickupQuantities(req.user.userId);
  res.json((data || []).map((harvest) => ({ ...harvest, ...harvestAvailability(harvest, requests) })));
});

// Pickup requests (harvest, quantity, status) of one farmer or one harvest. Before
// the pickup quantity column exists, every request covers its whole harvest.
async function farmerPickupQuantities(farmerId, harvestId) {
  const query = (columns) => {
    let q = supabaseAdmin.from('pickup_requests').select(columns);
    if (farmerId) q = q.eq('farmer_id', farmerId);
    if (harvestId) q = q.eq('harvest_id', harvestId);
    return q;
  };
  let { data, error } = await query('harvest_id, quantity_kg, status');
  if (needsMigration(error)) ({ data, error } = await query('harvest_id, status'));
  return error ? [] : (data || []);
}
// True when part of the harvest has a pickup request that was not declined.
async function harvestHasPickups(harvestId) {
  const requests = await farmerPickupQuantities(null, harvestId);
  return requests.some((request) => !['declined', 'cancelled'].includes(request.status));
}

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

  // Attach pickup details so the report can show the harvest-to-pickup timeline.
  const harvestIds = data.map((h) => h.id);
  let pickupByHarvestId = {};
  if (harvestIds.length) {
    const { data: pickups } = await supabaseAdmin
      .from('pickup_requests')
      .select('harvest_id, status, received_at, delivery_personnel_id, received_by')
      .in('harvest_id', harvestIds);
    (pickups || []).forEach((p) => { pickupByHarvestId[p.harvest_id] = p; });
  }

  // Resolve rider and distributor names in a single query.
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
  if (quantity_kg !== undefined && (!isPositiveQuantity(quantity_kg) || !hasStockPrecision(quantity_kg))) {
    return res.status(400).json({ error: 'Quantity must be a positive number in kg.' });
  }
  if (status !== undefined && status !== existing.status) {
    return res.status(400).json({ error: 'Harvest status is managed by the pickup workflow.' });
  }

  // A harvest's name and quantity are locked once any part of it has a pickup request.
  if ((vegetable_name !== undefined || quantity_kg !== undefined)
    && (existing.status !== 'available' || await harvestHasPickups(id))) {
    return res.status(400).json({ error: 'This harvest is pending pickup or has already been picked up and can no longer be edited' });
  }

  const updates = {};
  if (vegetable_name !== undefined) updates.vegetable_name = vegetable_name;
  if (quantity_kg !== undefined) updates.quantity_kg = quantity_kg;
  if (image_url !== undefined) updates.image_url = image_url;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const { data, error } = await supabaseAdmin
    .from('harvests')
    .update(updates)
    .eq('id', id)
    .eq('farmer_id', farmerId)
    .eq('status', existing.status)
    .select()
    .maybeSingle();

  if (error) return sendDbError(res, error);
  if (!data) return res.status(409).json({ error: 'This harvest changed. Refresh and try again.' });
  res.json({ message: 'Harvest updated', harvest: data });
});

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

  if (['for_pickup', 'picked_up'].includes(existing.status) || await harvestHasPickups(id)) {
    return res.status(400).json({ error: 'This harvest is pending pickup or has already been picked up and can no longer be deleted' });
  }

  const { error } = await supabaseAdmin
    .from('harvests')
    .delete()
    .eq('id', id);

  if (error) return sendDbError(res, error);
  res.json({ message: 'Harvest deleted' });
});

// A farmer requests a pickup for part or all of one harvest at their price per kg.
// The database function locks the harvest, so two requests never claim the same kg.
app.post('/api/pickup-requests', verifyToken, async (req, res) => {
  if (req.user.role !== 'farmer') {
    return res.status(403).json({ error: 'Only farmers can request pickups' });
  }
  const { harvest_id, note } = req.body || {};
  if (!harvest_id) return res.status(400).json({ error: 'Select a harvest to request a pickup.', field: 'harvest_id' });
  if (note != null && (typeof note !== 'string' || note.length > 500)) {
    return res.status(400).json({ error: 'Note must be text of 500 characters or fewer.', field: 'note' });
  }
  const { data: harvest, error: harvestError } = await supabaseAdmin.from('harvests')
    .select('id, vegetable_name, quantity_kg, status').eq('id', harvest_id).eq('farmer_id', req.user.userId).maybeSingle();
  if (harvestError) return sendDbError(res, harvestError);
  if (!harvest) return res.status(404).json({ error: 'Harvest not found or not owned by you' });
  const { available_kg: availableKg } = harvestAvailability(harvest, await farmerPickupQuantities(null, harvest.id));
  if (harvest.status !== 'available' || !(availableKg > 0)) {
    return res.status(409).json({ error: 'A pickup has already been requested for this harvest.' });
  }
  const invalid = pickupInputError(req.body || {}, availableKg);
  if (invalid) return res.status(422).json(invalid);
  const quantity = roundKg(req.body.quantity_kg), price = Math.round(Number(req.body.price_per_kg) * 100) / 100;

  const { data: request, error } = await supabaseAdmin.rpc('request_harvest_pickup', {
    p_farmer_id: req.user.userId, p_harvest_id: harvest.id, p_quantity: quantity, p_price: price, p_note: note || null,
  });
  if (error) return sendWorkflowError(res, error);

  const { data: farmer } = await supabaseAdmin
    .from('users').select('full_name').eq('id', req.user.userId).single();
  const label = `${quantity} kg of ${harvest.vegetable_name} at PHP ${price.toFixed(2)} per kg`;

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

const PICKUP_COLUMNS = 'id, farmer_id, harvest_id, note, status, requested_at, delivery_personnel_id, received_by, received_at, proof_photo_url, pod';
// Added by sql/pickup_pricing_and_spoilage.sql; omitted until it is applied.
const PICKUP_PRICING_COLUMNS = 'quantity_kg, price_per_kg, approved_at, declined_at, decline_reason';

// Reads pickup requests with their harvest, newest first. `scope` narrows the query.
async function readPickups(scope) {
  const run = (columns) => scope(supabaseAdmin.from('pickup_requests').select(columns)).order('requested_at', { ascending: false });
  let { data, error } = await run(`${PICKUP_COLUMNS}, ${PICKUP_PRICING_COLUMNS}, harvests (vegetable_name, quantity_kg, recorded_at)`);
  if (needsMigration(error)) ({ data, error } = await run(`${PICKUP_COLUMNS}, harvests (vegetable_name, quantity_kg, recorded_at)`));
  return { data: data || [], error };
}
async function usersById(ids, columns) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await supabaseAdmin.from('users').select(`id, ${columns}`).in('id', unique);
  return Object.fromEntries((data || []).map((user) => [user.id, user]));
}
// Requested quantity (older requests: the whole harvest), price and estimated total.
const withPricing = (pickup) => {
  const quantity = requestedKg(pickup, pickup.harvests);
  return { ...pickup, quantity_kg: quantity, price_per_kg: pickup.price_per_kg ?? null,
    estimated_total: estimatedTotal(quantity, pickup.price_per_kg) };
};

app.get('/api/pickup-requests', verifyToken, async (req, res) => {
  const role = req.user.role;

  // Farmer: only their own requests.
  if (role === 'farmer') {
    const { data, error } = await readPickups((q) => q.eq('farmer_id', req.user.userId));
    if (error) return sendDbError(res, error);
    const peopleById = await usersById(data.flatMap((p) => [p.delivery_personnel_id, p.received_by]), 'full_name, phone');
    const { data: farmerProfile } = await supabaseAdmin.from('users')
      .select('farm_location, latitude, longitude').eq('id', req.user.userId).maybeSingle();
    return res.json(data.map((pickup) => ({
      ...withPricing(pickup),
      rider: pickup.delivery_personnel_id ? peopleById[pickup.delivery_personnel_id] || null : null,
      distributor: pickup.received_by ? peopleById[pickup.received_by] || null : null,
      // The farmer profile is the source of truth for this pickup location.
      pickup_location: { address: farmerProfile?.farm_location || null, latitude: farmerProfile?.latitude || null, longitude: farmerProfile?.longitude || null },
    })));
  }

  // Distributors see every request with the farmer, price and progress details
  // needed before approval and afterwards as history.
  if (role === 'distributor') {
    const { data, error } = await readPickups((q) => q);
    if (error) return sendDbError(res, error);
    const [farmersById, peopleById] = await Promise.all([
      usersById(data.map((r) => r.farmer_id), 'full_name, avatar_url, phone, farm_location'),
      usersById(data.map((r) => r.delivery_personnel_id), 'full_name'),
    ]);
    const pickupIds = data.filter((r) => r.status === 'picked_up').map((r) => r.id);
    let batchByPickup = {};
    if (pickupIds.length) {
      const { data: batches } = await supabaseAdmin.from('products').select('id, pickup_request_id').in('pickup_request_id', pickupIds);
      batchByPickup = Object.fromEntries((batches || []).map((b) => [b.pickup_request_id, b.id]));
    }
    return res.json(data.map((r) => {
      const farmer = farmersById[r.farmer_id];
      return {
        ...withPricing(r),
        farmer_name: farmer?.full_name || null,
        farmer_avatar_url: farmer?.avatar_url || null,
        farmer_phone: farmer?.phone || null,
        pickup_location: farmer?.farm_location || null,
        harvest_date: r.harvests?.recorded_at || null,
        rider_name: r.delivery_personnel_id ? peopleById[r.delivery_personnel_id]?.full_name || null : null,
        batch_id: batchByPickup[r.id] || null,
        created_at: r.requested_at,
      };
    }));
  }

  // Riders see only the requests assigned to them.
  if (role === 'delivery_personnel') {
    const { data, error } = await readPickups((q) => q.eq('delivery_personnel_id', req.user.userId));
    if (error) return sendDbError(res, error);
    const farmersById = await usersById(data.map((r) => r.farmer_id), 'full_name, farm_location, latitude, longitude');
    return res.json(data.map((r) => {
      const farmer = farmersById[r.farmer_id];
      return {
        id: r.id, farmer_id: r.farmer_id, harvest_id: r.harvest_id, note: r.note, status: r.status,
        requested_at: r.requested_at, quantity_kg: requestedKg(r, r.harvests),
        harvests: r.harvests ? { vegetable_name: r.harvests.vegetable_name, quantity_kg: requestedKg(r, r.harvests) } : null,
        farmer_name: farmer?.full_name || null,
        farmer_coords: farmer ? { latitude: farmer.latitude, longitude: farmer.longitude } : null,
        farmer_address: farmer?.farm_location || null,
        created_at: r.requested_at,
      };
    }));
  }

  return res.status(403).json({ error: 'Not allowed' });
});

// Distributor accepts the farmer's quantity and price; a rider can be assigned now or later.
app.put('/api/pickup-requests/:id/approve', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can approve pickup requests' });
  }
  const { id } = req.params;
  const { data: request, error: fetchErr } = await supabaseAdmin
    .from('pickup_requests').select('id, status, farmer_id').eq('id', id).maybeSingle();
  if (fetchErr) return sendDbError(res, fetchErr);
  if (!request) return res.status(404).json({ error: 'Pickup request not found' });
  if (request.status === 'approved') return res.json({ message: 'Pickup request approved', request });
  if (request.status !== 'requested') {
    return res.status(409).json({ error: 'This pickup request was already updated. Refresh and try again.' });
  }
  const { data: updated, error } = await supabaseAdmin.from('pickup_requests')
    .update({ status: 'approved', approved_at: new Date().toISOString(), received_by: req.user.userId })
    .eq('id', id).eq('status', 'requested').select().maybeSingle();
  if (error) return needsMigration(error) || error.code === '23514' ? sendMigrationRequired(res) : sendDbError(res, error);
  if (!updated) return res.status(409).json({ error: 'This pickup request was already updated. Refresh and try again.' });
  await createNotification(request.farmer_id, 'Pickup Approved',
    'Your pickup request was approved. A rider will be assigned to collect your vegetables.', 'pickup', id);
  res.json({ message: 'Pickup request approved', request: updated });
});

// Distributor declines a pending or approved request (before a rider is assigned).
app.put('/api/pickup-requests/:id/decline', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can decline pickup requests' });
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!reason) return res.status(400).json({ error: 'Enter a reason for declining.', field: 'reason' });
  if (reason.length > 300) return res.status(400).json({ error: 'The reason must be 300 characters or fewer.', field: 'reason' });
  const { data: request, error } = await supabaseAdmin.rpc('decline_pickup_request', {
    p_pickup_id: req.params.id, p_distributor_id: req.user.userId, p_reason: reason,
  });
  if (error) return sendWorkflowError(res, error);
  await createNotification(request.farmer_id, 'Pickup Declined',
    `Your pickup request was declined. Reason: ${reason}`, 'pickup', request.id);
  res.json({ message: 'Pickup request declined', request });
});

// Assigns the rider (from Pending, which also approves it, or from Approved).
app.put('/api/pickup-requests/:id/assign', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can assign riders to pickup requests' });
  }
  const { id } = req.params;
  const { delivery_personnel_id } = req.body || {};

  if (!delivery_personnel_id) {
    return res.status(400).json({ error: 'Select a rider for this pickup.', field: 'delivery_personnel_id' });
  }

  const { data: request, error: fetchErr } = await supabaseAdmin
    .from('pickup_requests')
    .select('id, status, farmer_id, harvest_id')
    .eq('id', id)
    .single();

  if (fetchErr || !request) return res.status(404).json({ error: 'Pickup request not found' });
  if (!['requested', 'approved'].includes(request.status)) {
    return res.status(400).json({ error: `Pickup request is already ${request.status}` });
  }
  const riderError = await riderAssignmentError(delivery_personnel_id);
  if (riderError) return res.status(riderError.status).json(riderError.body);

  // Conditional update: only one concurrent assignment can succeed.
  const updates = { status: 'assigned', delivery_personnel_id, received_by: req.user.userId };
  const assign = (values) => supabaseAdmin.from('pickup_requests').update(values)
    .eq('id', id).in('status', ['requested', 'approved']).select().maybeSingle();
  let { data: updated, error: updErr } = await assign(request.status === 'requested' ? { ...updates, approved_at: new Date().toISOString() } : updates);
  // Before sql/pickup_pricing_and_spoilage.sql there is no approved_at column.
  if (needsMigration(updErr)) ({ data: updated, error: updErr } = await assign(updates));

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

app.post('/api/pickup-requests/:id/pickup/check', verifyToken, async (req, res) => {
  if (req.user.role !== 'delivery_personnel') {
    return res.status(403).json({ error: 'Only riders can mark pickups as completed', code: 'PICKUP_FORBIDDEN' });
  }
  const guard = await pickupCompletionGuard(supabaseAdmin, req.params.id, req.user.userId, req.body || {});
  if (guard.reject) return res.status(guard.reject.status).json(guard.reject.body);
  if (guard.done) return res.json({ ok: true, completed: true });
  const tooFar = await pickupProximityRejection(supabaseAdmin, guard.request, guard.pod);
  if (tooFar) return res.status(tooFar.status).json(tooFar.body);
  res.json({ ok: true, completed: false });
});

app.post('/api/pickup-requests/:id/pickup', verifyToken, (req, res) => oneAtATime(`pickup:${req.params.id}`, async () => {
  if (req.user.role !== 'delivery_personnel') {
    return res.status(403).json({ error: 'Only riders can mark pickups as completed' });
  }
  const { id } = req.params;
  const { proof_photo_url } = req.body || {};

  const guard = await pickupCompletionGuard(supabaseAdmin, id, req.user.userId, req.body || {});
  if (guard.reject) return res.status(guard.reject.status).json(guard.reject.body);
  if (guard.done) return res.json(guard.done);
  const { request, pod } = guard;

  let photoUrl;
  try { photoUrl = proofImageUrl(proof_photo_url, pod, undefined, 'Pickup'); }
  catch (err) { return res.status(422).json({ error: err.message, code: err.code || 'PROOF_IMAGE_INVALID' }); }
  try { await ensureProofImage(photoUrl); }
  catch { return res.status(503).json({ error: 'Proof was uploaded, but the pickup could not be completed. Please try again.', code: 'PROOF_IMAGE_UNAVAILABLE' }); }

  const { data: completedPod, error: completeError } = await supabaseAdmin.rpc('complete_pickup_with_proof', {
    p_pickup_id: id, p_rider_id: req.user.userId, p_photo_url: photoUrl, p_pod: pod,
  });
  if (completeError) return res.status(completeError.code === '22023' ? 422 : 500).json({ error: completeError.code === '22023' ? completeError.message : 'Could not save pickup proof. Retry; contact the administrator if this continues.' });

  const updated = { ...request, status: 'picked_up', proof_photo_url: photoUrl, pod: completedPod };

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
    message: 'Pickup completed successfully and inventory updated',
    request: updated,
  });
}));

// Rider marks a pickup as on the way before arriving at the farm.
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

// Pickup tracking; same response shape as GET /api/delivery/tracking/:orderId.
app.get('/api/pickup-requests/:id/tracking', verifyToken, createPickupTrackingHandler({ db: supabaseAdmin, routes: routeService }));

app.get('/', (req, res) => {
  res.json({ message: 'VeggieTrack API is running!' });
});

function sendInventoryError(res, error) {
  const statuses = { P0001: 409, P0002: 404, '22023': 422, '42501': 403 };
  if (statuses[error.code]) return res.status(statuses[error.code]).json({
    error: error.message, ...(error.code === 'P0001' ? { code: 'STOCK_CHANGED', field: 'items' } : {}),
  });
  return sendDbError(res, error);
}

// Each `products` row is one stock batch (received -> listed -> sold_out/archived;
// see lib/batches.js). This route adds a batch from the Stocks form and lists it
// immediately.
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
  if (!isPositiveQuantity(price_per_kg) || !hasStockPrecision(price_per_kg)) {
    return res.status(400).json({ error: 'Price must be a positive number.' });
  }
  if (!isPositiveQuantity(stock_kg) || !hasStockPrecision(stock_kg)) {
    return res.status(400).json({ error: 'Stock must be positive with at most two decimal places in kg.' });
  }
  // Optional free-text farmer name, stored as typed (NULL when left blank).
  const farmerInput = req.body.farmer_name;
  if (farmerInput != null && typeof farmerInput !== 'string') {
    return res.status(400).json({ error: 'Farmer name must be text.', field: 'farmer_name' });
  }
  const farmerName = farmerInput?.trim() || null;
  if (farmerName && farmerName.length > 120) {
    return res.status(400).json({ error: 'Farmer name must be 120 characters or fewer.', field: 'farmer_name' });
  }
  const harvest = batchDate(req.body.harvest_date);
  const pickup = batchDate(req.body.pickup_date);
  if (!harvest) return res.status(400).json({ error: 'Select a valid harvest date.', field: 'harvest_date' });
  if (!pickup) return res.status(400).json({ error: 'Select a valid pickup date.', field: 'pickup_date' });
  if (pickup.day < harvest.day) {
    return res.status(400).json({ error: 'The pickup date cannot be before the harvest date.', field: 'pickup_date' });
  }
  if (pickup.day > manilaToday()) {
    return res.status(400).json({ error: 'The harvest and pickup dates cannot be in the future.', field: 'pickup_date' });
  }
  // 7-day stock rule: stock picked up more than 7 days ago is already past the limit.
  if (daysInStock({ pickup_date: pickup.iso }) > STOCK_ALERT_DAYS) {
    return res.status(400).json({ error: `Stock picked up more than ${STOCK_ALERT_DAYS} days ago can no longer be sold.`, field: 'pickup_date' });
  }
  let batchPhotoUrl;
  try { batchPhotoUrl = validateBatchPhotoUrl(batch_photo_url); }
  catch (error) { return res.status(error.status || 400).json({ error: error.message }); }

  // All listed batches of a vegetable share one price; a new batch adopts it.
  const { data: listed, error: listedError } = await supabaseAdmin
    .from('products').select('*').eq('distributor_id', distributorId).eq('status', 'listed');
  if (listedError) return sendDbError(res, listedError);
  const onSale = (listed || []).filter(sameVegetableAs(vegetable_name)).find(isSellableBatch);

  const batch = {
    distributor_id: distributorId,
    vegetable_name,
    price_per_kg: onSale ? onSale.price_per_kg : Number(price_per_kg),
    stock_kg: Number(stock_kg),
    batch_photo_url: batchPhotoUrl,
    quantity_received: Number(stock_kg),
    status: 'listed',
    farmer_name: farmerName,
    harvest_date: harvest.iso,
    pickup_date: pickup.iso,
  };
  const insertBatch = (row) => supabaseAdmin.from('products').insert(row).select().single();
  let { data, error } = await insertBatch(batch);
  // Retry without the name if sql/batch_farmer_name.sql has not been applied.
  if (missingColumn(error, ['farmer_name'])) {
    console.warn('products.farmer_name missing — apply sql/batch_farmer_name.sql to save farmer names.');
    const withoutName = { ...batch };
    delete withoutName.farmer_name;
    ({ data, error } = await insertBatch(withoutName));
  }

  if (error) return sendDbError(res, error);
  res.status(201).json({ message: 'Product added', product: data });
});

// Stocks: batches still in the warehouse, in FIFO order. Sold-out and archived
// batches appear only in the inventory report. Related names are fetched
// separately so a missing relationship cannot empty the list.
app.get('/api/products', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view their products' });
  }
  const { data: rows, error } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('distributor_id', req.user.userId);

  if (error) return sendDbError(res, error);
  const data = (rows || []).filter(isActiveBatch).sort(compareFifo);

  const farmerIds = [...new Set((data || []).map((p) => p.farmer_id).filter(Boolean))];
  const pickupIds = [...new Set((data || []).map((p) => p.pickup_request_id).filter(Boolean))];

  const [{ data: farmers, error: farmersError }, { data: pickups, error: pickupsError }] = await Promise.all([
    farmerIds.length
      ? supabaseAdmin.from('users').select('id, full_name').in('id', farmerIds)
      : Promise.resolve({ data: [] }),
    pickupIds.length
      ? supabaseAdmin.from('pickup_requests').select('id, received_at').in('id', pickupIds)
      : Promise.resolve({ data: [] }),
  ]);
  if (farmersError || pickupsError) return sendDbError(res, farmersError || pickupsError);

  const farmerNameById = Object.fromEntries((farmers || []).map((f) => [f.id, f.full_name]));
  const pickupDateById = Object.fromEntries((pickups || []).map((p) => [p.id, p.received_at]));

  const list = (data || []).map((p) => ({
    ...p,
    // The linked farmer account (rider pickups), else the name typed on Add New Product.
    farmer_name: farmerNameById[p.farmer_id] || p.farmer_name || null,
    // Pickup batches use the rider's completion time; manual batches use the entered date.
    pickup_date: pickupDateById[p.pickup_request_id] || p.pickup_date || null,
    // 7-day stock rule: day 7 is the last day the batch can be sold.
    days_in_stock: daysInStock(p),
    past_limit: isPastSpoilageLimit(p),
  }));
  res.json(list);
});

// Lists a received batch for sale. If the vegetable is already on sale, the
// batch adopts that price so all batches of a vegetable share one price.
app.put('/api/products/:id/list', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { price_per_kg } = req.body;
  const distributorId = req.user.userId;

  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can list products' });
  }

  const { data: batch, error: fetchError } = await supabaseAdmin
    .from('products')
    .select('id, vegetable_name, status, stock_kg, batch_photo_url')
    .eq('id', id)
    .eq('distributor_id', distributorId)
    .single();

  if (fetchError || !batch) {
    return res.status(404).json({ error: 'Batch not found or not owned by you' });
  }
  // Only a received batch with remaining stock can be listed.
  if (batch.status === 'listed') {
    return res.status(400).json({ error: 'This batch is already on the product list.' });
  }
  if (!isReceivedBatch(batch)) {
    return res.status(400).json({ error: 'This batch is sold out and cannot be added again. Add a new batch instead.' });
  }
  if (!batch.batch_photo_url) {
    return res.status(400).json({ error: 'Upload a recent batch photo in Edit before adding this batch to the product list.' });
  }

  const { data: listed, error: listedError } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('distributor_id', distributorId)
    .eq('status', 'listed');
  if (listedError) return sendDbError(res, listedError);
  const sibling = (listed || []).filter(sameVegetableAs(batch.vegetable_name)).find(isSellableBatch);

  const resolvedPrice = sibling ? sibling.price_per_kg : Number(price_per_kg);
  if (!sibling && (!isPositiveQuantity(price_per_kg) || !hasStockPrecision(price_per_kg))) {
    return res.status(400).json({ error: 'A valid positive price_per_kg is required for the first batch of a vegetable' });
  }

  let update = supabaseAdmin.from('products')
    .update({ status: 'listed', price_per_kg: resolvedPrice, updated_at: new Date() })
    .eq('id', id).eq('distributor_id', distributorId).gt('stock_kg', 0);
  update = batch.status == null ? update.is('status', null) : update.eq('status', 'received');
  const { data, error } = await update.select().maybeSingle();
  if (error) return sendDbError(res, error);
  if (!data) return res.status(409).json({ error: 'This batch changed. Refresh and try again.' });
  res.json({ message: 'Added to product list', product: data });
});

// A batch photo applies to a single batch only.
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

// Only received batches can have their photo removed; listed batches keep theirs.
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
  if (batch.status === 'listed' || COMPLETED_STATUSES.includes(batch.status)) {
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

// Returns every batch (in the given statuses) of the same vegetable as batch `id`,
// matching any name spelling. `missing` is set when `id` is not the distributor's batch.
async function vegetableBatches(id, distributorId, statuses) {
  const { data: anchor, error: anchorError } = await supabaseAdmin
    .from('products')
    .select('id, vegetable_name')
    .eq('id', id)
    .eq('distributor_id', distributorId)
    .single();
  if (anchorError || !anchor) return { missing: true };
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('distributor_id', distributorId)
    .in('status', statuses);
  if (error) return { error };
  return { batches: (data || []).filter(sameVegetableAs(anchor.vegetable_name)) };
}

// Price edits only; stock changes only through pickups, orders and cancellations.
app.put('/api/products/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { price_per_kg } = req.body;
  const distributorId = req.user.userId;
  const role = req.user.role;

  if (role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can update products' });
  }

  const { missing, error: fetchError, batches } = await vegetableBatches(id, distributorId, ['listed', 'sold_out']);
  if (missing) {
    return res.status(404).json({ error: 'Product not found or not owned by you' });
  }
  if (fetchError) return sendDbError(res, fetchError);

  if (price_per_kg === undefined) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  if (!isPositiveQuantity(price_per_kg) || !hasStockPrecision(price_per_kg)) {
    return res.status(400).json({ error: 'Price must be a positive number.' });
  }
  if (batches.length === 0) return res.json({ message: 'Product updated', products: [] });

  // Apply the price to every batch of this vegetable.
  const { data, error } = await supabaseAdmin
    .from('products')
    .update({ price_per_kg, updated_at: new Date() })
    .in('id', batches.map((batch) => batch.id))
    .select();

  if (error) return sendDbError(res, error);
  res.json({ message: 'Product updated', products: data });
});

// Removes a product from the list without deleting history: batches with stock
// return to Stocks as 'received'; sold-out batches become 'archived'.
app.put('/api/products/:id/unlist', verifyToken, async (req, res) => {
  const { id } = req.params;
  const distributorId = req.user.userId;

  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can remove products' });
  }

  const { data: updated, error } = await supabaseAdmin.rpc('unlist_inventory_product', {
    p_product_id: id, p_distributor_id: distributorId,
  });
  if (error) return sendInventoryError(res, error);
  res.json({ message: 'Product removed from list', products: updated || [] });
});

// Stock adjustments use the same transactional FIFO ordering as checkout.
app.put('/api/products/:id/reduce-quantity', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { new_total_kg } = req.body;
  const distributorId = req.user.userId;

  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can update products' });
  }

  if (!isNonNegativeQuantity(new_total_kg) || !hasStockPrecision(new_total_kg)) {
    return res.status(400).json({ error: 'A valid new_total_kg is required' });
  }
  const newTotal = Number(new_total_kg);

  const { missing, error: batchError, batches } = await vegetableBatches(id, distributorId, ['listed']);
  if (missing) {
    return res.status(404).json({ error: 'Product not found or not owned by you' });
  }
  if (batchError) return sendDbError(res, batchError);

  const currentTotal = roundKg(batches.filter(isSellableBatch).reduce((sum, b) => sum + Number(b.stock_kg), 0));
  if (newTotal >= currentTotal) {
    return res.status(400).json({ error: 'New quantity must be less than the current available quantity' });
  }

  const { error } = await supabaseAdmin.rpc('reduce_inventory_quantity', {
    p_product_id: id, p_distributor_id: distributorId,
    p_expected_total: currentTotal, p_new_total: newTotal,
  });
  if (error) return sendInventoryError(res, error);

  res.json({ message: 'Quantity updated' });
});

// Discard: the distributor takes all remaining stock of one batch out of sale. It is
// recorded in Spoiled Products ('discarded'); the batch keeps its history and never
// returns to Stocks. A batch already past the 7-day limit is recorded as such.
app.post('/api/products/:id/discard', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can discard stock' });
  }
  const { data: spoilage, error } = await supabaseAdmin.rpc('discard_product_stock', {
    p_product_id: req.params.id, p_distributor_id: req.user.userId,
  });
  if (error) return sendWorkflowError(res, error);
  const message = spoilage?.reason === 'past_limit'
    ? 'This batch was past its spoilage limit. Its remaining stock is now in Spoiled Products.'
    : 'Stock discarded and moved to Spoiled Products.';
  res.json({ message, spoilage });
});

// Removing a received batch archives it so provenance and order history remain intact.
app.delete('/api/products/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const distributorId = req.user.userId;

  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can delete products' });
  }

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('products')
    .select('id, status, stock_kg')
    .eq('id', id)
    .eq('distributor_id', distributorId)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Product not found or not owned by you' });
  }
  if (!isReceivedBatch(existing)) {
    return res.status(400).json({ error: 'Only un-listed batches can be deleted' });
  }

  let update = supabaseAdmin.from('products')
    .update({ status: 'archived', updated_at: new Date() })
    .eq('id', id).eq('distributor_id', distributorId).gt('stock_kg', 0);
  update = existing.status == null ? update.is('status', null) : update.eq('status', 'received');
  const { data, error } = await update.select('id').maybeSingle();
  if (error) return sendDbError(res, error);
  if (!data) return res.status(409).json({ error: 'This batch changed. Refresh and try again.' });
  res.json({ message: 'Batch archived' });
});

// Distributor product list: one row per vegetable, summing listed batches with stock.
app.get('/api/products/listings', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view their product list' });
  }
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('distributor_id', req.user.userId)
    .in('status', ['listed', 'sold_out']);

  if (error) return sendDbError(res, error);
  res.json(distributorListings(data || []));
});

// Retailer catalogue: one entry per vegetable with stock on sale, without batch or
// farmer details. Sold-out batches are not available stock; FIFO batch selection
// happens when the order is approved.
app.get('/api/products/available', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('status', 'listed')
    .gt('stock_kg', 0);

  if (error) return sendDbError(res, error);
  res.json(retailerProducts(data || []));
});

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
  if (typeof delivery_address !== 'string' || !delivery_address.trim()) {
    return res.status(400).json({ error: 'Delivery address is required' });
  }

  try {
    const deliveryCoords = coordinate({ latitude: req.body.delivery_latitude, longitude: req.body.delivery_longitude });
    if (!deliveryCoords) return res.status(422).json({ error: 'Your saved delivery address needs a map location. Update it in Manage Address before placing your order.', code: 'ADDRESS_LOCATION_REQUIRED', field: 'delivery_address' });
    try { preferred_schedule = validateSchedule(preferred_schedule); }
    catch (err) { return res.status(422).json({ error: err.message, field: 'preferred_schedule' }); }
    // Save the delivery address before creating the order so it is never lost.
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
    const { data: order, error: orderError } = await supabaseAdmin.rpc('place_inventory_order', {
      p_retailer_id: retailerId, p_items: items, p_delivery_address: delivery_address,
      p_delivery_latitude: deliveryCoords.latitude, p_delivery_longitude: deliveryCoords.longitude,
      p_preferred_schedule: preferred_schedule,
    });
    if (orderError) return sendInventoryError(res, orderError);
    if (!order) throw new Error('Order transaction returned no order');

    res.status(201).json({
      message: 'Order placed successfully',
      order: {
        id: order.id,
        status: order.status,
        total_amount: order.total_amount,
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
  await markOverdueOrdersUnsuccessful();

  // Related rows are fetched separately so one failed join cannot empty the list.
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

app.get('/api/orders/pending', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view pending orders' });
  }
  // Close overdue orders first so they cannot be approved.
  await markOverdueOrdersUnsuccessful();
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(`
      *,
      order_items (vegetable_name, quantity_kg, price_at_order)
    `)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: true });

  if (error) return sendDbError(res, error);

  // Pending orders and approved orders without a rider.
  const list = (data || []).filter(o => o.status === 'pending' || !o.delivery_personnel_id);
  res.json(list);
});

// Unpaid orders (registered before /api/orders/:id).
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

// Active orders in the delivery pipeline (registered before /api/orders/:id).
app.get('/api/orders/active', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view active orders' });
  }
  await markOverdueOrdersUnsuccessful();
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select(`
      *,
      order_items (vegetable_name, quantity_kg, price_at_order),
      deliveries (id, status, delivery_personnel_id, proof_photo_url, delivered_at, pod)
    `)
    .eq('distributor_id', req.user.userId)
    // Every reviewed order (approved through delivered, cancelled or unsuccessful).
    // Filtering out 'pending' works before and after the 'unsuccessful' status exists.
    .neq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) return sendDbError(res, error);

  // Attach rider names with a separate lookup.
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
  await markOverdueOrdersUnsuccessful();

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
    if (role === 'distributor' && order.distributor_id !== userId) {
      return res.status(403).json({ error: 'You can only cancel your own orders' });
    }
    if (role === 'distributor' && !reason) {
      return res.status(400).json({ error: 'A cancellation reason is required' });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ error: `Cannot cancel order with status '${order.status}'` });
    }

    const { data: updatedOrder, error: updateErr } = await supabaseAdmin.rpc('cancel_inventory_order', {
      p_order_id: id, p_actor_id: userId, p_reason: reason || null,
    });
    if (updateErr) return sendInventoryError(res, updateErr);
    if (!updatedOrder) return res.status(409).json({ error: 'This order was already updated. Refresh and try again.' });

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

  // Leaving pending draws the stock FIFO in the same statement (sync_order_stock in
  // sql/inventory_transactions.sql); it fails without changes if stock is short.
  const { data: updatedOrder, error: updateError } = await supabaseAdmin
    .from('orders')
    .update({ status: 'approved' })
    .eq('id', id)
    .eq('status', 'pending')
    .select()
    .maybeSingle();

  if (updateError) return sendInventoryError(res, updateError);
  if (!updatedOrder) return res.status(409).json({ error: 'This order was already updated. Refresh and try again.' });

  const { error: deliveryError } = await supabaseAdmin
    .from('deliveries')
    .insert({
      order_id: id,
      delivery_personnel_id: null,
      status: 'pending'
    });

  if (deliveryError) {
    // Returning to pending gives the drawn stock back.
    await supabaseAdmin.from('orders').update({ status: 'pending' }).eq('id', id);
    return res.status(500).json({ error: 'Failed to create delivery record' });
  }

  await createNotification(order.retailer_id, 'Order Approved', `Your order ${id.slice(0,8)} has been approved and will be delivered soon.`, 'order', id);

  res.json({ message: 'Order approved successfully', order: updatedOrder });
});

// Riders the distributor can choose for a new order or pickup: active accounts
// whose rider turned on Available for Deliveries (sql/rider_availability.sql).
// Before that update there is no availability column, so every active rider is listed.
app.get('/api/delivery-personnel', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can access delivery personnel list' });
  }
  const riders = () => supabaseAdmin
    .from('users')
    .select('id, full_name, phone, service_area')
    .eq('role', 'delivery_personnel')
    .eq('account_status', 'active');
  let { data, error } = await riders().eq('is_available_for_delivery', true);
  if (needsMigration(error)) ({ data, error } = await riders());

  if (error) return sendDbError(res, error);
  res.json(data);
});

// Checks that a new assignment may go to this rider: an active rider account with
// Available for Deliveries on. Returns the error to send, or null.
async function riderAssignmentError(riderId) {
  const read = (columns) => supabaseAdmin.from('users').select(columns).eq('id', riderId).maybeSingle();
  let { data: rider, error } = await read('id, role, account_status, is_available_for_delivery');
  if (needsMigration(error)) ({ data: rider, error } = await read('id, role, account_status'));
  if (error) return { status: 500, body: { error: 'Could not check the rider. Please try again.' } };
  if (!rider || rider.role !== 'delivery_personnel' || rider.account_status !== 'active') {
    return { status: 400, body: { error: 'Select a valid rider.', field: 'delivery_personnel_id' } };
  }
  if (rider.is_available_for_delivery === false) {
    return { status: 409, body: { error: 'This rider is not available for new deliveries. Please choose another rider.', code: 'RIDER_UNAVAILABLE', field: 'delivery_personnel_id' } };
  }
  return null;
}

// Rider's own Available for Deliveries status (Rider Home). Only new assignments
// depend on it; deliveries and pickups already assigned stay with the rider.
app.get('/api/delivery/availability', verifyToken, async (req, res) => {
  if (req.user.role !== 'delivery_personnel') {
    return res.status(403).json({ error: 'Only riders have a delivery availability status' });
  }
  const { data, error } = await supabaseAdmin.from('users')
    .select('is_available_for_delivery').eq('id', req.user.userId).maybeSingle();
  if (needsMigration(error)) return sendMigrationRequired(res);
  if (error) return sendDbError(res, error);
  res.json({ available: data?.is_available_for_delivery === true });
});

app.put('/api/delivery/availability', verifyToken, async (req, res) => {
  if (req.user.role !== 'delivery_personnel') {
    return res.status(403).json({ error: 'Only riders can change delivery availability' });
  }
  const available = req.body?.available;
  if (typeof available !== 'boolean') {
    return res.status(400).json({ error: 'Choose whether you are available for deliveries.', field: 'available' });
  }
  const { data, error } = await supabaseAdmin.from('users')
    .update({ is_available_for_delivery: available })
    .eq('id', req.user.userId).eq('role', 'delivery_personnel')
    .select('is_available_for_delivery').maybeSingle();
  if (needsMigration(error)) return sendMigrationRequired(res);
  if (error) return sendDbError(res, error);
  if (!data) return res.status(404).json({ error: 'Rider account not found' });
  res.json({ available: data.is_available_for_delivery === true });
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
    // Re-assigning the same rider is a no-op; replacing an assigned rider is rejected.
    if (order.delivery_personnel_id === delivery_personnel_id) {
      return res.json({ message: 'Delivery personnel assigned successfully' });
    }
    return res.status(409).json({ error: 'This order has already been assigned to a rider.' });
  }
  const riderError = await riderAssignmentError(delivery_personnel_id);
  if (riderError) return res.status(riderError.status).json(riderError.body);

  // Conditional update: only one concurrent assignment can succeed.
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
  await markOverdueOrdersUnsuccessful();
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

// Specific routes must be registered before /:userId.
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

// Riders advance a delivery (picked_up -> in_transit); the status is mirrored onto the order.
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

  // A repeated tap or retry for the status already saved is answered without a
  // second update or a second retailer notification.
  if (delivery.status === status) return res.json({ message: `Delivery marked ${status}`, unchanged: true });
  if (!((delivery.status === 'assigned' && status === 'picked_up') || (delivery.status === 'picked_up' && status === 'in_transit'))) return res.status(409).json({ error: 'Invalid delivery status transition. Refresh and retry.' });
  const { error: progressError } = await supabaseAdmin.rpc('advance_delivery_status', { p_delivery_id: id, p_rider_id: req.user.userId, p_status: status });
  if (progressError) return res.status(progressError.code === '22023' ? 409 : 500).json({ error: 'Unable to update delivery status. Refresh and retry.' });
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

// Riders may decline a delivery only while it is still 'assigned'; the order
// then returns to the distributor's pending list for reassignment.
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

  const handBack = { delivery_personnel_id: null, status: 'pending' };
  // Conditional on 'assigned' so a double tap releases the delivery and notifies the distributor once.
  const release = (changes) => supabaseAdmin.from('deliveries').update(changes)
    .eq('id', id).eq('delivery_personnel_id', req.user.userId).eq('status', 'assigned').select('id');
  let { data: released, error: rejectError } = await release({
    ...handBack,
    rejection_reason: reason.trim().slice(0, 500),
    rejected_at: new Date().toISOString(),
  });
  // Retry without the audit columns if sql/delivery_reject.sql has not been applied.
  if (missingColumn(rejectError, ['rejection_reason', 'rejected_at'])) {
    console.warn('deliveries.rejection_reason/rejected_at missing — apply sql/delivery_reject.sql to record reject reasons.');
    ({ data: released, error: rejectError } = await release(handBack));
  }
  // Stop if the delivery was not released so the order is never unassigned on its own.
  if (rejectError) return sendDbError(res, rejectError, 'The delivery could not be rejected. Please try again.');
  if (!released?.length) return res.status(409).json({ error: 'This delivery was already updated. Please refresh.' });

  const { error: orderError } = await supabaseAdmin
    .from('orders')
    .update({ delivery_personnel_id: null })
    .eq('id', delivery.order_id);
  if (orderError) return sendDbError(res, orderError, 'The delivery could not be rejected. Please try again.');

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

app.post('/api/deliveries/:id/complete/check', verifyToken, async (req, res) => {
  if (req.user.role !== 'delivery_personnel') {
    return res.status(403).json({ error: 'Only delivery personnel can complete deliveries', code: 'DELIVERY_FORBIDDEN' });
  }
  const guard = await deliveryCompletionGuard(supabaseAdmin, req.params.id, req.user.userId, req.body || {});
  if (guard.reject) return res.status(guard.reject.status).json(guard.reject.body);
  if (guard.done) return res.json({ ok: true, completed: true });
  // Location status is informational; distance does not block completion (see validateProof).
  res.json({ ok: true, completed: false, location_status: guard.pod.location_status });
});

app.put('/api/deliveries/:id/complete', verifyToken, (req, res) => oneAtATime(`delivery:${req.params.id}`, async () => {
  const { id } = req.params;
  const { proof_photo_url } = req.body || {};
  const deliveryPersonId = req.user.userId;
  const role = req.user.role;

  if (role !== 'delivery_personnel') {
    return res.status(403).json({ error: 'Only delivery personnel can complete deliveries' });
  }

  const guard = await deliveryCompletionGuard(supabaseAdmin, id, deliveryPersonId, req.body || {});
  if (guard.reject) return res.status(guard.reject.status).json(guard.reject.body);
  if (guard.done) return res.json(guard.done);
  const { delivery, order, pod } = guard;

  let photoUrl;
  try { photoUrl = proofImageUrl(proof_photo_url, pod); }
  catch (err) { return res.status(422).json({ error: err.message, code: err.code || 'PROOF_IMAGE_INVALID' }); }
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
}));

// Distributor weekly report (last 7 days of orders and products)
app.get('/api/distributor/weekly-report', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can access this report' });
  }
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const { data: orders, error: ordersError } = await supabaseAdmin
    .from('orders')
    .select('total_amount, status, created_at')
    .eq('distributor_id', req.user.userId)
    .gte('created_at', oneWeekAgo.toISOString());

  if (ordersError) return sendDbError(res, ordersError);

  const totalRevenue = orders.reduce((sum, o) => sum + o.total_amount, 0);
  const completedOrders = orders.filter(o => o.status === 'delivered').length;

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

// Traceability report: one row per batch and consuming order; unsold batches are included.
app.get('/api/distributor/inventory-report', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can access this report' });
  }
  const distributorId = req.user.userId;

  const { data: batchRows, error: batchesError } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('distributor_id', distributorId);

  if (batchesError) return sendDbError(res, batchesError);
  const batches = (batchRows || []).sort(compareFifo);

  const batchIds = (batches || []).map((b) => b.id);
  const farmerIds = [...new Set((batches || []).map((b) => b.farmer_id).filter(Boolean))];
  const pickupIds = [...new Set((batches || []).map((b) => b.pickup_request_id).filter(Boolean))];

  const [{ data: farmers, error: farmersError }, { data: pickups, error: pickupsError }, { data: orderItems, error: itemsError }] = await Promise.all([
    farmerIds.length ? supabaseAdmin.from('users').select('id, full_name').in('id', farmerIds) : Promise.resolve({ data: [] }),
    pickupIds.length ? supabaseAdmin.from('pickup_requests').select('id, received_at, delivery_personnel_id').in('id', pickupIds) : Promise.resolve({ data: [] }),
    batchIds.length ? supabaseAdmin.from('order_items').select('product_id, order_id, quantity_kg, price_at_order').in('product_id', batchIds) : Promise.resolve({ data: [] }),
  ]);
  if (farmersError || pickupsError || itemsError) return sendDbError(res, farmersError || pickupsError || itemsError);

  const farmerNameById = Object.fromEntries((farmers || []).map((f) => [f.id, f.full_name]));
  const pickupDateById = Object.fromEntries((pickups || []).map((p) => [p.id, p.received_at]));
  const pickupRiderIdById = Object.fromEntries((pickups || []).map((p) => [p.id, p.delivery_personnel_id]));

  // Riders who collected each harvest from the farmer.
  const pickupRiderIds = [...new Set((pickups || []).map((p) => p.delivery_personnel_id).filter(Boolean))];
  let pickupRiderNameById = {};
  if (pickupRiderIds.length) {
    const { data: riders, error } = await supabaseAdmin.from('users').select('id, full_name').in('id', pickupRiderIds);
    if (error) return sendDbError(res, error);
    pickupRiderNameById = Object.fromEntries((riders || []).map((r) => [r.id, r.full_name]));
  }

  const orderIds = [...new Set((orderItems || []).map((it) => it.order_id))];
  let orderById = {};
  let deliveryByOrderId = {};
  let peopleNameById = {};
  let paidOrderIds = new Set();
  if (orderIds.length) {
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select('id, retailer_id, delivery_personnel_id, status')
      .in('id', orderIds);
    if (ordersError) return sendDbError(res, ordersError);
    orderById = Object.fromEntries((orders || []).map((o) => [o.id, o]));

    const { data: deliveries, error: deliveriesError } = await supabaseAdmin
      .from('deliveries')
      .select('order_id, delivered_at')
      .in('order_id', orderIds);
    if (deliveriesError) return sendDbError(res, deliveriesError);
    deliveryByOrderId = Object.fromEntries((deliveries || []).map((d) => [d.order_id, d.delivered_at]));

    const { data: paidPayments, error: paymentsError } = await supabaseAdmin
      .from('payments')
      .select('order_id')
      .in('order_id', orderIds);
    if (paymentsError) return sendDbError(res, paymentsError);
    paidOrderIds = new Set((paidPayments || []).map((p) => p.order_id));

    const peopleIds = [...new Set((orders || []).flatMap((o) => [o.retailer_id, o.delivery_personnel_id]).filter(Boolean))];
    if (peopleIds.length) {
      const { data: people, error } = await supabaseAdmin.from('users').select('id, full_name').in('id', peopleIds);
      if (error) return sendDbError(res, error);
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
      batch_id: batch.id,
      product: batch.vegetable_name,
      batch_status: batchStatus(batch),
      batch_photo_url: batch.batch_photo_url || null,
      farmer_name: farmerNameById[batch.farmer_id] || batch.farmer_name || null,
      harvest_date: batch.harvest_date,
      pickup_date: pickupDateById[batch.pickup_request_id] || batch.pickup_date || null,
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
      // Pending orders have not drawn stock yet; cancelled orders gave it back;
      // unsuccessful deliveries were never sold.
      const unsold = ['pending', 'cancelled', 'unsuccessful'].includes(order?.status);
      rows.push({
        ...base,
        quantity_sold: unsold ? 0 : item.quantity_kg,
        // Use the price charged at order time, not the current price.
        total_amount: unsold ? 0 : Number(item.quantity_kg) * Number(item.price_at_order ?? batch.price_per_kg ?? 0),
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

// Vegetable Chain Tracking: every batch of the distributor with its pickup from
// the farmer, the orders that drew from it and its spoilage (lib/chainTracking.js).
async function loadChainBatches(distributorId) {
  const { data: batchRows, error } = await supabaseAdmin.from('products').select('*').eq('distributor_id', distributorId);
  if (error) return { error };
  const batches = batchRows || [];
  const batchIds = batches.map((b) => b.id);
  const pickupIds = [...new Set(batches.map((b) => b.pickup_request_id).filter(Boolean))];
  const pickupBase = 'id, requested_at, received_at, delivery_personnel_id, proof_photo_url, pod';

  const [pickupsResult, itemsResult, spoilageResult] = await Promise.all([
    (async () => {
      if (!pickupIds.length) return { data: [] };
      const run = (columns) => supabaseAdmin.from('pickup_requests').select(columns).in('id', pickupIds);
      const result = await run(`${pickupBase}, ${PICKUP_PRICING_COLUMNS}`);
      return needsMigration(result.error) ? run(pickupBase) : result;
    })(),
    batchIds.length ? supabaseAdmin.from('order_items').select('product_id, order_id, quantity_kg, price_at_order').in('product_id', batchIds) : { data: [] },
    (async () => {
      if (!batchIds.length) return { data: [] };
      const result = await supabaseAdmin.from('stock_spoilage').select('id, product_id, quantity_kg, reason, recorded_at').in('product_id', batchIds);
      return needsMigration(result.error) ? { data: [] } : result;
    })(),
  ]);
  const failed = [pickupsResult, itemsResult, spoilageResult].find((r) => r.error);
  if (failed) return { error: failed.error };

  const items = itemsResult.data || [];
  const orderIds = [...new Set(items.map((i) => i.order_id))];
  let orders = [], deliveries = [], payments = [];
  if (orderIds.length) {
    const results = await Promise.all([
      supabaseAdmin.from('orders').select('id, retailer_id, delivery_personnel_id, status, created_at, delivered_at, stock_committed_at').in('id', orderIds),
      supabaseAdmin.from('deliveries').select('order_id, delivered_at, proof_photo_url, pod').in('order_id', orderIds),
      supabaseAdmin.from('payments').select('order_id').in('order_id', orderIds),
    ]);
    const orderFailure = results.find((r) => r.error);
    if (orderFailure) return { error: orderFailure.error };
    [orders, deliveries, payments] = results.map((r) => r.data || []);
  }
  const pickups = pickupsResult.data || [];
  const peopleById = await usersById([
    ...batches.map((b) => b.farmer_id), ...pickups.map((p) => p.delivery_personnel_id),
    ...orders.flatMap((o) => [o.retailer_id, o.delivery_personnel_id]),
  ], 'full_name');
  return {
    batches: buildChainBatches({
      batches, farmersById: peopleById, peopleById, items,
      pickupsById: Object.fromEntries(pickups.map((p) => [p.id, p])),
      ordersById: Object.fromEntries(orders.map((o) => [o.id, o])),
      deliveriesByOrderId: Object.fromEntries(deliveries.map((d) => [d.order_id, d])),
      paidOrderIds: new Set(payments.map((p) => p.order_id)),
      spoilage: spoilageResult.data || [],
    }),
  };
}

app.get('/api/distributor/chain-tracking', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view Vegetable Chain Tracking' });
  }
  const { batches, error } = await loadChainBatches(req.user.userId);
  if (error) return sendDbError(res, error);
  res.json({ batches });
});

// Transaction history report: stock received, sales delivered and spoilage dated
// within ?from=YYYY-MM-DD&to=YYYY-MM-DD (Philippine days, inclusive), optionally
// for one ?vegetable=. `vegetables` lists every vegetable the filter can choose.
// Report filters from ?from=YYYY-MM-DD&to=YYYY-MM-DD (Philippine days, inclusive,
// either optional) and ?vegetable=. Sends a 400 and returns null when the dates are invalid.
function reportFilters(req, res) {
  const from = req.query.from ? batchDate(String(req.query.from)) : null;
  const to = req.query.to ? batchDate(String(req.query.to)) : null;
  if ((req.query.from && !from) || (req.query.to && !to)) {
    res.status(400).json({ error: 'Select valid report dates.', field: from ? 'to' : 'from' });
    return null;
  }
  if (from && to && from.day > to.day) {
    res.status(400).json({ error: 'The start date cannot be after the end date.', field: 'from' });
    return null;
  }
  return { from: from?.day, to: to?.day, vegetable: String(req.query.vegetable || '').trim().slice(0, 80) || null };
}

app.get('/api/distributor/chain-report', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view reports' });
  }
  const filters = reportFilters(req, res);
  if (!filters) return;
  const { batches, error } = await loadChainBatches(req.user.userId);
  if (error) return sendDbError(res, error);
  const { from, to, vegetable } = filters;
  const events = chainEvents(batches, filters);
  res.json({
    from: from || null, to: to || null, vegetable: vegetable && canonicalVegetableName(vegetable),
    vegetables: reportVegetables(batches), summary: reportSummary(events), events,
  });
});

// Spoiled Products: stock no longer sellable, newest first, with this week's total.
// Takes the same ?from, ?to and ?vegetable filters as the chain report; without
// them every record is listed. `vegetables` lists each vegetable with a record.
app.get('/api/distributor/spoilage', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view Spoiled Products' });
  }
  const filters = reportFilters(req, res);
  if (!filters) return;
  const { batches, error } = await loadChainBatches(req.user.userId);
  if (error) return sendDbError(res, error);
  const { inRange, hasVegetable } = reportFilter(filters);
  const spoiledBatches = batches.filter((batch) => batch.spoilage.length > 0);
  const records = spoiledBatches.filter((batch) => hasVegetable(batch.vegetable_name)).flatMap((batch) => batch.spoilage
    .filter((record) => inRange(record.recorded_at))
    .map((record) => ({
      ...record, batch_id: batch.batch_id, vegetable_name: batch.vegetable_name, farmer_name: batch.farmer_name,
      harvest_date: batch.harvest_date, batch_status: batch.status,
    }))).sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));
  const week = manilaWeek();
  const thisWeek = chainEvents(batches, week).filter((event) => event.type === 'spoiled');
  res.json({
    this_week: { ...week, kg: reportSummary(thisWeek).spoiled_kg },
    from: filters.from || null, to: filters.to || null,
    vegetable: filters.vegetable && canonicalVegetableName(filters.vegetable),
    vegetables: reportVegetables(spoiledBatches),
    total_kg: roundKg(records.reduce((total, record) => total + Number(record.quantity_kg || 0), 0)),
    records,
  });
});

// Batches on their last sellable day (day 7 in stock) that still have stock. Each
// batch is announced once in Notifications; the list itself is current state.
app.get('/api/distributor/stock-alerts', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view stock alerts' });
  }
  const { data, error } = await supabaseAdmin.from('products').select('*').eq('distributor_id', req.user.userId);
  if (error) return sendDbError(res, error);
  const alerts = (data || []).filter((batch) => needsStockAlert(batch)).sort(compareFifo).map((batch) => {
    const days = daysInStock(batch);
    const harvested = batch.harvest_date ? ` Harvested on ${philippineDate(batch.harvest_date)} and has` : ' It has';
    return {
      batch_id: batch.id, vegetable_name: batch.vegetable_name, remaining_kg: Number(batch.stock_kg),
      harvest_date: batch.harvest_date || null, in_stock_since: stockSince(batch), days_in_stock: days,
      status: batchStatus(batch), price_per_kg: batch.price_per_kg,
      // Day 8 and later: past the spoilage limit, waiting for the distributor to discard it.
      past_limit: isPastSpoilageLimit(batch),
      message: `${batch.vegetable_name} has ${Number(batch.stock_kg)} kg remaining in stock.${harvested} been in stock for ${days} days.`,
    };
  });
  if (alerts.length) {
    const { data: sent } = await supabaseAdmin.from('notifications').select('item_id')
      .eq('user_id', req.user.userId).eq('type', 'stock_alert').in('item_id', alerts.map((a) => a.batch_id));
    const notified = new Set((sent || []).map((n) => n.item_id));
    for (const alert of alerts.filter((a) => !notified.has(a.batch_id))) {
      await createNotification(req.user.userId, 'Stock Alert',
        `${alert.message} Sell it today, change its price or discard it.`, 'stock_alert', alert.batch_id);
    }
  }
  res.json(alerts);
});

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

app.delete('/api/users/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  if (req.user.userId !== id) {
    return res.status(403).json({ error: 'You can only delete your own account' });
  }

  // Accounts are disabled by the distributor rather than deleted, to preserve history.
  res.status(409).json({ error: 'Contact the distributor to disable your account and preserve your transaction history.' });
});

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
    // Fall back to the server receipt time when the client sends no capture time.
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
// DELIVERY TRACKING
app.get('/api/delivery/tracking/:orderId', verifyToken, createTrackingHandler({ db: supabaseAdmin, routes: routeService }));
// DELIVERY ADDRESSES CRUD

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
// Return JSON rather than Express's default HTML for unknown routes and errors.
app.use('/api', (req, res) => res.status(404).json({ error: 'That endpoint does not exist.' }));
// eslint-disable-next-line no-unused-vars -- Express needs all four params to treat this as an error handler.
app.use((err, req, res, next) => {
  console.error('[unhandled route error]', req.method, req.originalUrl, err?.stack || err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// Log unhandled promise rejections instead of letting them stop the server.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandled rejection]', reason?.stack || reason);
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
