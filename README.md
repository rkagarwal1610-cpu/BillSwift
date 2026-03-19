# BillSwift ERP — Full Stack Production App

## Stack
- **Frontend:** Vanilla HTML/CSS/JS (zero dependencies, instant load)
- **Backend:** Node.js + Express REST API
- **Database:** PostgreSQL (Neon)
- **Hosting:** Vercel (frontend + serverless backend)

## Modules
- ✅ Auth (JWT login, register, session)
- ✅ Admin (users, roles, audit log)
- ✅ Inventory (products, stock levels, adjustments)
- ✅ Sales (invoices, clients, payments)
- ✅ Procurement (purchase orders, vendors)
- ✅ Finance (payments, ledger, P&L)
- ✅ POS Terminal (cart, billing, payment modes)
- ✅ Invoice Maker (line items, GST, live preview)
- ✅ Reports & Analytics

## Quick Deploy

### 1. Database (Neon)
1. Go to https://neon.tech → create project `billswift-db` (Singapore)
2. Copy connection string

### 2. GitHub
```bash
git init && git add . && git commit -m "initial"
git remote add origin https://github.com/YOUR_USERNAME/billswift-erp.git
git push -u origin main
```

### 3. Vercel
1. https://vercel.com → New Project → Import `billswift-erp`
2. Add environment variables:
   - `DATABASE_URL` = your Neon connection string
   - `DB_SSL` = `true`
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = random 64-char string (https://generate-secret.vercel.app/64)
   - `FRONTEND_URL` = your Vercel app URL (set after first deploy)
3. Click Deploy

### 4. Run Migrations
In Neon SQL Editor or locally:
```bash
cd backend && npm install
DATABASE_URL="your_neon_url" npm run migrate
DATABASE_URL="your_neon_url" npm run seed
```

### 5. First Login
- Email: `admin@billswift.in`
- Password: `BillSwift@123`
- **Change password immediately after login!**

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | Login |
| POST | /api/auth/register | Register first user |
| GET | /api/auth/me | Current user |
| GET | /api/users | List users |
| POST | /api/users | Create user |
| GET | /api/products | List products |
| POST | /api/products | Add product |
| POST | /api/products/:id/adjust | Adjust stock |
| GET | /api/clients | List clients |
| POST | /api/clients | Add client |
| GET | /api/invoices | List invoices |
| POST | /api/invoices | Create invoice |
| PUT | /api/invoices/:id/status | Update status |
| GET | /api/procurement/vendors | List vendors |
| POST | /api/procurement/vendors | Add vendor |
| GET | /api/procurement/po | List POs |
| POST | /api/procurement/po | Create PO |
| POST | /api/finance/payments | Record payment |
| GET | /api/finance/audit | Audit log |
| GET | /api/dashboard | Dashboard summary |
| GET | /health | Health check |
