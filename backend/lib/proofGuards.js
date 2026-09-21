// Everything a proof-of-delivery/pickup completion is judged on except the
// photo itself, split out so the rider's phone can run the same checks first
// (POST .../complete/check and .../pickup/check) and never upload an image for
// an attempt the server was always going to reject — a rejected upload leaves
// an orphaned file in Cloudinary that nothing ever references.
//
// The real completion routes run these too, so a pre-flight can never become
// the only thing standing between an unverified proof and the database.
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
  // Completion is allowed directly from 'assigned' as well as after the rider
  // has marked 'otw' — the on-the-way step is informational for the farmer,
  // not a mandatory gate the rider must pass through first.
  if (!['assigned', 'otw'].includes(request.status)) {
    return { reject: { status: 400, body: { error: `Pickup request cannot be picked up (status: ${request.status})`, code: 'PICKUP_NOT_ACTIONABLE' } } };
  }

  // Same proof-of-pickup requirement as delivery: GPS + photo + timestamp are
  // mandatory and validated before anything is persisted (see
  // complete_pickup_with_proof, which also checks proximity to the farmer's
  // saved location when one exists).
  let pod;
  try { pod = validatePickupProof(body); }
  catch (err) { return { reject: { status: 422, body: { error: err.message, code: err.code || 'PROOF_INVALID' } } }; }
  return { request, pod };
}

// Advisory copy of the proximity rule complete_pickup_with_proof enforces, used
// only by the pre-flight check so the phone can be told "move closer" before it
// spends an upload. A lookup failure returns null rather than guessing — the
// authoritative check still runs inside the transaction that writes.
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

module.exports = { deliveryCompletionGuard, pickupCompletionGuard, pickupProximityRejection };
