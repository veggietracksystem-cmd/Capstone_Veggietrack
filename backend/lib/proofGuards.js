// Proof-of-delivery/pickup checks other than the photo. The app runs them first
// (POST .../complete/check and .../pickup/check) so no photo is uploaded for an
// attempt that would be rejected; the completion routes run them again.
const { validateProof, validatePickupProof } = require('./deliveryProof');
const { coordinate, loadDestination } = require('./deliveryTracking');
const { distanceMeters, PICKUP_PROXIMITY_LIMIT_METERS } = require('./locationPolicy');

// Each guard resolves to exactly one of:
//   { reject: { status, body } }  the caller should answer with this verdict
//   { done: <response body> }     already completed; nothing left to do
//   { ...context, pod }           accepted, with the validated proof metadata
async function deliveryCompletionGuard(db, id, riderId, body) {
  const { data: delivery, error: deliveryError } = await db
    .from('deliveries')
    .select('*, order_id')
    .eq('id', id)
    .eq('delivery_personnel_id', riderId)
    .single();

  if (deliveryError || !delivery) {
    return { reject: { status: 404, body: { error: 'Delivery not found or not assigned to you', code: 'DELIVERY_NOT_FOUND' } } };
  }

  const { data: order, error: orderError } = await db.from('orders').select('*').eq('id', delivery.order_id).single();
  if (orderError || !order) return { reject: { status: 500, body: { error: 'Unable to load delivery destination. Retry.', code: 'DELIVERY_ORDER_LOOKUP_FAILED' } } };
  if (delivery.status === 'delivered' && order.status === 'delivered') return { done: { message: 'Delivery already completed', pod: delivery.pod } };
  if (delivery.status !== 'in_transit' || order.status !== 'in_transit') return { reject: { status: 409, body: { error: 'Delivery must be in transit before submitting proof.', code: 'DELIVERY_NOT_IN_TRANSIT' } } };

  let destination;
  try { destination = await loadDestination(db, order); }
  catch { return { reject: { status: 503, body: { error: 'Unable to load delivery destination. Retry.', code: 'DELIVERY_DESTINATION_LOOKUP_FAILED' } } }; }
  let pod;
  try { pod = validateProof(body, destination); }
  catch (err) { return { reject: { status: 422, body: { error: err.message, code: err.code || 'PROOF_INVALID' } } }; }
  return { delivery, order, pod };
}

async function pickupCompletionGuard(db, id, riderId, body) {
  const { data: request, error: fetchErr } = await db
    .from('pickup_requests')
    .select(`
      id, status, farmer_id, harvest_id, amount, received_by, pod,
      harvests (vegetable_name, quantity_kg, recorded_at)
    `)
    .eq('id', id)
    .eq('delivery_personnel_id', riderId)
    .single();

  if (fetchErr || !request) return { reject: { status: 404, body: { error: 'Pickup request not found', code: 'PICKUP_NOT_FOUND' } } };
  if (request.status === 'picked_up') return { done: { message: 'Pickup already completed', request, pod: request.pod } };
  // Completion is allowed from 'assigned' or 'otw'; the on-the-way step is optional.
  if (!['assigned', 'otw'].includes(request.status)) {
    return { reject: { status: 400, body: { error: `Pickup request cannot be picked up (status: ${request.status})`, code: 'PICKUP_NOT_ACTIONABLE' } } };
  }

  // GPS, photo and timestamp are validated before anything is saved.
  let pod;
  try { pod = validatePickupProof(body); }
  catch (err) { return { reject: { status: 422, body: { error: err.message, code: err.code || 'PROOF_INVALID' } } }; }
  return { request, pod };
}

// Advisory copy of the proximity rule in complete_pickup_with_proof, used only by
// the pre-check. Returns null on lookup failure; the database check is authoritative.
async function pickupProximityRejection(db, request, pod) {
  const { data: farmer, error } = await db
    .from('users').select('latitude, longitude').eq('id', request.farmer_id).maybeSingle();
  if (error) return null;
  const farm = coordinate(farmer);
  if (!farm) return null;
  const distance = distanceMeters(pod, farm);
  if (distance + pod.accuracy <= PICKUP_PROXIMITY_LIMIT_METERS) return null;
  return { status: 422, body: {
    error: `You are approximately ${Math.round(distance)} m from the farmer pickup location. Move closer before completing this pickup.`,
    code: 'PICKUP_TOO_FAR', distance_meters: Math.round(distance) } };
}

// Runs completions of the same record one after another. A second request that
// arrives while the first is still saving (double tap, network retry) waits for
// it and then finds the record already completed (`done`), so it never repeats
// the notifications. One server process; the database functions stay authoritative.
const running = new Map();
function oneAtATime(key, task) {
  const current = (running.get(key) || Promise.resolve()).catch(() => {}).then(task);
  running.set(key, current);
  current.catch(() => {}).finally(() => { if (running.get(key) === current) running.delete(key); });
  return current;
}

module.exports = { deliveryCompletionGuard, pickupCompletionGuard, pickupProximityRejection, oneAtATime };
