-- ============================================================
-- VeggieTrack – Cloudinary image support
-- Run this ONCE in the Supabase SQL editor, after schema_complete.sql
-- and fifo_inventory_upgrade.sql have already been applied.
--
-- Adds an optional photo URL to harvests (farmer's photo of the crop).
-- Cloudinary secure_url uploaded directly from the mobile app — see
-- mobile/src/lib/cloudinary.js. Delivery proof photos already have
-- their own column (deliveries.proof_photo_url, in schema_complete.sql).
--
-- Products intentionally do NOT get an image_url column — the
-- marketplace/product-list grids use the built-in per-vegetable icon
-- set (mobile/src/lib/vegetableIcons.js) instead of uploaded photos.
-- ============================================================

ALTER TABLE harvests ADD COLUMN IF NOT EXISTS image_url TEXT;
