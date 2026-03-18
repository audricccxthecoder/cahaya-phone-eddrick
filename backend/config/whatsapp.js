// ============================================
// WHATSAPP SERVICE
// Stateless — broadcast state lives in DB
// ============================================

const axios = require('axios');
const { sanitizePhone } = require('../utils/phoneUtils');
require('dotenv').config();

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class WhatsAppService {
    constructor() {
        this.apiUrl = process.env.WHATSAPP_API_URL;
        this.apiKey = process.env.WHATSAPP_API_KEY;
        // Simple rate limiter: track last send time
        this._lastSent = 0;
        this._minInterval = 1000; // min 1 second between any messages
    }

    /**
     * Send a single WhatsApp message
     * @param {string} phoneNumber - Raw or normalized phone number
     * @param {string} message
     */
    async sendMessage(phoneNumber, message) {
        try {
            const formattedNumber = sanitizePhone(phoneNumber);

            if (!formattedNumber || !formattedNumber.startsWith('62')) {
                return { success: false, error: 'Invalid phone number', phone: phoneNumber };
            }

            // Simple rate limiting: wait if last send was too recent
            const now = Date.now();
            const elapsed = now - this._lastSent;
            if (elapsed < this._minInterval) {
                await _sleep(this._minInterval - elapsed);
            }
            this._lastSent = Date.now();

            console.log(`📤 Sending WhatsApp to: ${formattedNumber}`);

            if (!this.apiUrl || !this.apiKey) {
                console.warn('⚠️ WhatsApp API not configured (WHATSAPP_API_URL / WHATSAPP_API_KEY missing)');
                return { success: false, error: 'WhatsApp API not configured', phone: formattedNumber };
            }

            const response = await axios.post(this.apiUrl, {
                target: formattedNumber,
                message: message,
                countryCode: '62'
            }, {
                headers: {
                    'Authorization': this.apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            console.log(`✅ WhatsApp sent to ${formattedNumber}`);
            return { success: true, phone: formattedNumber, data: response.data };

        } catch (error) {
            console.error(`❌ WhatsApp send failed to ${phoneNumber}:`, error.message);
            return {
                success: false,
                phone: phoneNumber,
                error: error.message,
                details: error.response?.data
            };
        }
    }

    /**
     * Auto-reply after customer submits form
     */
    async sendAutoReply(customer) {
        const message = `Halo ${customer.nama_lengkap}, terima kasih sudah mengunjungi toko kami! ` +
            `Kami akan mengirimkan promo dan ucapan spesial untuk Anda. ` +
            `Tim kami akan segera menghubungi Anda.`;
        return await this.sendMessage(customer.whatsapp, message);
    }

    /**
     * Welcome message for WhatsApp webhook (customer dari Instagram/sosmed)
     */
    async sendWelcomeMessage(phoneNumber, customerName = '') {
        const name = customerName || 'Kak';
        const message = `Halo ${name}, terima kasih sudah menghubungi Cahaya Phone! ` +
            `Tim kami akan segera membantu Anda.`;
        return await this.sendMessage(phoneNumber, message);
    }
}

module.exports = new WhatsAppService();
