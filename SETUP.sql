-- ============================================================
-- BillSwift ERP — Complete Database Setup
-- Run this entire script in Neon SQL Editor
-- ============================================================

-- Drop old audit_logs if it exists with wrong FK (re-create clean)
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS stock_movements CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS po_items CASCADE;
DROP TABLE IF EXISTS purchase_orders CASCADE;
DROP TABLE IF EXISTS invoice_items CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS vendors CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS company_settings CASCADE;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'Viewer',
  branch VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  gstin VARCHAR(20),
  email VARCHAR(100),
  phone VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  credit_limit NUMERIC(12,2) DEFAULT 0,
  outstanding NUMERIC(12,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  gstin VARCHAR(20),
  email VARCHAR(100),
  phone VARCHAR(20),
  address TEXT,
  type VARCHAR(100),
  total_business NUMERIC(12,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100),
  hsn VARCHAR(20),
  unit VARCHAR(20) DEFAULT 'Nos',
  gst_rate NUMERIC(5,2) DEFAULT 18,
  purchase_rate NUMERIC(12,2) DEFAULT 0,
  sale_rate NUMERIC(12,2) DEFAULT 0,
  qty INTEGER DEFAULT 0,
  reorder_level INTEGER DEFAULT 10,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no VARCHAR(50) UNIQUE NOT NULL,
  client_id UUID,
  client_name VARCHAR(200),
  invoice_date DATE NOT NULL,
  due_date DATE,
  gst_type VARCHAR(20) DEFAULT 'cgst',
  subtotal NUMERIC(12,2) DEFAULT 0,
  gst_amount NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  paid_amount NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'draft',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE,
  product_id UUID,
  description VARCHAR(300),
  hsn VARCHAR(20),
  qty NUMERIC(10,2),
  rate NUMERIC(12,2),
  gst_rate NUMERIC(5,2),
  amount NUMERIC(12,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_no VARCHAR(50) UNIQUE NOT NULL,
  vendor_id UUID,
  vendor_name VARCHAR(200),
  order_date DATE NOT NULL,
  expected_date DATE,
  warehouse VARCHAR(100),
  subtotal NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(30) DEFAULT 'pending',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE po_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id UUID,
  description VARCHAR(300),
  qty NUMERIC(10,2),
  rate NUMERIC(12,2),
  amount NUMERIC(12,2),
  received_qty NUMERIC(10,2) DEFAULT 0
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID,
  invoice_no VARCHAR(50),
  client_name VARCHAR(200),
  amount NUMERIC(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  mode VARCHAR(30),
  reference VARCHAR(100),
  notes TEXT,
  recorded_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID,
  product_name VARCHAR(200),
  type VARCHAR(20),
  qty INTEGER,
  reason VARCHAR(100),
  notes TEXT,
  warehouse VARCHAR(100),
  reference VARCHAR(100),
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  user_name VARCHAR(100),
  action TEXT NOT NULL,
  module VARCHAR(50),
  ip VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE company_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO company_settings (key, value) VALUES
  ('company_name', 'BillSwift Enterprises Pvt. Ltd.'),
  ('gstin', '07AABCB1234L1Z5'),
  ('pan', 'AABCB1234L'),
  ('address', 'B-12, Okhla Industrial Area Phase II, New Delhi 110020'),
  ('default_gst_rate', '18'),
  ('financial_year_start', 'April')
ON CONFLICT (key) DO NOTHING;

-- ✅ Done! All tables created.
-- Next: Open your app → click "Create admin account" to register.
