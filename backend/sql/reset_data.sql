-- ============================================================
-- VeggieTrack – Wipe all data, keep schema/features intact
-- Run this in the Supabase SQL Editor.
--
-- This TRUNCATEs every application table (deletes all rows) but does
-- NOT touch table definitions, columns, enum types, indexes, RLS
-- policies, or any Supabase Auth users — the app's functionality is
-- unaffected, it just starts with zero data.
--
-- NOTE: This does NOT delete uploaded media in Cloudinary (harvest
-- photos, delivery proof photos). Those are stored externally and
-- referenced by URL — clear them separately in the Cloudinary
-- dashboard if you want a fully fresh start there too.
-- ============================================================

TRUNCATE TABLE
  messages,
  notifications,
  payments,
  deliveries,
  order_items,
  orders,
  pickup_requests,
  products,
  harvests,
  users
CASCADE;

-- Verification: every table should show 0 rows.
SELECT 'users' AS table_name, COUNT(*) FROM users
UNION ALL SELECT 'harvests', COUNT(*) FROM harvests
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'orders', COUNT(*) FROM orders
UNION ALL SELECT 'order_items', COUNT(*) FROM order_items
UNION ALL SELECT 'pickup_requests', COUNT(*) FROM pickup_requests
UNION ALL SELECT 'deliveries', COUNT(*) FROM deliveries
UNION ALL SELECT 'payments', COUNT(*) FROM payments
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
UNION ALL SELECT 'messages', COUNT(*) FROM messages;
