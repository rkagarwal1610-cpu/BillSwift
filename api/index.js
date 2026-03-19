require('dotenv').config();
require('express-async-errors');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('./db');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'billswift-dev-secret-change-in-production';

// ── Auth middleware ───────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Audit log helper ──────────────────────────────────────
async function audit(userId, userName, action, module, ip) {
  try {
    await db.query(
      'INSERT INTO audit_logs (user_id, user_name, action, module, ip) VALUES ($1,$2,$3,$4,$5)',
      [userId || null, userName || 'System', action, module || 'System', ip || '']
    );
  } catch(e) { /* never crash on audit */ }
}

// ════════════════════════════════════════════════════════
// HEALTH
// ════════════════════════════════════════════════════════
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'healthy', db: 'connected', version: '3.1.0' });
  } catch (e) {
    res.status(503).json({ status: 'unhealthy', error: e.message });
  }
});

// ════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { rows } = await db.query(
      'SELECT * FROM users WHERE LOWER(email)=$1 AND is_active=true',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    await db.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    await audit(user.id, user.name, 'User logged in', 'Auth', req.ip);

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET, { expiresIn: '8h' }
    );
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, branch: user.branch } });
  } catch (e) {
    console.error('Login error:', e.message);
    res.status(500).json({ error: 'Login failed: ' + e.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const { rows: countRows } = await db.query('SELECT COUNT(*) FROM users');
    if (parseInt(countRows[0].count) > 0) return res.status(403).json({ error: 'Admin already exists. Please log in.' });

    const { rows: exists } = await db.query('SELECT id FROM users WHERE LOWER(email)=$1', [email.toLowerCase().trim()]);
    if (exists.length) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      'INSERT INTO users (name,email,password_hash,role,branch) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email,role,branch',
      [name.trim(), email.toLowerCase().trim(), hash, 'Super Admin', 'Head Office']
    );

    await audit(rows[0].id, rows[0].name, 'Admin account created', 'Auth', req.ip);

    const token = jwt.sign(
      { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role },
      JWT_SECRET, { expiresIn: '8h' }
    );
    res.status(201).json({ token, user: rows[0] });
  } catch (e) {
    console.error('Register error:', e.message);
    res.status(500).json({ error: 'Registration failed: ' + e.message });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id,name,email,role,branch,last_login FROM users WHERE id=$1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════
app.get('/api/dashboard', authMiddleware, async (req, res) => {
  try {
    const [rev, out, stk, low, cli, inv] = await Promise.all([
      db.query('SELECT COALESCE(SUM(total),0) v FROM invoices'),
      db.query("SELECT COALESCE(SUM(total-paid_amount),0) v FROM invoices WHERE status IN ('pending','overdue','partial')"),
      db.query('SELECT COALESCE(SUM(qty*sale_rate),0) v FROM products WHERE is_active=true'),
      db.query('SELECT COUNT(*) c FROM products WHERE is_active=true AND qty<=reorder_level'),
      db.query('SELECT COUNT(*) c FROM clients WHERE is_active=true'),
      db.query('SELECT * FROM invoices ORDER BY created_at DESC LIMIT 5'),
    ]);
    res.json({
      total_revenue: parseFloat(rev.rows[0].v),
      outstanding: parseFloat(out.rows[0].v),
      stock_value: parseFloat(stk.rows[0].v),
      low_stock_count: parseInt(low.rows[0].c),
      active_clients: parseInt(cli.rows[0].c),
      recent_invoices: inv.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// USERS
// ════════════════════════════════════════════════════════
app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id,name,email,phone,role,branch,is_active,last_login,created_at FROM users ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', authMiddleware, async (req, res) => {
  try {
    const { name, email, phone, role='Viewer', branch, password='BillSwift@123' } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });
    const exists = await db.query('SELECT id FROM users WHERE LOWER(email)=$1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email already exists' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      'INSERT INTO users (name,email,phone,password_hash,role,branch) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,name,email,phone,role,branch,is_active',
      [name, email.toLowerCase(), phone, hash, role, branch]
    );
    await audit(req.user.id, req.user.name, `User ${name} created`, 'Admin', req.ip);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id', authMiddleware, async (req, res) => {
  try {
    const { name, phone, role, branch, is_active } = req.body;
    const { rows } = await db.query(
      'UPDATE users SET name=COALESCE($1,name),phone=COALESCE($2,phone),role=COALESCE($3,role),branch=COALESCE($4,branch),is_active=COALESCE($5,is_active) WHERE id=$6 RETURNING id,name,email,role,branch,is_active',
      [name, phone, role, branch, is_active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/users/stats', authMiddleware, async (req, res) => {
  try {
    const t = await db.query('SELECT COUNT(*) FROM users');
    const a = await db.query('SELECT COUNT(*) FROM users WHERE is_active=true');
    res.json({ total: parseInt(t.rows[0].count), active: parseInt(a.rows[0].count) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// CLIENTS
// ════════════════════════════════════════════════════════
app.get('/api/clients', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM clients WHERE is_active=true ORDER BY name');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clients', authMiddleware, async (req, res) => {
  try {
    const { name, gstin, email, phone, address, city, state, pincode, credit_limit=0 } = req.body;
    if (!name) return res.status(400).json({ error: 'Client name required' });
    const { rows } = await db.query(
      'INSERT INTO clients (name,gstin,email,phone,address,city,state,pincode,credit_limit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [name, gstin, email, phone, address, city, state, pincode, credit_limit]
    );
    await audit(req.user.id, req.user.name, `Client ${name} added`, 'Sales', req.ip);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/clients/:id', authMiddleware, async (req, res) => {
  try {
    const { name, gstin, email, phone, city, state } = req.body;
    const { rows } = await db.query(
      'UPDATE clients SET name=COALESCE($1,name),gstin=COALESCE($2,gstin),email=COALESCE($3,email),phone=COALESCE($4,phone),city=COALESCE($5,city),state=COALESCE($6,state) WHERE id=$7 RETURNING *',
      [name, gstin, email, phone, city, state, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// PRODUCTS / INVENTORY
// ════════════════════════════════════════════════════════
app.get('/api/products', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM products WHERE is_active=true ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products', authMiddleware, async (req, res) => {
  try {
    const { name, sku, category, hsn, unit='Nos', gst_rate=18, purchase_rate=0, sale_rate, qty=0, reorder_level=10 } = req.body;
    if (!name) return res.status(400).json({ error: 'Product name required' });
    if (!sale_rate) return res.status(400).json({ error: 'Sale rate required' });
    const skuVal = sku || 'SKU-' + Date.now().toString().slice(-6);
    const { rows } = await db.query(
      'INSERT INTO products (sku,name,category,hsn,unit,gst_rate,purchase_rate,sale_rate,qty,reorder_level) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [skuVal, name, category, hsn, unit, gst_rate, purchase_rate, sale_rate, qty, reorder_level]
    );
    await audit(req.user.id, req.user.name, `Product ${name} added`, 'Inventory', req.ip);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/products/:id/adjust', authMiddleware, async (req, res) => {
  try {
    const { qty, reason='Manual adjustment', notes, warehouse } = req.body;
    const { rows: [p] } = await db.query('SELECT * FROM products WHERE id=$1', [req.params.id]);
    if (!p) return res.status(404).json({ error: 'Product not found' });
    const newQty = Math.max(0, p.qty + parseInt(qty));
    await db.query('UPDATE products SET qty=$1 WHERE id=$2', [newQty, req.params.id]);
    await db.query('INSERT INTO stock_movements (product_id,product_name,type,qty,reason,notes,warehouse,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [p.id, p.name, qty > 0 ? 'in' : 'out', Math.abs(qty), reason, notes, warehouse, req.user.id]);
    await audit(req.user.id, req.user.name, `Stock adjusted: ${p.name} by ${qty}`, 'Inventory', req.ip);
    const { rows: [updated] } = await db.query('SELECT * FROM products WHERE id=$1', [req.params.id]);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/products/stats', authMiddleware, async (req, res) => {
  try {
    const t = await db.query('SELECT COUNT(*) FROM products WHERE is_active=true');
    const l = await db.query('SELECT COUNT(*) FROM products WHERE is_active=true AND qty<=reorder_level');
    const v = await db.query('SELECT COALESCE(SUM(qty*sale_rate),0) v FROM products WHERE is_active=true');
    res.json({ total_skus: parseInt(t.rows[0].count), low_stock: parseInt(l.rows[0].count), stock_value: parseFloat(v.rows[0].v) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// INVOICES
// ════════════════════════════════════════════════════════
app.get('/api/invoices', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM invoices ORDER BY created_at DESC LIMIT 100');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/invoices', authMiddleware, async (req, res) => {
  try {
    const { client_id, client_name, invoice_date, due_date, gst_type='cgst', items=[], notes, status='draft' } = req.body;
    if (!client_name) return res.status(400).json({ error: 'Client name required' });

    const { rows: cnt } = await db.query('SELECT COUNT(*) FROM invoices');
    const num = String(parseInt(cnt[0].count) + 1).padStart(4, '0');
    const yr = new Date().getFullYear();
    const invoice_no = `INV-${yr}${yr+1}-${num}`;

    let subtotal = 0, gst_amount = 0;
    (items || []).forEach(i => {
      const base = (i.qty||0) * (i.rate||0);
      subtotal += base;
      gst_amount += gst_type === 'exempt' ? 0 : base * (i.gst_rate||0) / 100;
    });
    const total = subtotal + gst_amount;

    const { rows: [inv] } = await db.query(
      'INSERT INTO invoices (invoice_no,client_id,client_name,invoice_date,due_date,gst_type,subtotal,gst_amount,total,status,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *',
      [invoice_no, client_id||null, client_name, invoice_date||new Date(), due_date, gst_type, subtotal, gst_amount, total, status, notes, req.user.id]
    );

    for (const item of (items||[])) {
      const base = (item.qty||0) * (item.rate||0);
      const tax = gst_type === 'exempt' ? 0 : base * (item.gst_rate||0) / 100;
      await db.query(
        'INSERT INTO invoice_items (invoice_id,description,hsn,qty,rate,gst_rate,amount) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [inv.id, item.description, item.hsn, item.qty, item.rate, item.gst_rate, base+tax]
      );
    }

    await audit(req.user.id, req.user.name, `Invoice ${invoice_no} created for ${client_name}`, 'Sales', req.ip);
    res.status(201).json(inv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/invoices/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const { rows: [inv] } = await db.query('UPDATE invoices SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });
    await audit(req.user.id, req.user.name, `Invoice ${inv.invoice_no} marked ${status}`, 'Finance', req.ip);
    res.json(inv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// PROCUREMENT — VENDORS + POs
// ════════════════════════════════════════════════════════
app.get('/api/procurement/vendors', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM vendors WHERE is_active=true ORDER BY name');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/procurement/vendors', authMiddleware, async (req, res) => {
  try {
    const { name, gstin, email, phone, address, type } = req.body;
    if (!name) return res.status(400).json({ error: 'Vendor name required' });
    const { rows } = await db.query(
      'INSERT INTO vendors (name,gstin,email,phone,address,type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [name, gstin, email, phone, address, type]
    );
    await audit(req.user.id, req.user.name, `Vendor ${name} added`, 'Procurement', req.ip);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/procurement/po', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM purchase_orders ORDER BY created_at DESC LIMIT 50');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/procurement/po', authMiddleware, async (req, res) => {
  try {
    const { vendor_id, vendor_name, order_date, expected_date, warehouse, items=[], notes } = req.body;
    if (!vendor_name) return res.status(400).json({ error: 'Vendor required' });
    const { rows: cnt } = await db.query('SELECT COUNT(*) FROM purchase_orders');
    const po_no = `PO-${String(parseInt(cnt[0].count)+1).padStart(3,'0')}`;
    let total = 0;
    (items||[]).forEach(i => { total += (i.qty||0) * (i.rate||0); });
    const status = total <= 50000 ? 'approved' : 'pending';
    const { rows: [po] } = await db.query(
      'INSERT INTO purchase_orders (po_no,vendor_id,vendor_name,order_date,expected_date,warehouse,subtotal,total,status,notes,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
      [po_no, vendor_id||null, vendor_name, order_date||new Date(), expected_date, warehouse, total, total, status, notes, req.user.id]
    );
    await audit(req.user.id, req.user.name, `PO ${po_no} created for ${vendor_name}`, 'Procurement', req.ip);
    res.status(201).json({ ...po, auto_approved: status === 'approved' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/procurement/po/:id/status', authMiddleware, async (req, res) => {
  try {
    const { rows: [po] } = await db.query('UPDATE purchase_orders SET status=$1 WHERE id=$2 RETURNING *', [req.body.status, req.params.id]);
    if (!po) return res.status(404).json({ error: 'PO not found' });
    res.json(po);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════
// FINANCE
// ════════════════════════════════════════════════════════
app.post('/api/finance/payments', authMiddleware, async (req, res) => {
  try {
    const { invoice_id, invoice_no, client_name, amount, payment_date, mode='UPI', reference, notes } = req.body;
    if (!amount || !payment_date) return res.status(400).json({ error: 'Amount and date required' });
    const { rows: [payment] } = await db.query(
      'INSERT INTO payments (invoice_id,invoice_no,client_name,amount,payment_date,mode,reference,notes,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
      [invoice_id||null, invoice_no, client_name, amount, payment_date, mode, reference, notes, req.user.id]
    );
    if (invoice_id) {
      const { rows: [inv] } = await db.query('SELECT * FROM invoices WHERE id=$1', [invoice_id]);
      if (inv) {
        const newPaid = parseFloat(inv.paid_amount) + parseFloat(amount);
        const newStatus = newPaid >= inv.total ? 'paid' : newPaid > 0 ? 'partial' : inv.status;
        await db.query('UPDATE invoices SET paid_amount=$1, status=$2 WHERE id=$3', [newPaid, newStatus, invoice_id]);
      }
    }
    await audit(req.user.id, req.user.name, `Payment ₹${amount} recorded`, 'Finance', req.ip);
    res.status(201).json(payment);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/finance/audit', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 50');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/finance/summary', authMiddleware, async (req, res) => {
  try {
    const [rev, rec, pay, gst, col] = await Promise.all([
      db.query('SELECT COALESCE(SUM(total),0) v FROM invoices'),
      db.query("SELECT COALESCE(SUM(total-paid_amount),0) v FROM invoices WHERE status IN ('pending','overdue','partial')"),
      db.query("SELECT COALESCE(SUM(total),0) v FROM purchase_orders WHERE status IN ('pending','approved')"),
      db.query('SELECT COALESCE(SUM(gst_amount),0) v FROM invoices'),
      db.query('SELECT COALESCE(SUM(amount),0) v FROM payments'),
    ]);
    res.json({ total_revenue: parseFloat(rev.rows[0].v), receivables: parseFloat(rec.rows[0].v), payables: parseFloat(pay.rows[0].v), gst_output: parseFloat(gst.rows[0].v), total_collected: parseFloat(col.rows[0].v) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Error handler ─────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Export for Vercel ─────────────────────────────────────
module.exports = app;

// ── Also run locally if called directly ──────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 10000;
  app.listen(PORT, () => console.log(`✅ BillSwift API running on http://localhost:${PORT}`));
}
