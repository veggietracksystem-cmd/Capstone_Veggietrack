-- ============================================================
-- VeggieTrack – FIFO batch-tracked inventory upgrade
-- Run once in the Supabase SQL editor, after schema_complete.sql and
-- veggietrack_fixes.sql.
--
-- Adds batch provenance and lifecycle columns to `products`, where each row is
-- one batch of stock. No new table is introduced.
-- ============================================================

-- ---- products (batch/lot table) -----------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS harvest_id UUID REFERENCES harvests(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS pickup_request_id UUID REFERENCES pickup_requests(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS farmer_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS quantity_received NUMERIC;
ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'received'; -- received | listed | sold_out
ALTER TABLE products ADD COLUMN IF NOT EXISTS batch_photo_url TEXT; -- distributor's actual received-batch photo

-- Price is unknown until a batch is added to the product list.
ALTER TABLE products ALTER COLUMN price_per_kg DROP NOT NULL;

-- Existing rows were already sellable, so they are marked 'listed'. Their
-- provenance columns stay NULL.
UPDATE products
SET status = 'listed',
    quantity_received = COALESCE(quantity_received, stock_kg)
WHERE status IS NULL OR quantity_received IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_harvest_id ON products(harvest_id);
CREATE INDEX IF NOT EXISTS idx_products_farmer_id ON products(farmer_id);

-- ---- order_items: link each line back to the exact batch it consumed ----
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

-- ---- orders: capture why a distributor rejected/cancelled an order ------
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- ---- Verification -----------------------------------------------------
-- select column_name, data_type, is_nullable from information_schema.columns
-- where table_name = 'products' order by ordinal_position;
-- select column_name from information_schema.columns where table_name = 'order_items';
-- select id, vegetable_name, status, quantity_received, stock_kg, harvest_date from products order by harvest_date;
