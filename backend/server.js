const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config();

// Force IPv4-first DNS resolution globally. Railway's outbound network doesn't
// route IPv6 — without this, Node's DNS happily returns AAAA records first and
// every outbound TCP connect (SMTP, external APIs, etc.) fails with ENETUNREACH.
// This is the single most-tested fix for "ENETUNREACH 2607:f8b0:...:587" on
// Railway / Heroku / Fly / similar PaaS.
require('dns').setDefaultResultOrder('ipv4first');

const { csrfProtection } = require('./config/csrfMiddleware');

// ============================================
// BOOT-TIME SECRET VALIDATION (fix #5)
// Fail fast if critical secrets are missing or obviously weak.
// ============================================
(function validateSecrets() {
    const jwtSecret = process.env.JWT_SECRET || '';
    if (!jwtSecret || jwtSecret.length < 32) {
        console.error('[BOOT] JWT_SECRET missing or too short (<32 chars). Refusing to start.');
        process.exit(1);
    }
    if (jwtSecret === 'your_super_secret_jwt_key_here_change_in_production') {
        console.error('[BOOT] JWT_SECRET is still the example value. Refusing to start.');
        process.exit(1);
    }
    if (process.env.NODE_ENV === 'production') {
        if (!process.env.WA_BRIDGE_SECRET) {
            console.error('[BOOT] WA_BRIDGE_SECRET required in production. Refusing to start.');
            process.exit(1);
        }
        if (!process.env.ALLOWED_ORIGINS) {
            console.error('[BOOT] ALLOWED_ORIGINS required in production (don\'t leave CORS open). Refusing to start.');
            process.exit(1);
        }
    }
})();

// ============================================
// GLOBAL ERROR HANDLERS — prevent server crash
// ============================================
process.on('uncaughtException', (err) => {
    console.error('[CRASH PREVENTED] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('[CRASH PREVENTED] Unhandled Rejection:', reason);
});

const app = express();

// Trust the first proxy hop (Railway / Vercel / similar PaaS).
// Required so express-rate-limit reads client IP from X-Forwarded-For
// instead of the proxy's IP, and to silence ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// ============================================
// MIDDLEWARE
// ============================================

// Helmet — sets security headers (X-Frame-Options, X-Content-Type-Options, HSTS, etc.)
// CSP is configured manually because admin uses inline event handlers (onclick=...) and
// inline <style> blocks; locking those down would require a much bigger refactor.
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            'default-src': ["'self'"],
            // Helmet's CSP defaults set script-src-attr to 'none' which blocks ALL
            // inline event handlers (onclick="...", onchange="...", etc). The admin
            // dashboard uses inline handlers heavily, so we explicitly allow them.
            // This is a tradeoff: refactoring every onclick to addEventListener would
            // give us a stricter CSP, but the XSS attack surface is already closed
            // server-side (esc() on every untrusted field).
            'script-src': ["'self'", "'unsafe-inline'"],
            'script-src-attr': ["'unsafe-inline'"],
            'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            'style-src-attr': ["'unsafe-inline'"],
            'font-src': ["'self'", 'https://fonts.gstatic.com'],
            'img-src': ["'self'", 'data:', 'https:'],
            'connect-src': ["'self'", 'https:'],
            'frame-ancestors': ["'none'"],
            'object-src': ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false, // would block fonts.googleapis.com
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Cap request body at 50kb — legitimate form/webhook payloads are well under 5kb.
// Without this cap a bot can POST 100kb bodies repeatedly to fill the DB / OOM the process.
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: true, limit: '50kb' }));

// Cookie parsing — required for httpOnly auth_token and csrf_token reads.
app.use(cookieParser());

// CORS — izinkan frontend Vercel mengakses backend Railway
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : [];

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        // In production, ALLOWED_ORIGINS must be set (validated at boot) and is the only allowlist.
        if (process.env.NODE_ENV === 'production') {
            if (allowedOrigins.includes(origin)) return callback(null, true);
            return callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
        // Dev mode: if ALLOWED_ORIGINS not set, allow all for convenience
        if (allowedOrigins.length === 0) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Sync-Key', 'X-WA-Secret']
}));

// ============================================
// SERVE STATIC FRONTEND
// Selalu serve frontend files (Vercel, Railway, maupun local dev)
// Nanti kalau frontend pindah ke Vercel terpisah, backend Railway
// tidak perlu serve static lagi — tapi untuk sekarang tetap serve
// ============================================
app.use('/config.js', express.static(path.join(__dirname, '../config.js')));
app.use('/customer', express.static(path.join(__dirname, '../customer')));
app.use('/admin', express.static(path.join(__dirname, '../admin')));

app.get('/', (req, res) => {
    res.redirect('/customer');
});

// Health check
app.get('/api/health', async (req, res) => {
    const db = require('./config/database');
    try {
        const result = await db.query('SELECT NOW() as time');
        const whatsappService = require('./config/whatsapp');
        const waStatus = await whatsappService.getStatus();
        res.json({
            status: 'OK',
            db: 'connected',
            time: result.rows[0].time,
            wa: waStatus.status || 'not initialized',
            mode: process.env.VERCEL ? 'serverless' : 'persistent'
        });
    } catch (err) {
        res.status(500).json({ status: 'ERROR', db: 'failed', error: err.message });
    }
});

// API Routes — CSRF guard runs before routes so any write hits the check.
// Exempt endpoints (login, webhook, public form, sync-by-secret) are handled
// inside csrfProtection().
app.use('/api', csrfProtection, require('./routes/api'));

// Error handling
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Something went wrong!', details: err.message });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// ============================================
// START SERVER
// ============================================

// Vercel = serverless, export app saja
if (process.env.VERCEL) {
    module.exports = app;
} else {
    // Railway / local dev = persistent server + WA Client
    const cron = require('node-cron');
    const PORT = process.env.PORT || 5000;

    app.listen(PORT, async () => {
        console.log(`
========================================
  Cahaya Phone Backend (Baileys via wa-bridge)
  Running on port ${PORT}
  Mode: PERSISTENT (Railway/Local)
  Bridge: ${process.env.WA_BRIDGE_URL || 'http://localhost:3001'}
========================================
        `);

        // Initialize WA service (HTTP adapter to wa-bridge)
        try {
            const whatsappService = require('./config/whatsapp');
            await whatsappService.loadSettings();

            const status = await whatsappService.getStatus();
            if (status.status === 'connected') {
                console.log('[WA] Bridge connected and ready (Baileys)');
            } else if (status.status === 'bridge_unreachable') {
                console.warn('[WA] Bridge unreachable — set WA_BRIDGE_URL di .env dan pastikan wa-bridge running');
            } else {
                console.warn(`[WA] Bridge status: ${status.status} — scan QR di admin dashboard → WA Connect`);
            }

            // Start anti-ban orchestrator
            const waWorker = require('./config/wa-worker');
            await waWorker.start();
        } catch (err) {
            console.error('[WA] Failed to initialize WhatsApp service:', err.message);
        }

        // Birthday greeting cron — setiap hari jam 9 pagi WITA (1 jam margin after 08:00 working hours open)
        const birthdayController = require('./controllers/birthdayController');
        cron.schedule('0 9 * * *', () => {
            console.log('[Cron] Running birthday check (scheduled)...');
            birthdayController.cronCheckBirthdays();
        }, { timezone: 'Asia/Makassar' });
        console.log('[Cron] Birthday greeting scheduled: every day at 09:00 WITA');

        // Boot-time recovery: if Railway restarted mid-batch today, finish whatever
        // birthdays haven't been greeted yet. cronCheckBirthdays already filters to
        // "pending or failed for THIS year" so re-running is idempotent and won't
        // duplicate-send.
        setTimeout(() => {
            birthdayController.cronCheckBirthdays().catch(err =>
                console.warn('[Boot] Birthday recovery error:', err.message)
            );
        }, 60_000);   // wait 1 min after boot so wa-bridge has time to connect

        // Safety net: re-check birthdays every 2 hours during working hours, in case
        // some sends failed (number not registered, bridge hiccup) and need a retry.
        cron.schedule('0 11,13,15,17,19 * * *', () => {
            console.log('[Cron] Running birthday safety-net retry...');
            birthdayController.cronCheckBirthdays();
        }, { timezone: 'Asia/Makassar' });

        // Railway billing reminder — daily 09:00 WITA check, fires WA reminder to
        // owner on H-3 and H of BILLING_DAY (default tgl 11). Single cron handles
        // both events; the controller decides which template to send based on
        // today's date. No-op on all other days.
        const billingReminderController = require('./controllers/billingReminderController');
        cron.schedule('0 9 * * *', () => {
            billingReminderController.cronDailyCheck()
                .catch(err => console.warn('[BillingReminder] Cron error:', err.message));
        }, { timezone: 'Asia/Makassar' });
        console.log(`[Cron] Billing reminder scheduled: daily 09:00 WITA (H-3 + H of BILLING_DAY=${process.env.BILLING_DAY || 11})`);
    });
}
