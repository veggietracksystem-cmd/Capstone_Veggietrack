-- Never allow stock to go negative, even under concurrent writes.
--
-- A CHECK constraint is the final backstop; the two RPCs below are the
-- actual concurrency-safe path. Previously, order creation read stock_kg in
-- one round trip and wrote a computed new value in a second — two near-
-- simultaneous orders drawing from the same batch could both read the same
-- starting stock and each write their own (wrong) result, silently
-- overselling. A single atomic UPDATE with the check baked into its WHERE
-- clause closes that race: Postgres serializes concurrent writers to the
-- same row, so only one of two racing decrements can ever see enough stock.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_kg_non_negative') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_stock_kg_non_negative CHECK (stock_kg >= 0) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.products VALIDATE CONSTRAINT products_stock_kg_non_negative;

-- Order creation's FIFO draw: atomically checks and decrements in one
-- statement. Returns NULL (no row) if another concurrent order already
-- consumed the stock this call expected to find — the caller must treat a
-- NULL result as "insufficient stock, abort and roll back this order",
-- never assume success just because no error was raised.
CREATE OR REPLACE FUNCTION public.decrement_product_stock(p_product_id uuid, p_quantity numeric)
RETURNS public.products LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.products;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RETURN NULL; END IF;
  UPDATE products SET stock_kg = stock_kg - p_quantity,
    status = CASE WHEN stock_kg - p_quantity <= 0 THEN 'sold_out' ELSE 'listed' END,
    updated_at = clock_timestamp()
  WHERE id = p_product_id AND stock_kg >= p_quantity
  RETURNING * INTO result;
  -- A row target that receives zero rows from RETURNING INTO has every field
  -- set to NULL, which is NOT the same as the composite itself being NULL
  -- (it serializes as an all-null row, not JSON null). Callers only check
  -- for NULL, so this must be explicit.
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.decrement_product_stock(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_product_stock(uuid, numeric) TO service_role;

-- Order cancellation / rollback restore. Never guards against going negative
-- (restoring always increases stock) and preserves the existing "only a
-- sold_out batch comes back to listed" rule — a batch a distributor has
-- since unlisted back to 'received' stays 'received'.
CREATE OR REPLACE FUNCTION public.restore_product_stock(p_product_id uuid, p_quantity numeric)
RETURNS public.products LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.products;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RETURN NULL; END IF;
  UPDATE products SET stock_kg = stock_kg + p_quantity,
    status = CASE WHEN status = 'sold_out' THEN 'listed' ELSE status END,
    updated_at = clock_timestamp()
  WHERE id = p_product_id
  RETURNING * INTO result;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.restore_product_stock(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_product_stock(uuid, numeric) TO service_role;
