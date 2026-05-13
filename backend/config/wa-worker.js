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

// Spintax parser — resolves {opt1|opt2|opt3} to one random option.
// Handles nested spintax by iterating from innermost {} outward.
// REQUIRES at least one `|` inside the braces — single-token braces like {nama}
// and {umur} are placeholders, left untouched so the consumer can replace them.
// Example: "Halo {Kak|Bro}, {terima kasih|makasih}, Kak {nama}!" → "Halo Bro, makasih, Kak {nama}!"
function spinText(text) {
    if (typeof text !== 'string') return text;
    const inner = /\{([^{}]*\|[^{}]*)\}/;
    let out = text;
    let safety = 0;
    while (inner.test(out) && safety < 50) {
        out = out.replace(inner, (_, opts) => {
            const choices = opts.split('|');
            return choices[Math.floor(Math.random() * choices.length)];
        });
        safety++;
    }
    return out;
}

// Message variation — applied to broadcast (and optionally other categories).
// Layered defense against WA's fingerprinting of identical messages.
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
    // 1. Resolve spintax first (admin can write {pagi|siang|sore} in templates)
    let msg = spinText(String(message));
    // 2. Replace {nama} placeholder (after spintax so opts can include {nama})
    msg = msg.replace(/\{nama\}/gi, customerName || 'Kak');
    // 3. Random greeting prefix if message doesn't already greet
    const startsWithGreeting = /^(halo|hai|hi|hey|selamat|assalam|permisi)/i.test(msg);
    if (!startsWithGreeting) {
        const g = RANDOM_GREETINGS[Math.floor(Math.random() * RANDOM_GREETINGS.length)];
        if (g) msg = g + msg;
    }
    // 4. Random closing suffix
    const c = RANDOM_CLOSINGS[Math.floor(Math.random() * RANDOM_CLOSINGS.length)];
    msg = msg + c;
    // 5. 1-2 zero-width spaces at random positions (defeats exact-string fingerprinting)
    const zwsp = '​';
    const numZwsp = Math.floor(Math.random() * 2) + 1;
    for (let i = 0; i < numZwsp; i++) {
        const pos = Math.floor(Math.random() * Math.max(1, msg.length));
        msg = msg.slice(0, pos) + zwsp + msg.slice(pos);
    }
    return msg;
}

// spinText is exported at the bottom alongside the WAWorker singleton instance.

// ============================================
// ANTI-BAN CONFIG
// ============================================
const CONFIG = {
    tickInterval: 15_000, // 15s poll

    // Working hours in WITA (Asia/Makassar)
    workStartHour: 8,     // 08:00 start
    workEndHour: 22,      // stop at 22:00 (do not send after)

    // Per-category default ranges. The ACTUAL values for a given day are sampled
    // once from these ranges into todaysProfile (see _ensureDailyProfile), so two
    // consecutive days never produce the same anti-ban tempo.
    //
    // Both auto-reply and broadcast target ~5 min/message per the user spec.
    // Birthday stays slightly faster (~3 min) because there are at most a handful
    // of birthdays per day and the cron starts at 09:00 — needs a tighter loop
    // to fit safely inside working hours.
    broadcast: {
        warmupBaseMs: { min: 270_000, max: 360_000 },      // ~4:30 to 6:00 base for the day
        warmupJitterMs: 30_000,                             // ±30s per message
        normalBaseMs:  { min: 270_000, max: 360_000 },      // same range; broadcast == auto-reply
        normalJitterMs: 30_000,
        warmupThreshold: 20,
        breakEveryRange:  { min: 22, max: 32 },             // sampled to a single int per day
        breakDurationMs:  { min: 12 * 60_000, max: 28 * 60_000 }
    },

    autoReply: {
        baseDelayMs: { min: 270_000, max: 360_000 },        // 4:30 to 6:00 base for the day
        jitterMs: 30_000,                                    // ±30s per message
        breakEveryRange:  { min: 18, max: 28 },
        breakDurationMs:  { min: 10 * 60_000, max: 25 * 60_000 }
    },

    birthday: {
        baseDelayMs: { min: 150_000, max: 210_000 },        // 2:30 to 3:30
        jitterMs: 20_000,
        breakEveryRange:  { min: 15, max: 24 },
        breakDurationMs:  { min: 8 * 60_000, max: 18 * 60_000 }
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

        // In-memory anti-ban state — broadcast
        this.msgsSinceLastBreak = 0;
        this.nextBreakAt = this._randomBreakThreshold();
        this.breakUntil = 0;              // epoch ms
        this.lastBroadcastSentAt = 0;     // epoch ms
        this.nextBroadcastAllowedAt = 0;  // epoch ms (enforces delay between messages)
        this.startedAt = 0;

        // Auto-reply queue state (separate pacing from broadcast)
        this.autoReplyMsgsSinceBreak = 0;
        this.autoReplyBreakUntil = 0;
        this.nextAutoReplyAllowedAt = 0;

        // Daily anti-ban profile — re-rolled every day in WITA time. All delay/break
        // ranges are SAMPLED ONCE PER DAY from the ranges above, so today's tempo
        // never matches yesterday's. A spider that learns "every 5 min, break at 25"
        // sees a moving target instead.
        this.todaysProfile = null;
        this.todaysProfileDate = null;
        this.autoReplyNextBreakAt = 25;  // will be replaced on first _ensureDailyProfile
    }

    _todayKeyWITA() {
        // WITA = UTC+8; format as YYYY-MM-DD
        const utc = Date.now();
        const wita = new Date(utc + 8 * 60 * 60 * 1000);
        return wita.toISOString().slice(0, 10);
    }

    _ensureDailyProfile() {
        const today = this._todayKeyWITA();
        if (this.todaysProfileDate === today && this.todaysProfile) return this.todaysProfile;

        const bcCfg = CONFIG.broadcast;
        const arCfg = CONFIG.autoReply;
        const bdCfg = CONFIG.birthday;
        this.todaysProfile = {
            broadcast: {
                warmupBase: this._randInt(bcCfg.warmupBaseMs.min, bcCfg.warmupBaseMs.max),
                normalBase: this._randInt(bcCfg.normalBaseMs.min, bcCfg.normalBaseMs.max),
                breakEvery: this._randInt(bcCfg.breakEveryRange.min, bcCfg.breakEveryRange.max),
                breakDuration: { min: bcCfg.breakDurationMs.min, max: bcCfg.breakDurationMs.max }
            },
            autoReply: {
                base: this._randInt(arCfg.baseDelayMs.min, arCfg.baseDelayMs.max),
                breakEvery: this._randInt(arCfg.breakEveryRange.min, arCfg.breakEveryRange.max),
                breakDuration: { min: arCfg.breakDurationMs.min, max: arCfg.breakDurationMs.max }
            },
            birthday: {
                base: this._randInt(bdCfg.baseDelayMs.min, bdCfg.baseDelayMs.max),
                breakEvery: this._randInt(bdCfg.breakEveryRange.min, bdCfg.breakEveryRange.max),
                breakDuration: { min: bdCfg.breakDurationMs.min, max: bdCfg.breakDurationMs.max }
            }
        };
        this.todaysProfileDate = today;
        // Re-sync the running counters to today's break threshold
        this.nextBreakAt = this.todaysProfile.broadcast.breakEvery;
        this.autoReplyNextBreakAt = this.todaysProfile.autoReply.breakEvery;

        const sec = (ms) => Math.round(ms / 1000);
        console.log(`[AntiBan] Daily profile for ${today}:`
            + ` broadcast base=${sec(this.todaysProfile.broadcast.normalBase)}s break@${this.todaysProfile.broadcast.breakEvery};`
            + ` autoReply base=${sec(this.todaysProfile.autoReply.base)}s break@${this.todaysProfile.autoReply.breakEvery};`
            + ` birthday base=${sec(this.todaysProfile.birthday.base)}s break@${this.todaysProfile.birthday.breakEvery}`);
        return this.todaysProfile;
    }

    // Read-only accessor for birthday controller (so the inline cron loop uses the same
    // daily profile this worker is using for everything else).
    getBirthdayProfile() {
        return this._ensureDailyProfile().birthday;
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
            await this._processAutoReplyQueue();
            await this._processBirthdayQueue();
            await this._processBroadcast();
        } catch (err) {
            console.error('[WA Worker] Cycle error:', err.message);
        } finally {
            this.processing = false;
        }
    }

    // ============================================
    // AUTO-REPLY QUEUE — queued form thank-you messages
    // Picks one row per tick subject to: working hours, inter-message delay,
    // and periodic break (so 100-150/day looks human, not bot).
    // ============================================
    async _processAutoReplyQueue() {
        const now = Date.now();

        if (now < this.autoReplyBreakUntil) return;       // in a break
        if (!this._isWorkingHours()) return;              // outside 08-22 WITA
        if (now < this.nextAutoReplyAllowedAt) return;    // still cooling down

        // Bridge readiness check — don't claim a row if bridge can't deliver. The
        // status() call is cheap (cached in memory by wa-bridge). Without this, every
        // tick during a bridge outage would mark one auto-reply as transient-failed
        // (re-queued) and back off 60s — fine, but wasteful.
        try {
            const status = await whatsappService.getStatus();
            if (!status || status.status !== 'connected') {
                return;  // bridge not ready; try next tick
            }
        } catch (_) {
            return;  // bridge unreachable; try next tick
        }

        // Claim one queued auto-reply atomically
        const client = await db.connect();
        let row;
        try {
            await client.query('BEGIN');
            // Only auto_dispatch=TRUE rows get worker-processed. Rows enqueued
            // while the toggle was OFF (auto_dispatch=FALSE) sit until admin
            // explicitly clicks "Kirim Manual", which flips the flag to TRUE.
            const { rows } = await client.query(
                `SELECT id, phone, message_body
                 FROM whatsapp_logs
                 WHERE status = 'QUEUED' AND priority = 'auto_reply' AND auto_dispatch = TRUE::boolean
                 ORDER BY id ASC
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED`
            );
            if (rows.length === 0) {
                await client.query('COMMIT');
                return;
            }
            row = rows[0];
            await client.query(
                `UPDATE whatsapp_logs SET status = 'SENDING', updated_at = NOW() WHERE id = $1`,
                [row.id]
            );
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('[WA Worker] Auto-reply claim error:', err.message);
            return;
        } finally {
            client.release();
        }

        // Send via bridge directly (this log row already exists — don't double-log via sendText)
        try {
            const sendRes = await whatsappService._bridgeCall('POST', '/api/send', {
                phone: row.phone,
                message: row.message_body,
                typing: true
            });
            const waMessageId = sendRes?.wa_message_id || null;

            await db.query(
                `UPDATE whatsapp_logs SET status = 'SENT', wa_message_id = $1, sent_at = NOW(), updated_at = NOW() WHERE id = $2`,
                [waMessageId, row.id]
            );
            await whatsappService._incrementDailyCounter('sent');

            // Mark the matching customer record so dashboard reflects "auto-reply delivered"
            await db.query(
                `UPDATE customers SET wa_sent = TRUE, status = 'Completed' WHERE whatsapp = $1 AND status = 'New'`,
                [row.phone]
            ).catch(() => {});

            this.autoReplyMsgsSinceBreak += 1;
            console.log(`[WA Worker] ✉️ Auto-reply sent to ${row.phone} (${this.autoReplyMsgsSinceBreak}/${this.autoReplyNextBreakAt} until break)`);
        } catch (err) {
            // Distinguish "bridge is temporarily unreachable" (requeue) vs "real send
            // failed" (give up). For 503/timeout/connection refused, the message hasn't
            // been delivered to WA at all — putting it back in the queue keeps the
            // customer's auto-reply alive across Railway restarts and Baileys reconnects.
            const transient = /503|timeout|ECONN|ETIMEDOUT|ENOTFOUND|bridge|not connected/i.test(err.message || '');
            if (transient) {
                await db.query(
                    `UPDATE whatsapp_logs SET status = 'QUEUED', error_detail = $1, updated_at = NOW() WHERE id = $2`,
                    [`requeued: ${err.message}`.slice(0, 250), row.id]
                ).catch(() => {});
                // Back off auto-reply processing for a minute so we don't hot-loop
                this.nextAutoReplyAllowedAt = Date.now() + 60_000;
                console.warn(`[WA Worker] Auto-reply transient fail for ${row.phone} — requeued (${err.message})`);
            } else {
                await db.query(
                    `UPDATE whatsapp_logs SET status = 'FAILED', error_detail = $1, updated_at = NOW() WHERE id = $2`,
                    [err.message || 'send failed', row.id]
                ).catch(() => {});
                await whatsappService._incrementDailyCounter('failed');
                console.warn(`[WA Worker] Auto-reply permanent fail for ${row.phone}: ${err.message}`);
            }
            return;  // skip the post-send delay scheduler below
        }

        // Schedule next auto-reply slot using today's profile (base ± jitter).
        const profile = this._ensureDailyProfile().autoReply;
        if (this.autoReplyMsgsSinceBreak >= this.autoReplyNextBreakAt) {
            const breakMs = this._randInt(profile.breakDuration.min, profile.breakDuration.max);
            this.autoReplyBreakUntil = Date.now() + breakMs;
            this.autoReplyMsgsSinceBreak = 0;
            // Re-roll break threshold within day's range so two breaks in same day aren't identical
            this.autoReplyNextBreakAt = this._randInt(
                CONFIG.autoReply.breakEveryRange.min,
                CONFIG.autoReply.breakEveryRange.max
            );
            console.log(`[WA Worker] ☕ Auto-reply BREAK for ${Math.round(breakMs / 60_000)} min`);
        } else {
            const jitter = this._randInt(-CONFIG.autoReply.jitterMs, CONFIG.autoReply.jitterMs);
            const delay = Math.max(60_000, profile.base + jitter);  // floor at 1 min
            this.nextAutoReplyAllowedAt = Date.now() + delay;
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
        const profile = this._ensureDailyProfile().broadcast;

        // Break check — uses today's break threshold sampled from breakEveryRange
        if (this.msgsSinceLastBreak >= this.nextBreakAt) {
            const breakMs = this._randInt(profile.breakDuration.min, profile.breakDuration.max);
            this.breakUntil = now + breakMs;
            this.msgsSinceLastBreak = 0;
            // Re-roll break threshold WITHIN today's range so two breaks aren't identical
            this.nextBreakAt = this._randInt(
                CONFIG.broadcast.breakEveryRange.min,
                CONFIG.broadcast.breakEveryRange.max
            );
            console.log(`[WA Worker] ☕ BREAK for ${Math.round(breakMs / 60_000)} min after ${totalSentToday} messages today`);
            return;
        }

        // Warm-up (first N of day) uses warmupBase, then normalBase. Both ± jitter.
        const inWarmup = totalSentToday <= CONFIG.broadcast.warmupThreshold;
        const base = inWarmup ? profile.warmupBase : profile.normalBase;
        const jitterCfg = inWarmup ? CONFIG.broadcast.warmupJitterMs : CONFIG.broadcast.normalJitterMs;
        const jitter = this._randInt(-jitterCfg, jitterCfg);
        const delay = Math.max(60_000, base + jitter);
        this.nextBroadcastAllowedAt = now + delay;

        // Verbose log only outside production — saves RAM in log buffer + Railway egress
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[WA Worker] ✅ Sent (${totalSentToday}/day, ${this.msgsSinceLastBreak}/${this.nextBreakAt} until break). Next in ${Math.round(delay / 1000)}s (${inWarmup ? 'warmup' : 'normal'})`);
        }
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

            // Stale auto-reply rows (worker crashed mid-send) → put back in queue
            const { rowCount: arCount } = await db.query(
                `UPDATE whatsapp_logs SET status = 'QUEUED', updated_at = NOW()
                 WHERE status = 'SENDING' AND priority = 'auto_reply' AND sent_at IS NULL`
            );
            if (arCount > 0) {
                console.log(`[WA Worker] Recovered ${arCount} stale auto-reply log(s)`);
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
                    COUNT(*) FILTER (WHERE status = 'QUEUED' AND priority = 'auto_reply') as auto_reply_queued,
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
            const autoReplyInBreak = now < this.autoReplyBreakUntil;
            const autoReplyNextSendIn = Math.max(0, this.nextAutoReplyAllowedAt - now);
            const autoReplyBreakRemaining = Math.max(0, this.autoReplyBreakUntil - now);

            return {
                running: this.isRunning,
                ...counts,
                antiBan: {
                    workingHours: this._isWorkingHours(),
                    inBreak,
                    breakRemainingSec: Math.round(breakRemaining / 1000),
                    msgsSinceLastBreak: this.msgsSinceLastBreak,
                    nextBreakAt: this.nextBreakAt,
                    nextSendInSec: Math.round(nextSendIn / 1000),
                    autoReply: {
                        inBreak: autoReplyInBreak,
                        breakRemainingSec: Math.round(autoReplyBreakRemaining / 1000),
                        msgsSinceLastBreak: this.autoReplyMsgsSinceBreak,
                        nextBreakAt: this.autoReplyNextBreakAt,
                        nextSendInSec: Math.round(autoReplyNextSendIn / 1000)
                    }
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

    // ===========================================
    // WORKER: BIRTHDAY QUEUE (AUTO ONLY)
    // ===========================================
    async _processBirthdayQueue() {
        // GATE 1: Berhenti jika di luar jam operasional
        if (!this._isWorkingHours()) {
            return; // Diam saja, biarkan antrean menumpuk untuk dilanjutkan besok pagi
        }

        try {
            // GATE 2: Cari 1 customer yang antreannya OTOMATIS dan belum terkirim
            const { rows } = await db.query(`
                SELECT bg.id as greeting_id, c.id as customer_id, c.nama_lengkap, c.whatsapp 
                FROM birthday_greetings bg
                JOIN customers c ON bg.customer_id = c.id
                WHERE bg.status = 'pending' 
                  AND bg.dispatch_mode = 'auto'
                  AND bg.greeting_year = EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar'))
                ORDER BY bg.id ASC
                LIMIT 1
            `);

            // Kalau tidak ada antrian otomatis, keluar dari fungsi
            if (rows.length === 0) return; 

            const data = rows[0];

            // GATE 3: Anti-Ban (Delay & Break)
            this.consecutiveBirthdays = (this.consecutiveBirthdays || 0) + 1;
            
            // Cek apakah sudah waktunya break (misal: setelah 25 pesan berturut-turut)
            if (this.consecutiveBirthdays >= this._randomBreakThreshold()) {
                const breakMs = this._randInt(15 * 60000, 30 * 60000); // Break 15-30 menit
                console.log(`[WA-WORKER] ☕ Break ${Math.round(breakMs/60000)} menit untuk Birthday Auto-Queue.`);
                await new Promise(resolve => setTimeout(resolve, breakMs));
                this.consecutiveBirthdays = 0; // Reset counter setelah break
            } else {
                // Delay normal antar pesan (misal: 15-35 detik)
                const delayMs = this._randInt(15000, 35000);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }

            // PERSIAPAN PESAN
            const msgResult = await db.query(`SELECT value FROM app_settings WHERE key = 'birthday_message'`);
            const template = msgResult.rows.length > 0 ? msgResult.rows[0].value : 'Halo Kak {nama}! 🎂 Selamat Ulang Tahun!';
            const finalMessage = template.replace(/{nama}/g, data.nama_lengkap);

            // EKSEKUSI KIRIM WA
            console.log(`[WA-WORKER] 🎂 Mengirim pesan ultah OTOMATIS ke ${data.nama_lengkap}`);
            // (Sesuaikan nama method ini dengan fungsi kirim aslimu, misal sendMessage / _bridgeSend)
            const sendRes = await whatsappService.sendMessage(data.whatsapp, finalMessage, 'birthday');

            // UPDATE DATABASE BERDASARKAN HASIL (Hilang dari tab "Gagal Terkirim")
            if (sendRes.success) {
                await db.query(`UPDATE birthday_greetings SET status = 'sent', error = NULL WHERE id = $1`, [data.greeting_id]);
            } else {
                await db.query(`UPDATE birthday_greetings SET status = 'failed', error = $1 WHERE id = $2`, [sendRes.error || 'Bridge Timeout/Disconnect', data.greeting_id]);
            }

        } catch (err) {
            console.error('[WA-WORKER] Error processing birthday queue:', err.message);
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
        return this._randInt(CONFIG.broadcast.breakEveryRange.min, CONFIG.broadcast.breakEveryRange.max);
    }

    _randomDelay(min, max) {
        return new Promise(r => setTimeout(r, this._randInt(min, max)));
    }
}

const workerInstance = new WAWorker();
module.exports = workerInstance;
module.exports.spinText = spinText;
