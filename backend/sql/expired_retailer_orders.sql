-- Cancels pending orders whose delivery schedule has passed. Orders already in
-- transit or delivered are not affected. preferred_schedule is a timestamptz, so
-- comparing it with clock_timestamp() is independent of the server timezone.
--
-- Requires public.restore_product_stock (sql/stock_safety.sql).
--
-- Safe to run repeatedly or concurrently: the guarded UPDATE ... RETURNING
-- cancels each order, and restores its stock, exactly once.
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
    -- Restore stock to the exact batch each item was drawn from. Items created
    -- before batch tracking have no product_id and are skipped.
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
-- Runs the function every minute so overdue orders are cancelled even when the
-- app is closed. Apply once as a privileged user in the Supabase SQL Editor (or
-- with psql); the pg_cron extension must be enabled for the project.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Remove any existing job with this name so reapplying never creates duplicates.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cancel-expired-retailer-orders';
END $$;

SELECT cron.schedule(
  'cancel-expired-retailer-orders',
  '* * * * *',
  $$SELECT public.cancel_expired_retailer_orders();$$
);

-- Verification (run manually after applying):
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'cancel-expired-retailer-orders';
--   SELECT * FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'cancel-expired-retailer-orders') ORDER BY start_time DESC LIMIT 5;
