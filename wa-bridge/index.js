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

const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

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

async function forwardIncoming(payload) {
    if (!WEBHOOK_URL) return;
    try {
        const res = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-WA-Secret': API_SECRET },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            console.warn(`[WEBHOOK] Non-2xx response: ${res.status}`);
        }
    } catch (err) {
        console.warn('[WEBHOOK] Forward failed:', err.message);
    }
}

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
            syncFullHistory: false,
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            // Don't cache message retries — keeps memory low
            getMessage: async () => undefined
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
                    // Wipe session so next start yields fresh QR
                    try {
                        const fs = require('fs');
                        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                        fs.mkdirSync(SESSION_DIR, { recursive: true });
                        console.log('[SESSION] Wiped — ready for re-scan');
                    } catch (err) {
                        console.warn('[SESSION] Wipe failed:', err.message);
                    }
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

                    const phone = (msg.key.remoteJid || '').replace('@s.whatsapp.net', '');
                    const pushname = msg.pushName || '';
                    const waMessageId = msg.key.id;
                    const timestamp = Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000);

                    console.log(`[MSG IN] ${pushname} (${phone}): ${text.substring(0, 60)}`);

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
        disconnectedAt: clientState.disconnectedAt
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
        const fs = require('fs');
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        fs.mkdirSync(SESSION_DIR, { recursive: true });
        clientState.status = 'logged_out';
        clientState.info = null;
        clientState.qr = null;

        res.json({ success: true, message: 'Disconnected & session wiped. Restart to get new QR.' });

        // Auto-start for new QR after short delay
        setTimeout(() => startSocket().catch(() => {}), 1500);
    } catch (err) {
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

// Prevent silent crashes
process.on('uncaughtException', (err) => {
    console.error('[CRASH PREVENTED] Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
    console.error('[CRASH PREVENTED] Unhandled Rejection:', reason);
});
