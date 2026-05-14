// ============================================
// CAHAYA PHONE WA BRIDGE v2 (Baileys)
// Thin WhatsApp transport service.
// - QR auth + auto-reconnect
// - Send text messages (single, immediate)
// - Check number registered
// - Forward incoming messages to backend webhook
//
// Deployed to Railway. No Chromium needed.
// Anti-ban orchestration (warm-up, delays, working hours) lives
// in the BACKEND worker — this bridge just transports messages.
// ============================================

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const QRCode = require('qrcode');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const rawLogger = pino({ level: process.env.LOG_LEVEL || 'warn' });
const BAD_MAC_ALERT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const BAD_MAC_ALERT_THRESHOLD = 10;
let badMacErrorTimestamps = [];
let badMacRestartScheduled = false;

function registerBadMacError(message) {
    const text = String(message || '');
    if (!/Bad MAC|Failed to decrypt message/i.test(text)) return;

    const now = Date.now();
    badMacErrorTimestamps = badMacErrorTimestamps.filter(ts => now - ts < BAD_MAC_ALERT_WINDOW_MS);
    badMacErrorTimestamps.push(now);

    if (badMacErrorTimestamps.length >= BAD_MAC_ALERT_THRESHOLD && !badMacRestartScheduled) {
        badMacRestartScheduled = true;
        rawLogger.warn('[BAILEYS] High Bad MAC rate detected — restarting socket to recover session.');
        if (sock) {
            try { sock.end(new Error('bad mac recovery')); } catch (err) {
                rawLogger.warn('[BAILEYS] Failed to end socket during bad mac recovery:', err.message);
            }
        }
    }
}

const logger = rawLogger;
logger.warn = function (...args) {
    registerBadMacError(args[0]);
    return rawLogger.warn.apply(rawLogger, args);
};
logger.error = function (...args) {
    registerBadMacError(args[0]);
    return rawLogger.error.apply(rawLogger, args);
};
logger.fatal = function (...args) {
    registerBadMacError(args[0]);
    return rawLogger.fatal.apply(rawLogger, args);
};

// ============================================
// CONFIG
// ============================================
const PORT = process.env.PORT || 3001;
const API_SECRET = process.env.WA_BRIDGE_SECRET || 'cahaya-phone-secret-key';
const WEBHOOK_URL = process.env.WEBHOOK_URL || ''; // backend webhook for incoming messages
const SESSION_DIR = process.env.SESSION_DIR || './wa-session';
const RECONNECT_MIN_DELAY = 5_000;
const RECONNECT_MAX_DELAY = 60_000;

// ============================================
// STATE
// ============================================
let sock = null;
let clientState = {
    status: 'disconnected', // disconnected | connecting | qr_pending | open | logged_out | error
    qr: null,               // data URL
    qrRaw: null,            // raw QR string
    info: null,             // { phone, name, platform }
    lastError: null,
    connectedAt: null,
    disconnectedAt: null
};
let reconnectAttempts = 0;
let reconnectTimer = null;
let isShuttingDown = false;

// ============================================
// HTTP APP
// ============================================
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

function authCheck(req, res, next) {
    const secret = req.headers['x-wa-secret'] || req.query.secret;
    if (secret !== API_SECRET) {
        return res.status(401).json({ success: false, error: 'Invalid secret' });
    }
    next();
}

// ============================================
// HELPERS
// ============================================
function toJid(phone) {
    // phone should be Indonesian format '62xxx'
    const clean = String(phone || '').replace(/\D/g, '');
    if (!clean) return null;
    return `${clean}@s.whatsapp.net`;
}

function isReady() {
    return sock && clientState.status === 'open';
}

// ============================================
// FORWARD QUEUE — survive backend downtime without losing customer messages
//
// If the backend webhook is unreachable when a message arrives, naive forwarding
// would just log a warning and lose the message — the customer's chat still
// exists on their phone and our shop's WA, but our database never learns about
// it (no new "Customer - dd/mm/yyyy" row, no opt-out detection, no auto-reply
// trigger, no analytics).
//
// To prevent that, failed forwards are queued in memory AND persisted to disk
// in SESSION_DIR (same Railway volume as Baileys auth — survives container
// restart). A retry loop drains the queue when the backend recovers.
// ============================================
const fs = require('fs');
const path = require('path');
const PENDING_FORWARDS_FILE = path.join(SESSION_DIR, 'pending-forwards.json');
const FORWARD_RETRY_INTERVAL_MS = 30_000;        // every 30s while items pending
const FORWARD_RETRY_BATCH = 5;                   // up to 5 retries per cycle
const FORWARD_MAX_ATTEMPTS = 200;                // ~200 × 30s ≈ 100 minutes ceiling
const FORWARD_QUEUE_MAX_SIZE = 1000;             // hard cap so backend outage doesn't OOM us

let pendingForwards = [];
let forwardRetryTimer = null;
let forwardSaveTimer = null;

function loadPendingForwards() {
    try {
        if (fs.existsSync(PENDING_FORWARDS_FILE)) {
            const raw = fs.readFileSync(PENDING_FORWARDS_FILE, 'utf8');
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
                pendingForwards = arr;
                console.log(`[FORWARD] Loaded ${pendingForwards.length} pending forward(s) from disk`);
                if (pendingForwards.length > 0) ensureRetryTimer();
            }
        }
    } catch (err) {
        console.warn('[FORWARD] Could not load pending forwards:', err.message);
    }
}

function savePendingForwards() {
    // Debounce: write at most once per second to avoid disk thrashing during bursts.
    if (forwardSaveTimer) return;
    forwardSaveTimer = setTimeout(() => {
        forwardSaveTimer = null;
        try {
            fs.mkdirSync(SESSION_DIR, { recursive: true });
            fs.writeFileSync(PENDING_FORWARDS_FILE, JSON.stringify(pendingForwards));
        } catch (err) {
            console.warn('[FORWARD] Could not persist pending forwards:', err.message);
        }
    }, 1000);
}

function ensureRetryTimer() {
    if (forwardRetryTimer) return;
    forwardRetryTimer = setInterval(retryPendingForwards, FORWARD_RETRY_INTERVAL_MS);
}

function stopRetryTimer() {
    if (forwardRetryTimer) {
        clearInterval(forwardRetryTimer);
        forwardRetryTimer = null;
    }
}

async function attemptForward(payload) {
    const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WA-Secret': API_SECRET },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
}

async function retryPendingForwards() {
    if (pendingForwards.length === 0) {
        stopRetryTimer();
        return;
    }
    const batch = pendingForwards.splice(0, FORWARD_RETRY_BATCH);
    const failedAgain = [];
    let successCount = 0;

    for (const entry of batch) {
        entry.attempts = (entry.attempts || 0) + 1;
        try {
            await attemptForward(entry.payload);
            successCount++;
        } catch (err) {
            if (entry.attempts < FORWARD_MAX_ATTEMPTS) {
                failedAgain.push(entry);
            } else {
                console.error(`[FORWARD] Dropping message from ${entry.payload.sender} after ${entry.attempts} attempts`);
            }
        }
    }
    // Failed-again items go to the BACK of the queue so a stubborn item doesn't block fresher ones
    pendingForwards.push(...failedAgain);
    savePendingForwards();

    if (successCount > 0) {
        console.log(`[FORWARD] Retry batch: ${successCount} delivered, ${failedAgain.length} still pending (queue size: ${pendingForwards.length})`);
    }
    if (pendingForwards.length === 0) stopRetryTimer();
}

// Wipe Baileys session with retry. EBUSY happens when sock.end() returned but
// Baileys' async file handles in useMultiFileAuthState haven't fully released yet.
// fs.promises.rm with maxRetries handles that automatically (Node 14.14+).
async function wipeSession() {
    const fsp = require('fs').promises;
    // First, give pending async writes a chance to flush
    await new Promise(r => setTimeout(r, 500));
    try {
        await fsp.rm(SESSION_DIR, {
            recursive: true,
            force: true,
            maxRetries: 10,      // retry up to 10 times
            retryDelay: 300      // 300ms between retries (~3s max wait)
        });
    } catch (err) {
        // Fallback: delete file-by-file. Survives EBUSY on individual files.
        console.warn('[SESSION] Bulk rm failed (', err.message, ') — falling back to per-file delete');
        try {
            const entries = await fsp.readdir(SESSION_DIR);
            for (const entry of entries) {
                try { await fsp.unlink(require('path').join(SESSION_DIR, entry)); }
                catch (e) { console.warn(`[SESSION] Could not unlink ${entry}: ${e.message}`); }
            }
        } catch (readErr) {
            console.warn('[SESSION] readdir failed:', readErr.message);
        }
    }
    // Recreate empty dir
    try { await fsp.mkdir(SESSION_DIR, { recursive: true }); }
    catch (_) { /* already exists */ }
}

async function forwardIncoming(payload) {
    if (!WEBHOOK_URL) return;

    // Drain immediately if backend is healthy
    try {
        await attemptForward(payload);
        return;
    } catch (err) {
        // Failed — enqueue for retry
        if (pendingForwards.length >= FORWARD_QUEUE_MAX_SIZE) {
            console.error(`[FORWARD] Queue full (${FORWARD_QUEUE_MAX_SIZE}); dropping oldest entry`);
            pendingForwards.shift();
        }
        pendingForwards.push({ payload, queuedAt: Date.now(), attempts: 0 });
        savePendingForwards();
        ensureRetryTimer();
        console.warn(`[WEBHOOK] Forward failed (${err.message}), queued. Pending: ${pendingForwards.length}`);
    }
}

// Restore queued forwards on startup (in case container restarted while items were pending)
loadPendingForwards();

// ============================================
// BAILEYS SOCKET LIFECYCLE
// ============================================
async function startSocket() {
    if (isShuttingDown) return;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    try {
        clientState.status = 'connecting';
        clientState.lastError = null;

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`[BAILEYS] Using version ${version.join('.')} (latest: ${isLatest})`);

        sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger)
            },
            logger,
            printQRInTerminal: false,
            browser: Browsers.macOS('Safari'),
            // Memory-leak prevention — Baileys defaults aggressively cache history/state.
            // We don't need any of that because the backend persists everything to DB.
            syncFullHistory: false,                 // don't replay full chat history on connect
            markOnlineOnConnect: false,             // skip phantom presence update
            generateHighQualityLinkPreview: false,  // no link preview = no thumbnail download
            getMessage: async () => undefined,      // don't cache messages for retry
            // Tunable timeouts to prevent stuck WebSockets from inflating heap.
            keepAliveIntervalMs: 30_000,
            connectTimeoutMs: 60_000,
            defaultQueryTimeoutMs: 60_000,
            // Cap the in-memory message buffer Baileys keeps per chat.
            // Default is 100 messages × 1000 chats = potentially huge.
            shouldSyncHistoryMessage: () => false,
            shouldIgnoreJid: jid => /@(broadcast|status)/.test(jid || '')  // skip status broadcasts
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                clientState.status = 'qr_pending';
                clientState.qrRaw = qr;
                try {
                    clientState.qr = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
                    console.log('[QR] New QR code generated — scan via admin dashboard');
                } catch (err) {
                    console.error('[QR] Failed to generate QR image:', err.message);
                }
            }

            if (connection === 'open') {
                clientState.status = 'open';
                clientState.qr = null;
                clientState.qrRaw = null;
                clientState.lastError = null;
                clientState.connectedAt = new Date().toISOString();
                reconnectAttempts = 0;

                try {
                    const user = sock.user || {};
                    const phoneId = (user.id || '').split(':')[0].split('@')[0];
                    clientState.info = {
                        phone: phoneId,
                        name: user.name || user.notify || '',
                        platform: 'baileys'
                    };
                    console.log(`[READY] Connected as ${clientState.info.name || '?'} (${clientState.info.phone})`);
                } catch (e) {
                    console.warn('[READY] Could not read user info:', e.message);
                }
            }

            if (connection === 'close') {
                const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
                const reason = DisconnectReason[statusCode] || 'unknown';
                const errorMsg = lastDisconnect?.error?.message || String(lastDisconnect?.error || 'unknown');

                console.log(`[CLOSE] Connection closed — code=${statusCode} reason=${reason} err="${errorMsg}"`);
                clientState.info = null;
                clientState.disconnectedAt = new Date().toISOString();

                if (statusCode === DisconnectReason.loggedOut) {
                    // Session invalidated — user logged out from phone. Must scan QR again.
                    clientState.status = 'logged_out';
                    clientState.lastError = 'Logged out. Scan QR code again to reconnect.';
                    await wipeSession().catch(err =>
                        console.warn('[SESSION] Wipe failed:', err.message));
                    console.log('[SESSION] Wiped — ready for re-scan');
                    scheduleReconnect(0); // immediate re-init to emit new QR
                    return;
                }

                // Transient disconnect — reconnect with exponential backoff
                clientState.status = 'disconnected';
                clientState.lastError = `${reason}: ${errorMsg}`;
                reconnectAttempts += 1;
                scheduleReconnect();
            }
        });

        // Incoming messages
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                try {
                    // Skip own messages, status broadcasts, and protocol messages
                    if (msg.key.fromMe) continue;
                    if (msg.key.remoteJid === 'status@broadcast') continue;
                    if (msg.key.remoteJid?.endsWith('@g.us')) continue; // skip group messages

                    const text =
                        msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption ||
                        '';

                    if (!text) continue;

                    // Resolve sender JID — handle WA's new LID format.
                    // When sender isn't in our phonebook, remoteJid is `xxx@lid` (LID, not phone).
                    // Real phone lives in key.senderPn (sender phone number) on Baileys 6.7+.
                    const remoteJid = msg.key.remoteJid || '';
                    const pushname = msg.pushName || '';
                    let phoneJid;
                    if (remoteJid.endsWith('@lid')) {
                        const realPhone = msg.key.senderPn || msg.key.remoteJidAlt;
                        if (!realPhone) {
                            console.log(`[MSG IN] LID-only sender ${pushname} (${remoteJid}) — no real phone available, skipped`);
                            continue;
                        }
                        phoneJid = realPhone;
                    } else {
                        phoneJid = remoteJid;
                    }
                    const phone = phoneJid.replace('@s.whatsapp.net', '').replace('@lid', '').split(':')[0];
                    const waMessageId = msg.key.id;
                    const timestamp = Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000);

                    console.log(`[MSG IN] ${pushname} (${phone}${remoteJid.endsWith('@lid') ? ' via LID' : ''}): ${text.substring(0, 60)}`);

                    await forwardIncoming({
                        sender: phone,
                        message: text,
                        pushname,
                        timestamp,
                        wa_message_id: waMessageId,
                        source: 'wa-bridge'
                    });
                } catch (err) {
                    console.error('[MSG IN] Processing error:', err.message);
                }
            }
        });

    } catch (err) {
        clientState.status = 'error';
        clientState.lastError = err.message;
        console.error('[INIT] Failed to start socket:', err.message);
        reconnectAttempts += 1;
        scheduleReconnect();
    }
}

function scheduleReconnect(overrideMs = null) {
    if (isShuttingDown) return;
    if (reconnectTimer) return;

    let delay;
    if (overrideMs !== null) {
        delay = overrideMs;
    } else {
        // Exponential backoff with cap + jitter
        const base = Math.min(RECONNECT_MIN_DELAY * Math.pow(2, reconnectAttempts - 1), RECONNECT_MAX_DELAY);
        const jitter = Math.floor(Math.random() * 2000);
        delay = base + jitter;
    }

    console.log(`[RECONNECT] Retrying in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        startSocket().catch(err => {
            console.error('[RECONNECT] startSocket threw:', err.message);
            reconnectAttempts += 1;
            scheduleReconnect();
        });
    }, delay);
}

// ============================================
// API ROUTES
// ============================================

// Public health check (no auth)
app.get('/', (req, res) => {
    res.json({
        service: 'Cahaya Phone WA Bridge v2 (Baileys)',
        status: clientState.status,
        uptime_seconds: Math.round(process.uptime())
    });
});

// Status + QR (requires auth)
app.get('/api/status', authCheck, (req, res) => {
    res.json({
        success: true,
        status: clientState.status,
        qr: clientState.qr,
        info: clientState.info,
        lastError: clientState.lastError,
        connectedAt: clientState.connectedAt,
        disconnectedAt: clientState.disconnectedAt,
        pendingForwards: pendingForwards.length,
        oldestPendingForwardAgeSec: pendingForwards.length > 0
            ? Math.round((Date.now() - pendingForwards[0].queuedAt) / 1000)
            : 0
    });
});

// Send single text message (immediate — backend orchestrator handles delay & anti-ban)
app.post('/api/send', authCheck, async (req, res) => {
    const { phone, message, typing } = req.body;

    if (!phone || !message) {
        return res.status(400).json({ success: false, error: 'phone and message required' });
    }
    if (!isReady()) {
        return res.status(503).json({ success: false, error: `WhatsApp not connected (status: ${clientState.status})` });
    }

    const jid = toJid(phone);
    if (!jid) return res.status(400).json({ success: false, error: 'Invalid phone number' });

    try {
        // Optional: typing indicator for humanlike behavior. Backend controls whether to enable.
        if (typing) {
            try {
                await sock.presenceSubscribe(jid);
                await sock.sendPresenceUpdate('composing', jid);
                // Typing duration: 1.5-3.5 seconds (matches realistic human typing)
                await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
                await sock.sendPresenceUpdate('paused', jid);
            } catch (e) {
                // non-fatal
            }
        }

        const result = await sock.sendMessage(jid, { text: message });
        const waMessageId = result?.key?.id || null;

        console.log(`[SENT] ${phone} (wa_id: ${waMessageId})`);
        return res.json({ success: true, phone, wa_message_id: waMessageId });
    } catch (err) {
        console.error(`[SEND FAIL] ${phone}:`, err.message);
        return res.status(500).json({ success: false, phone, error: err.message });
    }
});

// Check if number is registered on WhatsApp
app.post('/api/check-number', authCheck, async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'phone required' });
    if (!isReady()) return res.status(503).json({ success: false, error: `Not connected (status: ${clientState.status})` });

    try {
        const clean = String(phone).replace(/\D/g, '');
        const [result] = await sock.onWhatsApp(clean);
        if (result && result.exists) {
            return res.json({ success: true, registered: true, jid: result.jid });
        }
        return res.json({ success: true, registered: false });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Force logout + wipe session (requires fresh QR scan)
app.post('/api/disconnect', authCheck, async (req, res) => {
    try {
        if (sock) {
            try { await sock.logout(); } catch (_) { /* ignore */ }
            try { sock.end(new Error('manual disconnect')); } catch (_) { /* ignore */ }
            sock = null;
        }
        // wipeSession() handles EBUSY race: waits 500ms for Baileys async writes
        // to flush, then rm with maxRetries=10. Used to fail with
        // "EBUSY: resource busy or locked, rmdir './wa-session'" on Windows /
        // any host where file handles linger.
        await wipeSession();

        clientState.status = 'logged_out';
        clientState.info = null;
        clientState.qr = null;

        res.json({ success: true, message: 'Disconnected & session wiped. Restart to get new QR.' });

        // Auto-start for new QR after short delay
        setTimeout(() => startSocket().catch(() => {}), 1500);
    } catch (err) {
        console.error('[DISCONNECT] Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Restart socket (soft) — useful to re-establish connection
app.post('/api/restart', authCheck, async (req, res) => {
    try {
        res.json({ success: true, message: 'Restarting socket...' });

        if (sock) {
            try { sock.end(new Error('manual restart')); } catch (_) { /* ignore */ }
            sock = null;
        }
        reconnectAttempts = 0;
        setTimeout(() => startSocket().catch(err => console.error('[RESTART] Failed:', err.message)), 500);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================
// STARTUP
// ============================================
app.listen(PORT, () => {
    console.log(`
========================================
  Cahaya Phone WA Bridge v2 (Baileys)
  Port: ${PORT}
  Webhook: ${WEBHOOK_URL || '(not configured)'}
  Session: ${SESSION_DIR}
========================================
    `);
    startSocket().catch(err => {
        console.error('[STARTUP] Initial start failed:', err.message);
        reconnectAttempts = 1;
        scheduleReconnect();
    });
});

// Graceful shutdown
async function shutdown(signal) {
    console.log(`[SHUTDOWN] Received ${signal} — closing...`);
    isShuttingDown = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (sock) {
        try { sock.end(new Error('shutdown')); } catch (_) { /* ignore */ }
    }
    setTimeout(() => process.exit(0), 1500);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ============================================
// DAILY RESTART — keep Node heap fresh
// ============================================
// Even with all the anti-bloat Baileys options, V8's garbage collector can
// accumulate fragmented memory over days/weeks of operation, slowly inflating
// RAM. Railway charges by RAM-hour, and an OOM kill would still cost a
// reconnection. Cheaper to schedule a self-shutdown daily at 03:00 WITA
// (shop is closed) — Railway will start a fresh process automatically, with
// reset heap and a fresh Baileys WebSocket. Total downtime ~30-60s.
//
// Can be disabled by setting DISABLE_DAILY_RESTART=true (e.g., during testing).
function scheduleDailyRestart() {
    if (process.env.DISABLE_DAILY_RESTART === 'true') {
        console.log('[BAILEYS] Daily restart disabled via env');
        return;
    }
    const now = Date.now();
    const wita = new Date(now + 8 * 60 * 60 * 1000);   // UTC+8
    const nextWita = new Date(wita);
    nextWita.setUTCHours(3, 0, 0, 0);                   // 03:00 WITA target
    if (nextWita <= wita) nextWita.setUTCDate(nextWita.getUTCDate() + 1);
    const msUntil = nextWita.getTime() - wita.getTime();
    const hours = Math.round(msUntil / (60 * 60 * 1000));

    console.log(`[BAILEYS] Daily restart scheduled in ~${hours}h (target: 03:00 WITA)`);
    setTimeout(() => {
        console.log('[BAILEYS] Daily 03:00 WITA restart — exiting so Railway respawns with fresh heap');
        shutdown('DAILY_RESTART');
    }, msUntil);
}
scheduleDailyRestart();

// Prevent silent crashes
process.on('uncaughtException', (err) => {
    console.error('[CRASH PREVENTED] Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('[CRASH PREVENTED] Unhandled Rejection:', reason);
});
