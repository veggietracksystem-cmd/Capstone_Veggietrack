-- ============================================================
-- VeggieTrack - OPTIONAL one-time fix: return stock that the old automatic
-- 7-day rule moved to Spoiled Products, so the distributor can review it.
--
-- Run only if you want this, and only AFTER manual_spoilage.sql (otherwise the
-- old rule would spoil the stock again). Safe to re-run: a second run finds
-- nothing to return.
--
-- What it changes:
--   * Automatic spoilage records are the ones the old rule wrote: reason
--     'past_limit' and no recorded_by (a distributor's discard always has one).
--   * A spoiled batch whose spoilage is ONLY automatic gets that stock back and
--     becomes 'listed' (it had a price) or 'received' again. From day 8 it shows
--     as "Past spoilage limit - needs review": still not sold, and only counted
--     as spoiled if the distributor discards it.
--   * Those automatic records are copied to stock_spoilage_reverted (history
--     kept), then removed from stock_spoilage, so Spoiled Products and the
--     reports no longer count them.
--   * Batches with any distributor discard are not touched.
--
-- PREVIEW first (changes nothing):
--   SELECT p.id, p.vegetable_name, p.price_per_kg, sum(s.quantity_kg) AS kg_returned
--   FROM products p JOIN stock_spoilage s ON s.product_id = p.id
--   WHERE p.status = 'spoiled'
--     AND NOT EXISTS (SELECT 1 FROM stock_spoilage m WHERE m.product_id = p.id
--                     AND (m.recorded_by IS NOT NULL OR m.reason <> 'past_limit'))
--   GROUP BY p.id, p.vegetable_name, p.price_per_kg;
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.batch_past_spoilage_limit(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'Run manual_spoilage.sql first.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.stock_spoilage_reverted (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  distributor_id uuid,
  quantity_kg numeric(10,2) NOT NULL,
  reason text NOT NULL,
  recorded_at timestamptz NOT NULL,
  recorded_by uuid,
  reverted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_spoilage_reverted ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_spoilage_reverted FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stock_spoilage_reverted TO service_role;

CREATE TEMP TABLE auto_spoiled ON COMMIT DROP AS
  SELECT p.id AS product_id, sum(s.quantity_kg) AS kg
  FROM public.products p JOIN public.stock_spoilage s ON s.product_id = p.id
  WHERE p.status = 'spoiled'
    AND NOT EXISTS (SELECT 1 FROM public.stock_spoilage m WHERE m.product_id = p.id
                    AND (m.recorded_by IS NOT NULL OR m.reason <> 'past_limit'))
  GROUP BY p.id;

INSERT INTO public.stock_spoilage_reverted(id, product_id, distributor_id, quantity_kg, reason, recorded_at, recorded_by)
  SELECT s.id, s.product_id, s.distributor_id, s.quantity_kg, s.reason, s.recorded_at, s.recorded_by
  FROM public.stock_spoilage s JOIN auto_spoiled a ON a.product_id = s.product_id
  ON CONFLICT (id) DO NOTHING;

DELETE FROM public.stock_spoilage s USING auto_spoiled a WHERE s.product_id = a.product_id;

UPDATE public.products p
  SET stock_kg = a.kg,
      status = CASE WHEN p.price_per_kg IS NOT NULL THEN 'listed' ELSE 'received' END,
      updated_at = clock_timestamp()
  FROM auto_spoiled a WHERE p.id = a.product_id;

COMMIT;
