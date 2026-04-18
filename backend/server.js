const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

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

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — izinkan frontend Vercel mengakses backend Railway
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
    : [];

app.use(cors({
    origin: function(origin, callback) {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        // Allow configured origins only (ALLOWED_ORIGINS di .env)
        if (allowedOrigins.length === 0) {
            // Dev mode: belum dikonfigurasi, allow all
            return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
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

// API Routes
app.use('/api', require('./routes/api'));

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
  Cahaya Phone Backend (WA Cloud API)
  Running on port ${PORT}
  Mode: PERSISTENT (Railway/Local)
========================================
        `);

        // Initialize WhatsApp Cloud API Service
        try {
            const whatsappService = require('./config/whatsapp');
            await whatsappService.loadSettings();

            const status = await whatsappService.getStatus();
            if (status.status === 'connected') {
                console.log('[WA] Cloud API configured and ready');
            } else {
                console.warn('[WA] Cloud API not configured — set WA_PHONE_NUMBER_ID & WA_ACCESS_TOKEN in .env');
            }

            // Start background worker (retry & auto-recovery)
            const waWorker = require('./config/wa-worker');
            await waWorker.start();
        } catch (err) {
            console.error('[WA] Failed to initialize WhatsApp service:', err.message);
        }

        // Birthday greeting cron — setiap hari jam 8 pagi WITA
        const birthdayController = require('./controllers/birthdayController');
        cron.schedule('0 8 * * *', () => {
            console.log('[Cron] Running birthday check...');
            birthdayController.cronCheckBirthdays();
        }, { timezone: 'Asia/Makassar' });
        console.log('[Cron] Birthday greeting scheduled: every day at 08:00 WITA');
    });
}
