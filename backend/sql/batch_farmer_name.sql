-- ============================================================
-- VeggieTrack – optional farmer name typed on Stocks "Add New Product"
-- Run once in the Supabase SQL editor. Safe to re-run; no rows change.
--
-- products.farmer_name holds the name exactly as the distributor typed it (or
-- NULL when left blank). Batches from a rider pickup keep products.farmer_id,
-- the linked farmer account, which takes precedence when both are present.
-- ============================================================

BEGIN;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS farmer_name text;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_farmer_name_length;
ALTER TABLE public.products ADD CONSTRAINT products_farmer_name_length
  CHECK (farmer_name IS NULL OR char_length(farmer_name) BETWEEN 1 AND 120);

COMMIT;

-- ---- Verification -----------------------------------------------------
-- select id, vegetable_name, farmer_id, farmer_name from products order by created_at desc limit 10;
