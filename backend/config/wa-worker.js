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

        this.phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
        this.accessToken = process.env.WA_ACCESS_TOKEN;
        this.checkInterval = 15000;
        this.batchSize = 5;
        this.delayBetweenMessages = { min: 1000, max: 3000 };
        this.broadcastDelay = { min: 3000, max: 8000 };
    }

    async start() {
        if (this.isRunning) {
            console.log('[WA Worker] Already running');
            return;
        }

        if (!this.phoneNumberId || !this.accessToken) {
            console.warn('[WA Worker] Cloud API not configured — worker will monitor but not send');
        }

        this.isRunning = true;
        console.log('[WA Worker] Started (interval: 15s, broadcast: backend-driven)');

        await this._recoverStuck();
        await this._recoverStaleBroadcast();

        this.intervalId = setInterval(() => {
            if (!this.processing) {
                this._cycle();
            }
        }, this.checkInterval);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
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
    // RETRY: FOR UPDATE SKIP LOCKED to prevent race conditions
    // ============================================
    async _retryFailed() {
        if (!this.phoneNumberId || !this.accessToken) return;

        const client = await db.connect();
        try {
            await client.query('BEGIN');

            const { rows } = await client.query(
                `SELECT id, phone, type, template_name, template_language, template_components, message_body, retry_count
                 FROM whatsapp_logs
                 WHERE status = 'FAILED'
                   AND retry_count < max_retries
                   AND next_retry_at IS NOT NULL
                   AND next_retry_at <= NOW()
                 ORDER BY next_retry_at ASC
                 LIMIT $1
                 FOR UPDATE SKIP LOCKED`,
                [this.batchSize]
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
                    const payload = this._buildPayload(msg);
                    if (!payload) {
                        await this._markPermanentFail(msg.id, 'Cannot rebuild payload');
                        continue;
                    }

                    await this._randomDelay(this.delayBetweenMessages.min, this.delayBetweenMessages.max);

                    const result = await this._send(msg.id, msg.phone, payload);

                    if (result.success) {
                        console.log(`[WA Worker] Retry SUCCESS: ${msg.phone} (attempt ${msg.retry_count + 1})`);
                    } else {
                        console.log(`[WA Worker] Retry FAILED: ${msg.phone} (attempt ${msg.retry_count + 1}): ${result.error}`);
                    }
                } catch (err) {
                    console.error(`[WA Worker] Error retrying msg #${msg.id}:`, err.message);
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
    // BROADCAST: Backend-driven processing loop
    // No longer depends on frontend polling
    // ============================================
    async _processBroadcast() {
        if (!this.phoneNumberId || !this.accessToken) return;

        try {
            const { rows: jobs } = await db.query(
                `SELECT id, message FROM broadcast_jobs WHERE status = 'running' ORDER BY id ASC LIMIT 1`
            );
            if (jobs.length === 0) return;

            const job = jobs[0];

            let templateInfo;
            try {
                templateInfo = JSON.parse(job.message);
            } catch (e) {
                const whatsappService = require('./whatsapp');
                templateInfo = { template_name: whatsappService.templates.broadcast, template_language: 'id', label: job.message };
            }

            const client = await db.connect();
            let recipient;
            try {
                await client.query('BEGIN');
                const { rows: batch } = await client.query(
                    `SELECT id, customer_id, customer_name, customer_phone
                     FROM broadcast_recipients
                     WHERE job_id = $1 AND status = 'pending'
                     ORDER BY id ASC LIMIT 1
                     FOR UPDATE SKIP LOCKED`,
                    [job.id]
                );

                if (batch.length === 0) {
                    await client.query('COMMIT');
                    await this._checkBroadcastComplete(job.id);
                    return;
                }

                recipient = batch[0];
                await client.query(
                    `UPDATE broadcast_recipients SET status = 'sending' WHERE id = $1`,
                    [recipient.id]
                );
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK').catch(() => {});
                console.error('[WA Worker] Broadcast lock error:', err.message);
                return;
            } finally {
                client.release();
            }

            await this._randomDelay(this.broadcastDelay.min, this.broadcastDelay.max);

            const whatsappService = require('./whatsapp');
            const components = [
                {
                    type: 'body',
                    parameters: [
                        { type: 'text', text: recipient.customer_name || 'Kak' }
                    ]
                }
            ];

            const result = await whatsappService.sendBroadcastMessage(
                recipient.customer_phone,
                templateInfo.template_name,
                templateInfo.template_language || 'id',
                components
            );

            const status = result.success ? 'sent' : 'failed';

            await db.query(
                `UPDATE broadcast_recipients SET status = $1, error = $2, sent_at = NOW() WHERE id = $3`,
                [status, result.error || null, recipient.id]
            );

            await db.query(
                `INSERT INTO messages (customer_id, direction, message) VALUES ($1, 'out', $2)`,
                [recipient.customer_id, `[BROADCAST][${status.toUpperCase()}] Template: ${templateInfo.template_name}`]
            ).catch(() => {});

            if (result.success) {
                await db.query(
                    `UPDATE customers SET status = 'Contacted' WHERE id = $1 AND status = 'New'`,
                    [recipient.customer_id]
                ).catch(() => {});
            }

            await db.query(
                `UPDATE broadcast_jobs SET sent = sent + $1, failed = failed + $2 WHERE id = $3`,
                [result.success ? 1 : 0, result.success ? 0 : 1, job.id]
            );

            await this._checkBroadcastComplete(job.id);

        } catch (err) {
            console.error('[WA Worker] Broadcast error:', err.message);
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
            console.log(`[WA Worker] Broadcast job #${jobId} completed`);
        }
    }

    // ============================================
    // RECOVERY: Reset stuck messages on server restart
    // ============================================
    async _recoverStuck() {
        try {
            const { rowCount } = await db.query(
                `UPDATE whatsapp_logs SET
                    status = 'FAILED',
                    error_detail = 'Server restart — auto-recovery',
                    retry_count = LEAST(retry_count, max_retries - 1),
                    next_retry_at = NOW()
                 WHERE status IN ('PENDING', 'RETRYING')
                   AND created_at < NOW() - INTERVAL '5 minutes'`
            );

            if (rowCount > 0) {
                console.log(`[WA Worker] Auto-recovered ${rowCount} stuck message(s)`);
            }
        } catch (err) {
            console.error('[WA Worker] Recovery error:', err.message);
        }
    }

    async _recoverStaleBroadcast() {
        try {
            const { rowCount } = await db.query(
                `UPDATE broadcast_recipients SET status = 'pending'
                 WHERE status = 'sending'
                   AND sent_at IS NULL`
            );
            if (rowCount > 0) {
                console.log(`[WA Worker] Recovered ${rowCount} stale broadcast recipient(s)`);
            }
        } catch (err) {
            console.error('[WA Worker] Broadcast recovery error:', err.message);
        }
    }

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

            await db.query(
                `UPDATE whatsapp_logs SET
                    status = 'SENT', wa_message_id = $1, api_response = $2,
                    error_code = NULL, error_detail = NULL,
                    sent_at = NOW(), updated_at = NOW()
                 WHERE id = $3`,
                [waMessageId, JSON.stringify(response.data), logId]
            );

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

            const retryable = this._isRetryable(errorCode, httpStatus);

            if (retryable) {
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
                await this._markPermanentFail(logId, `[${errorCode}] ${errorDetail}`);
            }

            return { success: false, error: errorDetail, retryable };
        }
    }

    async _markPermanentFail(logId, errorDetail) {
        await db.query(
            `UPDATE whatsapp_logs SET
                status = 'FAILED', retry_count = max_retries,
                error_detail = $1, updated_at = NOW()
             WHERE id = $2`,
            [errorDetail, logId]
        ).catch(err => console.warn('[WA Worker] markPermanentFail error:', err.message));
    }

    _isRetryable(errorCode, httpStatus) {
        if (httpStatus === 429) return true;
        if (httpStatus >= 500) return true;
        if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND'].includes(errorCode)) return true;
        const retryableCodes = [130429, 131026, 131047, 131053];
        if (retryableCodes.includes(Number(errorCode))) return true;
        return false;
    }

    _randomDelay(min, max) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        return new Promise(resolve => setTimeout(resolve, delay));
    }

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
