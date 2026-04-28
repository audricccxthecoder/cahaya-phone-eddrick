// ============================================
// FORM CONTROLLER
// Handle customer form submissions
// ============================================

const db = require('../config/database');
const whatsappService = require('../config/whatsapp');
const googleService = require('../config/google');
const { sanitizePhone, validatePhone } = require('../utils/phoneUtils');

/**
 * Submit customer form
 * POST /api/form-submit
 */
exports.submitForm = async (req, res) => {
    try {
        const {
            nama, nama_lengkap, email, whatsapp, alamat, kota,
            nama_sales, merk_unit, tipe_unit, harga, qty,
            tanggal_lahir, metode_pembayaran, tahu_dari, opted_in
        } = req.body;

        const finalName = nama || nama_lengkap;

        if (!finalName || !whatsapp) {
            return res.status(400).json({
                success: false,
                message: 'Nama dan No. WhatsApp wajib diisi'
            });
        }

        // Sanitize & validate phone number (backend validation)
        const cleanPhone = sanitizePhone(whatsapp);
        const phoneCheck = validatePhone(cleanPhone);
        if (!phoneCheck.valid) {
            return res.status(400).json({ success: false, message: phoneCheck.message });
        }

        const extra = [];
        if (kota) extra.push(`Kota: ${kota}`);
        if (email) extra.push(`Email: ${email}`);
        const fullAddress = [alamat, extra.join(' | ')].filter(Boolean).join(' | ');

        const parsedHarga = harga ? parseFloat(harga) : null;
        const parsedQty = qty ? parseInt(qty, 10) : 1;

        let source = 'Website';
        if (tahu_dari) {
            const td = String(tahu_dari).trim();
            const tdLower = td.toLowerCase();

            const mappings = [
                { pattern: /\b(ig|insta|instagram|instgram)\b/i, name: 'Instagram' },
                { pattern: /\b(web|website|site|google)\b/i, name: 'Website' },
                { pattern: /\b(fb|facebook|facebk|fesbuk)\b/i, name: 'Facebook' },
                { pattern: /\b(tt|tiktok|tik tok|tik-tok)\b/i, name: 'TikTok' },
                { pattern: /\b(wa|whatsapp|grup|group)\b/i, name: 'WhatsApp' },
                { pattern: /\b(yt|youtube|yutub)\b/i, name: 'YouTube' },
                { pattern: /\b(tw|twitter|x\.com)\b/i, name: 'Twitter/X' },
                { pattern: /\b(shopee|tokped|tokopedia|lazada|marketplace|olshop)\b/i, name: 'Marketplace' },
                { pattern: /\b(teman|temen|tmn|sodara|saudara|keluarga|klrga|kenal|tetangga|ortu|nyokap|bokap|kakak|adik|om|tante)\b/i, name: 'Teman/Keluarga' },
                { pattern: /\b(lewat|jalan|lalu|numpang|mampir|depan|toko|banner|spanduk|papan)\b/i, name: 'Walk-in' }
            ];

            const found = mappings.find(m => m.pattern.test(tdLower));
            if (found) {
                source = found.name;
            } else if (td.trim() === '') {
                source = 'Website';
            } else {
                source = td.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            }
        }

        console.log(`🧭 Determined source from tahu_dari='${tahu_dari}' -> source='${source}'`);

        // opted_in defaults to true if not explicitly set to false
        const optedIn = opted_in !== false;

        // Check if this phone already exists (Chat Only OR repeat buyer)
        const { rows: existingCustomer } = await db.query(
            `SELECT id FROM customers WHERE whatsapp = $1 ORDER BY created_at DESC LIMIT 1`,
            [cleanPhone]
        );

        let rows;
        if (existingCustomer.length > 0) {
            // Update existing record (Chat Only → Belanja, or repeat buyer update)
            const result = await db.query(
                `UPDATE customers SET
                    nama_lengkap = $1, nama_sales = $2, merk_unit = $3, tipe_unit = $4,
                    harga = $5, qty = $6, tanggal_lahir = $7, alamat = $8,
                    metode_pembayaran = $9, tahu_dari = $10, source = $11,
                    status = 'Completed', opted_in = $12, tipe = 'Belanja', updated_at = NOW()
                WHERE id = $13 RETURNING id`,
                [
                    finalName, nama_sales || null, merk_unit || null, tipe_unit || null,
                    parsedHarga, parsedQty, tanggal_lahir || null, fullAddress,
                    metode_pembayaran || null, tahu_dari || null, source,
                    optedIn, existingCustomer[0].id
                ]
            );
            rows = result.rows;
        } else {
            // New customer
            const result = await db.query(
                `INSERT INTO customers (
                    nama_lengkap, nama_sales, merk_unit, tipe_unit, harga, qty,
                    tanggal_lahir, alamat, whatsapp, metode_pembayaran, tahu_dari, source, status, opted_in, tipe
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Completed', $13, 'Belanja')
                ON CONFLICT (whatsapp) DO UPDATE SET
                    nama_lengkap = EXCLUDED.nama_lengkap, nama_sales = EXCLUDED.nama_sales,
                    merk_unit = EXCLUDED.merk_unit, tipe_unit = EXCLUDED.tipe_unit,
                    harga = EXCLUDED.harga, qty = EXCLUDED.qty,
                    tanggal_lahir = EXCLUDED.tanggal_lahir, alamat = EXCLUDED.alamat,
                    metode_pembayaran = EXCLUDED.metode_pembayaran, tahu_dari = EXCLUDED.tahu_dari,
                    source = EXCLUDED.source, status = 'Completed', opted_in = EXCLUDED.opted_in,
                    tipe = 'Belanja', updated_at = NOW()
                RETURNING id`,
                [
                    finalName, nama_sales || null, merk_unit || null, tipe_unit || null,
                    parsedHarga, parsedQty, tanggal_lahir || null, fullAddress,
                    cleanPhone, metode_pembayaran || null, tahu_dari || null, source, optedIn
                ]
            );
            rows = result.rows;
        }

        const customerId = rows[0].id;

        // Record purchase in purchases history table
        if (parsedHarga || merk_unit || tipe_unit) {
            await db.query(
                `INSERT INTO purchases (customer_id, merk_unit, tipe_unit, harga, qty, nama_sales, metode_pembayaran, source)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [customerId, merk_unit || null, tipe_unit || null, parsedHarga, parsedQty, nama_sales || null, metode_pembayaran || null, source]
            );
        }

        await db.query(
            `INSERT INTO messages (customer_id, direction, message) VALUES ($1, 'out', $2)`,
            [customerId, `Terima kasih ${finalName}, data Anda telah kami terima. Tim kami akan menghubungi segera.`]
        );

        // Response langsung (cepat!) — WA dan Google jalan di background
        res.json({
            success: true,
            message: 'Pendaftaran berhasil. Terima kasih!',
            customer_id: customerId
        });

        // Background: kirim WA auto-reply (tidak blocking response)
        // Guard: cek toggle form_autoreply_enabled. Default ON kalau belum di-set.
        (async () => {
            try {
                const { rows: setting } = await db.query(
                    `SELECT value FROM app_settings WHERE key = 'form_autoreply_enabled'`
                );
                const autoReplyEnabled = setting.length === 0 || setting[0].value !== 'false';

                if (!autoReplyEnabled) {
                    console.log(`[Form] Auto-reply disabled via setting — skipped for customer #${customerId}`);
                    await db.query('UPDATE customers SET wa_sent = FALSE WHERE id = $1', [customerId]).catch(() => {});
                    return;
                }

                const waResult = await whatsappService.sendAutoReply({ nama_lengkap: finalName, whatsapp: cleanPhone });
                const waSent = waResult && waResult.success;
                await db.query('UPDATE customers SET wa_sent = $1, status = $2 WHERE id = $3',
                    [waSent, waSent ? 'Completed' : 'New', customerId]);
            } catch (waError) {
                console.warn('⚠️ WhatsApp auto-reply failed:', waError.message || waError);
                await db.query('UPDATE customers SET wa_sent = FALSE, status = $1 WHERE id = $2', ['New', customerId]).catch(() => {});
            }
        })();

        // Background: auto-save to Google Contacts (tidak blocking response)
        (async () => {
            try {
                await googleService.saveContact({
                    nama_lengkap: finalName,
                    whatsapp: cleanPhone,
                    alamat: fullAddress || null,
                    merk_unit: merk_unit || null,
                    tipe_unit: tipe_unit || null,
                    metode_pembayaran: metode_pembayaran || null,
                    source,
                    tipe: 'Belanja'
                });
            } catch (gcError) {
                console.warn('⚠️ Google Contact save failed:', gcError.message || gcError);
            }
        })();

    } catch (error) {
        console.error('❌ Form submit error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal memproses pendaftaran',
            error: error.message
        });
    }
};
