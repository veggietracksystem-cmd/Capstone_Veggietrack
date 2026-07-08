-- ============================================================
-- VeggieTrack – Complete Database Schema
-- Run this in your Supabase SQL Editor (one time)
-- ============================================================

-- 1. Create ENUM types (used by users.role and orders.status)
CREATE TYPE user_role AS ENUM ('farmer', 'distributor', 'retailer', 'delivery_personnel');
CREATE TYPE order_status AS ENUM ('pending', 'approved', 'picked_up', 'in_transit', 'delivered');

-- 2. Create tables
-- Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    email TEXT,
    role user_role NOT NULL,
    password_hash TEXT NOT NULL,
    farm_location TEXT,
    warehouse_location TEXT,
    store_location TEXT,
    service_area TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Harvests (Farmer)
CREATE TABLE IF NOT EXISTS harvests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    farmer_id UUID REFERENCES users(id) ON DELETE CASCADE,
    vegetable_name TEXT NOT NULL,
    quantity_kg NUMERIC NOT NULL,
    status TEXT DEFAULT 'available', -- available, reserved, picked_up, collected
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Products (Distributor inventory)
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    distributor_id UUID REFERENCES users(id) ON DELETE CASCADE,
    vegetable_name TEXT NOT NULL,
    price_per_kg NUMERIC NOT NULL,
    stock_kg NUMERIC NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    retailer_id UUID REFERENCES users(id) ON DELETE CASCADE,
    distributor_id UUID REFERENCES users(id) ON DELETE CASCADE,
    delivery_personnel_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status order_status DEFAULT 'pending',
    total_amount NUMERIC NOT NULL,
    delivery_address TEXT NOT NULL,
    preferred_schedule TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Order Items
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    vegetable_name TEXT NOT NULL,
    quantity_kg NUMERIC NOT NULL,
    price_at_order NUMERIC NOT NULL
);

-- Deliveries
CREATE TABLE IF NOT EXISTS deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    delivery_personnel_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'pending', -- pending, assigned, picked_up, in_transit, delivered
    proof_photo_url TEXT,
    delivered_at TIMESTAMP WITH TIME ZONE
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    distributor_id UUID REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    status TEXT DEFAULT 'unpaid', -- unpaid, paid
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info', -- order, delivery, pickup, payment, system
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_id UUID REFERENCES users(id) ON DELETE CASCADE,
    recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pickup Requests
CREATE TABLE IF NOT EXISTS pickup_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farmer_id UUID REFERENCES users(id) ON DELETE CASCADE,
    harvest_id UUID REFERENCES harvests(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'requested', -- requested, received
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    note TEXT,
    received_by UUID REFERENCES users(id) ON DELETE SET NULL,
    received_at TIMESTAMP WITH TIME ZONE,
    amount NUMERIC,
    payment_status TEXT DEFAULT 'unpaid', -- unpaid, paid
    paid_at TIMESTAMP WITH TIME ZONE
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_harvests_farmer_id ON harvests(farmer_id);
CREATE INDEX IF NOT EXISTS idx_products_distributor_id ON products(distributor_id);
CREATE INDEX IF NOT EXISTS idx_orders_retailer_id ON orders(retailer_id);
CREATE INDEX IF NOT EXISTS idx_orders_distributor_id ON orders(distributor_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_order_id ON deliveries(order_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_personnel_id ON deliveries(delivery_personnel_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_distributor_id ON payments(distributor_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_id ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_farmer_id ON pickup_requests(farmer_id);
CREATE INDEX IF NOT EXISTS idx_pickup_requests_status ON pickup_requests(status);

-- 4. Enforce single distributor (unique index)
CREATE UNIQUE INDEX IF NOT EXISTS one_distributor_only ON users ((role)) WHERE role = 'distributor';

-- 5. Enable Row Level Security (RLS) on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE harvests ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickup_requests ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies (based on your app's logic)
-- Users: only own record
CREATE POLICY "Users can read own record" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own record" ON users FOR UPDATE USING (auth.uid() = id);

-- Harvests: farmers manage own; distributors can read
CREATE POLICY "Farmers manage own harvests" ON harvests USING (auth.uid() = farmer_id);
CREATE POLICY "Distributors can read harvests" ON harvests FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'distributor'));

-- Products: distributors manage own; retailers can read
CREATE POLICY "Distributors manage own products" ON products USING (auth.uid() = distributor_id);
CREATE POLICY "Retailers can read products" ON products FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'retailer'));

-- Orders: retailers manage own; distributors read all; delivery personnel read assigned
CREATE POLICY "Retailers manage own orders" ON orders USING (auth.uid() = retailer_id);
CREATE POLICY "Distributors read all orders" ON orders FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'distributor'));
CREATE POLICY "Delivery personnel read assigned orders" ON orders FOR SELECT USING (auth.uid() = delivery_personnel_id);

-- Order Items: same as orders
CREATE POLICY "Retailers manage own order items" ON order_items USING (EXISTS (SELECT 1 FROM orders WHERE id = order_id AND retailer_id = auth.uid()));
CREATE POLICY "Distributors read order items" ON order_items FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'distributor'));

-- Deliveries: delivery personnel manage; others read
CREATE POLICY "Delivery personnel manage deliveries" ON deliveries USING (auth.uid() = delivery_personnel_id);
CREATE POLICY "Distributors and retailers read deliveries" ON deliveries FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('distributor', 'retailer')));

-- Payments: distributors manage; retailers read
CREATE POLICY "Distributors manage payments" ON payments USING (auth.uid() = distributor_id);
CREATE POLICY "Retailers read payments" ON payments FOR SELECT USING (EXISTS (SELECT 1 FROM orders WHERE id = order_id AND retailer_id = auth.uid()));

-- Notifications: users read/update own
CREATE POLICY "Users read own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON notifications FOR UPDATE USING (auth.uid() = user_id);

-- Messages: participants manage
CREATE POLICY "messages_insert_own" ON messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "messages_select_participant" ON messages FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
CREATE POLICY "messages_update_receiver" ON messages FOR UPDATE USING (auth.uid() = recipient_id);

-- Pickup Requests: farmers and distributors
CREATE POLICY "pickup_farmer_insert_own" ON pickup_requests FOR INSERT WITH CHECK (auth.uid() = farmer_id);
CREATE POLICY "pickup_farmer_select_own" ON pickup_requests FOR SELECT USING (auth.uid() = farmer_id);
CREATE POLICY "pickup_farmer_update_own" ON pickup_requests FOR UPDATE USING (auth.uid() = farmer_id);
CREATE POLICY "pickup_distributor_select_all" ON pickup_requests FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'distributor'));
CREATE POLICY "pickup_distributor_update_all" ON pickup_requests FOR UPDATE USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'distributor'));

-- 7. (Optional) Verification query
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;