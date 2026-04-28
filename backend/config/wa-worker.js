// ============================================
// WA WORKER — Anti-ban orchestrator
//
// Responsibilities:
// 1. Retry FAILED messages (exponential backoff via whatsapp_logs.next_retry_at)
// 2. Process broadcast queue with strict anti-ban strategy:
//    - Working hours only: 07:00-21:00 WITA
//    - Daily limit (from app_settings or env, default 200)
//    - Warm-up: first 20 msgs of day use longer delay (slow start)
//    - Delay between broadcasts: 120-240s (with jitter)
//    - Break: every 25-30 msgs, pause 15-30 min (humanlike)
//    - Variasi pesan applied per-recipient (zero-width spaces + random greeting)
//
// All sends go via wa-bridge (Baileys). This worker does NOT call WhatsApp directly.
// ============================================

const db = require('./database');
const whatsappService = require('./whatsapp');
require('dotenv').config();

// Message variation — identical copy used by adminController
// Keeps each broadcast message slightly unique so WA anti-spam doesn't fingerprint
const RANDOM_GREETINGS = [
    '', '',
    'Halo Kak, ', 'Hi Kak, ', 'Hai Kak, ', 'Halo, ', 'Hai, ',
    'Halo Kak! ', 'Hi! ', 'Hey Kak, ',
    'Permisi Kak, '
];
const RANDOM_CLOSINGS = [
    '',
    ' 😊', ' 🙏', ' ✨', ' 👍', ' 🎉',
    '\n\nTerima kasih! 🙏', '\n\nSalam hangat! 😊', '\n\nDitunggu ya Kak! 👋'
];

function variasiPesan(message, customerName) {
    let msg = String(message).replace(/\{nama\}/gi, customerName || 'Kak');
    const startsWithGreeting = /^(halo|hai|hi|hey|selamat|assalam|permisi)/i.test(msg);
    if (!startsWithGreeting) {
        const g = RANDOM_GREETINGS[Math.floor(Math.random() * RANDOM_GREETINGS.length)];
        if (g) msg = g + msg;
    }
    const c = RANDOM_CLOSINGS[Math.floor(Math.random() * RANDOM_CLOSINGS.length)];
    msg = msg + c;
    // 1-2 zero-width spaces at random positions
    const zwsp = '​';
    const numZwsp = Math.floor(Math.random() * 2) + 1;
    for (let i = 0; i < numZwsp; i++) {
        const pos = Math.floor(Math.random() * Math.max(1, msg.length));
        msg = msg.slice(0, pos) + zwsp + msg.slice(pos);
    }
    return msg;
}

// ============================================
// ANTI-BAN CONFIG
// ============================================
const CONFIG = {
    tickInterval: 15_000, // 15s poll

    // Working hours in WITA (Asia/Makassar)
    workStartHour: 7,     // 07:00 start
    workEndHour: 21,      // stop at 21:00 (do not send after)

    // Broadcast delays (milliseconds)
    broadcast: {
        warmupDelay:  { min: 90_000,  max: 180_000 },  // first 20 of day
        normalDelay:  { min: 120_000, max: 240_000 },  // after warm-up
        warmupThreshold: 20,                            // first 20 msgs = warm-up

        // Break: every 25-30 messages, pause 15-30 min
        breakEveryMin: 25,
        breakEveryMax: 30,
        breakDuration: { min: 15 * 60_000, max: 30 * 60_000 }
    },

    // Retry delays
    retry: {
        batchSize: 3,
        interMessageDelay: { min: 2_000, max: 5_000 }
    },

    // Startup safety break — after restart, wait before sending
    startupCooldownMs: 30_000,

    // Daily limit fallback if not in DB
    defaultDailyLimit: 200
};

class WAWorker {
    constructor() {
        this.isRunning = false;
        this.intervalId = null;
        this.processing = false;

        // In-memory anti-ban state
        this.msgsSinceLastBreak = 0;
        this.nextBreakAt = this._randomBreakThreshold();
        this.breakUntil = 0;              // epoch ms
        this.lastBroadcastSentAt = 0;     // epoch ms
        this.nextBroadcastAllowedAt = 0;  // epoch ms (enforces delay between messages)
        this.startedAt = 0;
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.startedAt = Date.now();
        // After restart, wait a cooldown before sending anything
        this.nextBroadcastAllowedAt = this.startedAt + CONFIG.startupCooldownMs;

        console.log(`[WA Worker] Started. Cooldown ${CONFIG.startupCooldownMs / 1000}s before first broadcast.`);

        await this._recoverStaleBroadcast();

        this.intervalId = setInterval(() => {
            if (!this.processing) this._cycle();
        }, CONFIG.tickInterval);
    }

    stop() {
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = null;
        this.isRunning = false;
        console.log('[WA Worker] Stopped');
    }

    async _cycle() {
        this.processing = true;
        try {
            await this._retryFailed();
            await this._processBroadcast();
        } catch (err) {
            console.error('[WA Worker] Cycle error:', err.message);
        } finally {
            this.processing = false;
        }
    }

    // ============================================
    // RETRY FAILED (whatsapp_logs with next_retry_at due)
    // ============================================
    async _retryFailed() {
        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const { rows } = await client.query(
                `SELECT id, phone, type, message_body, retry_count
                 FROM whatsapp_logs
                 WHERE status = 'FAILED'
                   AND retry_count < max_retries
                   AND next_retry_at IS NOT NULL
                   AND next_retry_at <= NOW()
                   AND message_body IS NOT NULL
                 ORDER BY next_retry_at ASC
                 LIMIT $1
                 FOR UPDATE SKIP LOCKED`,
                [CONFIG.retry.batchSize]
            );

            if (rows.length === 0) {
                await client.query('COMMIT');
                return;
            }

            const ids = rows.map(r => r.id);
            await client.query(
                `UPDATE whatsapp_logs SET status = 'RETRYING', updated_at = NOW() WHERE id = ANY($1)`,
                [ids]
            );
            await client.query('COMMIT');

            console.log(`[WA Worker] Retrying ${rows.length} failed message(s)...`);

            for (const msg of rows) {
                try {
                    // sendText creates a NEW log entry — close out the old one as permanently_failed
                    // to avoid infinite retry loops (the new log tracks this retry attempt)
                    const result = await whatsappService.sendText(msg.phone, msg.message_body, {
                        typing: false,
                        skipOptCheck: true,
                        category: msg.type || 'text'
                    });

                    // Close the old log: mark as retried
                    await db.query(
                        `UPDATE whatsapp_logs SET
                            status = $1, retry_count = retry_count + 1, updated_at = NOW()
                         WHERE id = $2`,
                        [result.success ? 'SENT' : 'FAILED', msg.id]
                    );

                    await this._randomDelay(CONFIG.retry.interMessageDelay.min, CONFIG.retry.interMessageDelay.max);
                } catch (err) {
                    console.error(`[WA Worker] Retry error for #${msg.id}:`, err.message);
                    await db.query(
                        `UPDATE whatsapp_logs SET status = 'FAILED', updated_at = NOW() WHERE id = $1`,
                        [msg.id]
                    ).catch(() => {});
                }
            }
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('[WA Worker] retryFailed error:', err.message);
        } finally {
            client.release();
        }
    }

    // ============================================
    // BROADCAST PROCESSING with anti-ban strategy
    // ============================================
    async _processBroadcast() {
        const now = Date.now();

        // 1. In a break?
        if (now < this.breakUntil) {
            return;
        }

        // 2. Working hours check
        if (!this._isWorkingHours()) {
            return;
        }

        // 3. Startup cooldown / inter-message delay
        if (now < this.nextBroadcastAllowedAt) {
            return;
        }

        // 4. Daily limit check
        const sentToday = await this._getSentToday();
        const dailyLimit = await this._getDailyLimit();
        if (sentToday >= dailyLimit) {
            // Once per ~10 min logging
            if (!this._lastLimitLog || now - this._lastLimitLog > 10 * 60_000) {
                console.log(`[WA Worker] Daily limit reached (${sentToday}/${dailyLimit}) — pausing broadcasts`);
                this._lastLimitLog = now;
            }
            return;
        }

        // 5. Get one pending recipient from running job
        const recipient = await this._claimNextRecipient();
        if (!recipient) return;

        // 6. Send!
        try {
            const variedMsg = variasiPesan(recipient.broadcast_message, recipient.customer_name);

            const result = await whatsappService.sendBroadcastMessage(
                recipient.customer_phone,
                variedMsg
            );

            const status = result.success ? 'sent' : 'failed';
            await db.query(
                `UPDATE broadcast_recipients SET status = $1, error = $2, sent_at = NOW() WHERE id = $3`,
                [status, result.error || null, recipient.id]
            );

            // Log to messages
            await db.query(
                `INSERT INTO messages (customer_id, direction, message) VALUES ($1, 'out', $2)`,
                [recipient.customer_id, `[BROADCAST][${status.toUpperCase()}] ${variedMsg.substring(0, 180)}`]
            ).catch(() => {});

            if (result.success) {
                await db.query(
                    `UPDATE customers SET status = 'Contacted' WHERE id = $1 AND status = 'New'`,
                    [recipient.customer_id]
                ).catch(() => {});

                this.msgsSinceLastBreak += 1;
                this.lastBroadcastSentAt = Date.now();
            }

            await db.query(
                `UPDATE broadcast_jobs SET sent = sent + $1, failed = failed + $2 WHERE id = $3`,
                [result.success ? 1 : 0, result.success ? 0 : 1, recipient.job_id]
            ).catch(() => {});

            await this._checkBroadcastComplete(recipient.job_id);

            // 7. Set next send window: delay + break-if-needed
            this._scheduleNextBroadcast(sentToday + 1);

        } catch (err) {
            console.error('[WA Worker] Broadcast send error:', err.message);
            await db.query(
                `UPDATE broadcast_recipients SET status = 'failed', error = $1, sent_at = NOW() WHERE id = $2`,
                [err.message, recipient.id]
            ).catch(() => {});
            // Still apply short cooldown so we don't spam errors
            this.nextBroadcastAllowedAt = Date.now() + 30_000;
        }
    }

    _scheduleNextBroadcast(totalSentToday) {
        const now = Date.now();

        // Break check — every 25-30 msgs, pause 15-30 min
        if (this.msgsSinceLastBreak >= this.nextBreakAt) {
            const breakMs = this._randInt(CONFIG.broadcast.breakDuration.min, CONFIG.broadcast.breakDuration.max);
            this.breakUntil = now + breakMs;
            this.msgsSinceLastBreak = 0;
            this.nextBreakAt = this._randomBreakThreshold();
            console.log(`[WA Worker] ☕ BREAK for ${Math.round(breakMs / 60_000)} min after ${totalSentToday} messages today`);
            return;
        }

        // Warm-up delay (first N of day) vs normal delay
        const inWarmup = totalSentToday <= CONFIG.broadcast.warmupThreshold;
        const delayCfg = inWarmup ? CONFIG.broadcast.warmupDelay : CONFIG.broadcast.normalDelay;
        const delay = this._randInt(delayCfg.min, delayCfg.max);
        this.nextBroadcastAllowedAt = now + delay;

        console.log(`[WA Worker] ✅ Sent (${totalSentToday}/day, ${this.msgsSinceLastBreak}/${this.nextBreakAt} until break). Next in ${Math.round(delay / 1000)}s (${inWarmup ? 'warmup' : 'normal'})`);
    }

    async _claimNextRecipient() {
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            const { rows } = await client.query(
                `SELECT r.id, r.job_id, r.customer_id, r.customer_name, r.customer_phone,
                        j.message as broadcast_message
                 FROM broadcast_recipients r
                 JOIN broadcast_jobs j ON j.id = r.job_id
                 WHERE r.status = 'pending' AND j.status = 'running'
                 ORDER BY r.id ASC
                 LIMIT 1
                 FOR UPDATE OF r SKIP LOCKED`
            );
            if (rows.length === 0) {
                await client.query('COMMIT');
                return null;
            }
            const recipient = rows[0];
            await client.query(
                `UPDATE broadcast_recipients SET status = 'sending' WHERE id = $1`,
                [recipient.id]
            );
            await client.query('COMMIT');
            return recipient;
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('[WA Worker] Claim recipient error:', err.message);
            return null;
        } finally {
            client.release();
        }
    }

    async _checkBroadcastComplete(jobId) {
        const { rows: [counts] } = await db.query(
            `SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'sending')) as remaining
             FROM broadcast_recipients WHERE job_id = $1`,
            [jobId]
        );
        if (parseInt(counts.remaining) === 0) {
            await db.query(`UPDATE broadcast_jobs SET status = 'completed' WHERE id = $1`, [jobId]);
            console.log(`[WA Worker] 🎉 Broadcast job #${jobId} completed`);
        }
    }

    async _recoverStaleBroadcast() {
        try {
            const { rowCount } = await db.query(
                `UPDATE broadcast_recipients SET status = 'pending'
                 WHERE status = 'sending' AND sent_at IS NULL`
            );
            if (rowCount > 0) {
                console.log(`[WA Worker] Recovered ${rowCount} stale broadcast recipient(s)`);
            }
        } catch (err) {
            console.error('[WA Worker] Recovery error:', err.message);
        }
    }

    // ============================================
    // STATUS / UTILS
    // ============================================
    async getQueueStatus() {
        try {
            const { rows: [counts] } = await db.query(
                `SELECT
                    COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
                    COUNT(*) FILTER (WHERE status = 'FAILED' AND retry_count < max_retries) as retryable,
                    COUNT(*) FILTER (WHERE status = 'FAILED' AND retry_count >= max_retries) as permanent_fail,
                    COUNT(*) FILTER (WHERE status = 'SENT') as sent,
                    COUNT(*) FILTER (WHERE status = 'RETRYING') as retrying
                 FROM whatsapp_logs
                 WHERE created_at > NOW() - INTERVAL '24 hours'`
            );

            const now = Date.now();
            const inBreak = now < this.breakUntil;
            const nextSendIn = Math.max(0, this.nextBroadcastAllowedAt - now);
            const breakRemaining = Math.max(0, this.breakUntil - now);

            return {
                running: this.isRunning,
                ...counts,
                antiBan: {
                    workingHours: this._isWorkingHours(),
                    inBreak,
                    breakRemainingSec: Math.round(breakRemaining / 1000),
                    msgsSinceLastBreak: this.msgsSinceLastBreak,
                    nextBreakAt: this.nextBreakAt,
                    nextSendInSec: Math.round(nextSendIn / 1000)
                }
            };
        } catch (err) {
            return { running: this.isRunning, error: err.message };
        }
    }

    async _getSentToday() {
        try {
            const { rows: [r] } = await db.query(
                `SELECT COUNT(*)::int as c FROM broadcast_recipients
                 WHERE status = 'sent' AND (sent_at AT TIME ZONE 'Asia/Makassar')::date = (NOW() AT TIME ZONE 'Asia/Makassar')::date`
            );
            return r.c || 0;
        } catch (_) {
            return 0;
        }
    }

    async _getDailyLimit() {
        try {
            const { rows } = await db.query(`SELECT value FROM app_settings WHERE key = 'wa_daily_limit' LIMIT 1`);
            const v = parseInt(rows[0]?.value || '');
            return v > 0 ? v : CONFIG.defaultDailyLimit;
        } catch (_) {
            return CONFIG.defaultDailyLimit;
        }
    }

    _isWorkingHours() {
        // WITA hour from UTC+8
        const nowUtc = new Date();
        const witaHours = (nowUtc.getUTCHours() + 8) % 24;
        return witaHours >= CONFIG.workStartHour && witaHours < CONFIG.workEndHour;
    }

    _randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    _randomBreakThreshold() {
        return this._randInt(CONFIG.broadcast.breakEveryMin, CONFIG.broadcast.breakEveryMax);
    }

    _randomDelay(min, max) {
        return new Promise(r => setTimeout(r, this._randInt(min, max)));
    }
}

module.exports = new WAWorker();
