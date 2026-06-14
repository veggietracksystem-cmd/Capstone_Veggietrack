const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

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
async function createNotification(userId, title, message, type = 'info') {
  await supabaseAdmin.from('notifications').insert({
    user_id: userId,
    title,
    message,
    type
  });
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
    .select('id, phone, password_hash')
    .eq('phone', phone)
    .single();

  if (error || !user) {
    return res.status(404).json({ error: 'No account found with this phone number' });
  }

  // Legacy accounts (no real password set) skip the password check so existing
  // users aren't locked out. They still complete login via OTP.
  if (!user.password_hash || user.password_hash === LEGACY_PASSWORD_MARKER) {
    return res.json({ valid: true, password_set: false });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  return res.json({ valid: true, password_set: true });
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

  const { data: user, error } = await supabasePublic
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
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }
  otpStore.delete(phone);
    otpAttempts.delete(phone);

  const { data: user, error } = await supabasePublic
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
  const { vegetable_name, quantity_kg, status } = req.body;
  const farmerId = req.user.userId;
  const role = req.user.role;

  if (role !== 'farmer') {
    return res.status(403).json({ error: 'Only farmers can add harvests' });
  }
  if (!vegetable_name || !quantity_kg) {
    return res.status(400).json({ error: 'Vegetable name and quantity required' });
  }

  const { data, error } = await supabaseAdmin
    .from('harvests')
    .insert({
      farmer_id: farmerId,
      vegetable_name,
      quantity_kg,
      status: status || 'available'
    })
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
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const { data, error } = await supabaseAdmin
    .from('harvests')
    .select('vegetable_name, quantity_kg, recorded_at')
    .eq('farmer_id', req.user.userId)
    .gte('recorded_at', oneWeekAgo.toISOString());

  if (error) return res.status(500).json({ error: error.message });

  const summary = {};
  data.forEach(item => {
    if (!summary[item.vegetable_name]) {
      summary[item.vegetable_name] = { total_kg: 0, count: 0 };
    }
    summary[item.vegetable_name].total_kg += item.quantity_kg;
    summary[item.vegetable_name].count += 1;
  });

  res.json({
    period: 'last 7 days',
    total_harvests: data.length,
    summary,
    details: data
  });
});

// Update one of the farmer's own harvests (vegetable_name, quantity_kg, status).
app.put('/api/harvests/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { vegetable_name, quantity_kg, status } = req.body;
  const farmerId = req.user.userId;

  if (req.user.role !== 'farmer') {
    return res.status(403).json({ error: 'Only farmers can update harvests' });
  }

  // Ownership check: the harvest must belong to this farmer.
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('harvests')
    .select('id')
    .eq('id', id)
    .eq('farmer_id', farmerId)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Harvest not found or not owned by you' });
  }

  const updates = {};
  if (vegetable_name !== undefined) updates.vegetable_name = vegetable_name;
  if (quantity_kg !== undefined) updates.quantity_kg = quantity_kg;
  if (status !== undefined) updates.status = status;

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
    .select('id')
    .eq('id', id)
    .eq('farmer_id', farmerId)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Harvest not found or not owned by you' });
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
      'pickup'
    );
  }

  res.status(201).json({ message: 'Pickup requested', request });
});

app.get('/api/pickup-requests', verifyToken, async (req, res) => {
  const role = req.user.role;

  // Farmer: only their own requests (unchanged).
  if (role === 'farmer') {
    const { data, error } = await supabaseAdmin
      .from('pickup_requests')
      .select('id, harvest_id, note, status, requested_at, harvests (vegetable_name, quantity_kg)')
      .eq('farmer_id', req.user.userId)
      .order('requested_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  }

  // Issue 5: distributor sees ALL requests (the HarvestReceiving screen filters
  // to status === 'requested'). Farmer names are attached without relying on an
  // embed relationship so this is robust regardless of FK constraint naming.
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
      created_at: r.requested_at, // alias so the UI's date label renders
    }));
    return res.json(list);
  }

  return res.status(403).json({ error: 'Not allowed' });
});

// Issue 5: distributor confirms receipt of a pickup → mark it received and fold
// the harvest quantity into the distributor's product inventory (creating the
// product if it doesn't exist yet). An optional price_per_kg seeds a new product.
app.post('/api/pickup-requests/:id/receive', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can receive pickups' });
  }
  const { id } = req.params;
  const distributorId = req.user.userId;
  const { price_per_kg } = req.body || {};

  const { data: request, error: reqErr } = await supabaseAdmin
    .from('pickup_requests')
    .select('id, status, harvest_id, harvests (vegetable_name, quantity_kg)')
    .eq('id', id)
    .single();
  if (reqErr || !request) return res.status(404).json({ error: 'Pickup request not found' });
  if (request.status !== 'requested') {
    return res.status(400).json({ error: `Request already ${request.status}` });
  }

  const harvest = request.harvests;
  const qty = Number(harvest?.quantity_kg || 0);
  const vegName = harvest?.vegetable_name;

  if (vegName && qty > 0) {
    const { data: existingProduct } = await supabaseAdmin
      .from('products')
      .select('id, stock_kg')
      .eq('distributor_id', distributorId)
      .eq('vegetable_name', vegName)
      .maybeSingle();

    if (existingProduct) {
      await supabaseAdmin.from('products')
        .update({ stock_kg: Number(existingProduct.stock_kg) + qty, updated_at: new Date() })
        .eq('id', existingProduct.id);
    } else {
      await supabaseAdmin.from('products').insert({
        distributor_id: distributorId,
        vegetable_name: vegName,
        price_per_kg: price_per_kg != null ? price_per_kg : 0,
        stock_kg: qty,
      });
    }
  }

  if (request.harvest_id) {
    await supabaseAdmin.from('harvests').update({ status: 'received' }).eq('id', request.harvest_id);
  }

  const { data: updated, error: updErr } = await supabaseAdmin
    .from('pickup_requests')
    .update({ status: 'received' })
    .eq('id', id)
    .select()
    .single();
  if (updErr) return res.status(500).json({ error: updErr.message });

  res.json({ message: 'Pickup received and inventory updated', request: updated });
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

  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({
      distributor_id: distributorId,
      vegetable_name,
      price_per_kg,
      stock_kg
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ message: 'Product added', product: data });
});

app.get('/api/products', verifyToken, async (req, res) => {
  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can view their products' });
  }
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('distributor_id', req.user.userId)
    .order('updated_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/api/products/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { price_per_kg, stock_kg } = req.body;
  const distributorId = req.user.userId;
  const role = req.user.role;

  if (role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can update products' });
  }

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('products')
    .select('id')
    .eq('id', id)
    .eq('distributor_id', distributorId)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Product not found or not owned by you' });
  }

  const updates = {};
  if (price_per_kg !== undefined) updates.price_per_kg = price_per_kg;
  if (stock_kg !== undefined) updates.stock_kg = stock_kg;
  updates.updated_at = new Date();

  const { data, error } = await supabaseAdmin
    .from('products')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Product updated', product: data });
});

// Delete one of the distributor's own products.
app.delete('/api/products/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const distributorId = req.user.userId;

  if (req.user.role !== 'distributor') {
    return res.status(403).json({ error: 'Only distributors can delete products' });
  }

  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('products')
    .select('id')
    .eq('id', id)
    .eq('distributor_id', distributorId)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Product not found or not owned by you' });
  }

  const { error } = await supabaseAdmin
    .from('products')
    .delete()
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Product deleted' });
});

app.get('/api/products/available', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('id, vegetable_name, price_per_kg, stock_kg')
    .gt('stock_kg', 0);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
    // B2: Validate EVERY item (existence + stock) and compute the total BEFORE
    // mutating anything. Nothing is written until validation fully passes, so a
    // bad item can never leave stock decremented for a half-created order.
    let total_amount = 0;
    const validated = [];

    for (const item of items) {
      const { product_id, quantity_kg } = item;
      if (!product_id || !quantity_kg || quantity_kg <= 0) {
        throw new Error('Each item must have product_id and positive quantity_kg');
      }

      const { data: product, error: productError } = await supabaseAdmin
        .from('products')
        .select('id, vegetable_name, price_per_kg, stock_kg, distributor_id')
        .eq('id', product_id)
        .single();

      if (productError || !product) {
        throw new Error(`Product ${product_id} not found`);
      }
      if (product.stock_kg < quantity_kg) {
        throw new Error(`Insufficient stock for ${product.vegetable_name}. Available: ${product.stock_kg}kg`);
      }

      total_amount += product.price_per_kg * quantity_kg;
      validated.push({ product, quantity_kg });
    }

    const distributorId = validated[0].product.distributor_id;

    // Step 1: create the order first. If this fails, no stock has been touched.
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        retailer_id: retailerId,
        distributor_id: distributorId,
        total_amount,
        delivery_address,
        preferred_schedule: preferred_schedule || null,
        status: 'pending'
      })
      .select()
      .single();

    if (orderError || !order) throw new Error('Failed to create order');

    // Step 2: insert order_items. On failure, remove the order we just made.
    const orderItemsToInsert = validated.map(({ product, quantity_kg }) => ({
      order_id: order.id,
      vegetable_name: product.vegetable_name,
      quantity_kg,
      price_at_order: product.price_per_kg
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
    for (const { product, quantity_kg } of validated) {
      const { error: updateError } = await supabaseAdmin
        .from('products')
        .update({ stock_kg: product.stock_kg - quantity_kg, updated_at: new Date() })
        .eq('id', product.id);

      if (updateError) {
        for (const d of decremented) {
          await supabaseAdmin
            .from('products')
            .update({ stock_kg: d.product.stock_kg, updated_at: new Date() })
            .eq('id', d.product.id);
        }
        await supabaseAdmin.from('order_items').delete().eq('order_id', order.id);
        await supabaseAdmin.from('orders').delete().eq('id', order.id);
        throw new Error(`Failed to update stock for ${product.vegetable_name}`);
      }
      decremented.push({ product, quantity_kg });
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
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
      deliveries (id, status, delivery_personnel_id)
    `)
    .eq('distributor_id', req.user.userId)
    .in('status', ['approved', 'picked_up', 'in_transit'])
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

  await createNotification(order.retailer_id, 'Order Approved', `Your order ${id.slice(0,8)} has been approved and will be delivered soon.`, 'order');

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

  await createNotification(delivery_personnel_id, 'New Delivery Assignment', `You have been assigned to deliver order ${id.slice(0,8)}. Please check the order details.`, 'delivery');
  await createNotification(order.retailer_id, 'Delivery Assigned', `A delivery person has been assigned to your order ${id.slice(0,8)}.`, 'delivery');

  res.json({ message: 'Delivery personnel assigned successfully' });
});

app.get('/api/delivery/orders', verifyToken, async (req, res) => {
  if (req.user.role !== 'delivery_personnel') {
    return res.status(403).json({ error: 'Access denied' });
  }
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(`
      id,
      status,
      total_amount,
      delivery_address,
      preferred_schedule,
      created_at,
      order_items (vegetable_name, quantity_kg, price_at_order),
      deliveries (id, status)
    `)
    .eq('delivery_personnel_id', req.user.userId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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

  await createNotification(order.retailer_id, 'Payment Received', `Your payment of ₱${amount} for order ${order_id.slice(0,8)} has been recorded.`, 'payment');

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
  let query = supabaseAdmin
    .from('users')
    .select('id, full_name, role')
    .neq('id', req.user.userId)
    .order('full_name', { ascending: true });

  // Issue 8: farmers may only message distributors (not retailers/others).
  if (req.user.role === 'farmer') {
    query = query.eq('role', 'distributor');
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
  await supabaseAdmin.from('orders').update({ status }).eq('id', delivery.order_id);

  const { data: order } = await supabaseAdmin
    .from('orders').select('retailer_id').eq('id', delivery.order_id).single();
  if (order) {
    const label = status === 'picked_up' ? 'picked up' : 'on the way';
    await createNotification(
      order.retailer_id,
      'Delivery Update',
      `Your order ${delivery.order_id.slice(0, 8)} has been ${label}.`,
      'delivery'
    );
  }
  res.json({ message: `Delivery marked ${status}` });
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
  await createNotification(order.retailer_id, 'Order Delivered', `Your order ${orderIdShort} has been delivered. Thank you!`, 'delivery');
  await createNotification(order.distributor_id, 'Order Completed', `Order ${orderIdShort} was delivered successfully.`, 'delivery');

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

// ========== REGISTRATION ROUTES ==========
app.post('/api/auth/register', async (req, res) => {
  const { phone, full_name, role, email, password, farm_location, warehouse_location, store_location, service_area } = req.body;

  if (!phone || !full_name || !role) {
    return res.status(400).json({ error: 'Phone, full name, and role are required' });
  }

  // Accept any valid international number (+ and 10–15 digits), not just +63.
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: 'Enter a valid phone number with country code, e.g. +639171234567' });
  }

  // Reject if the phone is already registered.
  const { data: existingUser } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  if (existingUser) {
    return res.status(409).json({ error: 'An account with this phone number already exists' });
  }

  // Issue 3: fail fast (before sending an OTP) if a distributor already exists.
  // verify-registration re-checks this as the authoritative guard.
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

  const otp = generateOTP();
  otpStore.set(phone, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
  pendingRegistrations.set(phone, {
    full_name,
    role,
    email,
    password, // hashed at verify-registration time (optional)
    farm_location,
    warehouse_location,
    store_location,
    service_area,
    createdAt: Date.now()
  });

  await deliverOtp(phone, otp, 'registration'); // Issue 2: real SMS (falls back to console)
  res.json({ message: 'OTP sent to complete registration.' });
});

app.post('/api/auth/verify-registration', async (req, res) => {
  const { phone, otp } = req.body;
  if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });

  // B3: brute-force guard (same logic as verify-otp).
  if (otpAttemptsExceeded(phone)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
  }

  const stored = otpStore.get(phone);
  if (!stored || stored.otp !== otp || stored.expiresAt < Date.now()) {
    recordFailedOtp(phone);
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }
  otpAttempts.delete(phone); // success — clear the counter

  const pending = pendingRegistrations.get(phone);
  if (!pending) {
    return res.status(400).json({ error: 'No pending registration found for this phone number' });
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
    password_hash
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

  if (error) return res.status(500).json({ error: error.message });

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

  const { full_name, email, farm_location, warehouse_location, store_location, service_area } = req.body;
  const updates = {};
  if (full_name !== undefined) updates.full_name = full_name;
  if (email !== undefined) updates.email = email;
  if (farm_location !== undefined) updates.farm_location = farm_location;
  if (warehouse_location !== undefined) updates.warehouse_location = warehouse_location;
  if (store_location !== undefined) updates.store_location = store_location;
  if (service_area !== undefined) updates.service_area = service_area;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', id)
    .select('id, full_name, phone, role, email, farm_location, warehouse_location, store_location, service_area')
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

// ========== PASSWORD RESET (Forgot Password via OTP) ==========
// Step 1: verify the account exists and send a reset OTP.
app.post('/api/auth/forgot-password', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();
  if (!user) return res.status(404).json({ error: 'No account found with this phone number' });

  const otp = generateOTP();
  otpStore.set(phone, { otp, expiresAt: Date.now() + 5 * 60 * 1000 });
  await deliverOtp(phone, otp, 'password reset'); // Issue 2: real SMS (falls back to console)
  res.json({ message: 'OTP sent to reset password.', phone });
});

// Step 2: verify the OTP and set the new password.
app.post('/api/auth/reset-password', async (req, res) => {
  const { phone, otp, new_password } = req.body;
  if (!phone || !otp || !new_password) {
    return res.status(400).json({ error: 'All fields required' });
  }

  // B3: brute-force guard (same logic as verify-otp).
  if (otpAttemptsExceeded(phone)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
  }

  const stored = otpStore.get(phone);
  if (!stored || stored.otp !== otp || stored.expiresAt < Date.now()) {
    recordFailedOtp(phone);
    return res.status(401).json({ error: 'Invalid or expired OTP' });
  }
  otpAttempts.delete(phone); // success — clear the counter

  const hashed = await bcrypt.hash(new_password, 10);
  const { error } = await supabaseAdmin
    .from('users')
    .update({ password_hash: hashed })
    .eq('phone', phone);
  if (error) return res.status(500).json({ error: error.message });

  otpStore.delete(phone);
  res.json({ message: 'Password reset successful. You can now log in.' });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});