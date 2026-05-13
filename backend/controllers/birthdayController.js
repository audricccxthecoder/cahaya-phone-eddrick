// ============================================
// BIRTHDAY GREETING CONTROLLER (PRO VERSION)
// Antrian Ketat: Auto Priority > Manual, Working Hours Gate
// ============================================

const db = require('../config/database');
const whatsappService = require('../config/whatsapp');

const DEFAULT_MESSAGE = `Halo Kak {nama}! 🎂🎉\n\nSelamat Ulang Tahun dari kami *CAHAYA PHONE* Gorontalo!\n\nSemoga panjang umur, sehat selalu, dan diberkahi rezeki yang melimpah. Terima kasih sudah menjadi pelanggan setia kami.\n\nSalam hangat,\nCahaya Phone 🙏`;

const WORK_START_HOUR = 8;
const WORK_END_HOUR = 22;

function isWorkingHoursWITA() {
    const nowUtc = new Date();
    const witaHours = (nowUtc.getUTCHours() + 8) % 24;
    return witaHours >= WORK_START_HOUR && witaHours < WORK_END_HOUR;
}

// ... (Biarkan fungsi randInt, nextBirthdayDelayMs, nextBirthdayBreakMs, birthdayBreakEvery, calculateAge seperti aslinya) ...

/**
 * FUNGSI BARU: Memasukkan ulang tahun hari ini ke dalam Antrian (Queue)
 * Ini memastikan dispatch_mode (AUTO/MANUAL) terkunci sesuai status toggle saat antrian dibuat.
 */
async function enqueueTodayBirthdays() {
    // 1. Cek status toggle saat ini
    const autoResult = await db.query(`SELECT value FROM app_settings WHERE key = 'birthday_auto_send'`);
    const isAutoOn = autoResult.rows.length === 0 || autoResult.rows[0].value !== 'false';
    const currentMode = isAutoOn ? 'auto' : 'manual';
    const currentYear = new Date().getFullYear();

    // 2. Ambil semua yang ulang tahun hari ini (termasuk kabisat logic)
    // (Gunakan query getBirthdayToday aslimu di sini, tapi kita modifikasi untuk INSERT)
    const query = `
        INSERT INTO birthday_greetings (customer_id, greeting_year, status, dispatch_mode)
        SELECT c.id, $1, 'pending', $2
        FROM customers c
        WHERE c.tanggal_lahir IS NOT NULL AND c.opted_in IS NOT FALSE
          AND (
            (EXTRACT(MONTH FROM c.tanggal_lahir) = EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Makassar'))
             AND EXTRACT(DAY FROM c.tanggal_lahir) = EXTRACT(DAY FROM (NOW() AT TIME ZONE 'Asia/Makassar')))
            OR (
                EXTRACT(MONTH FROM c.tanggal_lahir) = 2 AND EXTRACT(DAY FROM c.tanggal_lahir) = 29
                AND EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Makassar')) = 2 AND EXTRACT(DAY FROM (NOW() AT TIME ZONE 'Asia/Makassar')) = 28
                AND NOT (MOD(EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar'))::int, 4) = 0)
            )
          )
        ON CONFLICT (customer_id, greeting_year) DO NOTHING; -- Jangan timpa yang sudah ada
    `;
    await db.query(query, [currentYear, currentMode]);
}

/**
 * API: Get daftar ulang tahun hari ini
 * Dimodifikasi: Generate queue dulu, baru return datanya.
 */
exports.getTodayBirthdays = async (req, res) => {
    try {
        await enqueueTodayBirthdays(); // Pastikan antrian hari ini sudah di-generate

        const customers = await db.query(`
            SELECT c.id, c.nama_lengkap, c.whatsapp, c.tanggal_lahir,
                   bg.id as greeting_id, bg.status as greeting_status, 
                   bg.dispatch_mode, bg.error as greeting_error
            FROM customers c
            JOIN birthday_greetings bg ON bg.customer_id = c.id
            WHERE bg.greeting_year = EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar'))
            ORDER BY c.nama_lengkap
        `);

        // Get app settings (message & toggle)
        const msgResult = await db.query(`SELECT value FROM app_settings WHERE key = 'birthday_message'`);
        const customMessage = msgResult.rows.length > 0 ? msgResult.rows[0].value : DEFAULT_MESSAGE;
        const autoResult = await db.query(`SELECT value FROM app_settings WHERE key = 'birthday_auto_send'`);
        const autoSend = autoResult.rows.length === 0 || autoResult.rows[0].value !== 'false';

        res.json({
            success: true,
            data: {
                customers: customers.rows,
                message: customMessage,
                autoSend,
                is_working_hours: isWorkingHoursWITA(),
                working_hours: { start: WORK_START_HOUR, end: WORK_END_HOUR, tz: 'WITA' }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/**
 * API: Kirim manual 1 customer
 * LOGIKA KETAT: Prioritas AUTO, Jam Operasional, Delay Muter-Muter
 */
exports.sendGreeting = async (req, res) => {
    try {
        const { customer_id } = req.body;
        
        // GATE 1: JAM OPERASIONAL
        if (!isWorkingHoursWITA()) {
            return res.status(403).json({
                success: false,
                message: `Di luar jam operasional (${WORK_START_HOUR}:00–${WORK_END_HOUR}:00 WITA). Sistem tidak memproses pengiriman.`
            });
        }

        // GATE 2: PRIORITAS OTOMATIS (AUTO)
        // Cek apakah masih ada antrian 'pending' dengan mode 'auto' hari ini
        const pendingAuto = await db.query(`
            SELECT 1 FROM birthday_greetings 
            WHERE status IN ('pending', 'failed') AND dispatch_mode = 'auto' 
            AND greeting_year = EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Makassar')) LIMIT 1
        `);
        
        if (pendingAuto.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Masih mendahulukan antrian otomatis! Selesaikan antrian otomatis (atau tunggu sistem menyelesaikannya) sebelum mengirim manual.'
            });
        }

        // GATE 3: JIKA LOLOS, EKSEKUSI DENGAN DELAY (Loading Muter-muter)
        // Frontend akan menunggu respon ini selesai (bisa memakan waktu 10-30 detik)
        const delay = Math.floor(Math.random() * (15000 - 5000 + 1)) + 5000; // Random 5-15 detik untuk simulasi/anti-ban
        
        // Sengaja menunggu sebelum mengeksekusi agar UI terlihat "loading"
        await new Promise(r => setTimeout(r, delay));

        // Eksekusi kirim pesan
        const result = await sendBirthdayMessage(customer_id);

        if (result.success) {
            res.json({ success: true, message: 'Pesan ulang tahun berhasil terkirim manual!' });
        } else {
            res.status(400).json({ success: false, message: result.message || result.error });
        }

    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};