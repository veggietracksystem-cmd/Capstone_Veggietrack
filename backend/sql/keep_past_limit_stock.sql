-- ============================================================
-- VeggieTrack - stock past the spoilage limit stays on sale until the
-- distributor decides.
--
-- Run once in the Supabase SQL Editor AFTER manual_spoilage.sql. Safe to re-run.
-- No rows are deleted and no stock is changed by this file.
--
-- Before (manual_spoilage.sql): from day 8 in stock a batch was "Needs Review"
-- and also taken out of sale: checkout and approval skipped it, so the Product
-- List showed a vegetable with 5 kg in Stocks as Out of Stock.
-- Now:
--   The 7-day limit is a warning only. A batch past it keeps its stock, stays
--   on the Product List and in the retailer catalogue while listed, and is sold
--   FIFO (oldest first) like any other batch. Out of Stock means 0 kg left.
--   The distributor answers the warning with
--     Keep/Sell  POST /api/products/:id/keep sets kept_for_sale_at/_by below;
--                the stock stays on sale and the warning clears.
--     Discard    discard_product_stock (unchanged): the stock moves to Spoiled
--                Products, reason 'past_limit', and leaves sellable stock.
--
-- If inventory_transactions.sql, pickup_pricing_and_spoilage.sql or
-- manual_spoilage.sql is ever run again, run this file again afterwards: it
-- replaces the checkout and approval functions they define.
-- ============================================================

BEGIN;

-- The distributor's Keep/Sell decision. Set only by the backend.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS kept_for_sale_at timestamptz,
  ADD COLUMN IF NOT EXISTS kept_for_sale_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Checkout and approval: as in manual_spoilage.sql, except that stock past the
-- 7-day limit is sold like any other listed stock, oldest batch first (FIFO).
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
        AND status = 'listed' AND stock_kg > 0
        AND public.inventory_vegetable_key(vegetable_name) = item.key)
        < item.quantity THEN
      RAISE EXCEPTION 'Not enough stock available to approve this order.' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.order_items WHERE order_id = p_order_id
      AND public.inventory_vegetable_key(vegetable_name) = item.key;
    remaining := item.quantity; quantities := item.quantities; line := 1;
    FOR batch IN SELECT * FROM public.products WHERE distributor_id = p_distributor_id
        AND status = 'listed' AND stock_kg > 0
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

REVOKE ALL ON FUNCTION public.place_inventory_order(uuid,jsonb,text,double precision,double precision,timestamptz),
  public.commit_order_stock(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_inventory_order(uuid,jsonb,text,double precision,double precision,timestamptz),
  public.commit_order_stock(uuid,uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---- Verification -----------------------------------------------------------
-- Both columns exist:
--   select column_name from information_schema.columns
--   where table_name = 'products' and column_name like 'kept_for_sale%';
-- Batches that need review (listed ones are on sale):
--   select id, vegetable_name, status, stock_kg from products
--   where status in ('received', 'listed') and stock_kg > 0 and kept_for_sale_at is null
--     and public.batch_past_spoilage_limit(coalesce(pickup_date, created_at));
