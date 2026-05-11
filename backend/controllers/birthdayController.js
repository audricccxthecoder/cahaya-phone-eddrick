// ============================================
// BIRTHDAY GREETING CONTROLLER
// Kirim ucapan ulang tahun otomatis via WhatsApp
// ============================================

const db = require('../config/database');
const whatsappService = require('../config/whatsapp');

const DEFAULT_MESSAGE = `Halo Kak {nama}! 🎂🎉\n\nSelamat Ulang Tahun dari kami *CAHAYA PHONE* Gorontalo!\n\nSemoga panjang umur, sehat selalu, dan diberkahi rezeki yang melimpah. Terima kasih sudah menjadi pelanggan setia kami.\n\nSalam hangat,\nCahaya Phone 🙏`;

// Anti-ban pacing for birthday sends
const BIRTHDAY_DELAY_MIN_MS = 165_000;   // ~3 min ± 15s per message
const BIRTHDAY_DELAY_MAX_MS = 195_000;
const BIRTHDAY_BREAK_EVERY = 20;          // break after every 20 messages
const BIRTHDAY_BREAK_MIN_MS = 10 * 60_000; // 10 min
const BIRTHDAY_BREAK_MAX_MS = 15 * 60_000; // 15 min
const WORK_START_HOUR = 8;                // WITA
const WORK_END_HOUR = 22;                 // WITA

function isWorkingHoursWITA() {
    const nowUtc = new Date();
    const witaHours = (nowUtc.getUTCHours() + 8) % 24;
    return witaHours >= WORK_START_HOUR && witaHours < WORK_END_HOUR;
}

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Calculate age in years from tanggal_lahir.
// Birthday cron only fires on the actual birthday so this is just (currentYear - birthYear),
// but we still adjust for month/day in case the function is called off-day (manual trigger).
function calculateAge(birthDate) {
    if (!birthDate) return null;
    const today = new Date();
    const birth = new Date(birthDate);
    if (isNaN(birth.getTime())) return null;
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age >= 0 ? age : null;
}

/**
 * Get customers yang ulang tahun hari ini
 */
async function getBirthdayToday() {
    const result = await db.query(`
        SELECT c.id, c.nama_lengkap, c.whatsapp, c.tanggal_lahir, c.merk_unit, c.tipe_unit,
               bg.id as greeting_id, bg.status as greeting_status, bg.sent_at, bg.error as greeting_error
        FROM customers c
        LEFT JOIN birthday_greetings bg
            ON bg.customer_id = c.id AND bg.greeting_year = EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar'))
        WHERE c.tanggal_lahir IS NOT NULL
          AND EXTRACT(MONTH FROM c.tanggal_lahir) = EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Makassar'))
          AND EXTRACT(DAY FROM c.tanggal_lahir) = EXTRACT(DAY FROM (NOW() AT TIME ZONE 'Asia/Makassar'))
          AND c.opted_in IS NOT FALSE
        ORDER BY c.nama_lengkap
    `);
    return result.rows;
}

/**
 * API: Get daftar ulang tahun hari ini + status pengiriman
 */
exports.getTodayBirthdays = async (req, res) => {
    try {
        const customers = await getBirthdayToday();

        // Get custom message dari settings
        const msgResult = await db.query(
            `SELECT value FROM app_settings WHERE key = 'birthday_message'`
        );
        const customMessage = msgResult.rows.length > 0 ? msgResult.rows[0].value : DEFAULT_MESSAGE;

        // Get auto-send setting
        const autoResult = await db.query(
            `SELECT value FROM app_settings WHERE key = 'birthday_auto_send'`
        );
        const autoSend = autoResult.rows.length > 0 ? autoResult.rows[0].value === 'true' : true;

        res.json({
            success: true,
            data: {
                customers,
                message: customMessage,
                autoSend,
                today: new Date().toISOString().split('T')[0]
            }
        });
    } catch (err) {
        console.error('[Birthday] Error getting today birthdays:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Kirim ucapan ke 1 customer (manual trigger dari admin)
 */
exports.sendGreeting = async (req, res) => {
    try {
        const { customer_id } = req.body;
        if (!customer_id) return res.status(400).json({ success: false, message: 'customer_id required' });

        const result = await sendBirthdayMessage(customer_id);
        res.json(result);
    } catch (err) {
        console.error('[Birthday] Error sending greeting:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Kirim ucapan ke semua customer yang ulang tahun hari ini
 */
exports.sendAllGreetings = async (req, res) => {
    try {
        if (!isWorkingHoursWITA()) {
            return res.status(400).json({
                success: false,
                message: `Di luar jam operasional (${WORK_START_HOUR}:00–${WORK_END_HOUR}:00 WITA). Coba lagi di jam kerja.`
            });
        }

        const customers = await getBirthdayToday();
        const pending = customers.filter(c => !c.greeting_id || c.greeting_status === 'failed');

        if (pending.length === 0) {
            return res.json({ success: true, message: 'Tidak ada ucapan yang perlu dikirim', sent: 0 });
        }

        // Respond immediately so admin tab doesn't hang for hours on 50+ customers
        res.json({
            success: true,
            message: `Memproses ${pending.length} ucapan di background dengan delay ~3 menit/pesan + break 10–15 menit tiap ${BIRTHDAY_BREAK_EVERY} pesan. Pantau di Riwayat.`,
            queued: pending.length
        });

        // Background loop — runs until done or working hours close
        (async () => {
            let sent = 0, failed = 0, skipped = 0, sinceBreak = 0;
            for (const customer of pending) {
                if (!isWorkingHoursWITA()) {
                    console.log(`[Birthday] ⏸ Stopped at ${sent} sent — outside working hours`);
                    skipped = pending.length - sent - failed;
                    break;
                }

                const result = await sendBirthdayMessage(customer.id);
                if (result.success) {
                    sent++;
                    sinceBreak++;
                } else {
                    failed++;
                }

                // Break every N messages
                if (sinceBreak >= BIRTHDAY_BREAK_EVERY) {
                    const breakMs = randInt(BIRTHDAY_BREAK_MIN_MS, BIRTHDAY_BREAK_MAX_MS);
                    console.log(`[Birthday] ☕ Break ${Math.round(breakMs / 60_000)} min after ${sent} sent`);
                    await new Promise(r => setTimeout(r, breakMs));
                    sinceBreak = 0;
                    continue;
                }

                // Inter-message delay (2 min ± 10s)
                await new Promise(r => setTimeout(r, randInt(BIRTHDAY_DELAY_MIN_MS, BIRTHDAY_DELAY_MAX_MS)));
            }
            console.log(`[Birthday] Manual run done: ${sent} sent, ${failed} failed, ${skipped} skipped`);
        })().catch(err => console.error('[Birthday] Manual run crashed:', err.message));
    } catch (err) {
        console.error('[Birthday] Error sending all greetings:', err.message);
        if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Update pesan ucapan custom
 */
exports.updateMessage = async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, message: 'Pesan tidak boleh kosong' });
        }

        await db.query(`
            INSERT INTO app_settings (key, value) VALUES ('birthday_message', $1)
            ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
        `, [message.trim()]);

        res.json({ success: true, message: 'Pesan ucapan berhasil diupdate' });
    } catch (err) {
        console.error('[Birthday] Error updating message:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Toggle auto-send on/off
 */
exports.toggleAutoSend = async (req, res) => {
    try {
        const { enabled } = req.body;
        await db.query(`
            INSERT INTO app_settings (key, value) VALUES ('birthday_auto_send', $1)
            ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
        `, [String(!!enabled)]);

        res.json({ success: true, autoSend: !!enabled });
    } catch (err) {
        console.error('[Birthday] Error toggling auto-send:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Get riwayat ucapan yang sudah terkirim (untuk log)
 */
exports.getHistory = async (req, res) => {
    try {
        const result = await db.query(`
            SELECT bg.*, c.nama_lengkap, c.whatsapp, c.tanggal_lahir
            FROM birthday_greetings bg
            JOIN customers c ON c.id = bg.customer_id
            ORDER BY bg.sent_at DESC
            LIMIT 50
        `);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('[Birthday] Error getting history:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * Internal: Kirim pesan birthday ke 1 customer
 *
 * NOTE: Kolom sent_at disimpan sebagai TIMESTAMP UTC murni (pakai NOW()).
 * Frontend yang konversi ke WITA via toLocaleString({ timeZone: 'Asia/Makassar' }).
 * JANGAN pernah simpan string lokal WITA — akan kena double-shift saat dibaca.
 */
async function sendBirthdayMessage(customerId) {
    try {
        // Get customer data
        const custResult = await db.query(
            'SELECT id, nama_lengkap, whatsapp, tanggal_lahir FROM customers WHERE id = $1',
            [customerId]
        );
        if (custResult.rows.length === 0) {
            return { success: false, message: 'Customer tidak ditemukan' };
        }
        const customer = custResult.rows[0];

        // Cek apakah sudah dikirim tahun ini
        const year = new Date().getFullYear();
        const existing = await db.query(
            `SELECT id, status FROM birthday_greetings WHERE customer_id = $1 AND greeting_year = $2 AND status = 'sent'`,
            [customerId, year]
        );
        if (existing.rows.length > 0) {
            return { success: false, message: 'Ucapan sudah terkirim tahun ini' };
        }

        // Get custom message
        const msgResult = await db.query(
            `SELECT value FROM app_settings WHERE key = 'birthday_message'`
        );
        let message = msgResult.rows.length > 0 ? msgResult.rows[0].value : DEFAULT_MESSAGE;

        // Replace placeholders: {nama} = customer name, {umur} = age in years
        message = message.replace(/\{nama\}/g, customer.nama_lengkap);
        const umur = calculateAge(customer.tanggal_lahir);
        message = message.replace(/\{umur\}/g, umur !== null ? String(umur) : '');

        // Cek dulu apakah nomor terdaftar di WhatsApp
        const numberCheck = await whatsappService.isNumberRegistered(customer.whatsapp);
        if (!numberCheck.registered) {
            const errorMsg = numberCheck.error || `Nomor ${customer.whatsapp} tidak terdaftar di WhatsApp`;

            await db.query(`
                INSERT INTO birthday_greetings (customer_id, greeting_year, message, status, error)
                VALUES ($1, $2, $3, 'failed', $4)
                ON CONFLICT (customer_id, greeting_year) DO UPDATE
                SET status = 'failed', error = $4
            `, [customerId, year, message, errorMsg]);

            console.log(`[Birthday] ❌ ${customer.nama_lengkap}: ${errorMsg}`);
            return { success: false, message: errorMsg, error: errorMsg };
        }

        // Kirim via WA bridge (Baileys)
        const waResult = await whatsappService.sendBirthdayGreeting(customer, message);

        // Log ke database — sent_at pakai NOW() (UTC), frontend konversi ke WITA
        if (waResult.success) {
            await db.query(`
                INSERT INTO birthday_greetings (customer_id, greeting_year, message, status, sent_at)
                VALUES ($1, $2, $3, 'sent', NOW())
                ON CONFLICT (customer_id, greeting_year) DO UPDATE
                SET status = 'sent', message = $3, sent_at = NOW()
            `, [customerId, year, message]);

            await db.query(`
                INSERT INTO messages (customer_id, direction, message, sent_at)
                VALUES ($1, 'out', $2, NOW())
            `, [customerId, message]);

            console.log(`[Birthday] ✅ Sent to ${customer.nama_lengkap} (${customer.whatsapp})`);
        } else {
            await db.query(`
                INSERT INTO birthday_greetings (customer_id, greeting_year, message, status, error)
                VALUES ($1, $2, $3, 'failed', $4)
                ON CONFLICT (customer_id, greeting_year) DO UPDATE
                SET status = 'failed', error = $4
            `, [customerId, year, message, waResult.error || 'Unknown error']);

            console.log(`[Birthday] ❌ Failed for ${customer.nama_lengkap}: ${waResult.error}`);
        }

        return { success: waResult.success, customer: customer.nama_lengkap, error: waResult.error };
    } catch (err) {
        console.error('[Birthday] Send error:', err.message);
        return { success: false, message: err.message };
    }
}

/**
 * CRON: Dipanggil otomatis tiap pagi — cek & kirim birthday greetings
 */
exports.cronCheckBirthdays = async function() {
    console.log('[Birthday] 🎂 Cron check started...');
    try {
        // Cek apakah auto-send aktif
        const autoResult = await db.query(
            `SELECT value FROM app_settings WHERE key = 'birthday_auto_send'`
        );
        const autoSend = autoResult.rows.length === 0 || autoResult.rows[0].value !== 'false';

        if (!autoSend) {
            console.log('[Birthday] Auto-send disabled, skipping');
            return;
        }

        const customers = await getBirthdayToday();
        const pending = customers.filter(c => !c.greeting_id || c.greeting_status === 'failed');

        if (pending.length === 0) {
            console.log('[Birthday] No birthdays today or all already sent');
            return;
        }

        console.log(`[Birthday] Found ${pending.length} birthday(s) today!`);

        let sent = 0, failed = 0, sinceBreak = 0;
        for (const customer of pending) {
            if (!isWorkingHoursWITA()) {
                console.log(`[Birthday] ⏸ Cron stopped at ${sent} sent — outside working hours ${WORK_START_HOUR}-${WORK_END_HOUR} WITA`);
                break;
            }

            const result = await sendBirthdayMessage(customer.id);
            if (result.success) {
                sent++;
                sinceBreak++;
            } else {
                failed++;
            }

            // Break every N messages
            if (sinceBreak >= BIRTHDAY_BREAK_EVERY) {
                const breakMs = randInt(BIRTHDAY_BREAK_MIN_MS, BIRTHDAY_BREAK_MAX_MS);
                console.log(`[Birthday] ☕ Cron break ${Math.round(breakMs / 60_000)} min after ${sent} sent`);
                await new Promise(r => setTimeout(r, breakMs));
                sinceBreak = 0;
                continue;
            }

            // Inter-message delay (2 min ± 10s)
            await new Promise(r => setTimeout(r, randInt(BIRTHDAY_DELAY_MIN_MS, BIRTHDAY_DELAY_MAX_MS)));
        }

        console.log(`[Birthday] ✅ Cron check completed: ${sent} sent, ${failed} failed`);
    } catch (err) {
        console.error('[Birthday] Cron error:', err.message);
    }
};
