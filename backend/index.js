const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { isVegetable, VEGETABLE_VALIDATION_MESSAGE } = require('./lib/vegetables');
const { coordinate, createTrackingHandler, missingColumn } = require('./lib/deliveryTracking');

// Legacy marker stored as password_hash for accounts created before password
// login existed. These accounts have NO real password, so we skip the bcrypt
// check for them rather than locking them out.
const LEGACY_PASSWORD_MARKER = 'registered_with_otp';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Allow the Expo web app (localhost:8081 / :19006) to call this API from the
// browser. Without this, the browser blocks the preflight OPTIONS request and
// the fetch fails silently — even though curl works fine.
app.use(cors());
app.use(express.json());

// Public Supabase client (anon key) – for login/OTP
const supabasePublic = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Admin Supabase client (service_role) – bypasses RLS for authenticated API calls
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Store OTP codes
const otpStore = new Map();
// Store OTP verification attempts
const otpAttempts = new Map(); // key: phone, value: { count, firstAttemptTime }
// Pending registrations awaiting OTP verification (phone -> registration data)
const pendingRegistrations = new Map();
// Cooldown between OTP resends (phone -> lastResendTimestamp)
const otpCooldown = new Map();
// Rate limit for send-otp (phone -> { count, firstAttemptTime })
const sendOtpLimits = new Map();

// ========== OTP DELIVERY (console-only mode) ==========
// Temporary console-only delivery for the capstone demonstration. Twilio has
// been removed, so the OTP is simply printed to the terminal running the
// backend — read the code from there to complete login/registration. The OTP is
// still generated + verified locally (otpStore), so the verify endpoints are
// unchanged. This ALWAYS prints (including in production) since console is now
// the only channel.
async function deliverOtp(phone, otp, context = 'login') {
  console.log(`\n========== OTP for ${phone} (${context}) ==========\nCODE: ${otp}\n==================================\n`);
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ========== OTP BRUTE-FORCE GUARD (shared by all OTP-verifying routes) ==========
// B3: max 5 failed attempts per phone, then a 15-minute lockout. Used by
// verify-otp, verify-registration, and reset-password so none of them can be
// brute-forced (6-digit codes are only ~1M combinations).
function otpAttemptsExceeded(phone) {
  const attempt = otpAttempts.get(phone);
  if (attempt && attempt.count >= 5) {
    if (Date.now() - attempt.firstAttemptTime < 15 * 60 * 1000) return true;
    otpAttempts.delete(phone); // lockout window passed — reset
  }
  return false;
}

function recordFailedOtp(phone) {
  const current = otpAttempts.get(phone);
  if (!current) {
    otpAttempts.set(phone, { count: 1, firstAttemptTime: Date.now() });
  } else {
    current.count += 1;
    otpAttempts.set(phone, current);
  }
}

// International phone validation (E.164): '+' then 10–15 digits. Not PH-only, so
// any country's real number is accepted. Mirrors mobile/src/lib/phone.js.
function isValidPhone(phone) {
  return /^\+\d{10,15}$/.test((phone || '').trim());
}

function generateToken(userId, phone, role) {
  return jwt.sign({ userId, phone, role }, process.env.JWT_SECRET || 'temp_secret_change_this', { expiresIn: '7d' });
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

// Auth middleware
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'temp_secret_change_this');
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ========== AUTH ROUTES ==========
// Step 1 of password+OTP login: validate phone + password BEFORE sending an OTP.
// Returns { valid: true } so the client can proceed to /api/auth/send-otp.
app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body || {};
  
  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone and password are required' });
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, full_name, phone, role, email, farm_location, warehouse_location, store_location, service_area, password_hash')
    .eq('phone', phone)
    .single();

  if (error || !user) {
    return res.status(404).json({ error: 'No account found with this phone number' });
  }

  // Legacy accounts check (if any exist without hashed password)
  if (!user.password_hash || user.password_hash === LEGACY_PASSWORD_MARKER) {
    return res.status(401).json({ error: 'Please re-register your account password.' });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const token = generateToken(user.id, user.phone, user.role);
  res.json({
    message: 'Login successful',
    token,
    user: {
      id: user.id,
      full_name: user.full_name,
      phone: user.phone,
      role: user.role,
      email: user.email,
      farm_location: user.farm_location,
      warehouse_location: user.warehouse_location,
      store_location: user.store_location,
      service_area: user.service_area
    }
  });
});

app.post('/api/auth/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  // Rate limit: max 3 OTP requests per phone in a rolling 10-minute window.
  const nowTs = Date.now();
  const limit = sendOtpLimits.get(phone);
  if (limit) {
    if (nowTs - limit.firstAttemptTime > 10 * 60 * 1000) {
      // Window expired – start fresh.
      sendOtpLimits.set(phone, { count: 1, firstAttemptTime: nowTs });
    } else if (limit.count >= 3) {
      return res.status(429).json({ error: 'Too many OTP requests. Please wait 10 minutes.' });
    } else {
      limit.count += 1;
      sendOtpLimits.set(phone, limit);
    }
  } else {
    sendOtpLimits.set(phone, { count: 1, firstAttemptTime: nowTs });
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, phone, role')
    .eq('phone', phone)
    .single();

  if (error || !user) {
    return res.status(404).json({ error: 'No account found with this phone number' });
  }

  const otp = generateOTP();
  otpStore.set(phone, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
  await deliverOtp(phone, otp, 'login'); // Issue 2: real SMS (falls back to console)
  res.json({ message: 'OTP sent', phone });
});

app.post('/api/auth/verify-otp', async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

    // Check failed attempts
  const attempt = otpAttempts.get(phone);
  if (attempt && attempt.count >= 5) {
    const timeSinceFirst = Date.now() - attempt.firstAttemptTime;
    if (timeSinceFirst < 15 * 60 * 1000) {
      return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    } else {
      otpAttempts.delete(phone);
    }
  }
  const stored = otpStore.get(phone);
  if (!stored || stored.otp !== otp || stored.expiresAt < Date.now()) {
    // B1: record exactly ONE failed attempt (the duplicate counting block that
    // used to live here is gone — it locked users out after ~3 tries, not 5).
    recordFailedOtp(phone);
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }
  otpStore.delete(phone);
    otpAttempts.delete(phone);

  const { data: user, error } = await supabaseAdmin

    .from('users')
    .select('id, full_name, phone, role, email, farm_location, warehouse_location, store_location, service_area')
    .eq('phone', phone)
    .single();

  if (error || !user) return res.status(404).json({ error: 'User not found' });

  const token = generateToken(user.id, user.phone, user.role);
  res.json({
    message: 'Login successful',
    token,
    // `name` kept for dashboard headers; full_name + email + location fields
    // let the Profile screen seed its editable inputs without an extra fetch.
    user: {
      id: user.id,
      name: user.full_name,
      full_name: user.full_name,
      phone: user.phone,
      role: user.role,
      email: user.email,
      farm_location: user.farm_location,
      warehouse_location: user.warehouse_location,
      store_location: user.store_location,
      service_area: user.service_area
    }
  });
});

// ========== FARMER HARVEST ROUTES ==========
app.post('/api/harvests', verifyToken, async (req, res) => {
  const { vegetable_name, quantity_kg, status, harvest_date, image_url } = req.body;
  const farmerId = req.user.userId;
  const role = req.user.role;

  if (role !== 'farmer') {
    return res.status(403).json({ error: 'Only farmers can add harvests' });
  }
  if (!vegetable_name || !quantity_kg) {
    return res.status(400).json({ error: 'Vegetable name and quantity required' });
  }
  if (!isVegetable(vegetable_name)) {
    return res.status(400).json({ error: VEGETABLE_VALIDATION_MESSAGE });
  }

  // The harvest date (recorded_at) is set once, here, by the farmer — never
  // re-entered anywhere downstream (pickup, stocks, listing, order, report).
  const insertPayload = {
    farmer_id: farmerId,
    vegetable_name,
    quantity_kg,
    status: status || 'available'
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

  if (error) return res.status(500).json({ error: error.message });
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

  if (error) return res.status(500).json({ error: error.message });
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

  if (error) return res.status(500).json({ error: error.message });

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

  if (error) return res.status(500).json({ error: error.message });
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

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Harvest deleted' });
});

// ========== PICKUP REQUESTS (Farmer -> Distributors) ==========
app.post('/api/pickup-requests', verifyToken, async (req, res) => {
  if (req.user.role !== 'farmer') {
    return res.status(403).json({ error: 'Only farmers can request pickups' });
  }
  const { harvest_id, note } = req.body || {};

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

  if (error) return res.status(500).json({ error: error.message });

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
      .select('id, harvest_id, note, status, requested_at, harvests (vegetable_name, quantity_kg)')
      .eq('farmer_id', req.user.userId)
      .order('requested_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // Distributor sees ALL requests. Farmer names are attached.
  if (role === 'distributor') {
    const { data, error } = await supabaseAdmin
      .from('pickup_requests')
      .select('id, farmer_id, harvest_id, note, status, requested_at, harvests (vegetable_name, quantity_kg)')
      .order('requested_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    const farmerIds = [...new Set((data || []).map((r) => r.farmer_id).filter(Boolean))];
    let nameById = {};
    if (farmerIds.length) {
      const { data: farmers } = await supabaseAdmin
        .from('users').select('id, full_name').in('id', farmerIds);
      nameById = Object.fromEntries((farmers || []).map((f) => [f.id, f.full_name]));
    }
    const list = (data || []).map((r) => ({
      ...r,
      farmer_name: nameById[r.farmer_id] || null,
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
    if (error) return res.status(500).json({ error: error.message });

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

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('pickup_requests')
    .update({
      status: 'assigned',
      delivery_personnel_id,
      amount: price_per_kg ? Number(price_per_kg) : null,
      received_by: req.user.userId
    })
    .eq('id', id)
    .select()
    .single();

  if (updErr) return res.status(500).json({ error: updErr.message });

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

  const { data: request, error: fetchErr } = await supabaseAdmin
    .from('pickup_requests')
    .select(`
      id, status, farmer_id, harvest_id, amount, received_by,
      harvests (vegetable_name, quantity_kg, recorded_at)
    `)
    .eq('id', id)
    .single();

  if (fetchErr || !request) return res.status(404).json({ error: 'Pickup request not found' });
  if (request.status !== 'assigned') {
    return res.status(400).json({ error: `Pickup request cannot be picked up (status: ${request.status})` });
  }

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('pickup_requests')
    .update({
      status: 'picked_up',
      received_at: new Date()
    })
    .eq('id', id)
    .select()
    .single();

  if (updErr) return res.status(500).json({ error: updErr.message });

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

// B5: DISABLED — this debug route let any authenticated user enumerate every
// user's phone number (a privacy leak). Removed from the API surface. If you
// ever need an admin-only user list, gate it behind a real admin role check.
// app.get('/api/users', verifyToken, async (req, res) => {
//   const { data, error } = await supabasePublic.from('users').select('id, full_name, phone, role');
//   if (error) return res.status(500).json({ error: error.message });
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
  const { vegetable_name, price_per_kg, stock_kg } = req.body;
  const distributorId = req.user.userId;
  const role = req.user.role;

  if (role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can add products' });
  }
  if (!vegetable_name || !price_per_kg || stock_kg === undefined) {
    return res.status(400).json({ error: 'Vegetable name, price, and stock are required' });
  }
  if (!isVegetable(vegetable_name)) {
    return res.status(400).json({ error: VEGETABLE_VALIDATION_MESSAGE });
  }

  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      distributor_id: distributorId,
      vegetable_name,
      price_per_kg,
      stock_kg,
      quantity_received: stock_kg,
      status: 'listed'
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
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

  if (error) return res.status(500).json({ error: error.message });

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
    .select('id, vegetable_name, status')
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

  const { data: sibling } = await supabaseAdmin
    .from('products')
    .select('price_per_kg')
    .eq('distributor_id', distributorId)
    .eq('vegetable_name', batch.vegetable_name)
    .in('status', ['listed', 'sold_out'])
    .limit(1)
    .maybeSingle();

  const resolvedPrice = sibling ? sibling.price_per_kg : Number(price_per_kg);
  if (!sibling && (!price_per_kg || isNaN(resolvedPrice) || resolvedPrice <= 0)) {
    return res.status(400).json({ error: 'price_per_kg is required for the first batch of a vegetable' });
  }

  const { data, error } = await supabaseAdmin
    .from('products')
    .update({ status: 'listed', price_per_kg: resolvedPrice, updated_at: new Date() })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Added to product list', product: data });
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

  // Cascade to every batch of this vegetable so the shared price stays in sync.
  const { data, error } = await supabaseAdmin
    .from('products')
    .update({ price_per_kg, updated_at: new Date() })
    .eq('distributor_id', distributorId)
    .eq('vegetable_name', existing.vegetable_name)
    .in('status', ['listed', 'sold_out'])
    .select();

  if (error) return res.status(500).json({ error: error.message });
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

  if (error) return res.status(500).json({ error: error.message });
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

  const newTotal = Number(new_total_kg);
  if (new_total_kg === undefined || isNaN(newTotal) || newTotal < 0) {
    return res.status(400).json({ error: 'A valid new_total_kg is required' });
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

  const { data: batches, error: batchError } = await supabaseAdmin
    .from('products')
    .select('id, stock_kg')
    .eq('distributor_id', distributorId)
    .eq('vegetable_name', existing.vegetable_name)
    .eq('status', 'listed')
    .gt('stock_kg', 0)
    .order('harvest_date', { ascending: true });

  if (batchError) return res.status(500).json({ error: batchError.message });

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
    if (updateError) return res.status(500).json({ error: updateError.message });
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

  if (error) return res.status(500).json({ error: error.message });
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

  if (error) return res.status(500).json({ error: error.message });

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
    .select('vegetable_name, price_per_kg, stock_kg')
    .eq('status', 'listed')
    .gt('stock_kg', 0);

  if (error) return res.status(500).json({ error: error.message });

  const byVeg = {};
  (data || []).forEach((row) => {
    if (!byVeg[row.vegetable_name]) {
      byVeg[row.vegetable_name] = { vegetable_name: row.vegetable_name, price_per_kg: row.price_per_kg, available_kg: 0 };
    }
    byVeg[row.vegetable_name].available_kg += Number(row.stock_kg);
  });
  res.json(Object.values(byVeg));
});

// ========== RETAILER ORDER ROUTES ==========
app.post('/api/orders', verifyToken, async (req, res) => {
  const { items, delivery_address, preferred_schedule } = req.body;
  const retailerId = req.user.userId;
  const role = req.user.role;

  if (role !== 'retailer') {
    return res.status(403).json({ error: 'Only retailers can place orders' });
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Order items are required' });
  }
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
        throw new Error(`Insufficient stock for ${vegetable_name}. Available: ${totalAvailable}kg`);
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
    const orderValues = { retailer_id: retailerId, distributor_id: distributorId, total_amount,
      delivery_address, preferred_schedule: preferred_schedule || null, status: 'pending',
      ...(deliveryCoords ? { delivery_latitude: deliveryCoords.latitude, delivery_longitude: deliveryCoords.longitude } : {}) };
    const insertOrder = values => supabaseAdmin.from('orders').insert(values).select().single();
    let orderResult = await insertOrder(orderValues);
    if (missingColumn(orderResult.error, ['delivery_latitude', 'delivery_longitude'])) {
      // Keep existing checkout working until the additive migration is applied.
      delete orderValues.delivery_latitude; delete orderValues.delivery_longitude;
      orderResult = await insertOrder(orderValues);
      console.warn('Apply sql/delivery_tracking_maps.sql to retain order map pins.');
    }
    const { data: order, error: orderError } = orderResult;

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

    // Step 3: decrement stock LAST, with best-effort rollback. If a later update
    // fails, restore the stock already reduced and delete the order + items, so
    // the system is never left with lost inventory for an order that didn't commit.
    const decremented = [];
    for (const { batch, quantity_kg } of consumptions) {
      const newStock = Number(batch.stock_kg) - quantity_kg;
      const { error: updateError } = await supabaseAdmin
        .from('products')
        .update({
          stock_kg: newStock,
          status: newStock <= 0 ? 'sold_out' : 'listed',
          updated_at: new Date()
        })
        .eq('id', batch.id);

      if (updateError) {
        for (const d of decremented) {
          await supabaseAdmin
            .from('products')
            .update({ stock_kg: d.batch.stock_kg, status: 'listed', updated_at: new Date() })
            .eq('id', d.batch.id);
        }
        await supabaseAdmin.from('order_items').delete().eq('order_id', order.id);
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        throw new Error(`Failed to update stock for ${batch.vegetable_name}`);
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
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders', verifyToken, async (req, res) => {
  if (req.user.role !== 'retailer') {
    return res.status(403).json({ error: 'Only retailers can view their orders' });
  }

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
    return res.status(500).json({ error: error.message });
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
      .select('order_id, status, proof_photo_url, delivered_at')
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
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(`
      *,
      order_items (vegetable_name, quantity_kg, price_at_order)
    `)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  
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

  if (ordersError) return res.status(500).json({ error: ordersError.message });

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
  const { data: orders, error } = await supabaseAdmin
    .from('orders')
    .select(`
      *,
      order_items (vegetable_name, quantity_kg, price_at_order),
      deliveries (id, status, delivery_personnel_id, proof_photo_url, delivered_at)
    `)
    .eq('distributor_id', req.user.userId)
    .in('status', ['approved', 'picked_up', 'in_transit', 'delivered', 'cancelled'])
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

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
    order_items (*)
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
  if (error) return res.status(500).json({ error: error.message });
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

    const { data: updatedOrder, error: updateErr } = await supabaseAdmin
      .from('orders')
      .update({ status: 'cancelled', cancellation_reason: reason || null })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    // Restore stock to the EXACT batch each item was drawn from (order_items
    // now carries product_id — no more guessing by vegetable_name match).
    if (items && items.length > 0) {
      for (const item of items) {
        if (!item.product_id) continue; // legacy pre-FIFO order_item, nothing to restore to
        const { data: batch } = await supabaseAdmin
          .from('products')
          .select('id, stock_kg, status')
          .eq('id', item.product_id)
          .maybeSingle();

        if (batch) {
          await supabaseAdmin
            .from('products')
            .update({
              stock_kg: Number(batch.stock_kg) + Number(item.quantity_kg),
              status: batch.status === 'sold_out' ? 'listed' : batch.status,
              updated_at: new Date()
            })
            .eq('id', batch.id);
        }
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
    res.status(500).json({ error: err.message });
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
    .select()
    .single();

  if (updateError) return res.status(500).json({ error: updateError.message });

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
    .eq('role', 'delivery_personnel');

  if (error) return res.status(500).json({ error: error.message });
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
    .select('id, status, retailer_id')
    .eq('id', id)
    .eq('distributor_id', distributorId)
    .single();

  if (orderError || !order) {
    return res.status(404).json({ error: 'Order not found or not owned by you' });
  }
  if (order.status !== 'approved') {
    return res.status(400).json({ error: 'Order must be approved before assigning delivery' });
  }

  const { error: updateOrderError } = await supabaseAdmin
    .from('orders')
    .update({ delivery_personnel_id })
    .eq('id', id);

  if (updateOrderError) return res.status(500).json({ error: updateOrderError.message });

  const { error: updateDeliveryError } = await supabaseAdmin
    .from('deliveries')
    .update({ delivery_personnel_id, status: 'assigned' })
    .eq('order_id', id);

  if (updateDeliveryError) return res.status(500).json({ error: updateDeliveryError.message });

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
      id,
      status,
      total_amount,
      delivery_address,
      preferred_schedule,
      created_at,
      retailer_id,
      distributor_id,
      order_items (vegetable_name, quantity_kg, price_at_order),
      deliveries (id, status)
    `)
    .eq('delivery_personnel_id', req.user.userId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

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

    const list = (orders || []).map((o) => {
      const ret = usersInfo[o.retailer_id] || {};
      const dist = usersInfo[o.distributor_id] || {};

      return {
        ...o,
        retailer_name: ret.full_name || 'Retailer',
        retailer_address: o.delivery_address || ret.store_location || 'Retailer address',
        retailer_coords: ret.latitude && ret.longitude ? { latitude: ret.latitude, longitude: ret.longitude } : null,
        distributor_name: dist.full_name || 'Distributor',
        distributor_address: dist.warehouse_location || 'Distributor warehouse',
        distributor_coords: dist.latitude && dist.longitude ? { latitude: dist.latitude, longitude: dist.longitude } : null,
      };
    });

    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  if (!order_id || !amount || amount <= 0) {
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

  if (insertError) return res.status(500).json({ error: insertError.message });

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
  if (error) return res.status(500).json({ error: error.message });
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
  if (error) return res.status(500).json({ error: error.message });
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

  if (error) return res.status(500).json({ error: error.message });
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

  if (error) return res.status(500).json({ error: error.message });
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
      .select('id, full_name, role')
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
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages/unread-count', verifyToken, async (req, res) => {
  const { count, error } = await supabaseAdmin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', req.user.userId)
    .eq('is_read', false);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ count: count || 0 });
});

app.get('/api/messages/:userId', verifyToken, async (req, res) => {
  const me = req.user.userId;
  const other = req.params.userId;

  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('*')
    .or(`and(sender_id.eq.${me},recipient_id.eq.${other}),and(sender_id.eq.${other},recipient_id.eq.${me})`)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

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
  if (error) return res.status(500).json({ error: error.message });
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

  await supabaseAdmin.from('deliveries').update({ status }).eq('id', id);
  // Once the rider picks up the order it is, from the retailer/distributor's
  // point of view, already on its way — so the parent order jumps straight to
  // "in_transit" instead of surfacing the rider-only "picked_up" step.
  const orderStatus = status === 'picked_up' ? 'in_transit' : status;
  await supabaseAdmin.from('orders').update({ status: orderStatus }).eq('id', delivery.order_id);

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

  const deliveryUpdate = { status: 'delivered', delivered_at: new Date() };
  if (proof_photo_url) deliveryUpdate.proof_photo_url = proof_photo_url;

  await supabaseAdmin
    .from('deliveries')
    .update(deliveryUpdate)
    .eq('id', id);

  await supabaseAdmin
    .from('orders')
    .update({ status: 'delivered' })
    .eq('id', delivery.order_id);

  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('retailer_id, distributor_id')
    .eq('id', delivery.order_id)
    .single();

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

  if (ordersError) return res.status(500).json({ error: ordersError.message });

  const totalRevenue = orders.reduce((sum, o) => sum + o.total_amount, 0);
  const completedOrders = orders.filter(o => o.status === 'delivered').length;

  // Products (current inventory)
  const { data: products, error: productsError } = await supabaseAdmin
    .from('products')
    .select('vegetable_name, stock_kg')
    .eq('distributor_id', req.user.userId);

  if (productsError) return res.status(500).json({ error: productsError.message });

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

  if (batchesError) return res.status(500).json({ error: batchesError.message });

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

// ========== REGISTRATION ROUTES ==========
app.post('/api/auth/register', async (req, res) => {
  try {
    const { phone, full_name, role, password, farm_location, warehouse_location, store_location, service_area, latitude, longitude } = req.body;

    if (!phone || !full_name || !role) {
      return res.status(400).json({ error: 'Phone, full name, and role are required' });
    }

    // Accept any valid international number (+ and 10–15 digits), not just +63.
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Enter a valid phone number with country code, e.g. +639171234567' });
    }

    // Reject if the phone is already registered.
    const { data: existingUser, error: checkErr } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (checkErr) {
      console.error('❌ Supabase register check error:', checkErr);
      return res.status(500).json({ error: `Database error: ${checkErr.message}` });
    }

    if (existingUser) {
      return res.status(409).json({ error: 'An account with this phone number already exists' });
    }

    // Fail fast if a distributor already exists.
    if (role === 'distributor') {
      const { data: existingDistributor } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('role', 'distributor')
        .maybeSingle();
      if (existingDistributor) {
        return res.status(409).json({ error: 'Only one distributor account is allowed.' });
      }
    }

    const password_hash = password
      ? await bcrypt.hash(password, 10)
      : LEGACY_PASSWORD_MARKER;

    const newUser = {
      full_name,
      phone,
      role,
      email: null,
      password_hash,
      latitude: latitude || null,
      longitude: longitude || null
    };
    if (role === 'farmer') newUser.farm_location = farm_location || null;
    if (role === 'distributor') newUser.warehouse_location = warehouse_location || null;
    if (role === 'retailer') newUser.store_location = store_location || null;
    if (role === 'delivery_personnel') newUser.service_area = service_area || null;

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .insert(newUser)
      .select()
      .single();

    if (error) {
      console.log('❌ Insert error details:', error);
      return res.status(400).json({ error: error.message });
    }

    const token = generateToken(user.id, user.phone, user.role);
    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        phone: user.phone,
        role: user.role,
        email: user.email,
        farm_location: user.farm_location,
        warehouse_location: user.warehouse_location,
        store_location: user.store_location,
        service_area: user.service_area
      }
    });
  } catch (err) {
    console.error('❌ register error:', err);
    let msg = err.message || 'Registration failed';
    if (msg.includes('fetch failed') || err.name === 'TypeError') {
      msg = 'Database connection failed — please ensure your Supabase project is active and unpaused.';
    }
    res.status(500).json({ error: msg });
  }
});

app.post('/api/auth/verify-registration', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

    // B3: brute-force guard (same logic as verify-otp).
    if (otpAttemptsExceeded(phone)) {
      return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
    }

    const stored = otpStore.get(phone);
    if (!stored || stored.otp !== otp || stored.expiresAt < Date.now()) {
      recordFailedOtp(phone);
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }
    otpAttempts.delete(phone); // success — clear the counter

    const pending = pendingRegistrations.get(phone);
    if (!pending) {
      return res.status(400).json({ error: 'No pending registration found for this phone number. Please submit registration again.' });
    }

    // Issue 3: only one distributor (the hub) may exist. If one is already
    // registered, block this even though the OTP was valid, and clear the pending
    // registration so the phone can re-register under a different role.
    if (pending.role === 'distributor') {
      const { data: existingDistributor } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('role', 'distributor')
        .maybeSingle();
      if (existingDistributor) {
        pendingRegistrations.delete(phone);
        otpStore.delete(phone);
        return res.status(409).json({ error: 'Only one distributor account is allowed.' });
      }
    }

    // Hash the password if one was provided at registration; otherwise fall back
    // to the legacy marker (account works via OTP only, no password login).
    const password_hash = pending.password
      ? await bcrypt.hash(pending.password, 10)
      : LEGACY_PASSWORD_MARKER;

    // Build the user record, attaching only the location field for the role.
    const newUser = {
      full_name: pending.full_name,
      phone,
      role: pending.role,
      email: pending.email || null,
      password_hash,
      latitude: pending.latitude || null,
      longitude: pending.longitude || null
    };
    if (pending.role === 'farmer') newUser.farm_location = pending.farm_location || null;
    if (pending.role === 'distributor') newUser.warehouse_location = pending.warehouse_location || null;
    if (pending.role === 'retailer') newUser.store_location = pending.store_location || null;
    if (pending.role === 'delivery_personnel') newUser.service_area = pending.service_area || null;

    const { data: user, error } = await supabaseAdmin
      .from('users')
      .insert(newUser)
      .select()
      .single();

    console.log('🔍 Insert result:', { data: user, error });

    if (error) {
      console.log('❌ Insert error details:', error);
      return res.status(400).json({ error: `Database insertion error: ${error.message}` });
    }

    pendingRegistrations.delete(phone);
    otpStore.delete(phone);

    const token = generateToken(user.id, user.phone, user.role);
    res.status(201).json({
      token,
      // Return the location fields too so the Profile screen is fully seeded
      // right after registration (the insert .select() returns all columns).
      user: {
        id: user.id,
        full_name: user.full_name,
        phone: user.phone,
        role: user.role,
        email: user.email,
        farm_location: user.farm_location,
        warehouse_location: user.warehouse_location,
        store_location: user.store_location,
        service_area: user.service_area
      }
    });
  } catch (err) {
    console.error('❌ verify-registration error:', err);
    let msg = err.message || 'Verification failed';
    if (msg.includes('fetch failed') || err.name === 'TypeError') {
      msg = 'Database connection failed — please ensure your Supabase project is active and unpaused.';
    }
    res.status(500).json({ error: msg });
  }
});

app.post('/api/auth/resend-otp', async (req, res) => {
  const { phone, purpose = 'login' } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  // Enforce a 60-second cooldown between resends.
  const last = otpCooldown.get(phone);
  if (last && Date.now() - last < 60 * 1000) {
    return res.status(429).json({ error: 'Please wait before requesting another OTP.' });
  }

  if (purpose === 'registration' && !pendingRegistrations.has(phone)) {
    return res.status(400).json({ error: 'No pending registration found for this phone number' });
  }

  const otp = generateOTP();
  otpStore.set(phone, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
  otpCooldown.set(phone, Date.now());

  await deliverOtp(phone, otp, purpose); // Issue 2: real SMS (falls back to console)
  res.json({ message: 'OTP resent.' });
});

app.post('/api/auth/refresh-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });

  try {
    // Accept an expired token as long as the signature is valid.
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'temp_secret_change_this', { ignoreExpiration: true });
    const { userId, phone, role } = decoded;

    // Confirm the user still exists before issuing a fresh token.
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, phone, role')
      .eq('id', userId)
      .single();

    if (error || !user) return res.status(404).json({ error: 'User not found' });

    const newToken = generateToken(user.id, user.phone, user.role);
    res.json({ token: newToken });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

// ========== USER PROFILE ROUTES ==========
app.put('/api/users/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  if (req.user.userId !== id) {
    return res.status(403).json({ error: 'You can only update your own profile' });
  }

  const {
    full_name, email, farm_location, warehouse_location, store_location, service_area,
    latitude, longitude,
  } = req.body;
  const updates = {};
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
    .select('id, full_name, phone, role, email, farm_location, warehouse_location, store_location, service_area, latitude, longitude')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Profile updated', user: data });
});

// Change password (Issue 9). Requires the current password only if the account
// already has one set; legacy OTP-only accounts can set a password for the first
// time without it.
app.put('/api/users/:id/password', verifyToken, async (req, res) => {
  const { id } = req.params;
  if (req.user.userId !== id) {
    return res.status(403).json({ error: 'You can only change your own password' });
  }
  const { current_password, new_password } = req.body || {};
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, password_hash')
    .eq('id', id)
    .single();
  if (error || !user) return res.status(404).json({ error: 'User not found' });

  const hasRealPassword = user.password_hash && user.password_hash !== LEGACY_PASSWORD_MARKER;
  if (hasRealPassword) {
    if (!current_password) {
      return res.status(400).json({ error: 'Current password is required' });
    }
    const ok = await bcrypt.compare(current_password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const password_hash = await bcrypt.hash(new_password, 10);
  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ password_hash })
    .eq('id', id);
  if (updateError) return res.status(500).json({ error: updateError.message });

  res.json({ message: 'Password updated' });
});

// Change phone number. Phone doubles as the login credential (unique, embedded
// in the JWT), so — like the password change above — it requires the current
// password when the account has a real one set; legacy OTP-only accounts can
// change it without. Uniqueness is re-checked the same way registration does.
app.put('/api/users/:id/phone', verifyToken, async (req, res) => {
  const { id } = req.params;
  if (req.user.userId !== id) {
    return res.status(403).json({ error: 'You can only update your own profile' });
  }
  const { current_password, new_phone } = req.body || {};
  if (!new_phone || !isValidPhone(new_phone)) {
    return res.status(400).json({ error: 'Enter a valid phone number with country code, e.g. +639171234567' });
  }
  const phone = new_phone.trim();

  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('id, phone, password_hash, role')
    .eq('id', id)
    .single();
  if (error || !user) return res.status(404).json({ error: 'User not found' });

  const hasRealPassword = user.password_hash && user.password_hash !== LEGACY_PASSWORD_MARKER;
  if (hasRealPassword) {
    if (!current_password) {
      return res.status(400).json({ error: 'Current password is required' });
    }
    const ok = await bcrypt.compare(current_password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
  }

  if (phone === user.phone) {
    return res.json({ message: 'Phone number updated', phone: user.phone, token: generateToken(user.id, user.phone, user.role) });
  }

  const { data: existingUser, error: checkErr } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('phone', phone)
    .neq('id', id)
    .maybeSingle();
  if (checkErr) return res.status(500).json({ error: checkErr.message });
  if (existingUser) return res.status(409).json({ error: 'An account with this phone number already exists' });

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ phone })
    .eq('id', id);
  if (updateError) return res.status(500).json({ error: updateError.message });

  const token = generateToken(user.id, phone, user.role);
  res.json({ message: 'Phone number updated', phone, token });
});

app.delete('/api/users/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  if (req.user.userId !== id) {
    return res.status(403).json({ error: 'You can only delete your own account' });
  }

  const { error } = await supabaseAdmin
    .from('users')
    .delete()
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Account deleted successfully.' });
});

// ========== PASSWORD RESET (Forgot Password via Phone) ==========
app.post('/api/auth/forgot-password', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  if (!user) return res.status(404).json({ error: 'No account found with this phone number' });

  res.json({ message: 'Phone number verified. Proceed to set new password.', phone });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { phone, new_password, password } = req.body;
  const targetPassword = new_password || password;
  if (!phone || !targetPassword) {
    return res.status(400).json({ error: 'Phone number and new password required' });
  }

  const hashed = await bcrypt.hash(targetPassword, 10);
  const { error } = await supabaseAdmin
    .from('users')
    .update({ password_hash: hashed })
    .eq('phone', phone);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ message: 'Password reset successful. You can now log in.' });
});

// 2. Email Reset Link Flow (New Features)
app.post('/api/auth/forgot-password-email', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email address is required' });
  }

  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();

    if (error || !user) {
      // Mock success for security to prevent user enumeration
      return res.json({ message: 'If the email is registered, a password reset link has been sent.' });
    }

    const crypto = require('crypto');
    const token = crypto.randomBytes(20).toString('hex');
    const expires = new Date(Date.now() + 3600000); // 1 hour

    const { error: updateErr } = await supabaseAdmin
      .from('users')
      .update({
        reset_password_token: token,
        reset_password_expires: expires.toISOString()
      })
      .eq('id', user.id);

    if (updateErr) {
      return res.status(500).json({ error: updateErr.message });
    }

    const resetUrl = `http://localhost:${port}/api/auth/reset-password-web?token=${token}`;
    console.log('\n==================================================');
    console.log(`✉️  EMAIL OUTBOX: PASSWORD RESET REQUEST`);
    console.log(`TO: ${user.email} (${user.full_name})`);
    console.log(`LINK: ${resetUrl}`);
    console.log(`EXPIRY: 1 Hour`);
    console.log('==================================================\n');

    res.json({ message: 'If the email is registered, a password reset link has been sent.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/reset-password-web', async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).send('<h1>Invalid Request</h1><p>Reset token is missing.</p>');
  }

  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, reset_password_expires')
      .eq('reset_password_token', token)
      .maybeSingle();

    if (error || !user) {
      return res.status(400).send('<h1>Link Invalid</h1><p>This password reset link is invalid or has already been used.</p>');
    }

    if (new Date(user.reset_password_expires) < new Date()) {
      return res.status(400).send('<h1>Link Expired</h1><p>This password reset link has expired. Please request a new one.</p>');
    }

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Password - VeggieTrack</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #2e7d32;
      --primary-hover: #1b5e20;
      --bg: #f4f7f5;
      --card-bg: #ffffff;
      --text: #2c3e2e;
      --text-muted: #607362;
      --error: #d32f2f;
      --success: #388e3c;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: var(--card-bg);
      padding: 40px;
      border-radius: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.08);
      width: 100%;
      max-width: 440px;
      text-align: center;
      animation: fadeIn 0.5s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(15px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .logo { font-size: 48px; margin-bottom: 12px; display: inline-block; }
    h1 { font-size: 24px; font-weight: 700; color: var(--primary); margin-bottom: 8px; }
    p { font-size: 14px; color: var(--text-muted); margin-bottom: 24px; }
    .form-group { text-align: left; margin-bottom: 20px; }
    label { font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 6px; display: block; }
    input {
      width: 100%;
      padding: 12px 16px;
      border-radius: 8px;
      border: 1px solid #c8d6c9;
      font-family: inherit;
      font-size: 15px;
      transition: all 0.2s;
    }
    input:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 3px rgba(46,125,50,0.15);
    }
    .btn {
      width: 100%;
      background: var(--primary);
      color: white;
      border: none;
      padding: 14px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      margin-top: 10px;
    }
    .btn:hover { background: var(--primary-hover); }
    .error-msg { color: var(--error); font-size: 13px; margin-top: 8px; text-align: left; display: none; }
    .success-card { display: none; }
    .success-icon { font-size: 48px; color: var(--success); margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card" id="form-card">
    <span class="logo">🥬</span>
    <h1>Reset Password</h1>
    <p>Please enter your new password below.</p>
    <form id="reset-form">
      <input type="hidden" name="token" id="token-input">
      <div class="form-group">
        <label for="password">New Password</label>
        <input type="password" id="password" required minlength="6" placeholder="At least 6 characters">
      </div>
      <div class="form-group">
        <label for="confirm-password">Confirm Password</label>
        <input type="password" id="confirm-password" required minlength="6" placeholder="Repeat new password">
        <div class="error-msg" id="match-error">Passwords do not match.</div>
      </div>
      <button type="submit" class="btn" id="submit-btn">Reset Password</button>
    </form>
  </div>

  <div class="card success-card" id="success-card">
    <div class="success-icon">✓</div>
    <h1>Password Reset Successful</h1>
    <p>Your password has been successfully updated. You can now return to the VeggieTrack app and log in with your new credentials.</p>
  </div>

  <script>
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    document.getElementById('token-input').value = token;

    const form = document.getElementById('reset-form');
    const passwordInput = document.getElementById('password');
    const confirmInput = document.getElementById('confirm-password');
    const matchError = document.getElementById('match-error');
    const formCard = document.getElementById('form-card');
    const successCard = document.getElementById('success-card');
    const submitBtn = document.getElementById('submit-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      matchError.style.display = 'none';

      if (passwordInput.value !== confirmInput.value) {
        matchError.style.display = 'block';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Resetting...';

      try {
        const response = await fetch('/api/auth/reset-password-web', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: token,
            password: passwordInput.value
          })
        });

        const data = await response.json();
        if (response.ok) {
          formCard.style.display = 'none';
          successCard.style.display = 'block';
        } else {
          alert(data.error || 'Failed to reset password. Please request a new reset link.');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Reset Password';
        }
      } catch (err) {
        alert('An error occurred. Please check your internet connection.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reset Password';
      }
    });
  </script>
</body>
</html>
    `);
  } catch (err) {
    res.status(500).send('<h1>Server Error</h1><p>' + err.message + '</p>');
  }
});

app.post('/api/auth/reset-password-web', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Token and password are required' });
  }

  try {
    const { data: user, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('id, reset_password_expires')
      .eq('reset_password_token', token)
      .maybeSingle();

    if (fetchError || !user) {
      return res.status(400).json({ error: 'Invalid reset token' });
    }

    if (new Date(user.reset_password_expires) < new Date()) {
      return res.status(400).json({ error: 'Reset token has expired' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        password_hash: hashed,
        reset_password_token: null,
        reset_password_expires: null
      })
      .eq('id', user.id);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to reset password: ' + updateError.message });
    }

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== DEBUG ENDPOINTS ==========
// Debug: List all users (temporary)
app.get('/api/debug/users', async (req, res) => {
  console.log('🔍 DEBUG: Fetching all users...');
  
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, phone, full_name, role, email');
  
  if (error) {
    console.log('❌ Debug error:', error);
    return res.status(500).json({ error: error.message });
  }
  
  console.log(`✅ Found ${data?.length || 0} users`);
  res.json({ users: data, count: data?.length || 0 });
});

// Debug: Check specific phone number
app.get('/api/debug/user/:phone', async (req, res) => {
  const { phone } = req.params;
  console.log(`🔍 DEBUG: Looking for user with phone: ${phone}`);
  
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single();
  
  if (error) {
    console.log('❌ User not found:', error.message);
    return res.json({ exists: false, error: error.message });
  }
  
  console.log('✅ User found:', data);
  res.json({ exists: true, user: data });
});// ============================================
// RIDER LOCATION UPDATE - FIXED
// ============================================

app.post('/api/delivery/update-location', verifyToken, async (req, res) => {
  try {
    const riderId = req.user.userId;
    if (req.user.role !== 'delivery_personnel') return res.status(403).json({ error: 'Only riders can publish delivery GPS' });
    const coords = coordinate(req.body);
    if (!coords) return res.status(400).json({ error: 'Valid latitude and longitude are required' });
    const { delivery_id, accuracy } = req.body;
    if (delivery_id) {
      const { data: order } = await supabaseAdmin.from('orders').select('delivery_personnel_id').eq('id', delivery_id).single();
      if (!order || order.delivery_personnel_id !== riderId) return res.status(403).json({ error: 'This delivery is not assigned to you' });
    }
    const precision = accuracy != null && Number.isFinite(Number(accuracy)) && Number(accuracy) >= 0 ? Number(accuracy) : null;
    const timestamp = new Date().toISOString();
    const updates = { current_latitude: coords.latitude, current_longitude: coords.longitude,
      current_location_accuracy: precision, last_location_update: timestamp };
    let result = await supabaseAdmin.from('users').update(updates).eq('id', riderId);
    if (missingColumn(result.error, ['current_location_accuracy'])) {
      delete updates.current_location_accuracy;
      result = await supabaseAdmin.from('users').update(updates).eq('id', riderId);
    }
    if (result.error) return res.status(500).json({ error: 'Failed to save rider location' });
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
            return res.status(500).json({ error: error.message });
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
            return res.status(500).json({ error: error.message });
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
            return res.status(500).json({ error: error.message });
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
            return res.status(500).json({ error: error.message });
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