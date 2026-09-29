-- ============================================================
-- VeggieTrack — clear all test data and every account except the
-- distributor, ready for real client accounts.
-- Run this in the Supabase SQL Editor.
--
-- Keeps: the trusted distributor profile and its Auth user.
-- Deletes: every other public.users row, their auth.users rows, and
--          ALL business data (harvests, batches, orders, deliveries,
--          pickups, payments, messages, notifications, saved addresses,
--          tracking pings and the account audit trail).
--
-- Unlike sql/reset_data.sql, this keeps the distributor profile, whose ID is
-- TRUSTED_DISTRIBUTOR in backend/lib/auth.js. Uploaded Cloudinary media is not
-- deleted.
--
-- THIS IS IRREVERSIBLE. Take a database backup first:
-- Supabase Dashboard > Database > Backups.
-- ============================================================

-- The kept profile is 86d9d317-b099-430c-be21-824d0a3434b6; it must match
-- TRUSTED_DISTRIBUTOR in backend/lib/auth.js.

-- ------------------------------------------------------------
-- STEP 1 — PRE-FLIGHT. Run this on its own and read the output
-- before running anything below it.
-- ------------------------------------------------------------
SELECT id, full_name, email, role, account_status,
       CASE WHEN id = '86d9d317-b099-430c-be21-824d0a3434b6'
            THEN 'KEEP' ELSE 'DELETE' END AS action
FROM public.users
ORDER BY action, role;

SELECT 'harvests' AS t, COUNT(*) FROM public.harvests
UNION ALL SELECT 'products',           COUNT(*) FROM public.products
UNION ALL SELECT 'pickup_requests',    COUNT(*) FROM public.pickup_requests
UNION ALL SELECT 'orders',             COUNT(*) FROM public.orders
UNION ALL SELECT 'order_items',        COUNT(*) FROM public.order_items
UNION ALL SELECT 'deliveries',         COUNT(*) FROM public.deliveries
UNION ALL SELECT 'delivery_tracking',  COUNT(*) FROM public.delivery_tracking
UNION ALL SELECT 'delivery_addresses', COUNT(*) FROM public.delivery_addresses
UNION ALL SELECT 'payments',           COUNT(*) FROM public.payments
UNION ALL SELECT 'messages',           COUNT(*) FROM public.messages
UNION ALL SELECT 'notifications',      COUNT(*) FROM public.notifications
UNION ALL SELECT 'account_audit',      COUNT(*) FROM public.account_audit;

-- ------------------------------------------------------------
-- STEP 2 — THE WIPE. Only run this once STEP 1 shows exactly one
-- KEEP row and it is your distributor.
-- ------------------------------------------------------------
BEGIN;

-- Abort if the distributor profile does not exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = '86d9d317-b099-430c-be21-824d0a3434b6' AND role = 'distributor'
  ) THEN
    RAISE EXCEPTION 'Trusted distributor 86d9d317-... not found as a distributor. Refusing to wipe.';
  END IF;
END $$;

-- Business data, children first. delivery_addresses, delivery_tracking and
-- account_audit are cleared explicitly because their ON DELETE behaviour is not
-- defined in these scripts (account_audit would otherwise block the user delete).
DELETE FROM public.delivery_tracking;
DELETE FROM public.order_items;
DELETE FROM public.deliveries;
DELETE FROM public.payments;
DELETE FROM public.orders;
DELETE FROM public.products;
DELETE FROM public.pickup_requests;
DELETE FROM public.harvests;
DELETE FROM public.delivery_addresses;
DELETE FROM public.messages;
DELETE FROM public.notifications;
DELETE FROM public.account_audit;

-- Profiles. public.users.auth_user_id references auth.users with NO ACTION,
-- so the profile row must go before its Auth user.
DELETE FROM public.users
WHERE id <> '86d9d317-b099-430c-be21-824d0a3434b6';

-- Auth users left with no profile. Restricted to confirmed orphans so a
-- half-finished signup mid-wipe is never collateral.
DELETE FROM auth.users
WHERE id <> '86d9d317-b099-430c-be21-824d0a3434b6'
  AND id NOT IN (SELECT auth_user_id FROM public.users WHERE auth_user_id IS NOT NULL);

COMMIT;

-- ------------------------------------------------------------
-- STEP 3 — VERIFY. Expect one user, one auth user, zeros everywhere else.
-- ------------------------------------------------------------
SELECT 'public.users' AS t, COUNT(*) FROM public.users
UNION ALL SELECT 'auth.users',         COUNT(*) FROM auth.users
UNION ALL SELECT 'harvests',           COUNT(*) FROM public.harvests
UNION ALL SELECT 'products',           COUNT(*) FROM public.products
UNION ALL SELECT 'pickup_requests',    COUNT(*) FROM public.pickup_requests
UNION ALL SELECT 'orders',             COUNT(*) FROM public.orders
UNION ALL SELECT 'order_items',        COUNT(*) FROM public.order_items
UNION ALL SELECT 'deliveries',         COUNT(*) FROM public.deliveries
UNION ALL SELECT 'delivery_tracking',  COUNT(*) FROM public.delivery_tracking
UNION ALL SELECT 'delivery_addresses', COUNT(*) FROM public.delivery_addresses
UNION ALL SELECT 'payments',           COUNT(*) FROM public.payments
UNION ALL SELECT 'messages',           COUNT(*) FROM public.messages
UNION ALL SELECT 'notifications',      COUNT(*) FROM public.notifications
UNION ALL SELECT 'account_audit',      COUNT(*) FROM public.account_audit;
