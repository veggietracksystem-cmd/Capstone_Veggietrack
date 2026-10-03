-- ============================================================
-- VeggieTrack - spoilage is the distributor's decision.
--
-- Run once in the Supabase SQL Editor AFTER pickup_pricing_and_spoilage.sql.
-- Safe to re-run. No rows are deleted or changed by this file.
--
-- Before: from day 8 in stock, unsold stock was moved to Spoiled Products
-- automatically (spoil_expired_batches, run by the app, by checkout and
-- approval, and daily by pg_cron).
-- Now:
--   Day 0-6   active and sellable.
--   Day 7     still sellable; the distributor is alerted.
--   Day 8+    "Past spoilage limit - needs review": the stock stays in the batch
--             (it is not spoiled, not zeroed, not in Spoiled Products and not in
--             the Spoiled report total) but it is no longer offered to retailers
--             or drawn by orders, as before.
--   Only the distributor's Discard (discard_product_stock) moves stock to
--   Spoiled Products. Discarding a batch past the limit records reason
--   'past_limit'; earlier, 'discarded'. Both record who discarded it.
--
-- If inventory_transactions.sql or pickup_pricing_and_spoilage.sql is ever run
-- again, run this file again afterwards: it replaces functions they define.
-- ============================================================

BEGIN;

-- True from day 8 in stock (Philippine calendar days, as batch_days_in_stock).
-- A batch without an entry date is never past the limit.
CREATE OR REPLACE FUNCTION public.batch_past_spoilage_limit(p_since timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(public.batch_days_in_stock(p_since) > 7, false);
$$;

-- Kept so older callers keep working, but it no longer moves any stock.
CREATE OR REPLACE FUNCTION public.spoil_expired_batches()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Spoilage is recorded only by discard_product_stock, when the distributor decides.
  RETURN 0;
END;
$$;

-- Distributor discard: all remaining stock of one batch goes to Spoiled Products.
-- The batch keeps its id and history and never returns to Stocks. Retrying is
-- safe: a batch already in Spoiled Products returns its latest spoilage record.
CREATE OR REPLACE FUNCTION public.discard_product_stock(p_product_id uuid, p_distributor_id uuid)
RETURNS public.stock_spoilage LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE batch public.products; result public.stock_spoilage;
BEGIN
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
    VALUES (batch.id, batch.distributor_id, batch.stock_kg,
      CASE WHEN public.batch_past_spoilage_limit(coalesce(batch.pickup_date, batch.created_at)) THEN 'past_limit' ELSE 'discarded' END,
      p_distributor_id)
    RETURNING * INTO result;
  UPDATE public.products SET stock_kg = 0, status = 'spoiled', updated_at = clock_timestamp()
    WHERE id = batch.id;
  RETURN result;
END;
$$;

-- Checkout and approval: as in pickup_pricing_and_spoilage.sql, except that they
-- skip stock past the limit instead of moving it to Spoiled Products first.
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
        -- Stock past the 7-day limit waits for the distributor and is never sold.
        AND NOT public.batch_past_spoilage_limit(coalesce(p.pickup_date, p.created_at))
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
  -- Stock past the 7-day limit waits for the distributor and is never drawn.
  -- Lock the candidate batches in one stable order so concurrent approvals queue.
  PERFORM p.id FROM public.products p WHERE p.distributor_id = p_distributor_id
    AND p.status = 'listed' AND p.stock_kg > 0 AND NOT public.batch_past_spoilage_limit(coalesce(p.pickup_date, p.created_at))
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
        AND status = 'listed' AND stock_kg > 0 AND NOT public.batch_past_spoilage_limit(coalesce(pickup_date, created_at))
        AND public.inventory_vegetable_key(vegetable_name) = item.key)
        < item.quantity THEN
      RAISE EXCEPTION 'Not enough stock available to approve this order.' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.order_items WHERE order_id = p_order_id
      AND public.inventory_vegetable_key(vegetable_name) = item.key;
    remaining := item.quantity; quantities := item.quantities; line := 1;
    FOR batch IN SELECT * FROM public.products WHERE distributor_id = p_distributor_id
        AND status = 'listed' AND stock_kg > 0 AND NOT public.batch_past_spoilage_limit(coalesce(pickup_date, created_at))
        AND public.inventory_vegetable_key(vegetable_name) = item.key
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

REVOKE ALL ON FUNCTION public.batch_past_spoilage_limit(timestamptz), public.spoil_expired_batches(),
  public.discard_product_stock(uuid,uuid),
  public.place_inventory_order(uuid,jsonb,text,double precision,double precision,timestamptz),
  public.commit_order_stock(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.batch_past_spoilage_limit(timestamptz), public.spoil_expired_batches(),
  public.discard_product_stock(uuid,uuid),
  public.place_inventory_order(uuid,jsonb,text,double precision,double precision,timestamptz),
  public.commit_order_stock(uuid,uuid) TO service_role;

COMMIT;

-- The daily automatic spoilage job is removed. Skipped when pg_cron is not enabled.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'spoil-expired-batches';
  END IF;
END $$;

-- ---- Verification -----------------------------------------------------------
-- select public.spoil_expired_batches();                              -- 0
-- select count(*) from cron.job where jobname = 'spoil-expired-batches'; -- 0
-- Batches waiting for the distributor's review:
--   select id, vegetable_name, stock_kg from products
--   where status in ('received', 'listed') and stock_kg > 0
--     and public.batch_past_spoilage_limit(coalesce(pickup_date, created_at));
