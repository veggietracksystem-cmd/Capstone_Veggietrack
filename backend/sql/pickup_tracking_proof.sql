-- Add pickup proof storage without changing the existing pickup lifecycle.
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS proof_photo_url TEXT;
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS pod JSONB;

-- Rider pickup completion, mirroring complete_delivery_with_proof
-- (sql/delivery_proof.sql): one service-role-only atomic transaction that
-- validates GPS + photo + timestamp and persists them together with the
-- status transition, so a photo URL can never be stored without a verified
-- transaction, and a lost response can be safely retried without duplicating
-- or overwriting an already-completed pickup.
--
-- Unlike delivery (where the retailer's delivery pin is required at order
-- time), a farmer's farm location pin is optional. When it exists, the
-- rider's proof must be within the same radius policy as delivery; when it
-- doesn't, the proximity check is skipped but GPS/photo/timestamp capture is
-- still mandatory — never silently accept a bare photo URL either way.
CREATE OR REPLACE FUNCTION public.complete_pickup_with_proof(
  p_pickup_id uuid, p_rider_id uuid, p_photo_url text, p_pod jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.pickup_requests; farmer_lat double precision; farmer_lng double precision;
  lat double precision; lng double precision; accuracy double precision; distance double precision;
BEGIN
  SELECT * INTO p FROM pickup_requests WHERE id = p_pickup_id FOR UPDATE;
  IF p.id IS NULL OR p.delivery_personnel_id IS DISTINCT FROM p_rider_id THEN
    RAISE EXCEPTION 'Pickup request not assigned to you' USING ERRCODE = '22023';
  END IF;
  IF p.status = 'picked_up' THEN RETURN p.pod; END IF;
  -- Completion is allowed directly from 'assigned' as well as after the rider
  -- has marked 'otw' (on the way) — see PUT /api/pickup-requests/:id/status.
  IF p.status NOT IN ('assigned', 'otw') THEN
    RAISE EXCEPTION 'Pickup request cannot be picked up' USING ERRCODE = '22023';
  END IF;

  lat := (p_pod->>'latitude')::double precision;
  lng := (p_pod->>'longitude')::double precision;
  accuracy := (p_pod->>'accuracy')::double precision;
  IF lat IS NULL OR lng IS NULL OR accuracy IS NULL OR NOT (lat BETWEEN -90 AND 90)
    OR NOT (lng BETWEEN -180 AND 180) OR NOT (accuracy BETWEEN 0 AND 100) THEN
    RAISE EXCEPTION 'Valid current GPS location is required' USING ERRCODE = '22023';
  END IF;
  IF p_photo_url IS NULL OR p_photo_url NOT LIKE 'https://res.cloudinary.com/%/image/upload/%' THEN
    RAISE EXCEPTION 'A valid proof photo is required' USING ERRCODE = '22023';
  END IF;
  IF (p_pod->>'captured_at') IS NULL
    OR (p_pod->>'captured_at')::timestamptz < clock_timestamp() - interval '60 seconds'
    OR (p_pod->>'captured_at')::timestamptz > clock_timestamp() + interval '30 seconds' THEN
    RAISE EXCEPTION 'Your GPS location has expired. Refresh your location and try again.' USING ERRCODE = '22023';
  END IF;

  SELECT latitude, longitude INTO farmer_lat, farmer_lng FROM users WHERE id = p.farmer_id;
  IF farmer_lat IS NOT NULL AND farmer_lng IS NOT NULL THEN
    distance := 12742000 * asin(sqrt(least(1.0,
      power(sin(radians(farmer_lat - lat)/2),2) +
      cos(radians(lat))*cos(radians(farmer_lat))*power(sin(radians(farmer_lng-lng)/2),2))));
    IF distance + accuracy > 150 THEN
      RAISE EXCEPTION 'You are approximately % m from the farmer pickup location. Move closer before completing this pickup.', round(distance) USING ERRCODE = '22023';
    END IF;
    p_pod := p_pod || jsonb_build_object('distance_meters', distance, 'coordinate_source', 'farmer_profile');
  ELSE
    p_pod := p_pod || jsonb_build_object('coordinate_source', 'unavailable');
  END IF;
  p_pod := p_pod || jsonb_build_object('location_status', 'verified');

  UPDATE pickup_requests SET status = 'picked_up', received_at = clock_timestamp(),
    proof_photo_url = p_photo_url, pod = p_pod WHERE id = p.id;
  RETURN p_pod;
END; $$;
REVOKE ALL ON FUNCTION public.complete_pickup_with_proof(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pickup_with_proof(uuid,uuid,text,jsonb) TO service_role;
