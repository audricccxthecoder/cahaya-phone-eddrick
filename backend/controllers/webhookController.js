// ============================================
// WEBHOOK CONTROLLER
// Handle incoming WhatsApp messages
//
// ATURAN EMAS:
// - Chat manual (Skenario B): HANYA save DB + Google Contact
//   Format: "Customer - DD/MM/YYYY". TIDAK kirim auto-reply.
// - Auto-reply HANYA dari formController (Skenario A).
//
// ATURAN CUSTOMER:
// - 1 nomor HP = 1 record customer (tidak boleh duplikat)
// - Chat masuk dari nomor yang sudah ada → update, BUKAN insert baru
// - Chat Only → saat submit form → pindah ke Belanja
// - Sudah pernah Belanja → chat lagi → TIDAK bikin record baru
// ============================================

const db = require('../config/database');
const googleService = require('../config/google');
const { sanitizePhone, validatePhone } = require('../utils/phoneUtils');

/**
 * Handle incoming message dari WA Client (event internal, bukan HTTP)
 * Dipanggil langsung dari server.js saat WA Client emit 'message_received'
 */
exports.handleIncomingMessage = async (data) => {
    try {
        const { sender: phoneNumber, message, pushname: senderName, wa_message_id: waMessageId } = data;

        // PENTING: pakai sanitizePhone supaya format konsisten (628xxx)
        const cleanPhone = sanitizePhone(phoneNumber.replace(/\D/g, ''));

        // Validasi ketat: harus nomor Indonesia valid (62xxx, 11-15 digit)
        // Ini juga memfilter nomor WA internal (contoh: 188394495865076)
        const phoneCheck = validatePhone(cleanPhone);
        if (!phoneCheck.valid) {
            console.log(`[WEBHOOK] Invalid phone number: ${phoneNumber} -> ${cleanPhone} (${phoneCheck.message}), skipped`);
            return { success: false, error: 'Invalid phone number' };
        }

        console.log(`[WEBHOOK] Processing: ${senderName} (${cleanPhone}): ${message.substring(0, 50)}...`);

        // Opt-out: jika customer balas "STOP" / "BERHENTI", set opted_in = false
        const optOutKeywords = ['stop', 'berhenti', 'unsubscribe', 'keluar'];
        const lowerMsg = message.trim().toLowerCase();
        if (optOutKeywords.includes(lowerMsg)) {
            await db.query(
                `UPDATE customers SET opted_in = FALSE, updated_at = NOW() WHERE whatsapp = $1`,
                [cleanPhone]
            );
            console.log(`[WEBHOOK] Customer ${cleanPhone} opted out (keyword: "${lowerMsg}")`);
        }

        // Opt-in: jika customer balas "MULAI" / "START", set opted_in = true
        const optInKeywords = ['start', 'mulai', 'subscribe', 'daftar'];
        if (optInKeywords.includes(lowerMsg)) {
            await db.query(
                `UPDATE customers SET opted_in = TRUE, updated_at = NOW() WHERE whatsapp = $1`,
                [cleanPhone]
            );
            console.log(`[WEBHOOK] Customer ${cleanPhone} opted back in (keyword: "${lowerMsg}")`);
        }

        // Cari customer berdasarkan nomor HP (1 nomor = 1 customer)
        const { rows: existing } = await db.query(
            'SELECT id, nama_lengkap, status, tipe FROM customers WHERE whatsapp = $1 ORDER BY created_at DESC LIMIT 1',
            [cleanPhone]
        );

        let customerId;
        let customerStatus;

        if (existing.length > 0) {
            customerId = existing[0].id;
            const currentStatus = existing[0].status;

            if (['New', 'Inactive', 'Follow Up'].includes(currentStatus)) {
                await db.query(
                    'UPDATE customers SET status = $1, last_incoming_message_at = NOW() WHERE id = $2',
                    ['Contacted', customerId]
                );
                customerStatus = 'Contacted';
            } else {
                await db.query(
                    'UPDATE customers SET last_incoming_message_at = NOW() WHERE id = $1',
                    [customerId]
                );
                customerStatus = currentStatus;
            }

            console.log(`[WEBHOOK] Existing customer: ${customerId} (${existing[0].tipe}) — ${currentStatus} -> ${customerStatus}`);

            // Nama Chat Only tetap "Customer - tanggal", tidak di-update dari pushname
            // Nama Belanja dari form, juga tidak di-timpa
        } else {
            // ============================================
            // SKENARIO B: Customer BARU chat manual
            // Save ke DB + Google Contact ("Customer - Tanggal")
            // TIDAK kirim auto-reply — biarkan WA Business bawaan
            // ============================================
            let source = 'Unknown';
            const lowerMessage = message.toLowerCase();

            if (lowerMessage.includes('instagram') || lowerMessage.includes('ig')) {
                source = 'Instagram';
            } else if (lowerMessage.includes('facebook') || lowerMessage.includes('fb')) {
                source = 'Facebook';
            } else if (lowerMessage.includes('tiktok')) {
                source = 'TikTok';
            }

            // Format nama SELALU: "Customer - DD/MM/YYYY"
            // Tidak pakai pushname — pushname bisa asal-asalan / beda orang sama nomor
            const now = new Date();
            const tanggal = now.toLocaleDateString('id-ID', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                timeZone: 'Asia/Makassar'
            });
            const customerName = `Customer - ${tanggal}`;

            const { rows: inserted } = await db.query(
                `INSERT INTO customers (nama_lengkap, whatsapp, source, status, tipe, last_incoming_message_at)
                VALUES ($1, $2, $3, 'New', 'Chat Only', NOW())
                ON CONFLICT (whatsapp) DO UPDATE SET updated_at = CURRENT_TIMESTAMP, last_incoming_message_at = NOW()
                RETURNING id, status`,
                [customerName, cleanPhone, source]
            );

            customerId = inserted[0].id;
            customerStatus = inserted[0].status || 'New';

            console.log(`[WEBHOOK] New customer (Chat Only): ${customerId} — ${customerName} — NO auto-reply`);

            // Auto-save ke Google Contacts (format: "Customer - DD/MM/YYYY")
            try {
                await googleService.saveContact({
                    nama_lengkap: customerName,
                    whatsapp: cleanPhone,
                    source,
                    tipe: 'Chat Only'
                });
            } catch (gcErr) {
                console.warn('[WEBHOOK] Google Contact save failed:', gcErr.message);
            }

            // BERHENTI DI SINI. TIDAK kirim auto-reply.
            // WA Business bawaan yang handle reply.
        }

        // Simpan pesan ke database (dengan wa_message_id untuk idempotency)
        await db.query(
            'INSERT INTO messages (customer_id, direction, message, wa_message_id) VALUES ($1, $2, $3, $4)',
            [customerId, 'in', message, waMessageId || null]
        );

        console.log(`[WEBHOOK] Message saved for customer: ${customerId}`);
        return { success: true, customer_id: customerId, status: customerStatus };

    } catch (error) {
        console.error('[WEBHOOK] Error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * HTTP Webhook endpoint (untuk Fonnte / external WA API fallback)
 * POST /api/webhook/whatsapp
 */
exports.handleWhatsAppWebhook = async (req, res) => {
    try {
        console.log('[WEBHOOK HTTP] Received:', JSON.stringify(req.body, null, 2));

        let data;

        // Format WA Bridge / internal
        if (req.body.source === 'wa-bridge') {
            data = {
                sender: req.body.sender,
                message: req.body.message,
                pushname: req.body.pushname || ''
            };
        }
        // Format Fonnte
        else if (req.body.sender) {
            data = {
                sender: req.body.sender,
                message: req.body.message,
                pushname: req.body.member?.name || ''
            };
        }
        // Format Wablas
        else if (req.body.phone) {
            data = {
                sender: req.body.phone,
                message: req.body.message,
                pushname: req.body.pushname || ''
            };
        }
        else {
            return res.status(400).json({ success: false, message: 'Invalid webhook payload' });
        }

        const result = await exports.handleIncomingMessage(data);
        res.json(result);

    } catch (error) {
        console.error('[WEBHOOK HTTP] Error:', error);
        res.json({ success: false, message: 'Error processing webhook', error: error.message });
    }
};

/**
 * Test webhook endpoint
 * GET /api/webhook/test
 */
exports.testWebhook = (req, res) => {
    res.json({
        success: true,
        message: 'Webhook endpoint is working',
        timestamp: new Date().toISOString()
    });
};
