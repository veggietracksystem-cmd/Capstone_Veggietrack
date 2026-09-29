-- Lets riders decline an assigned delivery before pickup and records the reason.
-- The delivery and order become unassigned so the distributor can reassign them.
-- Run in the Supabase SQL editor.

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP WITH TIME ZONE;
