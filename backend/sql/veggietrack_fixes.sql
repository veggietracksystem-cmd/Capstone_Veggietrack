-- VeggieTrack fixes — run in the Supabase SQL editor.
-- Most status columns in this project are plain TEXT, so the new status strings
-- ("picked_up", "in_transit", "received") work with NO schema change. The blocks
-- below are (a) the hard DB guarantee for Issue 3, and (b) optional ENUM upgrades
-- ONLY if your columns are Postgres enums rather than text.

------------------------------------------------------------------------------
-- ISSUE 3: enforce a single distributor at the database level (belt + braces;
-- the API already returns 409, this stops any path that bypasses it).
------------------------------------------------------------------------------
-- Inspect current distributors first:
--   select id, full_name, phone from users where role = 'distributor';

create unique index if not exists one_distributor_only
  on users ((role))
  where role = 'distributor';

------------------------------------------------------------------------------
-- ISSUE 8/9/10: order + delivery status flow
--   orders.status:     pending -> approved -> picked_up -> in_transit -> delivered
--   deliveries.status: pending -> assigned -> picked_up -> in_transit -> delivered
--
-- If these columns are TEXT (default for this project), you are DONE — no change
-- needed. Verify with:
--   select column_name, data_type, udt_name
--   from information_schema.columns
--   where table_name in ('orders','deliveries') and column_name = 'status';
--
-- ONLY if data_type = 'USER-DEFINED' (an enum), add the new values, e.g.:
--   alter type order_status add value if not exists 'picked_up';
--   alter type order_status add value if not exists 'in_transit';
--   alter type delivery_status add value if not exists 'picked_up';
--   alter type delivery_status add value if not exists 'in_transit';
-- (Replace order_status / delivery_status with your actual enum type names from
--  the udt_name column above. ADD VALUE cannot run inside a transaction block.)

------------------------------------------------------------------------------
-- ISSUE 5: pickup_requests.status uses 'requested' -> 'received'. If it is an
-- enum and missing 'received', add it (skip if the column is TEXT):
--   alter type pickup_status add value if not exists 'received';

------------------------------------------------------------------------------
-- ISSUE 6: verify orders are actually being written for the retailer. Replace
-- the UUID with the affected retailer's users.id:
--   select id, retailer_id, distributor_id, status, total_amount, created_at
--   from orders
--   where retailer_id = '<retailer-user-id>'
--   order by created_at desc;
-- If rows exist here but the app showed an empty list, the cause was the
-- embedded join (now fixed in GET /api/orders) — just pull-to-refresh.
