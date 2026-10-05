-- ============================================================
-- VeggieTrack – rider "Available for Deliveries" status
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- users.is_available_for_delivery is set only by the rider (Rider Home toggle,
-- PUT /api/delivery/availability). Distributors see and can assign only riders
-- with it on, for new orders and new pickups. Turning it off never changes
-- deliveries or pickups that are already assigned.
--
-- New riders start unavailable. Riders who exist when this runs start
-- available, so the distributor's rider list is the same as before the update.
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_available_for_delivery'
  ) THEN
    ALTER TABLE public.users ADD COLUMN is_available_for_delivery boolean NOT NULL DEFAULT false;
    UPDATE public.users SET is_available_for_delivery = true WHERE role = 'delivery_personnel';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ---- Verification -----------------------------------------------------
-- select full_name, account_status, is_available_for_delivery
-- from public.users where role = 'delivery_personnel' order by full_name;
