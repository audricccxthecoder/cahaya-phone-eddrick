// ============================================
// WHATSAPP SERVICE — Meta Cloud API (Official)
//
// Semua pengiriman WA lewat Cloud API resmi Meta.
// Mendukung Template Message + Text Message.
// Semua log disimpan ke database (survive restart).
// Retry otomatis via wa-worker.js (exponential backoff).
//
// PENTING Cloud API:
// - Inisiasi percakapan (broadcast, auto-reply, birthday) → HARUS pakai Template
// - Reply ke customer (dalam 24 jam window) → boleh pakai Text
// ============================================

const axios = require('axios');
const db = require('./database');
const { sanitizePhone } = require('../utils/phoneUtils');
require('dotenv').config();

// Cloud API base URL
const GRAPH_API_VERSION = 'v21.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

class WhatsAppService {
    constructor() {
        // Meta Cloud API config (dari .env)
        this.phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
        this.accessToken = process.env.WA_ACCESS_TOKEN;
        this.businessAccountId = process.env.WA_BUSINESS_ACCOUNT_ID;

        // Anti-bot delays (tetap ada untuk broadcast, meskipun Cloud API official)
        this.singleDelay = { min: 500, max: 1500 };
        this.broadcastDelay = { min: 3000, max: 8000 };

        // Daily limit (soft warning — Cloud API punya limit sendiri dari Meta)
        this.dailyLimit = 250;

        // Default template names (bisa diubah dari app_settings)
        this.templates = {
            autoReply: process.env.WA_TEMPLATE_AUTO_REPLY || 'terima_kasih_belanja',
            birthday: process.env.WA_TEMPLATE_BIRTHDAY || 'ucapan_ulang_tahun',
            broadcast: process.env.WA_TEMPLATE_BROADCAST || 'promo_info'
        };
    }

    // ============================================
    // PUBLIC: Send Template Message (untuk inisiasi percakapan)
    // Ini yang dipakai untuk broadcast, auto-reply, birthday
    // ============================================
    async sendTemplate(phone, templateName, language, components) {
        const formattedNumber = sanitizePhone(phone);
        if (!formattedNumber || !formattedNumber.startsWith('62')) {
            return { success: false, error: 'Invalid phone number', phone };
        }

        // Insert ke DB sebagai PENDING (worker akan pickup atau langsung kirim)
        const logId = await this._insertLog({
            phone: formattedNumber,
            type: 'template',
            template_name: templateName,
            template_language: language || 'id',
            template_components: components || [],
            message_body: `[TEMPLATE] ${templateName}`,
            priority: 'normal'
        });

        // Kirim langsung (tidak nunggu worker — lebih responsif)
        const result = await this._callCloudAPI(formattedNumber, {
            messaging_product: 'whatsapp',
            to: formattedNumber,
            type: 'template',
            template: {
                name: templateName,
                language: { code: language || 'id' },
                components: components || []
            }
        }, logId);

        return result;
    }

    // ============================================
    // PUBLIC: Send Text Message (untuk reply dalam 24h window)
    // ============================================
    async sendText(phone, message) {
        const formattedNumber = sanitizePhone(phone);
        if (!formattedNumber || !formattedNumber.startsWith('62')) {
            return { success: false, error: 'Invalid phone number', phone };
        }

        const logId = await this._insertLog({
            phone: formattedNumber,
            type: 'text',
            message_body: message,
            priority: 'normal'
        });

        const result = await this._callCloudAPI(formattedNumber, {
            messaging_product: 'whatsapp',
            to: formattedNumber,
            type: 'text',
            text: { body: message }
        }, logId);

        return result;
    }

    // ============================================
    // PUBLIC: Backward-compatible sendMessage
    // Coba text dulu (24h window), kalau gagal → sudahi
    // Untuk inisiasi percakapan, pakai sendTemplate langsung
    // ============================================
    async sendMessage(phone, message) {
        return this.sendText(phone, message);
    }

    // ============================================
    // PUBLIC: Send Broadcast (template, dengan delay)
    // ============================================
    async sendBroadcastMessage(phone, templateName, language, components) {
        const formattedNumber = sanitizePhone(phone);
        if (!formattedNumber || !formattedNumber.startsWith('62')) {
            return { success: false, error: 'Invalid phone number', phone };
        }

        // Anti-bot delay sebelum kirim
        await this._randomDelay(this.broadcastDelay.min, this.broadcastDelay.max);

        return this.sendTemplate(formattedNumber, templateName, language, components);
    }

    // ============================================
    // PUBLIC: Auto-reply setelah form submit (pakai template)
    // ============================================
    async sendAutoReply(customer) {
        const templateName = this.templates.autoReply;
        const components = [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: customer.nama_lengkap || 'Kak' }
                ]
            }
        ];

        return this.sendTemplate(customer.whatsapp, templateName, 'id', components);
    }

    // ============================================
    // PUBLIC: Birthday greeting (pakai template)
    // ============================================
    async sendBirthdayGreeting(customer, customMessage) {
        const templateName = this.templates.birthday;
        const components = [
            {
                type: 'body',
                parameters: [
                    { type: 'text', text: customer.nama_lengkap || 'Kak' }
                ]
            }
        ];

        return this.sendTemplate(customer.whatsapp, templateName, 'id', components);
    }

    // ============================================
    // PUBLIC: Check if API is configured
    // ============================================
    isConfigured() {
        return !!(this.phoneNumberId && this.accessToken);
    }

    // ============================================
    // PUBLIC: Get status (untuk admin dashboard)
    // ============================================
    async getStatus() {
        const stats = await this.getDailyStats();
        const configured = this.isConfigured();

        return {
            success: true,
            status: configured ? 'connected' : 'not_configured',
            mode: 'cloud_api',
            info: configured ? {
                provider: 'WhatsApp Cloud API (Meta)',
                phoneNumberId: this.phoneNumberId,
                apiConfigured: true
            } : null,
            messagesSentToday: stats.sent_count,
            dailyLimit: this.dailyLimit,
            lastError: configured ? null : 'WA_PHONE_NUMBER_ID dan WA_ACCESS_TOKEN belum dikonfigurasi'
        };
    }

    // ============================================
    // PUBLIC: Get daily stats from DB
    // ============================================
    async getDailyStats() {
        try {
            const { rows } = await db.query(
                `SELECT sent_count, failed_count FROM wa_daily_stats
                 WHERE stat_date = (CURRENT_DATE AT TIME ZONE 'Asia/Makassar')::date
                 LIMIT 1`
            );
            return rows.length > 0 ? rows[0] : { sent_count: 0, failed_count: 0 };
        } catch (err) {
            console.warn('[WA] getDailyStats error:', err.message);
            return { sent_count: 0, failed_count: 0 };
        }
    }

    // ============================================
    // PUBLIC: Get stats summary
    // ============================================
    async getStats() {
        const stats = await this.getDailyStats();
        return {
            success: true,
            sentToday: stats.sent_count,
            failedToday: stats.failed_count,
            dailyLimit: this.dailyLimit,
            remaining: Math.max(0, this.dailyLimit - stats.sent_count)
        };
    }

    // ============================================
    // PUBLIC: Check number registered (Cloud API — via contact check)
    // ============================================
    async isNumberRegistered(phoneNumber) {
        const formattedNumber = sanitizePhone(phoneNumber);
        if (!formattedNumber || !formattedNumber.startsWith('62')) {
            return { registered: false, error: 'Nomor tidak valid' };
        }

        // Cloud API tidak punya endpoint cek nomor terdaftar secara langsung
        // Kita anggap valid — kalau gagal kirim nanti API akan kasih error
        return { registered: true, unchecked: true };
    }

    // ============================================
    // PUBLIC: Update daily limit (persist di app_settings)
    // ============================================
    async setDailyLimit(limit) {
        if (limit && Number.isInteger(limit) && limit > 0) {
            this.dailyLimit = limit;
            await db.query(
                `INSERT INTO app_settings (key, value) VALUES ('wa_daily_limit', $1)
                 ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
                [String(limit)]
            ).catch(err => console.warn('[WA] Save daily limit failed:', err.message));
        }
        const stats = await this.getDailyStats();
        return { success: true, dailyLimit: this.dailyLimit, sentToday: stats.sent_count };
    }

    // ============================================
    // PUBLIC: Load settings dari DB (dipanggil saat startup)
    // ============================================
    async loadSettings() {
        try {
            const { rows } = await db.query(
                `SELECT key, value FROM app_settings WHERE key IN ('wa_daily_limit', 'wa_template_auto_reply', 'wa_template_birthday', 'wa_template_broadcast')`
            );
            for (const row of rows) {
                if (row.key === 'wa_daily_limit') {
                    const val = parseInt(row.value);
                    if (val > 0) this.dailyLimit = val;
                }
                if (row.key === 'wa_template_auto_reply') this.templates.autoReply = row.value;
                if (row.key === 'wa_template_birthday') this.templates.birthday = row.value;
                if (row.key === 'wa_template_broadcast') this.templates.broadcast = row.value;
            }
            console.log(`[WA] Settings loaded: dailyLimit=${this.dailyLimit}, templates=${JSON.stringify(this.templates)}`);
        } catch (err) {
            console.warn('[WA] loadSettings error:', err.message);
        }
    }

    // ============================================
    // PUBLIC: Update webhook status (dipanggil dari webhookController)
    // ============================================
    async updateMessageStatus(waMessageId, status, timestamp) {
        try {
            const statusMap = {
                sent: { col: 'sent_at', status: 'SENT' },
                delivered: { col: 'delivered_at', status: 'DELIVERED' },
                read: { col: 'read_at', status: 'READ' },
                failed: { col: null, status: 'FAILED' }
            };

            const mapping = statusMap[status];
            if (!mapping) return;

            const ts = timestamp ? new Date(timestamp * 1000) : new Date();

            if (mapping.col) {
                await db.query(
                    `UPDATE whatsapp_logs SET status = $1, ${mapping.col} = $2, updated_at = NOW()
                     WHERE wa_message_id = $3 AND status != 'FAILED'`,
                    [mapping.status, ts, waMessageId]
                );
            } else {
                await db.query(
                    `UPDATE whatsapp_logs SET status = $1, updated_at = NOW()
                     WHERE wa_message_id = $2`,
                    [mapping.status, waMessageId]
                );
            }
        } catch (err) {
            console.warn('[WA] updateMessageStatus error:', err.message);
        }
    }

    // ============================================
    // INTERNAL: Insert log ke database
    // ============================================
    async _insertLog({ phone, type, template_name, template_language, template_components, message_body, priority }) {
        try {
            const { rows } = await db.query(
                `INSERT INTO whatsapp_logs (phone, type, template_name, template_language, template_components, message_body, priority, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
                 RETURNING id`,
                [phone, type, template_name || null, template_language || 'id',
                 JSON.stringify(template_components || []), message_body || null, priority || 'normal']
            );
            return rows[0].id;
        } catch (err) {
            console.error('[WA] Insert log failed:', err.message);
            return null;
        }
    }

    // ============================================
    // INTERNAL: Call WhatsApp Cloud API
    // ============================================
    async _callCloudAPI(phone, payload, logId) {
        if (!this.isConfigured()) {
            const error = 'WA Cloud API belum dikonfigurasi (WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN)';
            await this._updateLog(logId, 'FAILED', null, null, error);
            return { success: false, phone, error };
        }

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

            await this._updateLog(logId, 'SENT', waMessageId, response.data, null);
            await this._incrementDailyCounter('sent');

            console.log(`[WA SENT] ${phone} (wa_id: ${waMessageId})`);
            return { success: true, phone, wa_message_id: waMessageId, data: response.data };

        } catch (error) {
            const errData = error.response?.data?.error;
            const errorCode = errData?.code || error.code || 'UNKNOWN';
            const errorDetail = errData?.message || errData?.error_data?.details || error.message;

            // Tentukan apakah bisa di-retry
            const retryable = this._isRetryable(errorCode, error.response?.status);

            await this._updateLogFailed(logId, errorCode, errorDetail, error.response?.data, retryable);
            await this._incrementDailyCounter('failed');

            console.error(`[WA FAIL] ${phone}: [${errorCode}] ${errorDetail}`);
            return { success: false, phone, error: errorDetail, error_code: errorCode, retryable };
        }
    }

    // ============================================
    // INTERNAL: Update log status
    // ============================================
    async _updateLog(logId, status, waMessageId, apiResponse, error) {
        if (!logId) return;
        try {
            await db.query(
                `UPDATE whatsapp_logs SET status = $1, wa_message_id = $2, api_response = $3,
                 error_detail = $4, sent_at = CASE WHEN $1 = 'SENT' THEN NOW() ELSE sent_at END,
                 updated_at = NOW()
                 WHERE id = $5`,
                [status, waMessageId, apiResponse ? JSON.stringify(apiResponse) : null, error, logId]
            );
        } catch (err) {
            console.warn('[WA] Update log failed:', err.message);
        }
    }

    // ============================================
    // INTERNAL: Update log as FAILED with retry info
    // ============================================
    async _updateLogFailed(logId, errorCode, errorDetail, apiResponse, retryable) {
        if (!logId) return;
        try {
            if (retryable) {
                // Exponential backoff: 30s, 2m, 10m
                await db.query(
                    `UPDATE whatsapp_logs SET
                        status = 'FAILED',
                        error_code = $1,
                        error_detail = $2,
                        api_response = $3,
                        retry_count = retry_count + 1,
                        next_retry_at = NOW() + (POWER(5, retry_count + 1) || ' seconds')::interval,
                        updated_at = NOW()
                     WHERE id = $4`,
                    [errorCode, errorDetail, apiResponse ? JSON.stringify(apiResponse) : null, logId]
                );
            } else {
                // Tidak bisa retry — tandai permanent fail
                await db.query(
                    `UPDATE whatsapp_logs SET
                        status = 'FAILED',
                        error_code = $1,
                        error_detail = $2,
                        api_response = $3,
                        retry_count = max_retries,
                        updated_at = NOW()
                     WHERE id = $4`,
                    [errorCode, errorDetail, apiResponse ? JSON.stringify(apiResponse) : null, logId]
                );
            }
        } catch (err) {
            console.warn('[WA] Update log failed:', err.message);
        }
    }

    // ============================================
    // INTERNAL: Check if error is retryable
    // ============================================
    _isRetryable(errorCode, httpStatus) {
        // Rate limit → retry
        if (httpStatus === 429) return true;
        if (errorCode === 130429) return true; // Rate limit hit

        // Server error → retry
        if (httpStatus >= 500) return true;

        // Network error → retry
        if (['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND'].includes(errorCode)) return true;

        // Cloud API specific retryable errors
        const retryableCodes = [
            131026, // Message undeliverable (temporary)
            131047, // Re-engagement message limit
            131053, // Media upload error
        ];
        if (retryableCodes.includes(Number(errorCode))) return true;

        // Non-retryable: invalid number, template not found, parameter mismatch, etc.
        return false;
    }

    // ============================================
    // INTERNAL: Increment daily counter di DB
    // ============================================
    async _incrementDailyCounter(type) {
        try {
            const column = type === 'sent' ? 'sent_count' : 'failed_count';
            await db.query(
                `INSERT INTO wa_daily_stats (stat_date, ${column})
                 VALUES ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Makassar')::date, 1)
                 ON CONFLICT (stat_date) DO UPDATE SET ${column} = wa_daily_stats.${column} + 1, updated_at = NOW()`
            );
        } catch (err) {
            console.warn('[WA] Increment daily counter failed:', err.message);
        }
    }

    // ============================================
    // INTERNAL: Random delay (anti-bot)
    // ============================================
    _randomDelay(min, max) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        return new Promise(resolve => setTimeout(resolve, delay));
    }
}

module.exports = new WhatsAppService();
