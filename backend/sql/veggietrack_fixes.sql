-- VeggieTrack schema updates — run in the Supabase SQL editor.
-- Status columns are TEXT by default, so the newer status values need no schema
-- change. The enum sections apply only to databases that use Postgres enums.

------------------------------------------------------------------------------
-- Enforce a single distributor account at the database level.
------------------------------------------------------------------------------
-- Inspect current distributors first:
--   select id, full_name, phone from users where role = 'distributor';

create unique index if not exists one_distributor_only
  on users ((role))
  where role = 'distributor';

------------------------------------------------------------------------------
-- Order and delivery status flow
--   orders.status:     pending -> approved -> picked_up -> in_transit -> delivered
--   deliveries.status: pending -> assigned -> picked_up -> in_transit -> delivered
--
-- No change is needed when these columns are TEXT. Check with:
--   select column_name, data_type, udt_name
--   from information_schema.columns
--   where table_name in ('orders','deliveries') and column_name = 'status';
--
-- If data_type = 'USER-DEFINED' (an enum), add the new values, e.g.:
--   alter type order_status add value if not exists 'picked_up';
--   alter type order_status add value if not exists 'in_transit';
--   alter type delivery_status add value if not exists 'picked_up';
--   alter type delivery_status add value if not exists 'in_transit';
-- (Replace order_status / delivery_status with your actual enum type names from
--  the udt_name column above. Commit new enum values before using them.)

------------------------------------------------------------------------------
-- pickup_requests.status uses 'requested' -> 'received'. If it is an
-- enum and missing 'received', add it (skip if the column is TEXT):
--   alter type pickup_status add value if not exists 'received';

------------------------------------------------------------------------------
-- Additional columns
------------------------------------------------------------------------------
-- Add item_id to notifications for deep linking
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS item_id UUID;

-- Add reset token columns to users for forgot password email flow
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMP WITH TIME ZONE;

-- Add location coordinates to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude NUMERIC;

-- Add harvest_date to products for FIFO tracking
ALTER TABLE products ADD COLUMN IF NOT EXISTS harvest_date TIMESTAMP WITH TIME ZONE;

-- Add delivery_personnel_id to pickup_requests
ALTER TABLE pickup_requests ADD COLUMN IF NOT EXISTS delivery_personnel_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Additional order status values.
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'picked_up';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'in_transit';

-- The checked-in base schema uses TEXT for these two statuses. Inspect the
-- actual column type; only alter it when an enum really exists (including
-- installations that used a different enum name).
DO $$
DECLARE target record; status_type regtype; enum_value text;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('deliveries', ARRAY['assigned','picked_up','in_transit']),
    ('pickup_requests', ARRAY['assigned','picked_up'])
  ) AS targets(table_name, new_values) LOOP
    SELECT a.atttypid::regtype INTO status_type
      FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
      WHERE a.attrelid=to_regclass('public.' || target.table_name)
        AND a.attname='status' AND NOT a.attisdropped AND t.typtype='e';
    IF status_type IS NOT NULL THEN
      FOREACH enum_value IN ARRAY target.new_values LOOP
        EXECUTE format('ALTER TYPE %s ADD VALUE IF NOT EXISTS %L', status_type, enum_value);
      END LOOP;
    END IF;
  END LOOP;
END $$;
