-- ============================================================
-- VeggieTrack – batch lifecycle, FIFO order and Add New Product details
-- Run once in the Supabase SQL editor, after fifo_inventory_upgrade.sql and
-- stock_safety.sql. Safe to re-run. Adds columns and constraints, marks batches
-- with no stock left as sold out and replaces the two stock functions; no rows
-- are deleted and no quantities or prices are changed.
--
-- products.status (one row = one batch; see backend/lib/batches.js):
--   received  in Stocks, waiting to be added to the Product List
--   listed    on sale while stock_kg > 0
--   sold_out  stock reached 0 (Inventory History only)
--   archived  sold out and removed from the Product List (history only)
-- ============================================================

BEGIN;

-- 1. Pickup date for batches added from the Stocks "Add New Product" form.
--    Batches created by a rider pickup keep using pickup_requests.received_at.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS pickup_date timestamptz;

-- 2. When the batch was added. FIFO sells the oldest harvest first; this breaks
--    ties between batches harvested the same day. Existing rows are backfilled
--    with the best date available.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS created_at timestamptz;
UPDATE public.products p
SET created_at = COALESCE(
  (SELECT r.received_at FROM public.pickup_requests r WHERE r.id = p.pickup_request_id),
  p.harvest_date, p.updated_at, now())
WHERE p.created_at IS NULL;
ALTER TABLE public.products ALTER COLUMN created_at SET DEFAULT now();

-- 3. Mark batches with no stock left that are still in an active status as sold out.
UPDATE public.products SET status = 'sold_out', updated_at = now()
WHERE status = 'listed' AND stock_kg <= 0;
UPDATE public.products SET status = 'archived', updated_at = now()
WHERE (status = 'received' OR status IS NULL) AND stock_kg <= 0;

-- 4. Validate lifecycle states and preserve inactive/rejected historical batches,
--    and a batch with no stock cannot be active.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_status_valid;
ALTER TABLE public.products ADD CONSTRAINT products_status_valid
  CHECK (status IS NULL OR status IN ('received', 'listed', 'sold_out', 'archived', 'inactive', 'rejected'));
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_active_batch_has_stock;
ALTER TABLE public.products ADD CONSTRAINT products_active_batch_has_stock
  CHECK (status IS NULL OR status NOT IN ('received', 'listed') OR stock_kg > 0);

-- 5. Order cancellation / rollback restore (replaces the stock_safety.sql
--    version). Returned stock goes back to the batch it came from:
--      sold_out -> listed    back on sale under the same product
--      archived -> received  the product was removed, so the stock waits in Stocks
--    Any other status is kept.
CREATE OR REPLACE FUNCTION public.restore_product_stock(p_product_id uuid, p_quantity numeric)
RETURNS public.products LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.products;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN RETURN NULL; END IF;
  UPDATE public.products SET stock_kg = stock_kg + p_quantity,
    status = CASE status WHEN 'sold_out' THEN 'listed' WHEN 'archived' THEN 'received' ELSE status END,
    updated_at = clock_timestamp()
  WHERE id = p_product_id
  RETURNING * INTO result;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.restore_product_stock(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_product_stock(uuid, numeric) TO service_role;

-- 6. Sales draw only from listed batches (replaces the stock_safety.sql
--    version). A batch removed from the Product List while an order is being
--    placed is left untouched, so it is never relisted by a sale.
CREATE OR REPLACE FUNCTION public.decrement_product_stock(p_product_id uuid, p_quantity numeric)
RETURNS public.products LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.products;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN RETURN NULL; END IF;
  UPDATE public.products SET stock_kg = stock_kg - p_quantity,
    status = CASE WHEN stock_kg - p_quantity <= 0 THEN 'sold_out' ELSE status END,
    updated_at = clock_timestamp()
  WHERE id = p_product_id AND status = 'listed' AND stock_kg >= p_quantity
  RETURNING * INTO result;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.decrement_product_stock(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_product_stock(uuid, numeric) TO service_role;

COMMIT;

-- ---- Verification -----------------------------------------------------
-- select status, count(*), sum(stock_kg) from products group by status;
-- select id, vegetable_name, status, stock_kg, harvest_date, pickup_date, created_at
--   from products order by harvest_date nulls last, created_at;
