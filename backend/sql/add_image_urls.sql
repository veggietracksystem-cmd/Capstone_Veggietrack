-- ============================================================
-- VeggieTrack – Cloudinary image support
-- Run once in the Supabase SQL editor, after schema_complete.sql and
-- fifo_inventory_upgrade.sql.
--
-- Adds an optional photo URL to harvests (uploaded from the mobile app, see
-- mobile/src/lib/cloudinary.js). Delivery proof photos use
-- deliveries.proof_photo_url.
-- ============================================================

ALTER TABLE harvests ADD COLUMN IF NOT EXISTS image_url TEXT;
