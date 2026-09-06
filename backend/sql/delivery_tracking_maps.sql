-- Additive migration: preserves existing orders, accounts, and tracking history.
-- Run once in Supabase SQL Editor before deploying the tracking backend.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_latitude DOUBLE PRECISION;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_longitude DOUBLE PRECISION;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS current_location_accuracy DOUBLE PRECISION;
