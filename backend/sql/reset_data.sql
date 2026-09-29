-- ============================================================
-- VeggieTrack – Delete all application data (schema unchanged)
-- Run in the Supabase SQL Editor.
--
-- Truncates every application table. Table definitions, indexes, RLS policies
-- and Supabase Auth users are not affected. Uploaded Cloudinary media is not
-- deleted (see scripts/clear_cloudinary.js).
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
