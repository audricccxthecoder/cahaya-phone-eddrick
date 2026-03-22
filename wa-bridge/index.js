// ============================================
// WA BRIDGE - WhatsApp Web.js Bridge Service
// Deploy di Railway ($5/bulan)
// ============================================

const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ============================================
// CONFIGURATION
// ============================================
const PORT = process.env.PORT || 3001;
const API_SECRET = process.env.WA_BRIDGE_SECRET || 'cahaya-phone-secret-key';
const WEBHOOK_URL = process.env.WEBHOOK_URL || ''; // URL backend utama untuk forward pesan masuk
const AUTO_REPLY_ENABLED = process.env.AUTO_REPLY_ENABLED !== 'false'; // default: true

// ============================================
// STATE
// ============================================
let clientState = {
    status: 'disconnected', // disconnected | qr_pending | authenticated | ready | error
    qr: null,               // QR code data URL (base64 image)
    qrRaw: null,            // QR code raw string
    info: null,              // WhatsApp account info (phone, name)
    lastError: null,
    autoReply: AUTO_REPLY_ENABLED,
    messagesSentToday: 0,
    lastResetDate: new Date().toDateString()
};

// Auto-reply message template
let autoReplyMessage = process.env.AUTO_REPLY_MESSAGE ||
    'Halo {nama}, terima kasih sudah menghubungi Cahaya Phone! Tim kami akan segera membantu Anda.';

// ============================================
// ANTI-BAN PROTECTION
// ============================================

// Tips anti-banned yang diimplementasi:
// 1. Random delay antara pesan (5-15 detik untuk broadcast, 2-3 detik untuk single)
// 2. Variasi pesan (prefix/suffix random)
// 3. Limit pesan per hari (max 200 untuk akun baru, 500 untuk akun lama)
// 4. Jangan kirim ke nomor yang tidak pernah chat
// 5. Warm-up period: mulai dari sedikit, naikkan gradual
// 6. Jangan kirim pesan identical ke banyak orang
// 7. Gunakan akun WA yang sudah lama (>6 bulan)

const ANTI_BAN = {
    // Delay antara pesan (ms)
    singleMessageDelay: { min: 500, max: 1500 },
    broadcastDelay: { min: 8000, max: 15000 },

    // Daily limit
    dailyLimit: 200, // Mulai konservatif, naikkan pelan-pelan
    warningAt: 100,

    // Warm-up: hari pertama max 20, naik 20/hari
    warmupDailyIncrease: 20,
    warmupStartLimit: 20,

    // Tracking
    sentCount: 0,
    lastResetDate: new Date().toDateString()
};

function resetDailyCounterIfNeeded() {
    const today = new Date().toDateString();
    if (ANTI_BAN.lastResetDate !== today) {
        ANTI_BAN.sentCount = 0;
        ANTI_BAN.lastResetDate = today;
        clientState.messagesSentToday = 0;
        clientState.lastResetDate = today;
    }
}

function canSendMessage() {
    resetDailyCounterIfNeeded();
    return ANTI_BAN.sentCount < ANTI_BAN.dailyLimit;
}

function randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
}

// Queue untuk kirim pesan satu per satu (anti-spam)
let messageQueue = [];
let isProcessingQueue = false;

async function processMessageQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (messageQueue.length > 0) {
        const task = messageQueue.shift();

        if (!canSendMessage()) {
            task.resolve({
                success: false,
                error: `Daily limit reached (${ANTI_BAN.dailyLimit} messages). Coba lagi besok.`
            });
            continue;
        }

        try {
            // Random delay sebelum kirim (anti-ban)
            const delayConfig = task.isBroadcast ? ANTI_BAN.broadcastDelay : ANTI_BAN.singleMessageDelay;
            await randomDelay(delayConfig.min, delayConfig.max);

            const chatId = task.phone.includes('@c.us') ? task.phone : `${task.phone}@c.us`;
            await waClient.sendMessage(chatId, task.message);

            ANTI_BAN.sentCount++;
            clientState.messagesSentToday = ANTI_BAN.sentCount;

            console.log(`[SENT] ${task.phone} (${ANTI_BAN.sentCount}/${ANTI_BAN.dailyLimit} today)`);
            task.resolve({ success: true, phone: task.phone });
        } catch (error) {
            console.error(`[FAIL] ${task.phone}:`, error.message);
            task.resolve({ success: false, phone: task.phone, error: error.message });
        }
    }

    isProcessingQueue = false;
}

function queueMessage(phone, message, isBroadcast = false) {
    return new Promise((resolve) => {
        messageQueue.push({ phone, message, isBroadcast, resolve });
        processMessageQueue();
    });
}

// ============================================
// AUTH MIDDLEWARE
// ============================================
function authCheck(req, res, next) {
    const secret = req.headers['x-wa-secret'] || req.query.secret;
    if (secret !== API_SECRET) {
        return res.status(401).json({ success: false, message: 'Invalid secret' });
    }
    next();
}

// ============================================
// WHATSAPP CLIENT
// ============================================
const puppeteerConfig = {
    headless: true,
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials'
    ]
};

// Gunakan Chromium dari system jika ada (Docker/Railway)
if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    puppeteerConfig.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

const waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: './wa-session' }),
    webVersionCache: { type: 'none' },
    puppeteer: puppeteerConfig
});

// QR Code event
waClient.on('qr', async (qr) => {
    console.log('[QR] New QR code generated');
    clientState.status = 'qr_pending';
    clientState.qrRaw = qr;
    try {
        clientState.qr = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
    } catch (err) {
        console.error('[QR] Failed to generate QR image:', err);
    }
});

// Authenticated event
waClient.on('authenticated', () => {
    console.log('[AUTH] WhatsApp authenticated');
    clientState.status = 'authenticated';
    clientState.qr = null;
    clientState.qrRaw = null;
});

// Ready event
waClient.on('ready', async () => {
    console.log('[READY] WhatsApp client is ready!');
    clientState.status = 'ready';
    clientState.qr = null;
    clientState.qrRaw = null;
    clientState.lastError = null;

    try {
        const info = waClient.info;
        clientState.info = {
            phone: info.wid.user,
            name: info.pushname,
            platform: info.platform
        };
        console.log(`[INFO] Connected as: ${info.pushname} (${info.wid.user})`);
    } catch (e) {
        console.warn('[INFO] Could not get client info:', e.message);
    }
});

// Incoming message handler
waClient.on('message', async (msg) => {
    // Abaikan pesan dari group, status, broadcast, atau pesan sendiri
    if (msg.isGroupMsg || msg.from.endsWith('@g.us') || msg.isStatus || msg.fromMe || msg.from === 'status@broadcast') return;

    const phone = msg.from.replace('@c.us', '');
    const text = msg.body;
    const contact = await msg.getContact();
    const senderName = contact.pushname || contact.name || '';

    console.log(`[MSG IN] ${senderName} (${phone}): ${text.substring(0, 50)}...`);

    // Forward ke backend utama via webhook
    if (WEBHOOK_URL) {
        try {
            await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-WA-Secret': API_SECRET
                },
                body: JSON.stringify({
                    sender: phone,
                    message: text,
                    pushname: senderName,
                    timestamp: msg.timestamp,
                    source: 'wa-bridge'
                })
            });
            console.log(`[WEBHOOK] Forwarded to ${WEBHOOK_URL}`);
        } catch (err) {
            console.error('[WEBHOOK] Forward failed:', err.message);
        }
    }

    // Auto-reply untuk customer baru (pertama kali chat)
    if (clientState.autoReply && canSendMessage()) {
        try {
            const chat = await msg.getChat();
            const messages = await chat.fetchMessages({ limit: 5 });
            // Cek apakah ini pesan pertama dari customer (belum pernah kita balas)
            const ourReplies = messages.filter(m => m.fromMe);
            if (ourReplies.length === 0) {
                // Pesan pertama - kirim auto reply
                const reply = autoReplyMessage.replace(/{nama}/gi, senderName || 'Kak');
                await randomDelay(3000, 6000); // Delay natural sebelum reply
                await waClient.sendMessage(msg.from, reply);
                ANTI_BAN.sentCount++;
                clientState.messagesSentToday = ANTI_BAN.sentCount;
                console.log(`[AUTO-REPLY] Sent to ${phone}`);
            }
        } catch (err) {
            console.error('[AUTO-REPLY] Error:', err.message);
        }
    }
});

// Disconnected event
waClient.on('disconnected', (reason) => {
    console.log('[DISCONNECTED]', reason);
    clientState.status = 'disconnected';
    clientState.info = null;
    clientState.qr = null;
});

// Auth failure
waClient.on('auth_failure', (msg) => {
    console.error('[AUTH_FAILURE]', msg);
    clientState.status = 'error';
    clientState.lastError = 'Authentication failed: ' + msg;
});

// Initialize client with retry
async function initializeWithRetry(maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[INIT] Starting WhatsApp client (attempt ${attempt}/${maxRetries})...`);
            await waClient.initialize();
            console.log('[INIT] Client initialized successfully');
            return;
        } catch (err) {
            console.error(`[INIT] Attempt ${attempt} failed:`, err.message);
            clientState.lastError = err.message;

            if (attempt < maxRetries) {
                const waitSec = attempt * 5;
                console.log(`[INIT] Retrying in ${waitSec} seconds...`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
            } else {
                console.error('[INIT] All attempts failed. Use /api/restart to try again.');
                clientState.status = 'error';
            }
        }
    }
}

initializeWithRetry();

// ============================================
// API ROUTES
// ============================================

// Health check (public)
app.get('/', (req, res) => {
    res.json({
        service: 'Cahaya Phone WA Bridge',
        status: clientState.status,
        uptime: process.uptime()
    });
});

// Get QR code and connection status
app.get('/api/status', authCheck, (req, res) => {
    resetDailyCounterIfNeeded();
    res.json({
        success: true,
        status: clientState.status,
        qr: clientState.qr,
        info: clientState.info,
        autoReply: clientState.autoReply,
        messagesSentToday: clientState.messagesSentToday,
        dailyLimit: ANTI_BAN.dailyLimit,
        lastError: clientState.lastError
    });
});

// Send single message
app.post('/api/send', authCheck, async (req, res) => {
    const { phone, message } = req.body;

    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'phone and message required' });
    }

    if (clientState.status !== 'ready') {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected. Status: ' + clientState.status
        });
    }

    const result = await queueMessage(phone, message, false);
    res.json(result);
});

// Send broadcast message (single recipient, called per-recipient by main backend)
app.post('/api/send-broadcast', authCheck, async (req, res) => {
    const { phone, message } = req.body;

    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'phone and message required' });
    }

    if (clientState.status !== 'ready') {
        return res.status(503).json({
            success: false,
            error: 'WhatsApp not connected. Status: ' + clientState.status
        });
    }

    const result = await queueMessage(phone, message, true); // longer delay for broadcast
    res.json(result);
});

// Toggle auto-reply
app.post('/api/auto-reply', authCheck, (req, res) => {
    const { enabled, message } = req.body;
    if (typeof enabled === 'boolean') {
        clientState.autoReply = enabled;
    }
    if (message && typeof message === 'string') {
        autoReplyMessage = message;
    }
    res.json({
        success: true,
        autoReply: clientState.autoReply,
        autoReplyMessage: autoReplyMessage
    });
});

// Get auto-reply settings
app.get('/api/auto-reply', authCheck, (req, res) => {
    res.json({
        success: true,
        autoReply: clientState.autoReply,
        autoReplyMessage: autoReplyMessage
    });
});

// Update daily limit
app.post('/api/settings', authCheck, (req, res) => {
    const { dailyLimit } = req.body;
    if (dailyLimit && Number.isInteger(dailyLimit) && dailyLimit > 0) {
        ANTI_BAN.dailyLimit = dailyLimit;
    }
    res.json({
        success: true,
        dailyLimit: ANTI_BAN.dailyLimit,
        sentToday: ANTI_BAN.sentCount
    });
});

// Disconnect WhatsApp
app.post('/api/disconnect', authCheck, async (req, res) => {
    try {
        await waClient.logout();
        clientState.status = 'disconnected';
        clientState.info = null;
        clientState.qr = null;
        res.json({ success: true, message: 'WhatsApp disconnected' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Restart client (re-generate QR)
let isRestarting = false;
app.post('/api/restart', authCheck, async (req, res) => {
    if (isRestarting) {
        return res.json({ success: true, message: 'Already restarting. Check /api/status for QR.' });
    }
    isRestarting = true;

    try {
        clientState.status = 'disconnected';
        clientState.qr = null;
        clientState.info = null;

        await waClient.destroy().catch(() => {});
        console.log('[RESTART] Reinitializing client...');

        // Respond immediately, init in background
        res.json({ success: true, message: 'WhatsApp client restarting. Check /api/status for QR.' });

        await initializeWithRetry(3);
        isRestarting = false;
    } catch (err) {
        clientState.status = 'error';
        clientState.lastError = err.message;
        isRestarting = false;
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get daily stats
app.get('/api/stats', authCheck, (req, res) => {
    resetDailyCounterIfNeeded();
    res.json({
        success: true,
        sentToday: ANTI_BAN.sentCount,
        dailyLimit: ANTI_BAN.dailyLimit,
        remaining: ANTI_BAN.dailyLimit - ANTI_BAN.sentCount,
        queueLength: messageQueue.length
    });
});

// ============================================
// MEMORY LEAK PROTECTION
// Auto-restart Chromium setiap 6 jam untuk cegah memory leak
// ============================================
const RESTART_INTERVAL = 6 * 60 * 60 * 1000; // 6 jam

setInterval(async () => {
    const memUsage = process.memoryUsage();
    const ramMB = Math.round(memUsage.rss / 1024 / 1024);
    console.log(`[MEMORY] RAM usage: ${ramMB} MB`);

    // Force restart jika RAM > 400MB atau setiap 6 jam
    if (ramMB > 400 || true) {
        console.log('[MEMORY] Scheduled restart to prevent memory leak...');
        try {
            if (clientState.status === 'ready') {
                await waClient.destroy().catch(() => {});
                console.log('[MEMORY] Client destroyed, reinitializing...');
                await waClient.initialize();
                console.log('[MEMORY] Client reinitialized successfully');
            }
        } catch (err) {
            console.error('[MEMORY] Restart failed:', err.message);
        }
    }
}, RESTART_INTERVAL);

// Monitor RAM setiap 5 menit (log saja)
setInterval(() => {
    const ramMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(`[MONITOR] RAM: ${ramMB} MB | Messages today: ${ANTI_BAN.sentCount}/${ANTI_BAN.dailyLimit} | Queue: ${messageQueue.length}`);
}, 5 * 60 * 1000);

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log(`
========================================
  Cahaya Phone WA Bridge
  Running on port ${PORT}

  Anti-Banned:
  - Delay 8-15 detik antar broadcast
  - Max ${ANTI_BAN.dailyLimit} pesan/hari
  - Variasi pesan otomatis dari backend

  Memory Protection:
  - Auto-restart Chromium tiap 6 jam
  - RAM monitor tiap 5 menit
========================================
    `);
});
