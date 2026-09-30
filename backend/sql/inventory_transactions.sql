-- Run in Supabase SQL Editor after fifo_inventory_upgrade.sql, stock_safety.sql,
-- batch_lifecycle.sql and delivery_tracking_maps.sql. Re-runnable; preserves rows.
--
-- Order stock: checkout records a pending order without touching stock. Stock is
-- drawn FIFO only when the order leaves pending (distributor approval) and is
-- returned when an approved order is cancelled. orders.stock_committed_at is set
-- while an order holds stock, so each order is drawn and returned at most once.
--
-- Overdue orders: an order not delivered by the end of its scheduled day
-- (Philippine time) becomes 'unsuccessful' for every role (orders and deliveries).

-- A new enum value must be committed before use, so it is added outside the
-- transaction below. The status column may be text on older databases.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typname = 'order_status') THEN
    ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'unsuccessful';
  END IF;
END $$;

BEGIN;

-- Pickup proof, batch provenance and harvest state commit in the same transaction.
CREATE OR REPLACE FUNCTION public.receive_pickup_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE harvest public.harvests;
BEGIN
  IF NEW.status <> 'picked_up' OR OLD.status = 'picked_up' THEN RETURN NEW; END IF;
  IF NEW.harvest_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO harvest FROM public.harvests WHERE id = NEW.harvest_id;
  IF NOT FOUND OR harvest.quantity_kg <= 0 OR NEW.received_by IS NULL THEN
    RAISE EXCEPTION 'The pickup needs a valid harvest and receiving distributor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products WHERE pickup_request_id = NEW.id) THEN
    INSERT INTO public.products(distributor_id, vegetable_name, price_per_kg, stock_kg,
      quantity_received, harvest_date, pickup_date, harvest_id, pickup_request_id, farmer_id, status)
    VALUES(NEW.received_by, harvest.vegetable_name, NULL, harvest.quantity_kg,
      harvest.quantity_kg, harvest.recorded_at,
      NEW.received_at, harvest.id, NEW.id, NEW.farmer_id, 'received');
  END IF;
  UPDATE public.harvests SET status = 'picked_up' WHERE id = harvest.id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS receive_pickup_inventory ON public.pickup_requests;
CREATE TRIGGER receive_pickup_inventory AFTER UPDATE OF status ON public.pickup_requests
  FOR EACH ROW EXECUTE FUNCTION public.receive_pickup_inventory();
REVOKE ALL ON FUNCTION public.receive_pickup_inventory() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_pickup_inventory() TO service_role;

-- Restore canceled sales without reviving an archived batch into approval.
CREATE OR REPLACE FUNCTION public.restore_product_stock(p_product_id uuid, p_quantity numeric)
RETURNS public.products LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.products;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RETURN NULL; END IF;
  UPDATE products SET stock_kg = stock_kg + p_quantity,
    status = CASE status WHEN 'sold_out' THEN 'listed' ELSE status END,
    updated_at = clock_timestamp()
  WHERE id = p_product_id
  RETURNING * INTO result;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.restore_product_stock(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_product_stock(uuid, numeric) TO service_role;

-- Keep aliases consistent with lib/vegetables.js. Longest matching name wins.
CREATE OR REPLACE FUNCTION public.inventory_vegetable_key(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH names(name, aliases) AS (VALUES
    ('tomato', ARRAY['tomato', 'kamatis']), ('eggplant', ARRAY['eggplant', 'talong']),
    ('okra', ARRAY['okra']), ('cabbage', ARRAY['cabbage', 'repolyo']),
    ('lettuce', ARRAY['lettuce', 'litsugas']), ('spinach', ARRAY['spinach']),
    ('pechay', ARRAY['pechay']), ('water spinach', ARRAY['kangkong', 'water spinach']),
    ('broccoli', ARRAY['broccoli']), ('cauliflower', ARRAY['cauliflower']),
    ('bell pepper', ARRAY['bell pepper']), ('chili pepper', ARRAY['chili pepper', 'sili']),
    ('carrot', ARRAY['carrot', 'karot']), ('sweet potato', ARRAY['sweet potato', 'kamote']),
    ('potato', ARRAY['potato', 'patatas']), ('onion', ARRAY['onion', 'sibuyas']),
    ('garlic', ARRAY['garlic', 'bawang']), ('squash', ARRAY['squash', 'kalabasa']),
    ('bitter gourd', ARRAY['bitter gourd', 'ampalaya']), ('bottle gourd', ARRAY['bottle gourd', 'upo']),
    ('sponge gourd', ARRAY['sponge gourd', 'patola']), ('chayote', ARRAY['chayote', 'sayote']),
    ('string beans', ARRAY['string beans', 'sitaw']), ('radish', ARRAY['radish', 'labanos']),
    ('cucumber', ARRAY['cucumber', 'pipino']), ('celery', ARRAY['celery']),
    ('mustard greens', ARRAY['mustard greens', 'mustasa']), ('malunggay', ARRAY['malunggay']),
    ('sweet potato leaves', ARRAY['talbos ng kamote', 'sweet potato leaves']),
    ('basil', ARRAY['basil']), ('oregano', ARRAY['oregano']),
    ('cilantro', ARRAY['cilantro', 'wansoy']), ('mint', ARRAY['mint']), ('parsley', ARRAY['parsley'])
  ), normalized AS (SELECT lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) AS value)
  SELECT coalesce((SELECT name FROM names CROSS JOIN LATERAL unnest(aliases) AS a(alias)
    WHERE normalized.value ~ ('\m' || alias || '(es|s)?\M')
    ORDER BY length(alias) DESC LIMIT 1), value) FROM normalized;
$$;

-- One-time conversion (runs only when the column is first added). Orders placed
-- before this change drew their stock at checkout: those still pending give it
-- back to the batches it came from; approved and later orders keep it.
DO $$
DECLARE item record;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'orders' AND column_name = 'stock_committed_at') THEN
    RETURN;
  END IF;
  ALTER TABLE public.orders ADD COLUMN stock_committed_at timestamptz;
  UPDATE public.orders SET stock_committed_at = coalesce(created_at, clock_timestamp())
    WHERE status::text NOT IN ('pending', 'cancelled');
  PERFORM p.id FROM public.products p WHERE p.id IN
    (SELECT oi.product_id FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
      WHERE o.status::text = 'pending')
    ORDER BY p.id FOR UPDATE;
  FOR item IN SELECT oi.product_id, sum(oi.quantity_kg) AS quantity FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.status::text = 'pending' AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id ORDER BY oi.product_id
  LOOP
    IF public.restore_product_stock(item.product_id, item.quantity) IS NULL THEN
      RAISE EXCEPTION 'Could not restore the original stock batch';
    END IF;
  END LOOP;
  UPDATE public.order_items SET product_id = NULL
    WHERE order_id IN (SELECT id FROM public.orders WHERE status::text = 'pending');
END $$;

-- Draws an approved order from its distributor's oldest listed batches (FIFO)
-- and records the batches on its items, keeping the price quoted at checkout.
-- Raises when the listed stock no longer covers the order; nothing is drawn then.
CREATE OR REPLACE FUNCTION public.commit_order_stock(p_order_id uuid, p_distributor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE item record; batch public.products; remaining numeric; take numeric; part numeric;
  quantities numeric[]; line integer;
BEGIN
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

-- Returns an order's drawn quantities to the exact batches they came from.
CREATE OR REPLACE FUNCTION public.release_order_stock(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE item record;
BEGIN
  PERFORM p.id FROM public.products p WHERE p.id IN
    (SELECT product_id FROM public.order_items WHERE order_id = p_order_id)
    ORDER BY p.id FOR UPDATE;
  FOR item IN SELECT product_id, sum(quantity_kg) AS quantity FROM public.order_items
    WHERE order_id = p_order_id AND product_id IS NOT NULL GROUP BY product_id ORDER BY product_id
  LOOP
    IF public.restore_product_stock(item.product_id, item.quantity) IS NULL THEN
      RAISE EXCEPTION 'Could not restore the original stock batch';
    END IF;
  END LOOP;
END;
$$;

-- Stock follows the order status, whichever route changes it: leaving pending
-- draws the stock once; cancellation (or a return to pending) gives it back once.
-- An unsuccessful delivery gives it back only if the rider never picked it up;
-- picked-up goods have left the warehouse. Cancelled and unsuccessful orders are
-- closed. Only this trigger sets stock_committed_at.
CREATE OR REPLACE FUNCTION public.sync_order_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE releases boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text <> 'pending' THEN RAISE EXCEPTION 'New orders must start as pending' USING ERRCODE = '22023'; END IF;
    NEW.stock_committed_at := NULL;
    RETURN NEW;
  END IF;
  NEW.stock_committed_at := OLD.stock_committed_at;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF OLD.status::text IN ('cancelled', 'unsuccessful') THEN
    RAISE EXCEPTION 'This order is closed and cannot be reopened' USING ERRCODE = 'P0001';
  END IF;
  releases := NEW.status::text IN ('pending', 'cancelled')
    OR (NEW.status::text = 'unsuccessful' AND OLD.status::text IN ('pending', 'approved'));
  IF releases AND OLD.stock_committed_at IS NOT NULL THEN
    PERFORM public.release_order_stock(NEW.id);
    IF NEW.status::text = 'pending' THEN
      UPDATE public.order_items SET product_id = NULL WHERE order_id = NEW.id;
    END IF;
    NEW.stock_committed_at := NULL;
  ELSIF NOT releases AND NEW.status::text <> 'unsuccessful' AND OLD.stock_committed_at IS NULL THEN
    PERFORM public.commit_order_stock(NEW.id, NEW.distributor_id);
    NEW.stock_committed_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_order_stock ON public.orders;
CREATE TRIGGER sync_order_stock BEFORE INSERT OR UPDATE OF status, stock_committed_at ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_order_stock();

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

CREATE OR REPLACE FUNCTION public.cancel_inventory_order(p_order_id uuid, p_actor_id uuid, p_reason text DEFAULT NULL)
RETURNS public.orders LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE result public.orders; actor_role text;
BEGIN
  SELECT role INTO actor_role FROM public.users WHERE id = p_actor_id;
  SELECT * INTO result FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002'; END IF;
  IF ((actor_role = 'retailer' AND result.retailer_id = p_actor_id)
       OR (actor_role = 'distributor' AND result.distributor_id = p_actor_id)) IS NOT TRUE THEN
    RAISE EXCEPTION 'You cannot cancel this order' USING ERRCODE = '42501';
  END IF;
  IF actor_role = 'distributor' AND nullif(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required' USING ERRCODE = '22023';
  END IF;
  IF result.status <> 'pending' THEN RAISE EXCEPTION 'This order was already updated' USING ERRCODE = 'P0001'; END IF;
  -- A pending order holds no stock, so declining it leaves inventory unchanged.
  UPDATE public.orders SET status = 'cancelled', cancellation_reason = p_reason
    WHERE id = p_order_id RETURNING * INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.reduce_inventory_quantity(p_product_id uuid, p_distributor_id uuid,
  p_expected_total numeric, p_new_total numeric)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE key text; batch public.products; current_total numeric; remaining numeric; take numeric;
BEGIN
  SELECT public.inventory_vegetable_key(vegetable_name) INTO key FROM public.products
    WHERE id = p_product_id AND distributor_id = p_distributor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  IF p_new_total IS NULL OR p_new_total < 0 OR p_new_total <> round(p_new_total, 2)
    OR p_new_total::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Invalid quantity' USING ERRCODE = '22023';
  END IF;
  PERFORM id FROM public.products WHERE distributor_id = p_distributor_id AND status = 'listed'
    AND public.inventory_vegetable_key(vegetable_name) = key ORDER BY id FOR UPDATE;
  SELECT coalesce(sum(stock_kg), 0) INTO current_total FROM public.products
    WHERE distributor_id = p_distributor_id AND status = 'listed'
      AND public.inventory_vegetable_key(vegetable_name) = key;
  IF current_total IS DISTINCT FROM p_expected_total THEN
    RAISE EXCEPTION 'The stock changed while saving. Refresh and try again.' USING ERRCODE = 'P0001';
  END IF;
  IF p_new_total >= current_total THEN
    RAISE EXCEPTION 'New quantity must be less than current stock' USING ERRCODE = '22023';
  END IF;
  remaining := current_total - p_new_total;
  FOR batch IN SELECT * FROM public.products WHERE distributor_id = p_distributor_id AND status = 'listed'
    AND stock_kg > 0 AND public.inventory_vegetable_key(vegetable_name) = key
    ORDER BY harvest_date NULLS LAST, created_at NULLS LAST, id
  LOOP
    take := least(batch.stock_kg, remaining);
    UPDATE public.products SET stock_kg = stock_kg - take,
      status = CASE WHEN stock_kg = take THEN 'sold_out' ELSE 'listed' END,
      updated_at = clock_timestamp() WHERE id = batch.id;
    remaining := remaining - take;
    EXIT WHEN remaining = 0;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlist_inventory_product(p_product_id uuid, p_distributor_id uuid)
RETURNS SETOF public.products LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE key text;
BEGIN
  SELECT public.inventory_vegetable_key(vegetable_name) INTO key FROM public.products
    WHERE id = p_product_id AND distributor_id = p_distributor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM id FROM public.products WHERE distributor_id = p_distributor_id
    AND status IN ('listed', 'sold_out') AND public.inventory_vegetable_key(vegetable_name) = key
    ORDER BY id FOR UPDATE;
  RETURN QUERY UPDATE public.products SET
    status = CASE WHEN stock_kg > 0 THEN 'received' ELSE 'archived' END, updated_at = clock_timestamp()
    WHERE distributor_id = p_distributor_id AND status IN ('listed', 'sold_out')
      AND public.inventory_vegetable_key(vegetable_name) = key RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_vegetable_key(text),
  public.place_inventory_order(uuid,jsonb,text,double precision,double precision,timestamptz),
  public.cancel_inventory_order(uuid,uuid,text), public.reduce_inventory_quantity(uuid,uuid,numeric,numeric),
  public.unlist_inventory_product(uuid,uuid), public.commit_order_stock(uuid,uuid),
  public.release_order_stock(uuid), public.sync_order_stock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_vegetable_key(text),
  public.place_inventory_order(uuid,jsonb,text,double precision,double precision,timestamptz),
  public.cancel_inventory_order(uuid,uuid,text), public.reduce_inventory_quantity(uuid,uuid,numeric,numeric),
  public.unlist_inventory_product(uuid,uuid), public.commit_order_stock(uuid,uuid),
  public.release_order_stock(uuid), public.sync_order_stock() TO service_role;

-- Keep identical to the copy in expired_retailer_orders.sql. The name is kept for
-- the existing pg_cron job and API calls.
CREATE OR REPLACE FUNCTION public.cancel_expired_retailer_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ids uuid[];
BEGIN
  -- Overdue: not delivered by the end of the scheduled day in Philippine time
  -- (UTC+8, no daylight saving). status is compared as text because the
  -- order_status enum has no 'assigned' value.
  SELECT array_agg(eligible.id) INTO ids FROM (
    SELECT id FROM public.orders
    WHERE status::text IN ('pending', 'approved', 'assigned', 'picked_up', 'in_transit')
      AND preferred_schedule IS NOT NULL
      AND clock_timestamp() >= (date_trunc('day', preferred_schedule AT TIME ZONE INTERVAL '+08:00')
        + interval '1 day') AT TIME ZONE INTERVAL '+08:00'
    ORDER BY id FOR UPDATE
  ) AS eligible;
  IF ids IS NULL THEN RETURN 0; END IF;
  -- Lock the batches of orders the rider has not picked up, in one stable order;
  -- sync_order_stock returns their stock. Pending orders hold none.
  PERFORM p.id FROM public.products p WHERE p.id IN
    (SELECT oi.product_id FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
      WHERE o.id = ANY(ids) AND o.status::text = 'approved' AND o.stock_committed_at IS NOT NULL)
    ORDER BY p.id FOR UPDATE;
  UPDATE public.orders SET status = 'unsuccessful' WHERE id = ANY(ids);
  UPDATE public.deliveries SET status = 'unsuccessful'
    WHERE order_id = ANY(ids) AND status IS DISTINCT FROM 'delivered';
  RETURN cardinality(ids);
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_expired_retailer_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_expired_retailer_orders() TO service_role, postgres;

COMMIT;
