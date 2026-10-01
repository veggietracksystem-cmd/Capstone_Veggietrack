-- ============================================================
-- VeggieTrack - farmer pickup quantity and price, pickup approval and decline,
-- discarded stock and the 7-day spoilage rule.
--
-- Run once in the Supabase SQL Editor AFTER inventory_transactions.sql (and
-- batch_lifecycle.sql / batch_farmer_name.sql). Safe to re-run. No rows are
-- deleted. If inventory_transactions.sql or batch_lifecycle.sql is ever run
-- again, run this file again afterwards: it replaces restore_product_stock,
-- receive_pickup_inventory, place_inventory_order and commit_order_stock.
--
-- Pickup request lifecycle (pickup_requests.status):
--   requested  Pending: waiting for the distributor
--   approved   Approved: price and quantity accepted, no rider yet
--   assigned   Ready for pickup: rider assigned
--   otw        In progress: rider on the way
--   picked_up  Successfully picked up (kept as history)
--   declined   Declined by the distributor (kept as history)
-- A farmer may request part of a harvest. The rest stays available for a later
-- request once the current one is picked up or declined.
--
-- 7-day stock rule (one rule for the whole app, see backend/lib/batches.js):
--   Days in stock are counted in Philippine calendar days from the date the batch
--   entered distributor stock (products.pickup_date, else products.created_at).
--   Day 0-6   active and sellable.
--   Day 7     still sellable; the distributor is alerted (keep selling, change the
--             price or discard).
--   Day 8+    past the spoilage limit: remaining stock is moved to Spoiled Products
--             with reason 'past_limit' and is no longer offered to retailers.
--   A distributor discard records reason 'discarded'.
--
-- Inventory identity per batch (no kilogram is counted twice):
--   quantity_received = stock_kg (remaining) + kg drawn by orders
--                       + kg in stock_spoilage + earlier quantity adjustments
-- ============================================================

-- PREVIEW before running: batches that will move to Spoiled Products the first
-- time the app runs the 7-day rule (unsold stock older than 7 days):
--   SELECT id, vegetable_name, stock_kg, coalesce(pickup_date, created_at) AS in_stock_since
--   FROM products WHERE (status IS NULL OR status IN ('received', 'listed')) AND stock_kg > 0
--     AND ((now() AT TIME ZONE INTERVAL '+08:00')::date
--          - (coalesce(pickup_date, created_at) AT TIME ZONE INTERVAL '+08:00')::date) > 7;

BEGIN;

-- 1. Requested quantity and the farmer's price per kg ---------------------------
ALTER TABLE public.pickup_requests ADD COLUMN IF NOT EXISTS quantity_kg numeric(10,2);
ALTER TABLE public.pickup_requests ADD COLUMN IF NOT EXISTS price_per_kg numeric(10,2);
ALTER TABLE public.pickup_requests ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.pickup_requests ADD COLUMN IF NOT EXISTS declined_at timestamptz;
ALTER TABLE public.pickup_requests ADD COLUMN IF NOT EXISTS decline_reason text;

-- Earlier requests always covered the whole harvest, and `amount` held the price
-- per kg the distributor entered when assigning the rider.
UPDATE public.pickup_requests r SET quantity_kg = h.quantity_kg
  FROM public.harvests h WHERE r.harvest_id = h.id AND r.quantity_kg IS NULL AND h.quantity_kg > 0;
UPDATE public.pickup_requests SET price_per_kg = round(amount, 2)
  WHERE price_per_kg IS NULL AND amount > 0;

ALTER TABLE public.pickup_requests DROP CONSTRAINT IF EXISTS pickup_requests_quantity_positive;
ALTER TABLE public.pickup_requests ADD CONSTRAINT pickup_requests_quantity_positive
  CHECK (quantity_kg IS NULL OR quantity_kg > 0);
ALTER TABLE public.pickup_requests DROP CONSTRAINT IF EXISTS pickup_requests_price_positive;
ALTER TABLE public.pickup_requests ADD CONSTRAINT pickup_requests_price_positive
  CHECK (price_per_kg IS NULL OR price_per_kg > 0);
-- NOT VALID: older rows keep whatever status they had; new writes are checked.
ALTER TABLE public.pickup_requests DROP CONSTRAINT IF EXISTS pickup_requests_status_valid;
ALTER TABLE public.pickup_requests ADD CONSTRAINT pickup_requests_status_valid
  CHECK (status IN ('requested', 'approved', 'assigned', 'otw', 'picked_up', 'declined',
    'received', 'completed', 'cancelled')) NOT VALID;

-- Harvest kg already claimed by pickup requests that were not declined. A request
-- without a quantity is an older whole-harvest request.
CREATE OR REPLACE FUNCTION public.harvest_reserved_kg(p_harvest_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(sum(coalesce(r.quantity_kg, h.quantity_kg)), 0)
  FROM public.pickup_requests r JOIN public.harvests h ON h.id = r.harvest_id
  WHERE r.harvest_id = p_harvest_id AND r.status NOT IN ('declined', 'cancelled');
$$;

-- Harvest status follows its pickup requests:
--   for_pickup  a request is still open (pending, approved, assigned, on the way)
--   available   no open request and some kg have not been requested yet
--   picked_up   every kg has been picked up
CREATE OR REPLACE FUNCTION public.sync_harvest_status(p_harvest_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE harvest public.harvests; next_status text;
BEGIN
  SELECT * INTO harvest FROM public.harvests WHERE id = p_harvest_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.pickup_requests WHERE harvest_id = p_harvest_id
      AND status IN ('requested', 'approved', 'assigned', 'otw')) THEN
    next_status := 'for_pickup';
  ELSIF harvest.quantity_kg - public.harvest_reserved_kg(p_harvest_id) > 0 THEN
    next_status := 'available';
  ELSE
    next_status := 'picked_up';
  END IF;
  UPDATE public.harvests SET status = next_status
    WHERE id = p_harvest_id AND status IS DISTINCT FROM next_status;
END;
$$;

-- Creates a farmer's pickup request for part or all of a harvest. The harvest row
-- is locked, so two requests can never claim the same kilograms.
CREATE OR REPLACE FUNCTION public.request_harvest_pickup(p_farmer_id uuid, p_harvest_id uuid,
  p_quantity numeric, p_price numeric, p_note text DEFAULT NULL)
RETURNS public.pickup_requests LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE harvest public.harvests; available numeric; result public.pickup_requests;
BEGIN
  SELECT * INTO harvest FROM public.harvests WHERE id = p_harvest_id AND farmer_id = p_farmer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Harvest not found or not owned by you' USING ERRCODE = 'P0002'; END IF;
  IF p_quantity IS NULL OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_quantity <= 0 OR p_quantity <> round(p_quantity, 2) THEN
    RAISE EXCEPTION 'Enter a quantity greater than 0 kg.' USING ERRCODE = '22023';
  END IF;
  IF p_price IS NULL OR p_price::text IN ('NaN', 'Infinity', '-Infinity')
    OR p_price <= 0 OR p_price <> round(p_price, 2) OR p_price > 100000 THEN
    RAISE EXCEPTION 'Enter a price per kg greater than 0.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pickup_requests WHERE harvest_id = p_harvest_id
      AND status IN ('requested', 'approved', 'assigned', 'otw')) THEN
    RAISE EXCEPTION 'A pickup has already been requested for this harvest.' USING ERRCODE = 'P0001';
  END IF;
  available := harvest.quantity_kg - public.harvest_reserved_kg(p_harvest_id);
  IF available <= 0 THEN
    RAISE EXCEPTION 'This harvest has no kilograms left to request.' USING ERRCODE = 'P0001';
  END IF;
  IF p_quantity > available THEN
    RAISE EXCEPTION 'You can request up to % kg from this harvest.', trim_scale(available) USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.pickup_requests(farmer_id, harvest_id, note, status, quantity_kg, price_per_kg)
    VALUES (p_farmer_id, p_harvest_id, nullif(btrim(p_note), ''), 'requested', p_quantity, p_price)
    RETURNING * INTO result;
  PERFORM public.sync_harvest_status(p_harvest_id);
  RETURN result;
END;
$$;

-- The distributor declines a pending or approved request before a rider is
-- assigned. The harvest kilograms become available to request again.
CREATE OR REPLACE FUNCTION public.decline_pickup_request(p_pickup_id uuid, p_distributor_id uuid, p_reason text)
RETURNS public.pickup_requests LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE result public.pickup_requests;
BEGIN
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to decline a pickup request.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO result FROM public.pickup_requests WHERE id = p_pickup_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pickup request not found' USING ERRCODE = 'P0002'; END IF;
  IF result.status = 'declined' THEN RETURN result; END IF;
  IF result.status NOT IN ('requested', 'approved') THEN
    RAISE EXCEPTION 'This pickup request was already updated. Refresh and try again.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.pickup_requests SET status = 'declined', declined_at = clock_timestamp(),
    decline_reason = btrim(p_reason), received_by = coalesce(received_by, p_distributor_id)
    WHERE id = p_pickup_id RETURNING * INTO result;
  IF result.harvest_id IS NOT NULL THEN PERFORM public.sync_harvest_status(result.harvest_id); END IF;
  RETURN result;
END;
$$;

-- A completed pickup creates one received batch with the requested quantity
-- (replaces the inventory_transactions.sql version, which took the whole harvest).
CREATE OR REPLACE FUNCTION public.receive_pickup_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE harvest public.harvests; received numeric;
BEGIN
  IF NEW.status <> 'picked_up' OR OLD.status = 'picked_up' THEN RETURN NEW; END IF;
  IF NEW.harvest_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO harvest FROM public.harvests WHERE id = NEW.harvest_id;
  IF NOT FOUND OR NEW.received_by IS NULL THEN
    RAISE EXCEPTION 'The pickup needs a valid harvest and receiving distributor';
  END IF;
  received := coalesce(NEW.quantity_kg, harvest.quantity_kg);
  IF received IS NULL OR received <= 0 THEN
    RAISE EXCEPTION 'The pickup needs a valid harvest and receiving distributor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE pickup_request_id = NEW.id) THEN
    INSERT INTO public.products(distributor_id, vegetable_name, price_per_kg, stock_kg,
      quantity_received, harvest_date, pickup_date, harvest_id, pickup_request_id, farmer_id, status)
    VALUES(NEW.received_by, harvest.vegetable_name, NULL, received,
      received, harvest.recorded_at,
      NEW.received_at, harvest.id, NEW.id, NEW.farmer_id, 'received');
  END IF;
  PERFORM public.sync_harvest_status(harvest.id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS receive_pickup_inventory ON public.pickup_requests;
CREATE TRIGGER receive_pickup_inventory AFTER UPDATE OF status ON public.pickup_requests
  FOR EACH ROW EXECUTE FUNCTION public.receive_pickup_inventory();

-- 2. Spoiled Products ---------------------------------------------------------------
-- One row per kilogram amount taken out of sellable stock because it spoiled.
-- The batch itself (products) is never deleted, so every row traces back to its
-- farmer, harvest, pickup request and orders through products.
CREATE TABLE IF NOT EXISTS public.stock_spoilage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  distributor_id uuid,
  quantity_kg numeric(10,2) NOT NULL CHECK (quantity_kg > 0),
  reason text NOT NULL CHECK (reason IN ('discarded', 'past_limit')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid
);
CREATE INDEX IF NOT EXISTS stock_spoilage_product_idx ON public.stock_spoilage(product_id);
CREATE INDEX IF NOT EXISTS stock_spoilage_distributor_time_idx ON public.stock_spoilage(distributor_id, recorded_at);
ALTER TABLE public.stock_spoilage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_spoilage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stock_spoilage TO service_role;

-- A batch whose remaining stock went to Spoiled Products is 'spoiled' (history only).
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_status_valid;
ALTER TABLE public.products ADD CONSTRAINT products_status_valid
  CHECK (status IS NULL OR status IN ('received', 'listed', 'sold_out', 'archived', 'inactive', 'rejected', 'spoiled'));

-- Philippine calendar days a batch has been in distributor stock.
CREATE OR REPLACE FUNCTION public.batch_days_in_stock(p_since timestamptz, p_now timestamptz DEFAULT clock_timestamp())
RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT ((p_now AT TIME ZONE INTERVAL '+08:00')::date - (p_since AT TIME ZONE INTERVAL '+08:00')::date)::integer;
$$;

-- Moves the unsold stock of every batch past the 7-day limit (day 8 or later) to
-- Spoiled Products. Runs before stock is shown or sold, and daily from pg_cron.
CREATE OR REPLACE FUNCTION public.spoil_expired_batches()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE batch public.products; moved integer := 0;
BEGIN
  FOR batch IN SELECT * FROM public.products
    WHERE (status IS NULL OR status IN ('received', 'listed')) AND stock_kg > 0
      AND public.batch_days_in_stock(coalesce(pickup_date, created_at)) > 7
    ORDER BY id FOR UPDATE
  LOOP
    INSERT INTO public.stock_spoilage(product_id, distributor_id, quantity_kg, reason)
      VALUES (batch.id, batch.distributor_id, batch.stock_kg, 'past_limit');
    UPDATE public.products SET stock_kg = 0, status = 'spoiled', updated_at = clock_timestamp()
      WHERE id = batch.id;
    moved := moved + 1;
  END LOOP;
  RETURN moved;
END;
$$;

-- Distributor discard: all remaining stock of one batch goes to Spoiled Products.
-- The batch keeps its id and history and never returns to Stocks. Retrying is
-- safe: a batch already in Spoiled Products returns its latest spoilage record.
CREATE OR REPLACE FUNCTION public.discard_product_stock(p_product_id uuid, p_distributor_id uuid)
RETURNS public.stock_spoilage LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE batch public.products; result public.stock_spoilage;
BEGIN
  -- A batch already past the limit is recorded as such ('past_limit'), not as a discard.
  PERFORM public.spoil_expired_batches();
  SELECT * INTO batch FROM public.products WHERE id = p_product_id AND distributor_id = p_distributor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch not found or not owned by you' USING ERRCODE = 'P0002'; END IF;
  IF batch.status = 'spoiled' THEN
    SELECT * INTO result FROM public.stock_spoilage WHERE product_id = batch.id
      ORDER BY recorded_at DESC, id DESC LIMIT 1;
    RETURN result;
  END IF;
  IF NOT (batch.status IS NULL OR batch.status IN ('received', 'listed')) OR batch.stock_kg <= 0 THEN
    RAISE EXCEPTION 'This batch has no stock left to discard.' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.stock_spoilage(product_id, distributor_id, quantity_kg, reason, recorded_by)
    VALUES (batch.id, batch.distributor_id, batch.stock_kg, 'discarded', p_distributor_id)
    RETURNING * INTO result;
  UPDATE public.products SET stock_kg = 0, status = 'spoiled', updated_at = clock_timestamp()
    WHERE id = batch.id;
  RETURN result;
END;
$$;

-- Order cancellation restore (replaces the batch_lifecycle.sql version). Stock
-- returned to a spoiled batch is not sellable again: it is added to that batch's
-- spoilage with the same reason instead.
CREATE OR REPLACE FUNCTION public.restore_product_stock(p_product_id uuid, p_quantity numeric)
RETURNS public.products LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.products; last_reason text;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN RETURN NULL; END IF;
  SELECT * INTO result FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF result.status = 'spoiled' THEN
    SELECT reason INTO last_reason FROM public.stock_spoilage WHERE product_id = p_product_id
      ORDER BY recorded_at DESC, id DESC LIMIT 1;
    INSERT INTO public.stock_spoilage(product_id, distributor_id, quantity_kg, reason)
      VALUES (result.id, result.distributor_id, p_quantity, coalesce(last_reason, 'past_limit'));
    RETURN result;
  END IF;
  UPDATE public.products SET stock_kg = stock_kg + p_quantity,
    status = CASE status WHEN 'sold_out' THEN 'listed' ELSE status END,
    updated_at = clock_timestamp()
  WHERE id = p_product_id
  RETURNING * INTO result;
  RETURN result;
END; $$;

-- 3. Checkout and approval never sell stock past the limit -------------------------
-- Same as inventory_transactions.sql, plus the first statement in each body.
CREATE OR REPLACE FUNCTION public.place_inventory_order(
  p_retailer_id uuid, p_items jsonb, p_delivery_address text,
  p_delivery_latitude double precision, p_delivery_longitude double precision,
  p_preferred_schedule timestamptz
) RETURNS public.orders LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  result public.orders;
  batch public.products;
  item record;
  remaining numeric;
  take numeric;
  distributor uuid;
BEGIN
  -- Stock past the 7-day limit is moved to Spoiled Products first, so it is never sold.
  PERFORM public.spoil_expired_batches();
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_retailer_id AND role = 'retailer') THEN
    RAISE EXCEPTION 'Retailer not found' USING ERRCODE = '42501';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order items are required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) AS i WHERE
    jsonb_typeof(i->'quantity_kg') IS DISTINCT FROM 'number'
    OR coalesce((i->>'quantity_kg')::numeric, 0) <= 0
    OR (i->>'quantity_kg')::numeric > 1000000
    OR (i->>'quantity_kg')::numeric <> round((i->>'quantity_kg')::numeric, 2)
    OR nullif(btrim(i->>'vegetable_name'), '') IS NULL)
    OR (SELECT sum((i->>'quantity_kg')::numeric) FROM jsonb_array_elements(p_items) AS i) < 5 THEN
    RAISE EXCEPTION 'Each item needs a positive quantity; minimum order is 5 kg' USING ERRCODE = '22023';
  END IF;
  IF p_preferred_schedule IS NULL OR p_preferred_schedule <= clock_timestamp()
    OR nullif(btrim(p_delivery_address), '') IS NULL
    OR p_delivery_latitude IS NULL OR p_delivery_longitude IS NULL
    OR NOT (p_delivery_latitude BETWEEN -90 AND 90 AND p_delivery_longitude BETWEEN -180 AND 180) THEN
    RAISE EXCEPTION 'A future schedule and valid delivery location are required' USING ERRCODE = '22023';
  END IF;

  -- A pending order holds no stock: check what is on sale now and quote its price.
  -- Approval draws the stock (commit_order_stock).
  INSERT INTO public.orders(retailer_id, total_amount, status, delivery_address,
    delivery_latitude, delivery_longitude, preferred_schedule)
    VALUES(p_retailer_id, 0, 'pending', btrim(p_delivery_address),
      p_delivery_latitude, p_delivery_longitude, p_preferred_schedule) RETURNING * INTO result;

  FOR item IN SELECT public.inventory_vegetable_key(i->>'vegetable_name') AS key,
      sum((i->>'quantity_kg')::numeric) AS quantity FROM jsonb_array_elements(p_items) AS i
      GROUP BY 1 ORDER BY 1
  LOOP
    remaining := item.quantity;
    FOR batch IN SELECT * FROM public.products p
      WHERE p.status = 'listed' AND p.stock_kg > 0
        AND public.inventory_vegetable_key(p.vegetable_name) = item.key
      ORDER BY p.harvest_date NULLS LAST, p.created_at NULLS LAST, p.id
    LOOP
      IF batch.price_per_kg IS NULL OR batch.price_per_kg <= 0
        OR batch.price_per_kg::text IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'Product price is unavailable' USING ERRCODE = '22023';
      END IF;
      IF distributor IS NOT NULL AND distributor IS DISTINCT FROM batch.distributor_id THEN
        RAISE EXCEPTION 'An order must belong to one distributor' USING ERRCODE = '22023';
      END IF;
      distributor := batch.distributor_id;
      take := least(batch.stock_kg, remaining);
      -- product_id stays empty until approval draws the stock from a batch.
      INSERT INTO public.order_items(order_id, product_id, vegetable_name, quantity_kg, price_at_order)
        VALUES(result.id, NULL, batch.vegetable_name, take, batch.price_per_kg);
      result.total_amount := result.total_amount + take * batch.price_per_kg;
      remaining := remaining - take;
      EXIT WHEN remaining = 0;
    END LOOP;
    IF remaining > 0 THEN
      RAISE EXCEPTION 'There is not enough % in stock. Refresh your cart and try again.', item.key USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  UPDATE public.orders SET distributor_id = distributor, total_amount = result.total_amount
    WHERE id = result.id RETURNING * INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_order_stock(p_order_id uuid, p_distributor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE item record; batch public.products; remaining numeric; take numeric; part numeric;
  quantities numeric[]; line integer;
BEGIN
  -- Stock past the 7-day limit is moved to Spoiled Products first, so it is never sold.
  PERFORM public.spoil_expired_batches();
  -- Lock the candidate batches in one stable order so concurrent approvals queue.
  PERFORM p.id FROM public.products p WHERE p.distributor_id = p_distributor_id
    AND p.status = 'listed' AND p.stock_kg > 0
    AND public.inventory_vegetable_key(p.vegetable_name) IN
      (SELECT public.inventory_vegetable_key(vegetable_name) FROM public.order_items WHERE order_id = p_order_id)
    ORDER BY p.id FOR UPDATE;
  -- One line per vegetable and quoted price (batches of a vegetable share a price).
  FOR item IN SELECT key, sum(quantity) AS quantity,
      array_agg(quantity ORDER BY price) AS quantities, array_agg(price ORDER BY price) AS prices
    FROM (SELECT public.inventory_vegetable_key(vegetable_name) AS key, price_at_order AS price,
        sum(quantity_kg) AS quantity FROM public.order_items WHERE order_id = p_order_id GROUP BY 1, 2) AS lines
    GROUP BY key ORDER BY key
  LOOP
    IF (SELECT coalesce(sum(stock_kg), 0) FROM public.products WHERE distributor_id = p_distributor_id
        AND status = 'listed' AND stock_kg > 0 AND public.inventory_vegetable_key(vegetable_name) = item.key)
        < item.quantity THEN
      RAISE EXCEPTION 'Not enough stock available to approve this order.' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.order_items WHERE order_id = p_order_id
      AND public.inventory_vegetable_key(vegetable_name) = item.key;
    remaining := item.quantity; quantities := item.quantities; line := 1;
    FOR batch IN SELECT * FROM public.products WHERE distributor_id = p_distributor_id
        AND status = 'listed' AND stock_kg > 0 AND public.inventory_vegetable_key(vegetable_name) = item.key
      ORDER BY harvest_date NULLS LAST, created_at NULLS LAST, id
    LOOP
      take := least(batch.stock_kg, remaining);
      UPDATE public.products SET stock_kg = stock_kg - take,
        status = CASE WHEN stock_kg = take THEN 'sold_out' ELSE 'listed' END,
        updated_at = clock_timestamp() WHERE id = batch.id;
      remaining := remaining - take;
      -- Split the draw across the checkout lines so each keeps its quoted price.
      WHILE take > 0 LOOP
        part := least(take, quantities[line]);
        INSERT INTO public.order_items(order_id, product_id, vegetable_name, quantity_kg, price_at_order)
          VALUES(p_order_id, batch.id, batch.vegetable_name, part, item.prices[line]);
        quantities[line] := quantities[line] - part;
        take := take - part;
        IF quantities[line] = 0 THEN line := line + 1; END IF;
      END LOOP;
      EXIT WHEN remaining = 0;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.harvest_reserved_kg(uuid), public.sync_harvest_status(uuid),
  public.request_harvest_pickup(uuid,uuid,numeric,numeric,text), public.decline_pickup_request(uuid,uuid,text),
  public.receive_pickup_inventory(), public.batch_days_in_stock(timestamptz,timestamptz),
  public.spoil_expired_batches(), public.discard_product_stock(uuid,uuid),
  public.restore_product_stock(uuid,numeric),
  public.place_inventory_order(uuid,jsonb,text,double precision,double precision,timestamptz),
  public.commit_order_stock(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.harvest_reserved_kg(uuid), public.sync_harvest_status(uuid),
  public.request_harvest_pickup(uuid,uuid,numeric,numeric,text), public.decline_pickup_request(uuid,uuid,text),
  public.receive_pickup_inventory(), public.batch_days_in_stock(timestamptz,timestamptz),
  public.spoil_expired_batches(), public.discard_product_stock(uuid,uuid),
  public.restore_product_stock(uuid,numeric),
  public.place_inventory_order(uuid,jsonb,text,double precision,double precision,timestamptz),
  public.commit_order_stock(uuid,uuid) TO service_role;

COMMIT;

-- 4. Daily run (pg_cron) ------------------------------------------------------------
-- The app also runs the rule whenever stock is listed, ordered or approved; this
-- job just moves expired stock right after midnight in the Philippines
-- (16:05 UTC) even when nobody opens the app. Skipped when pg_cron is not enabled.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.spoil_expired_batches() TO postgres';
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'spoil-expired-batches';
    PERFORM cron.schedule('spoil-expired-batches', '5 16 * * *', 'SELECT public.spoil_expired_batches();');
  END IF;
END $$;

-- ---- Verification -----------------------------------------------------------
-- select column_name from information_schema.columns where table_name = 'pickup_requests'
--   and column_name in ('quantity_kg', 'price_per_kg', 'approved_at', 'declined_at', 'decline_reason');
-- select reason, count(*), sum(quantity_kg) from stock_spoilage group by reason;
-- select jobname, schedule from cron.job where jobname = 'spoil-expired-batches';
