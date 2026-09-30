-- Prevents stock from going negative, including under concurrent writes.
-- The CHECK constraint is a final safeguard; the RPCs below perform each stock
-- change as a single atomic UPDATE with the check in its WHERE clause, so only
-- one of two concurrent orders can draw the same stock.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_kg_non_negative') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_stock_kg_non_negative CHECK (stock_kg >= 0) NOT VALID;
  END IF;
END $$;
ALTER TABLE public.products VALIDATE CONSTRAINT products_stock_kg_non_negative;

-- FIFO draw for order creation: checks and decrements in one statement.
-- Returns NULL when the stock is no longer available; the caller must then abort
-- and roll back the order.
CREATE OR REPLACE FUNCTION public.decrement_product_stock(p_product_id uuid, p_quantity numeric)
RETURNS public.products LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.products;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN RETURN NULL; END IF;
  UPDATE public.products SET stock_kg = stock_kg - p_quantity,
    status = CASE WHEN stock_kg - p_quantity <= 0 THEN 'sold_out' ELSE 'listed' END,
    updated_at = clock_timestamp()
  WHERE id = p_product_id AND status = 'listed' AND stock_kg >= p_quantity
  RETURNING * INTO result;
  -- RETURNING INTO with no rows yields an all-NULL row rather than NULL, so
  -- return NULL explicitly.
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.decrement_product_stock(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_product_stock(uuid, numeric) TO service_role;

-- Restores canceled stock to its original batch; archived batches stay archived.
CREATE OR REPLACE FUNCTION public.restore_product_stock(p_product_id uuid, p_quantity numeric)
RETURNS public.products LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result public.products;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity::text IN ('NaN', 'Infinity', '-Infinity') THEN RETURN NULL; END IF;
  UPDATE public.products SET stock_kg = stock_kg + p_quantity,
    status = CASE status WHEN 'sold_out' THEN 'listed' ELSE status END,
    updated_at = clock_timestamp()
  WHERE id = p_product_id
  RETURNING * INTO result;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.restore_product_stock(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_product_stock(uuid, numeric) TO service_role;
