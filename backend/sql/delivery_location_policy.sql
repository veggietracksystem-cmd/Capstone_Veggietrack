-- Read-only schema inspection MUST be reviewed before applying the transaction.
-- This combined rollout handles the missing columns/functions found by the hosted
-- read-only inspection. No hosted migration has been applied by this task.
SELECT table_name, column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('orders','deliveries','users','delivery_addresses')
ORDER BY table_name, ordinal_position;

BEGIN;
DO $$
DECLARE expected record; actual_type text;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('orders','id','uuid'), ('orders','retailer_id','uuid'), ('orders','distributor_id','uuid'),
    ('orders','delivery_personnel_id','uuid'), ('orders','status',null), ('orders','delivery_address','text'),
    ('orders','preferred_schedule','timestamp with time zone'),
    ('deliveries','id','uuid'), ('deliveries','order_id','uuid'), ('deliveries','delivery_personnel_id','uuid'),
    ('deliveries','status','text'), ('deliveries','proof_photo_url','text'), ('deliveries','delivered_at','timestamp with time zone'),
    ('users','id','uuid'), ('users','latitude',null), ('users','longitude',null), ('users','store_location','text'),
    ('delivery_addresses','user_id','uuid'), ('delivery_addresses','address','text'),
    ('delivery_addresses','latitude',null), ('delivery_addresses','longitude',null)
  ) AS required(table_name,column_name,data_type) LOOP
    SELECT c.data_type INTO actual_type FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=expected.table_name AND c.column_name=expected.column_name;
    IF actual_type IS NULL OR (expected.data_type IS NOT NULL AND actual_type <> expected.data_type)
      OR (expected.column_name IN ('latitude','longitude') AND actual_type NOT IN ('double precision','numeric','real'))
      OR (expected.column_name='status' AND expected.table_name='orders' AND actual_type NOT IN ('USER-DEFINED','text')) THEN
      RAISE EXCEPTION 'Schema inspection mismatch at %.%; aborting delivery rollout', expected.table_name, expected.column_name;
    END IF;
  END LOOP;
  FOR expected IN SELECT * FROM (VALUES
    ('orders','delivery_latitude','double precision'), ('orders','delivery_longitude','double precision'),
    ('users','current_location_accuracy','double precision'), ('deliveries','pod','jsonb')
  ) AS optional(table_name,column_name,data_type) LOOP
    SELECT c.data_type INTO actual_type FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name=expected.table_name AND c.column_name=expected.column_name;
    IF actual_type IS NOT NULL AND actual_type <> expected.data_type THEN
      RAISE EXCEPTION 'Existing column type mismatch at %.%; aborting delivery rollout', expected.table_name, expected.column_name;
    END IF;
  END LOOP;
END; $$;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_latitude double precision;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_longitude double precision;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS current_location_accuracy double precision;
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS pod jsonb;

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
  IF distance > effective_radius THEN
    RAISE EXCEPTION 'You are approximately % m from the delivery location. Move closer before completing this delivery.', round(distance) USING ERRCODE = '22023';
  END IF;
  IF p_photo_url IS NULL OR p_photo_url NOT LIKE 'https://res.cloudinary.com/%/image/upload/%' THEN
    RAISE EXCEPTION 'A valid uploaded proof photo is required.' USING ERRCODE = '22023';
  END IF;
  p_pod := p_pod || jsonb_build_object('location_status','verified','distance_meters',distance,
    'effective_radius_meters',effective_radius,'coordinate_source',coordinate_source,
    'submitted_at',clock_timestamp());
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
