-- Delivery reject feature — run in the Supabase SQL editor.
-- Lets delivery personnel decline an assigned delivery before starting it
-- (before it reaches 'picked_up'). Adds an audit trail for why it was
-- declined; the delivery/order are reset to unassigned so the distributor
-- can reassign a different rider.

ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP WITH TIME ZONE;
