// ============================================
// WA WORKER — Background Retry & Auto-Recovery
//
// Berjalan di background setiap 15 detik:
// 1. Retry pesan FAILED yang belum melebihi max_retries
// 2. Recovery pesan PENDING yang stuck (server crash/restart)
//
// Exponential Backoff:
// - Retry 1: +30 detik
// - Retry 2: +2.5 menit
// - Retry 3: +12.5 menit
//
// Self-Healing:
// - Saat server start, otomatis cek PENDING/FAILED lama
// - Pesan stuck > 5 menit di-reset ke PENDING untuk diproses ulang
// ============================================

const axios = require('axios');
const db = require('./database');
require('dotenv').config();

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

class WAWorker {
    constructor() {
        this.isRunning = false;
        this.intervalId = null;
        this.processing = false;

        // Config
        this.phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
        this.accessToken = process.env.WA_ACCESS_TOKEN;
        this.checkInterval = 15000; // 15 detik
        this.batchSize = 5; // proses max 5 pesan per cycle
        this.delayBetweenMessages = { min: 1000, max: 3000 };
    }

    // ============================================
    // START WORKER
    // ============================================
    async start() {
        if (this.isRunning) {
            console.log('[WA Worker] Already running');
            return;
        }

        if (!this.phoneNumberId || !this.accessToken) {
            console.warn('[WA Worker] Cloud API not configured — worker will monitor but not send');
        }

        this.isRunning = true;
        console.log('[WA Worker] Started (interval: 15s)');

        // Auto-recovery saat startup
        await this._recoverStuck();

        // Main loop
        this.intervalId = setInterval(() => {
            if (!this.processing) {
                this._cycle();
            }
        }, this.checkInterval);
    }

    // ============================================
    // STOP WORKER
    // ============================================
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log('[WA Worker] Stopped');
    }

    // ============================================
    // MAIN CYCLE: retry failed + process pending
    // ============================================
    async _cycle() {
        this.processing = true;
        try {
            await this._retryFailed();
        } catch (err) {
            console.error('[WA Worker] Cycle error:', err.message);
        } finally {
            this.processing = false;
        }
    }

    // ============================================
    // RETRY: Ambil pesan FAILED yang waktunya sudah tiba
    // ============================================
    async _retryFailed() {
        if (!this.phoneNumberId || !this.accessToken) return;

        try {
            // Ambil pesan FAILED yang: retry_count < max_retries DAN next_retry_at sudah lewat
            const { rows } = await db.query(
                `SELECT id, phone, type, template_name, template_language, template_components, message_body, retry_count
                 FROM whatsapp_logs
                 WHERE status = 'FAILED'
                   AND retry_count < max_retries
                   AND next_retry_at IS NOT NULL
                   AND next_retry_at <= NOW()
                 ORDER BY next_retry_at ASC
                 LIMIT $1`,
                [this.batchSize]
            );

            if (rows.length === 0) return;

            console.log(`[WA Worker] Retrying ${rows.length} failed message(s)...`);

            for (const msg of rows) {
                try {
                    // Build payload sesuai type
                    const payload = this._buildPayload(msg);
                    if (!payload) {
                        await this._markPermanentFail(msg.id, 'Cannot rebuild payload');
                        continue;
                    }

                    // Delay antar pesan
                    await this._randomDelay(this.delayBetweenMessages.min, this.delayBetweenMessages.max);

                    // Kirim via Cloud API
                    const result = await this._send(msg.id, msg.phone, payload);

                    if (result.success) {
                        console.log(`[WA Worker] Retry SUCCESS: ${msg.phone} (attempt ${msg.retry_count + 1})`);
                    } else {
                        console.log(`[WA Worker] Retry FAILED: ${msg.phone} (attempt ${msg.retry_count + 1}): ${result.error}`);
                    }
                } catch (err) {
                    console.error(`[WA Worker] Error retrying msg #${msg.id}:`, err.message);
                }
            }
        } catch (err) {
            console.error('[WA Worker] retryFailed error:', err.message);
        }
    }

    // ============================================
    // RECOVERY: Reset pesan stuck saat server restart
    // ============================================
    async _recoverStuck() {
        try {
            // Pesan PENDING yang sudah > 5 menit = stuck (server crash)
            // Reset supaya worker bisa proses ulang
            const { rowCount } = await db.query(
                `UPDATE whatsapp_logs SET
                    status = 'FAILED',
                    error_detail = 'Server restart — auto-recovery',
                    retry_count = LEAST(retry_count, max_retries - 1),
                    next_retry_at = NOW()
                 WHERE status = 'PENDING'
                   AND created_at < NOW() - INTERVAL '5 minutes'`
            );

            if (rowCount > 0) {
                console.log(`[WA Worker] Auto-recovered ${rowCount} stuck message(s)`);
            }
        } catch (err) {
            console.error('[WA Worker] Recovery error:', err.message);
        }
    }

    // ============================================
    // INTERNAL: Build Cloud API payload dari DB record
    // ============================================
    _buildPayload(msg) {
        if (msg.type === 'template') {
            if (!msg.template_name) return null;

            let components = [];
            try {
                components = typeof msg.template_components === 'string'
                    ? JSON.parse(msg.template_components)
                    : msg.template_components || [];
            } catch (e) {
                components = [];
            }

            return {
                messaging_product: 'whatsapp',
                to: msg.phone,
                type: 'template',
                template: {
                    name: msg.template_name,
                    language: { code: msg.template_language || 'id' },
                    components
                }
            };
        }

        if (msg.type === 'text') {
            if (!msg.message_body) return null;
            return {
                messaging_product: 'whatsapp',
                to: msg.phone,
                type: 'text',
                text: { body: msg.message_body }
            };
        }

        return null;
    }

    // ============================================
    // INTERNAL: Send via Cloud API + update DB
    // ============================================
    async _send(logId, phone, payload) {
        try {
            const url = `${GRAPH_API_BASE}/${this.phoneNumberId}/messages`;

            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            const waMessageId = response.data?.messages?.[0]?.id || null;

            // Update status → SENT
            await db.query(
                `UPDATE whatsapp_logs SET
                    status = 'SENT', wa_message_id = $1, api_response = $2,
                    error_code = NULL, error_detail = NULL,
                    sent_at = NOW(), updated_at = NOW()
                 WHERE id = $3`,
                [waMessageId, JSON.stringify(response.data), logId]
            );

            // Increment daily counter
            await db.query(
                `INSERT INTO wa_daily_stats (stat_date, sent_count)
                 VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Makassar')::date, 1)
                 ON CONFLICT (stat_date) DO UPDATE SET sent_count = wa_daily_stats.sent_count + 1, updated_at = NOW()`
            );

            return { success: true, wa_message_id: waMessageId };

        } catch (error) {
            const errData = error.response?.data?.error;
            const errorCode = String(errData?.code || error.code || 'UNKNOWN');
            const errorDetail = errData?.message || error.message;
            const httpStatus = error.response?.status;

            // Cek apakah masih bisa di-retry
            const retryable = this._isRetryable(errorCode, httpStatus);

            if (retryable) {
                // Update retry count + next_retry_at (exponential backoff)
                await db.query(
                    `UPDATE whatsapp_logs SET
                        status = 'FAILED',
                        error_code = $1, error_detail = $2,
                        api_response = $3,
                        retry_count = retry_count + 1,
                        next_retry_at = NOW() + (POWER(5, LEAST(retry_count + 1, 4)) || ' seconds')::interval,
                        updated_at = NOW()
                     WHERE id = $4`,
                    [errorCode, errorDetail, error.response?.data ? JSON.stringify(error.response.data) : null, logId]
                );
            } else {
                // Permanent fail — set retry_count = max_retries supaya worker tidak coba lagi
                await this._markPermanentFail(logId, `[${errorCode}] ${errorDetail}`);
            }

            return { success: false, error: errorDetail, retryable };
        }
    }

    // ============================================
    // INTERNAL: Mark as permanent fail
    // ============================================
    async _markPermanentFail(logId, errorDetail) {
        await db.query(
            `UPDATE whatsapp_logs SET
                status = 'FAILED', retry_count = max_retries,
                error_detail = $1, updated_at = NOW()
             WHERE id = $2`,
            [errorDetail, logId]
        ).catch(err => console.warn('[WA Worker] markPermanentFail error:', err.message));
    }

    // ============================================
    // INTERNAL: Check retryable error
    // ============================================
    _isRetryable(errorCode, httpStatus) {
        if (httpStatus === 429) return true;
        if (httpStatus >= 500) return true;
        if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND'].includes(errorCode)) return true;
        const retryableCodes = [130429, 131026, 131047, 131053];
        if (retryableCodes.includes(Number(errorCode))) return true;
        return false;
    }

    // ============================================
    // INTERNAL: Random delay
    // ============================================
    _randomDelay(min, max) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    // ============================================
    // PUBLIC: Get worker status (untuk monitoring)
    // ============================================
    async getQueueStatus() {
        try {
            const { rows: [counts] } = await db.query(
                `SELECT
                    COUNT(*) FILTER (WHERE status = 'PENDING') as pending,
                    COUNT(*) FILTER (WHERE status = 'FAILED' AND retry_count < max_retries) as retryable,
                    COUNT(*) FILTER (WHERE status = 'FAILED' AND retry_count >= max_retries) as permanent_fail,
                    COUNT(*) FILTER (WHERE status = 'SENT') as sent,
                    COUNT(*) FILTER (WHERE status = 'DELIVERED') as delivered,
                    COUNT(*) FILTER (WHERE status = 'READ') as read_status
                 FROM whatsapp_logs
                 WHERE created_at > NOW() - INTERVAL '24 hours'`
            );
            return {
                running: this.isRunning,
                ...counts
            };
        } catch (err) {
            return { running: this.isRunning, error: err.message };
        }
    }
}

module.exports = new WAWorker();
