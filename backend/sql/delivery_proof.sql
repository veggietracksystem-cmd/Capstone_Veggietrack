-- Apply after delivery_tracking_maps.sql, before deploying the API/mobile changes.
BEGIN;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS pod jsonb;

-- Recover historical snapshots only when the saved address has one unambiguous
-- coordinate pair. Never substitute a different branch or guess from text.
UPDATE public.orders o SET delivery_latitude = a.lat, delivery_longitude = a.lng
FROM (SELECT user_id, lower(trim(address)) AS address, min(latitude) AS lat, min(longitude) AS lng
  FROM public.delivery_addresses WHERE latitude IS NOT NULL AND longitude IS NOT NULL
  GROUP BY user_id, lower(trim(address))
  HAVING count(DISTINCT (latitude, longitude)) = 1) a
WHERE o.retailer_id = a.user_id AND lower(trim(o.delivery_address)) = a.address
  AND o.delivery_latitude IS NULL AND o.delivery_longitude IS NULL;
UPDATE public.orders o SET delivery_latitude = u.latitude, delivery_longitude = u.longitude
FROM public.users u WHERE o.retailer_id = u.id
  AND lower(trim(o.delivery_address)) = lower(trim(u.store_location))
  AND u.latitude IS NOT NULL AND u.longitude IS NOT NULL
  AND o.delivery_latitude IS NULL AND o.delivery_longitude IS NULL;

-- Validate on insertion/rescheduling, not on unrelated updates to old orders.
CREATE OR REPLACE FUNCTION public.validate_delivery_schedule() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.preferred_schedule IS DISTINCT FROM OLD.preferred_schedule THEN
    IF NEW.preferred_schedule IS NULL OR NEW.preferred_schedule <= clock_timestamp() THEN
      RAISE EXCEPTION 'Delivery date and time cannot be in the past.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS validate_delivery_schedule ON public.orders;
CREATE TRIGGER validate_delivery_schedule BEFORE INSERT OR UPDATE OF preferred_schedule
ON public.orders FOR EACH ROW EXECUTE FUNCTION public.validate_delivery_schedule();

-- Service-role-only transaction: lock parent first, then delivery. Retrying after
-- a lost response returns the existing proof without overwriting it.
CREATE OR REPLACE FUNCTION public.complete_delivery_with_proof(
  p_delivery_id uuid, p_rider_id uuid, p_photo_url text, p_pod jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.deliveries; o public.orders; v_order_id uuid;
  lat double precision; lng double precision; accuracy double precision; distance double precision;
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
  lat := (p_pod->>'latitude')::double precision;
  lng := (p_pod->>'longitude')::double precision;
  accuracy := (p_pod->>'accuracy')::double precision;
  IF lat IS NULL OR lng IS NULL OR accuracy IS NULL OR NOT (lat BETWEEN -90 AND 90)
    OR NOT (lng BETWEEN -180 AND 180) OR NOT (accuracy BETWEEN 0 AND 50)
    OR o.delivery_latitude IS NULL OR o.delivery_longitude IS NULL THEN
    RAISE EXCEPTION 'Valid GPS and destination map pin are required' USING ERRCODE = '22023';
  END IF;
  distance := 12742000 * asin(sqrt(least(1.0,
    power(sin(radians(o.delivery_latitude - lat)/2),2) +
    cos(radians(lat))*cos(radians(o.delivery_latitude))*power(sin(radians(o.delivery_longitude-lng)/2),2))));
  IF distance + accuracy > 150 OR p_photo_url IS NULL OR p_photo_url NOT LIKE 'https://res.cloudinary.com/%/image/upload/%'
    OR (p_pod->>'captured_at') IS NULL
    OR (p_pod->>'captured_at')::timestamptz < clock_timestamp() - interval '10 minutes'
    OR (p_pod->>'captured_at')::timestamptz > clock_timestamp() + interval '30 seconds' THEN
    RAISE EXCEPTION 'Proof is outside the destination area or expired. Retake proof.' USING ERRCODE = '22023';
  END IF;
  p_pod := p_pod || jsonb_build_object('location_status','verified','distance_meters',distance);
  UPDATE deliveries SET status = 'delivered', delivered_at = clock_timestamp(),
    proof_photo_url = p_photo_url, pod = p_pod WHERE id = d.id;
  UPDATE orders SET status = 'delivered' WHERE id = o.id;
  RETURN p_pod;
END; $$;
REVOKE ALL ON FUNCTION public.complete_delivery_with_proof(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_delivery_with_proof(uuid,uuid,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.advance_delivery_status(p_delivery_id uuid, p_rider_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.deliveries; o public.orders; v_order_id uuid;
BEGIN
  SELECT order_id INTO v_order_id FROM deliveries WHERE id = p_delivery_id;
  SELECT * INTO o FROM orders WHERE id = v_order_id FOR UPDATE;
  SELECT * INTO d FROM deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF d.id IS NULL OR d.delivery_personnel_id IS DISTINCT FROM p_rider_id
    OR o.delivery_personnel_id IS DISTINCT FROM p_rider_id THEN
    RAISE EXCEPTION 'Delivery not assigned to you' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('picked_up','in_transit') OR p_status IS NULL
    OR o.status IS NULL OR o.status::text NOT IN ('approved','in_transit','picked_up') THEN
    RAISE EXCEPTION 'Invalid delivery status transition' USING ERRCODE = '22023';
  END IF;
  IF d.status = p_status THEN RETURN; END IF;
  IF d.status IS NULL OR NOT ((d.status = 'assigned' AND p_status = 'picked_up') OR (d.status = 'picked_up' AND p_status = 'in_transit')) THEN
    RAISE EXCEPTION 'Invalid delivery status transition' USING ERRCODE = '22023';
  END IF;
  UPDATE deliveries SET status = p_status WHERE id = d.id;
  UPDATE orders SET status = 'in_transit' WHERE id = o.id;
END; $$;
REVOKE ALL ON FUNCTION public.advance_delivery_status(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_delivery_status(uuid,uuid,text) TO service_role;
-- The application uses its authenticated Express API for all order/delivery
-- writes. Close legacy direct REST write grants that bypass that validation.
REVOKE INSERT, UPDATE, DELETE ON public.orders, public.deliveries FROM anon, authenticated;
-- POD contains precise location. Restrict the legacy broad customer SELECT
-- policy to the participants of this order.
DROP POLICY IF EXISTS "Distributors and retailers read deliveries" ON public.deliveries;
CREATE POLICY "Distributors and retailers read deliveries" ON public.deliveries FOR SELECT
USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id
  AND (o.retailer_id = auth.uid() OR o.distributor_id = auth.uid())));
COMMIT;
