-- Relaxes complete_delivery_with_proof() so distance-from-destination is
-- recorded (for ETA/routing context) but no longer blocks delivery
-- completion. GPS coordinates, accuracy and timestamp are still required and
-- validated (real, fresh, reasonably accurate fix) — only the "must be
-- standing within the radius" gate is removed. Mirrors the same relaxation
-- already applied to backend/lib/deliveryProof.js (validateProof).
--
-- Run this against the hosted Supabase project's SQL editor (no local
-- migration tooling is wired up for this project — see the other files in
-- this directory for the same pattern).

BEGIN;
CREATE OR REPLACE FUNCTION public.complete_delivery_with_proof(
  p_delivery_id uuid, p_rider_id uuid, p_photo_url text, p_pod jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.deliveries; o public.orders; v_order_id uuid;
  lat double precision; lng double precision; accuracy double precision; distance double precision;
  destination_lat double precision; destination_lng double precision; pin_count integer;
  coordinate_source text; effective_radius double precision; captured timestamptz;
BEGIN
  SELECT order_id INTO v_order_id FROM deliveries WHERE id = p_delivery_id;
  SELECT * INTO o FROM orders WHERE id = v_order_id FOR UPDATE;
  SELECT * INTO d FROM deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF d.id IS NULL OR d.delivery_personnel_id IS DISTINCT FROM p_rider_id
    OR o.delivery_personnel_id IS DISTINCT FROM p_rider_id THEN
    RAISE EXCEPTION 'Delivery not assigned to you' USING ERRCODE = '22023';
  END IF;
  IF d.status = 'delivered' AND o.status::text = 'delivered' THEN RETURN d.pod; END IF;
  IF d.status IS DISTINCT FROM 'in_transit' OR o.status::text IS DISTINCT FROM 'in_transit' THEN
    RAISE EXCEPTION 'Delivery must be in transit' USING ERRCODE = '22023';
  END IF;
  -- Resolve exactly the same precedence as deliveryTracking.destinationFor.
  IF o.delivery_latitude BETWEEN -90 AND 90 AND o.delivery_longitude BETWEEN -180 AND 180 THEN
    destination_lat := o.delivery_latitude; destination_lng := o.delivery_longitude;
    coordinate_source := 'order_snapshot';
  ELSE
    SELECT count(DISTINCT (a.latitude,a.longitude)), min(a.latitude), min(a.longitude)
      INTO pin_count, destination_lat, destination_lng FROM delivery_addresses a
      WHERE a.user_id = o.retailer_id AND trim(coalesce(o.delivery_address,'')) <> ''
        AND lower(regexp_replace(trim(a.address),'\s+',' ','g')) = lower(regexp_replace(trim(o.delivery_address),'\s+',' ','g'))
        AND a.latitude BETWEEN -90 AND 90 AND a.longitude BETWEEN -180 AND 180;
    IF pin_count = 1 THEN coordinate_source := 'saved_address';
    ELSIF pin_count > 1 THEN destination_lat := null; destination_lng := null;
    ELSE
      SELECT u.latitude,u.longitude INTO destination_lat,destination_lng FROM users u
        WHERE u.id = o.retailer_id AND trim(coalesce(o.delivery_address,'')) <> ''
          AND lower(regexp_replace(trim(u.store_location),'\s+',' ','g')) = lower(regexp_replace(trim(o.delivery_address),'\s+',' ','g'))
          AND u.latitude BETWEEN -90 AND 90 AND u.longitude BETWEEN -180 AND 180;
      coordinate_source := 'retailer_store';
    END IF;
  END IF;
  IF destination_lat IS NULL OR destination_lng IS NULL THEN
    RAISE EXCEPTION 'Delivery location coordinates are unavailable. Contact the distributor.' USING ERRCODE = '22023';
  END IF;
  lat := (p_pod->>'latitude')::double precision;
  lng := (p_pod->>'longitude')::double precision;
  accuracy := (p_pod->>'accuracy')::double precision;
  IF lat IS NULL OR lng IS NULL OR NOT (lat BETWEEN -90 AND 90) OR NOT (lng BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'Current GPS coordinates are required.' USING ERRCODE = '22023';
  END IF;
  IF accuracy IS NULL OR NOT (accuracy BETWEEN 0 AND 100) THEN
    RAISE EXCEPTION 'Your current GPS signal is too inaccurate to verify your location. Refresh your location and try again.' USING ERRCODE = '22023';
  END IF;
  captured := (p_pod->>'captured_at')::timestamptz;
  IF captured IS NULL OR captured < clock_timestamp() - interval '60 seconds'
    OR captured > clock_timestamp() + interval '30 seconds' THEN
    RAISE EXCEPTION 'Your GPS location has expired. Refresh your location and try again.' USING ERRCODE = '22023';
  END IF;
  distance := 12742000 * asin(sqrt(least(1.0,
    power(sin(radians(destination_lat - lat)/2),2) +
    cos(radians(lat))*cos(radians(destination_lat))*power(sin(radians(destination_lng-lng)/2),2))));
  effective_radius := 100 + least(accuracy,50);
  -- Distance is recorded below (for ETA/routing context) but no longer
  -- raises — a photo + fresh, reasonably accurate GPS fix is the proof.
  IF p_photo_url IS NULL OR p_photo_url NOT LIKE 'https://res.cloudinary.com/%/image/upload/%' THEN
    RAISE EXCEPTION 'A valid uploaded proof photo is required.' USING ERRCODE = '22023';
  END IF;
  p_pod := p_pod || jsonb_build_object(
    'location_status', CASE WHEN distance <= effective_radius THEN 'verified' ELSE 'unverified' END,
    'distance_meters',distance, 'effective_radius_meters',effective_radius,
    'coordinate_source',coordinate_source, 'submitted_at',clock_timestamp());
  UPDATE deliveries SET status = 'delivered', delivered_at = clock_timestamp(),
    proof_photo_url = p_photo_url, pod = p_pod WHERE id = d.id;
  UPDATE orders SET status = 'delivered', delivered_at = clock_timestamp() WHERE id = o.id;
  RETURN p_pod;
END; $$;
REVOKE ALL ON FUNCTION public.complete_delivery_with_proof(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_delivery_with_proof(uuid,uuid,text,jsonb) TO service_role;
COMMIT;
