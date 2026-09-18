-- Expire schedules that were never started. Do not cancel in_transit/delivered
-- orders: once a rider has begun delivery, the delivery workflow owns that
-- outcome. `preferred_schedule` is stored as timestamptz (already an absolute
-- instant, normalized to UTC at write time from the Philippine wall-clock
-- input — see lib/deliveryProof.js's scheduleInstant), so comparing it
-- against clock_timestamp() is correct regardless of server timezone; no
-- separate date/time-of-day comparison is needed.
--
-- Depends on public.restore_product_stock from sql/stock_safety.sql — apply
-- that migration first (or together with this one).
--
-- Safe to run repeatedly / concurrently: cancellation is a single guarded
-- UPDATE ... RETURNING, so an order can only ever be picked up by one
-- execution, and once its status is 'cancelled' it no longer matches the
-- WHERE clause on any later run — no duplicate cancellation, no duplicate
-- stock restoration.
CREATE OR REPLACE FUNCTION public.cancel_expired_retailer_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE affected integer := 0; r record;
BEGIN
  FOR r IN
    UPDATE public.orders
       SET status = 'cancelled'
     WHERE status IN ('pending', 'approved', 'assigned')
       AND preferred_schedule IS NOT NULL
       AND preferred_schedule < clock_timestamp()
     RETURNING id
  LOOP
    affected := affected + 1;
    -- Restore stock to the exact batch each item was drawn from — the same
    -- rule PUT /api/orders/:id/cancel applies. Legacy pre-FIFO order_items
    -- with no product_id have nothing to restore to.
    PERFORM public.restore_product_stock(oi.product_id, oi.quantity_kg)
      FROM public.order_items oi
     WHERE oi.order_id = r.id AND oi.product_id IS NOT NULL;
  END LOOP;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_expired_retailer_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_expired_retailer_orders() TO service_role, postgres;

-- ============================================================
-- Scheduled execution (pg_cron)
-- ============================================================
-- This is the actual "even when the app is closed" guarantee — without a
-- registered job, the function above only ever runs when a retailer/
-- distributor happens to open an Orders screen (see cancelExpiredRetailerOrders
-- in backend/index.js, which calls it inline as a read/write-time backstop).
--
-- IMPORTANT — this section must be run once, by someone with sufficient
-- privileges on the actual Supabase project, via either:
--   * the Supabase Dashboard SQL Editor (Project > SQL Editor), or
--   * `supabase db push` / `psql` with the project's own connection string.
-- It cannot be applied from a generic backend/CI environment — pg_cron is a
-- Postgres extension that lives on the database server itself, and Supabase
-- requires it to be enabled per-project (Dashboard > Database > Extensions >
-- "pg_cron", or `CREATE EXTENSION IF NOT EXISTS pg_cron;` below if your role
-- already has that permission).
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent reschedule: drop any previous registration of this exact job
-- name first so reapplying this migration never creates duplicate jobs
-- (cron.unschedule on a name with no matching job is a no-op, not an error).
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cancel-expired-retailer-orders';
END $$;

-- Every minute. A single guarded UPDATE plus a handful of stock restores is
-- cheap; this cadence keeps the retailer's cart/stock view accurate without
-- requiring the app to be open.
SELECT cron.schedule(
  'cancel-expired-retailer-orders',
  '* * * * *',
  $$SELECT public.cancel_expired_retailer_orders();$$
);

-- Verification (run manually after applying):
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'cancel-expired-retailer-orders';
--   SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'cancel-expired-retailer-orders') ORDER BY start_time DESC LIMIT 5;
