-- Marks orders not delivered by the end of their scheduled day (Philippine time)
-- as 'unsuccessful', on the order and its delivery record, so every role sees the
-- same status. Delivered and cancelled (including rejected) orders are final and
-- never touched. preferred_schedule is a timestamptz and the deadline uses a fixed
-- UTC+8 offset, so the result does not depend on the server timezone.
--
-- Requires sql/inventory_transactions.sql: it adds the 'unsuccessful' status, and
-- its sync_order_stock trigger returns the stock of orders the rider never picked up.
--
-- Safe to run repeatedly or concurrently: each order is marked, and its stock
-- returned, exactly once.
-- Keep identical to the copy in inventory_transactions.sql. The name is kept for
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

-- ============================================================
-- Scheduled execution (pg_cron)
-- ============================================================
-- Runs the function every minute so overdue orders are marked unsuccessful even
-- when the app is closed. Apply once as a privileged user in the Supabase SQL Editor (or
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
