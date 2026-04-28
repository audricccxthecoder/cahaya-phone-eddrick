# CAHAYA PHONE CRM — Complete Web App Technical Overview
## Untuk Review: Cari Kelemahan, Bug, dan Area Improvement

---

## 1. OVERVIEW UMUM
- **Nama Proyek**: Cahaya Phone CRM — Sistem CRM toko HP + WhatsApp Integration
- **Tujuan**: Manajemen customer, broadcast WA, nota digital, analytics penjualan untuk toko HP fisik
- **Tech Stack**: Node.js 18+, Express.js, PostgreSQL (Supabase), vanilla HTML/CSS/JS frontend
- **Deployment Target**: Backend di Railway (persistent server), Frontend static di Vercel, Database di Supabase
- **Repo**: https://github.com/audricccxthecoder/cahaya-phone-eddrick

---

## 2. ARSITEKTUR SISTEM

```
[Customer Form HTML] ──POST──→ [Express Backend (Railway)]
[Admin Dashboard HTML] ──JWT──→       │
                                      ├── PostgreSQL (Supabase)
                                      ├── WhatsApp Cloud API (Meta)
                                      ├── Google Contacts API (People API)
                                      ├── wa-worker.js (background retry + broadcast processing)
                                      └── node-cron (birthday scheduler)
```

### File Structure
```
backend/
├── server.js                    # Express app, startup, cron init
├── migrate.js                   # Database schema migration (semua DDL)
├── package.json                 # Dependencies
├── config/
│   ├── database.js              # PostgreSQL pool (pg module, connection string)
│   ├── whatsapp.js              # WhatsApp Cloud API service (send template/text, 24h window check)
│   ├── wa-worker.js             # Background worker: retry failed (FOR UPDATE SKIP LOCKED), broadcast processing (backend-driven)
│   ├── authMiddleware.js        # JWT verification middleware
│   ├── auditLog.js              # Audit trail middleware (logs admin actions to DB)
│   └── google.js                # Google Contacts OAuth + People API
├── controllers/
│   ├── formController.js        # Customer form submission (POST /api/form-submit)
│   ├── adminController.js       # Admin dashboard, broadcast, analytics, WA management, audit log
│   ├── webhookController.js     # WA incoming messages + Cloud API webhook + opt-out/opt-in handling
│   ├── birthdayController.js    # Birthday greeting auto/manual
│   ├── googleController.js      # Google OAuth flow
│   └── invoiceController.js     # Nota digital CRUD
├── routes/
│   └── api.js                   # All API route definitions + rate limiters + audit middleware
├── utils/
│   └── phoneUtils.js            # Phone number sanitize & validate (Indonesia: 628xxx)
└── scripts/                     # Utility scripts (admin reset, data fix)

customer/                        # Public customer form (HTML/CSS/JS)
├── index.html
├── script.js
└── style.css

admin/                           # Admin dashboard (HTML/CSS/JS)
├── index.html                   # Login page
├── dashboard.html               # Main dashboard
├── admin.js                     # Dashboard logic (2572 lines) — broadcast sekarang polling status, bukan driving loop
├── admin.css
├── forgot.html
└── reset.html
```

---

## 3. DATABASE SCHEMA (PostgreSQL — Supabase)

### Tabel Utama (TIDAK PERNAH DIHAPUS)
```sql
-- admins: admin login
admins (id SERIAL PK, username VARCHAR(50) UNIQUE, password VARCHAR(255), nama VARCHAR(100), email VARCHAR(255))

-- customers: 1 nomor HP = 1 record (UNIQUE constraint on whatsapp)
customers (id SERIAL PK, nama_lengkap, nama_sales, merk_unit, tipe_unit, harga NUMERIC(15,2),
           qty INT, tanggal_lahir DATE, alamat TEXT, whatsapp VARCHAR(20) UNIQUE NOT NULL,
           metode_pembayaran, tahu_dari, source VARCHAR(20), status VARCHAR(20),
           opted_in BOOLEAN, tipe VARCHAR(20), catatan TEXT, wa_sent BOOLEAN,
           created_at TIMESTAMP, updated_at TIMESTAMP)
-- Status values: New, Contacted, Follow Up, Completed, Inactive
-- Tipe values: Belanja, Chat Only
-- Indexes: idx_whatsapp, idx_source, idx_status

-- purchases: riwayat pembelian (1 customer bisa banyak purchases)
purchases (id SERIAL PK, customer_id INT FK, merk_unit, tipe_unit, harga, qty,
           nama_sales, metode_pembayaran, source, created_at)
-- Indexes: idx_purchases_customer, idx_purchases_merk, idx_purchases_date

-- invoices: nota digital
invoices (id SERIAL PK, invoice_number VARCHAR(50) UNIQUE, token VARCHAR(64) UNIQUE,
          customer_id INT FK, purchase_id INT FK, items JSONB, subtotal, diskon, total,
          metode_pembayaran, catatan, created_at)
-- Indexes: idx_invoices_customer, idx_invoices_token
```

### Tabel Messaging
```sql
-- messages: chat log (incoming + outgoing)
messages (id SERIAL PK, customer_id INT FK, direction VARCHAR(3) CHECK('in','out'),
          message TEXT, channel VARCHAR(20) DEFAULT 'whatsapp', sent_at TIMESTAMP, created_at TIMESTAMP)
-- Indexes: idx_msg_customer, idx_msg_direction

-- whatsapp_logs: setiap pengiriman WA tercatat (Cloud API)
-- Status flow: PENDING → SENT → DELIVERED → READ (atau FAILED → RETRYING → SENT/FAILED)
whatsapp_logs (id SERIAL PK, phone VARCHAR(20), type VARCHAR(20),
              template_name VARCHAR(100), template_language VARCHAR(10),
              template_components JSONB, message_body TEXT,
              wa_message_id VARCHAR(100), status VARCHAR(20) DEFAULT 'PENDING',
              retry_count INT DEFAULT 0, max_retries INT DEFAULT 3,
              next_retry_at TIMESTAMP, error_code VARCHAR(50), error_detail TEXT,
              api_response JSONB, priority VARCHAR(10),
              created_at, updated_at, sent_at, delivered_at, read_at TIMESTAMP)
-- Indexes: idx_wl_phone, idx_wl_status, idx_wl_created
-- Partial indexes: idx_wl_retry (status='FAILED' AND retry_count < max_retries), idx_wl_wa_msg_id (WHERE wa_message_id IS NOT NULL)
-- Status 'RETRYING' dipakai saat worker sedang proses (FOR UPDATE SKIP LOCKED)

-- wa_daily_stats: daily counter (persist, survive restart)
wa_daily_stats (id SERIAL PK, stat_date DATE UNIQUE, sent_count INT, failed_count INT, updated_at)
-- Indexes: idx_wds_date
```

### Tabel Broadcast
```sql
-- broadcast_jobs: setiap broadcast session
broadcast_jobs (id SERIAL PK, message TEXT, source_filter, status VARCHAR(20),
               total INT, sent INT, failed INT, created_at)
-- Status: running, paused, stopped, completed

-- broadcast_recipients: setiap penerima broadcast
broadcast_recipients (id SERIAL PK, job_id INT FK, customer_id INT FK,
                      customer_name, customer_phone, status VARCHAR(20),
                      error TEXT, sent_at TIMESTAMP)
-- Status: pending, sending, sent, failed, skipped
-- 'sending' = sedang diproses worker (FOR UPDATE SKIP LOCKED)
-- Indexes: idx_br_job, idx_br_status (composite: job_id, status)
```

### Tabel Lainnya
```sql
-- birthday_greetings: log ucapan ulang tahun per tahun
birthday_greetings (id SERIAL PK, customer_id INT FK, greeting_year INT,
                    message TEXT, status VARCHAR(20), error TEXT, sent_at TIMESTAMP,
                    UNIQUE(customer_id, greeting_year))
-- Indexes: idx_bg_customer, idx_bg_year

-- app_settings: key-value store (birthday message, daily limit, template names, etc.)
app_settings (key VARCHAR(100) PK, value TEXT, updated_at TIMESTAMP)

-- admin_reset_tokens: password reset tokens
admin_reset_tokens (id SERIAL PK, admin_id INT FK, token VARCHAR(128),
                    expires_at TIMESTAMP, used BOOLEAN)

-- admin_activity_logs: audit trail — siapa melakukan apa kapan
admin_activity_logs (id SERIAL PK, admin_id INT FK REFERENCES admins ON DELETE SET NULL,
                     admin_username VARCHAR(50), action VARCHAR(100),
                     detail TEXT, ip_address VARCHAR(45),
                     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
-- Indexes: idx_aal_admin, idx_aal_action, idx_aal_created
-- Actions yang dicatat: broadcast_start, broadcast_stop, broadcast_pause, broadcast_resume,
--   update_customer_status, update_customer_catatan, update_wa_settings, cleanup_delete

-- google_tokens: Google OAuth tokens
google_tokens (id SERIAL PK, access_token TEXT, refresh_token TEXT, expiry_date BIGINT, updated_at)

-- customer_stats: VIEW for dashboard stats
```

---

## 4. API ENDPOINTS

### Public (No Auth)
```
POST /api/form-submit                    — Customer form submission [RATE LIMITED: 10/15min per IP]
POST /api/webhook/whatsapp               — Legacy WA webhook (Fonnte/Wablas format)
GET  /api/webhook/test                   — Test webhook
GET  /api/webhook/cloud                  — Cloud API webhook verification (Meta)
POST /api/webhook/cloud                  — Cloud API status updates + incoming messages + opt-out/opt-in
GET  /api/sync/contacts?key=xxx          — Quick-sync VCF (secret key via X-Sync-Key header)
GET  /api/sync/list?key=xxx              — Quick-sync JSON list
POST /api/sync/contacts/selected         — Quick-sync selected contacts
GET  /api/google/auth                    — Google OAuth redirect
GET  /api/google/callback                — Google OAuth callback
POST /api/admin/login                    — Admin login (returns JWT) [RATE LIMITED: 10/15min]
POST /api/admin/forgot                   — Forgot password [RATE LIMITED: 5/1jam]
GET  /api/admin/reset/validate           — Validate reset token
POST /api/admin/reset                    — Reset password
GET  /api/health                         — Health check (DB + WA status)
```

### Protected (JWT Required via Authorization: Bearer xxx)
```
-- Dashboard
GET  /api/admin/stats                    — Dashboard statistics + pipeline
GET  /api/admin/pipeline/monthly         — Monthly pipeline breakdown

-- Customers
GET  /api/admin/customers                — List all customers
GET  /api/admin/customers/:id            — Customer detail + purchases + messages
PATCH /api/admin/customers/:id/status    — Update status [AUDIT LOGGED]
PATCH /api/admin/customers/:id/catatan   — Update notes [AUDIT LOGGED]
GET  /api/admin/customers/export         — Export CSV
GET  /api/admin/customers/export/vcf     — Export vCard

-- Messages
GET  /api/admin/messages                 — All messages (last 100)
GET  /api/admin/messages/:customerId     — Messages by customer

-- Analytics
GET  /api/admin/analytics/top-buyers     — Top buyers
GET  /api/admin/analytics/top-products   — Top products
GET  /api/admin/analytics/top-brands     — Top brands

-- Broadcast (template-based, Cloud API, BACKEND-DRIVEN via wa-worker.js)
POST /api/admin/broadcast/start          — Start broadcast (template_name, filters) [AUDIT LOGGED]
POST /api/admin/broadcast/process        — Returns current status (backward compat, worker does the processing)
POST /api/admin/broadcast/stop           — Stop broadcast [AUDIT LOGGED]
POST /api/admin/broadcast/pause          — Pause broadcast [AUDIT LOGGED]
POST /api/admin/broadcast/resume         — Resume broadcast [AUDIT LOGGED]
GET  /api/admin/broadcast/status         — Get broadcast progress
GET  /api/admin/broadcast/daily-count    — Daily sent count

-- WhatsApp Management
GET  /api/admin/wa/status                — WA Cloud API status + worker queue
POST /api/admin/wa/restart               — Reload settings + restart worker
POST /api/admin/wa/settings              — Update daily limit [AUDIT LOGGED]
GET  /api/admin/wa/failed                — Failed WA deliveries
POST /api/admin/wa/retry/:id             — Retry single message
POST /api/admin/wa/retry-all             — Retry all failed
GET  /api/admin/wa/log                   — WA message log (from whatsapp_logs)

-- Birthday
GET  /api/admin/birthday/today           — Today's birthdays
POST /api/admin/birthday/send            — Send single greeting
POST /api/admin/birthday/send-all        — Send all greetings
PUT  /api/admin/birthday/message         — Update greeting template
POST /api/admin/birthday/auto-send       — Toggle auto-send
GET  /api/admin/birthday/history         — Greeting history

-- Data Cleanup
GET  /api/admin/cleanup/status           — Old data counts
GET  /api/admin/cleanup/export           — Export old logs CSV
POST /api/admin/cleanup/delete           — Delete old data (>30 hari) [AUDIT LOGGED]

-- Audit Trail
GET  /api/admin/audit-log                — View admin activity logs (limit, action filter)

-- Admin Profile
PATCH /api/admin/profile                 — Update name
PATCH /api/admin/credentials             — Change username/password

-- Google Contacts
GET  /api/google/status                  — Check connection
POST /api/google/disconnect              — Disconnect Google
```

---

## 5. FITUR-FITUR UTAMA

### A. Customer Form (Public)
- Form pendaftaran customer setelah beli HP
- Input: nama, whatsapp, merk/tipe HP, harga, qty, sales, metode bayar, tahu dari mana
- Auto-detect source dari "tahu_dari" field (Instagram, Facebook, TikTok, Walk-in, dll)
- Phone number sanitization (0812→62812, +62812→62812)
- UNIQUE constraint: 1 nomor = 1 customer record
- Jika customer sudah ada (Chat Only) → upgrade ke Belanja
- Background: auto-reply WA (template) + save Google Contact
- **RATE LIMITED**: max 10 submit per IP per 15 menit (express-rate-limit)

### B. WhatsApp Cloud API Integration
- Official Meta Cloud API (bukan unofficial library)
- Template message support (untuk inisiasi percakapan)
- Text message support (untuk reply dalam 24h window)
- **24h Window Check**: `isWithin24hWindow(phone)` — cek apakah customer pernah kirim pesan dalam 24 jam terakhir. `sendMessage()` otomatis menolak text message jika di luar window, minta pakai template.
- Message queue dengan anti-bot delay (3-8 detik broadcast, 0.5-1.5 detik single)
- Full lifecycle tracking: PENDING → SENT → DELIVERED → READ
- Webhook dari Meta untuk status update (delivered, read, failed)
- Incoming message handling (customer reply → save ke DB)

### C. Self-Healing Worker (wa-worker.js) — UPGRADED
- Background worker berjalan setiap 15 detik
- **Dual function**: retry failed messages + proses broadcast
- **FOR UPDATE SKIP LOCKED** pada semua query ambil pesan — mencegah race condition jika ada multiple instance
- Intermediate status `RETRYING` dan `sending` untuk tracking pesan yang sedang diproses
- Retry FAILED messages (max 3 kali)
- Exponential backoff: retry 1 = +30s, retry 2 = +2.5m, retry 3 = +12.5m
- Retryable errors: rate limit (429), server error (5xx), timeout, network error
- Non-retryable: invalid number, template not found → permanent fail
- Auto-recovery saat server restart:
  - PENDING/RETRYING > 5 menit di-reset ke FAILED untuk diproses ulang
  - broadcast_recipients yang stuck di `sending` tanpa `sent_at` di-reset ke `pending`

### D. Broadcast System — UPGRADED (Backend-Driven)
- **SEBELUMNYA**: Frontend polling POST /broadcast/process → browser tab harus buka terus
- **SEKARANG**: Backend wa-worker.js otomatis proses broadcast. Frontend hanya polling GET /broadcast/status setiap 5 detik untuk update UI.
- Jika tab admin ditutup, **broadcast tetap berjalan** di backend
- Template-based broadcast (Cloud API compliant)
- Filter by source, merk, metode pembayaran
- One message at a time (anti-spam) dengan FOR UPDATE SKIP LOCKED
- Random delay 3-8 detik antar pesan
- Pause/Resume/Stop controls
- Real-time progress tracking (sent/failed/queued)
- Daily sent counter (persist di DB)
- All broadcast results logged to messages table

### E. Opt-out / Opt-in (BARU)
- Customer balas **"STOP"**, **"BERHENTI"**, **"UNSUBSCRIBE"**, atau **"KELUAR"** → `opted_in` diset `FALSE`
- Customer balas **"START"**, **"MULAI"**, **"SUBSCRIBE"**, atau **"DAFTAR"** → `opted_in` diset `TRUE`
- Ditangani di `webhookController.handleIncomingMessage()` sebelum proses lain
- Customer yang `opted_in = FALSE` tidak akan diikutsertakan dalam broadcast (filter di query startBroadcast)

### F. Birthday Greeting
- Cron job setiap hari jam 08:00 WITA (node-cron)
- Auto-send ke customer yang ulang tahun hari ini
- Template-based (Cloud API)
- 1 ucapan per customer per tahun (UNIQUE constraint)
- Manual send dari admin dashboard
- Custom message template (editable dari dashboard)
- Toggle auto-send on/off

### G. Admin Dashboard
- JWT-based authentication (24h expiry)
- Dashboard: total customers, pipeline stats, monthly trends
- Customer management: list, search, status update, notes
- Message log: all incoming/outgoing messages
- Analytics: top buyers, top products, top brands
- Export: CSV dan vCard (.vcf)
- Quick-sync: download contacts as VCF via secret key
- WA status monitor: API status, daily stats, queue status
- Failed message retry: single or bulk retry
- Data cleanup: auto-delete logs > 30 hari, export before delete
- **RATE LIMITED login**: max 10 percobaan per 15 menit

### H. Audit Trail (BARU)
- Tabel `admin_activity_logs` mencatat semua aksi admin yang sensitif
- Middleware `auditLog(action)` yang wrap `res.json()` — hanya log jika response sukses (status < 400)
- Data yang dicatat: admin_id, admin_username, action, detail, ip_address, timestamp
- Actions yang di-log: broadcast_start, broadcast_stop, broadcast_pause, broadcast_resume, update_customer_status, update_customer_catatan, update_wa_settings, cleanup_delete
- Endpoint: `GET /api/admin/audit-log?limit=50` untuk view log

### I. Google Contacts Integration
- OAuth 2.0 flow (consent screen → callback → token storage)
- Auto-save customer sebagai Google Contact saat form submit atau chat masuk
- Format nama: "NamaCustomer - DD/MM/YYYY" (Belanja) atau "Customer - DD/MM/YYYY" (Chat Only)
- Contact notes: tipe, merk, unit, metode bayar, source
- Duplicate detection by phone number
- Token auto-refresh

### J. Invoice/Nota Digital
- Generate nota dengan nomor: CP-YYYYMMDD-XXXX
- Public access via token URL (tanpa login)
- Create from existing purchase
- Items, subtotal, diskon, total, metode bayar, catatan

### K. Security
- JWT authentication for all admin routes
- Password hashing (bcryptjs, 10 rounds)
- CORS whitelist (ALLOWED_ORIGINS env)
- Sync contacts protected by SYNC_SECRET (header X-Sync-Key)
- **Rate limiting** (express-rate-limit):
  - form-submit: 10/15min per IP
  - login: 10/15min
  - forgot password: 5/jam
- Phone number validation (Indonesia format only: 62xxx, 11-15 digit)
- Password reset via email (nodemailer) with time-limited tokens (1 hour)
- Parameterized SQL queries (prevent SQL injection)
- **Audit trail** untuk aksi admin sensitif

---

## 6. ENVIRONMENT VARIABLES

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Server
PORT=5000
NODE_ENV=production

# CORS
ALLOWED_ORIGINS=https://your-frontend.vercel.app
FRONTEND_URL=https://your-frontend.vercel.app

# WhatsApp Cloud API (Meta Official)
WA_PHONE_NUMBER_ID=123456789
WA_ACCESS_TOKEN=EAAxxxxxxx (permanent token dari System User)
WA_BUSINESS_ACCOUNT_ID=123456789
WA_WEBHOOK_VERIFY_TOKEN=random-string
WA_TEMPLATE_AUTO_REPLY=terima_kasih_belanja
WA_TEMPLATE_BIRTHDAY=ucapan_ulang_tahun
WA_TEMPLATE_BROADCAST=promo_info

# Sync
SYNC_SECRET=random-secret-for-sync

# JWT
JWT_SECRET=your_jwt_secret

# Mail (untuk password reset)
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USER=email@gmail.com
MAIL_PASS=app_password
MAIL_FROM=noreply@cahaya-phone.com

# Google Contacts
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://your-backend.railway.app/api/google/callback
```

---

## 7. DATA FLOW

### Skenario A: Customer Beli HP → Form Submit
1. Customer isi form di /customer/index.html
2. POST /api/form-submit → **rate limit check** → validate phone → insert/update customers
3. Insert ke purchases table
4. Response langsung ke customer (cepat)
5. Background: kirim WA template auto-reply via Cloud API
6. Background: save ke Google Contacts

### Skenario B: Customer Chat Manual via WA
1. Customer kirim pesan ke nomor bisnis WA
2. Meta kirim webhook ke POST /api/webhook/cloud
3. Backend terima → **cek opt-out keyword (STOP/BERHENTI)** → jika ya, set opted_in=false
4. **Cek opt-in keyword (START/MULAI)** → jika ya, set opted_in=true
5. Cek customer ada/tidak
6. Kalau baru: insert sebagai "Customer - DD/MM/YYYY" (Chat Only)
7. Kalau sudah ada: update status, save pesan
8. Save ke Google Contacts (kalau baru)
9. TIDAK kirim auto-reply (biarkan admin reply manual)

### Skenario C: Admin Broadcast — BACKEND-DRIVEN
1. Admin pilih template + filter di dashboard
2. POST /api/admin/broadcast/start → insert broadcast_jobs + recipients → **audit logged**
3. **wa-worker.js otomatis** memproses broadcast setiap 15 detik:
   - Ambil 1 recipient pending (FOR UPDATE SKIP LOCKED → set status 'sending')
   - Delay 3-8 detik (anti-spam)
   - Kirim via Cloud API template
   - Update recipient status (sent/failed) + job counters
   - Cek apakah semua selesai → mark job 'completed'
4. Frontend polling GET /broadcast/status setiap 5 detik untuk update UI
5. **Jika tab browser ditutup, broadcast tetap berjalan di backend**
6. Admin bisa Pause/Resume/Stop kapan saja
7. Kalau gagal → masuk whatsapp_logs → worker retry otomatis (exponential backoff)

### Skenario D: Birthday Auto-Send
1. Cron job jam 08:00 WITA
2. Query customers yang tanggal_lahir match hari ini
3. Cek apakah sudah dikirim tahun ini (UNIQUE per customer per year)
4. Kirim template birthday via Cloud API
5. Log ke birthday_greetings table

### Skenario E: Server Restart / Crash Recovery
1. Server start → wa-worker.js starts
2. Worker cek whatsapp_logs: PENDING/RETRYING > 5 menit = stuck → reset ke FAILED
3. Worker cek broadcast_recipients: 'sending' tanpa sent_at = stuck → reset ke 'pending'
4. Worker retry loop picks them up → kirim ulang

---

## 8. RACE CONDITION PREVENTION

### wa-worker.js — FOR UPDATE SKIP LOCKED
```
Retry Failed Messages:
1. BEGIN transaction
2. SELECT ... FROM whatsapp_logs WHERE status='FAILED' ... FOR UPDATE SKIP LOCKED
3. UPDATE status → 'RETRYING' (intermediate state)
4. COMMIT
5. Process each message (API call)
6. Update to SENT or FAILED

Broadcast Processing:
1. BEGIN transaction
2. SELECT ... FROM broadcast_recipients WHERE status='pending' ... FOR UPDATE SKIP LOCKED
3. UPDATE status → 'sending' (intermediate state)
4. COMMIT
5. Send message via Cloud API
6. Update to 'sent' or 'failed'
```

Ini mencegah:
- Dua worker instance mengambil pesan yang sama
- Double-send saat Railway restart dengan overlap instance

---

## 9. AUDIT TRAIL SYSTEM

### Middleware: auditLog.js
```javascript
// Intercept res.json() — hanya log jika response sukses
function auditLog(action) {
    return (req, res, next) => {
        const originalJson = res.json.bind(res);
        res.json = function (body) {
            if (res.statusCode < 400) {
                // Log ke admin_activity_logs (async, non-blocking)
                db.query('INSERT INTO admin_activity_logs ...', [adminId, username, action, detail, ip]);
            }
            return originalJson(body);
        };
        next();
    };
}
```

### Detail yang dicatat per action:
- `broadcast_start`: template name, filter
- `update_customer_status`: customer id, new status
- `update_wa_settings`: new daily limit
- `cleanup_delete`: (no detail, action itself is meaningful)

---

## 10. RATE LIMITING

```javascript
// Form submit: 10 requests per 15 min per IP
const formLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 10,
    validate: { xForwardedForHeader: false }
});

// Login: 10 attempts per 15 min
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 10
});

// Forgot password: 5 per hour
const forgotLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: 5
});
```

**Note**: Rate limit store default = in-memory. Jika Railway restart, counter reset. Untuk production, bisa pakai rate-limit-redis.

---

## 11. CLEANUP STRATEGY

- `admin_reset_tokens`: hapus otomatis (used/expired) setiap request cleanup
- `messages` (chat log): hapus > 30 hari
- `broadcast_recipients`: hapus > 30 hari (job selesai)
- `broadcast_jobs`: hapus > 30 hari (job selesai)
- `whatsapp_logs`: hapus > 30 hari
- `wa_daily_stats`: hapus > 90 hari
- `admin_activity_logs`: **belum ada auto-cleanup** (bisa grow unbounded)
- **TIDAK PERNAH dihapus**: customers, purchases, invoices, google_tokens

---

## 12. DEPENDENCIES (package.json)

```json
{
  "axios": "^1.13.4",            // HTTP client (Cloud API calls)
  "bcryptjs": "^2.4.3",          // Password hashing
  "body-parser": "^2.2.2",       // Request parsing
  "cors": "^2.8.6",              // CORS middleware
  "dotenv": "^17.2.3",           // Environment variables
  "express": "^4.22.1",          // Web framework
  "express-rate-limit": "^7.x",  // Rate limiting for public endpoints
  "googleapis": "^171.4.0",      // Google Contacts API
  "jsonwebtoken": "^9.0.2",      // JWT auth
  "node-cron": "^4.2.1",         // Cron scheduler (birthday)
  "nodemailer": "^6.9.4",        // Email (password reset)
  "pg": "^8.12.0"                // PostgreSQL driver
}
```

---

## 13. KNOWN CONSIDERATIONS

- Database SSL: `rejectUnauthorized: false` (required for Supabase)
- Timezone: semua query pakai `Asia/Makassar` (WITA) untuk consistency
- Cloud API: template harus di-approve dulu di Meta Business Manager sebelum bisa dipakai
- Cloud API: daily limit tergantung tier Meta (start 250/hari, naik seiring waktu)
- Frontend: vanilla HTML/JS (bukan React/Vue), served as static files
- Session: stateless JWT (tidak ada server-side session)
- File upload: tidak ada fitur upload file/gambar
- Multi-admin: didukung tapi belum ada role-based access control (semua admin = superadmin)
- Rate limit store: in-memory (reset saat server restart)
- Customer ID: masih SERIAL integer (bukan UUID) — sequential, predictable
- admin.js frontend: 2572 baris — belum di-refactor ke modul terpisah
- `admin_activity_logs` belum ada auto-cleanup — bisa grow tanpa batas

---

## 14. RECENT CHANGES (Latest Commit)

### Security & Reliability Overhaul:
1. **Rate limiting** (express-rate-limit) pada endpoint publik: form-submit (10/15min), login (10/15min), forgot password (5/jam)
2. **Broadcast dipindah ke backend-driven** — wa-worker.js yang proses, bukan frontend polling. Tab browser boleh ditutup.
3. **FOR UPDATE SKIP LOCKED** pada retry worker & broadcast processing — cegah race condition multi-instance
4. **24h window check** pada `sendMessage()` — tolak text jika customer belum chat dalam 24 jam, paksa pakai template
5. **Opt-out/opt-in handling** — customer balas STOP/BERHENTI → opted_in=false, START/MULAI → opted_in=true
6. **Audit trail** — tabel admin_activity_logs + middleware logging aksi admin sensitif (broadcast, customer update, settings, cleanup)
7. **Recovery otomatis** — broadcast recipients stuck di 'sending' saat restart di-reset ke 'pending'

---

Tolong review keseluruhan arsitektur, security, database schema, API design, dan business logic di atas. Identifikasi:
1. Bug atau logic error yang mungkin ada
2. Security vulnerabilities (OWASP Top 10)
3. Database design issues (missing indexes, N+1 queries, race conditions)
4. Error handling yang kurang
5. Scalability concerns
6. Missing features yang penting untuk production
7. Code smell atau anti-patterns
8. Apakah Cloud API integration sudah benar (webhook, template, retry logic)
9. Apakah recent changes (rate limiting, backend broadcast, audit trail, opt-out, 24h check) sudah diimplementasi dengan benar
