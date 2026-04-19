// ============================================
// ADMIN CONTROLLER
// Handle admin authentication & data
// ============================================

const db = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const whatsappService = require('../config/whatsapp');
const { sanitizePhone } = require('../utils/phoneUtils');

const VALID_STATUSES = ['New', 'Contacted', 'Follow Up', 'Completed', 'Inactive'];

// ============================================
// ANTI-SPAM: Message variation helpers
// ============================================
const RANDOM_GREETINGS = [
    '', '', // empty = no prefix (keeps original message)
    'Halo Kak, ', 'Hi Kak, ', 'Hai Kak, ', 'Halo, ', 'Hai, ',
    'Halo Kak! ', 'Hi! ', 'Hai! ', 'Hey Kak, ',
    'Selamat siang Kak, ', 'Selamat sore Kak, ',
    'Assalamualaikum Kak, ', 'Permisi Kak, ',
];

const RANDOM_CLOSINGS = [
    '', // empty = no closing
    ' 😊', ' 🙏', ' ✨', ' 👍', ' 🔥', ' 💯', ' 🎉', ' ❤️',
    ' 😁', ' 🤗', ' 👋', ' 💪', ' ⭐', ' 🌟', ' 📱', ' 🛒',
    '\n\nTerima kasih! 🙏', '\n\nSalam hangat! 😊', '\n\nSukses selalu! ✨',
    '\n\nDitunggu ya Kak! 👋', '\n\nYuk mampir! 🔥', '\n\nInfo lanjut hubungi kami ya 📱',
];

const RANDOM_FILLERS = [
    '', '', '', // mostly empty
    ' nih', ' ya', ' lho', ' dong', ' yuk', ' nih Kak',
];

/**
 * Add subtle random variations to broadcast message so each one is unique
 * Prevents WhatsApp from detecting identical bulk messages
 */
function variasiPesan(message, customerName) {
    let msg = message.replace(/{nama}/gi, customerName || 'Kak');

    // Random greeting prefix (only if message doesn't already start with greeting)
    const startsWithGreeting = /^(halo|hai|hi|hey|selamat|assalam|permisi)/i.test(msg);
    if (!startsWithGreeting) {
        const greeting = RANDOM_GREETINGS[Math.floor(Math.random() * RANDOM_GREETINGS.length)];
        if (greeting) msg = greeting + msg;
    }

    // Random filler word inserted after first sentence (before first period/newline)
    const filler = RANDOM_FILLERS[Math.floor(Math.random() * RANDOM_FILLERS.length)];
    if (filler) {
        const firstBreak = msg.search(/[.!\n]/);
        if (firstBreak > 10) {
            msg = msg.slice(0, firstBreak) + filler + msg.slice(firstBreak);
        }
    }

    // Random closing/emoji at end
    const closing = RANDOM_CLOSINGS[Math.floor(Math.random() * RANDOM_CLOSINGS.length)];
    msg = msg + closing;

    // Random invisible variation: add 1-3 zero-width spaces at random positions
    const zwsp = '\u200B';
    const numZwsp = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < numZwsp; i++) {
        const pos = Math.floor(Math.random() * msg.length);
        msg = msg.slice(0, pos) + zwsp + msg.slice(pos);
    }

    return msg;
}

/**
 * Random delay between min-max milliseconds (anti-spam)
 */
function randomDelay(minMs, maxMs) {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Get total messages sent today (for soft warning)
 */
async function getDailySentCount() {
    const { rows } = await db.query(
        `SELECT COUNT(*) as count FROM broadcast_recipients
         WHERE status = 'sent' AND (sent_at AT TIME ZONE 'Asia/Makassar')::date = (NOW() AT TIME ZONE 'Asia/Makassar')::date`
    );
    return parseInt(rows[0].count) || 0;
}

/**
 * Build WHERE clause from export/filter query params
 */
function buildExportFilter(query) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (query.source) {
        conditions.push(`source = $${idx++}`);
        params.push(query.source);
    }
    if (query.status) {
        conditions.push(`status = $${idx++}`);
        params.push(query.status);
    }
    if (query.date_from) {
        conditions.push(`created_at >= $${idx++}`);
        params.push(query.date_from);
    }
    if (query.date_to) {
        conditions.push(`created_at < ($${idx++})::date + 1`);
        params.push(query.date_to);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    return { where, params };
}

/**
 * Login admin
 * POST /api/admin/login
 */
exports.login = async (req, res) => {
    try {
        const { username, password } = req.body;

        console.log('🔐 Login attempt:', username);

        const { rows: admins } = await db.query(
            'SELECT * FROM admins WHERE username = $1',
            [username]
        );

        if (admins.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Username atau password salah'
            });
        }

        const admin = admins[0];

        const isValid = await bcrypt.compare(password, admin.password);

        if (!isValid) {
            return res.status(401).json({
                success: false,
                message: 'Username atau password salah'
            });
        }

        const token = jwt.sign(
            { id: admin.id, username: admin.username },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log('✅ Login successful:', username);

        res.json({
            success: true,
            message: 'Login berhasil',
            token: token,
            admin: {
                id: admin.id,
                username: admin.username,
                nama: admin.nama
            }
        });

    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan server'
        });
    }
};

/**
 * Get dashboard statistics
 * GET /api/admin/stats
 */
exports.getStats = async (req, res) => {
    try {
        // Auto-update statuses based on last activity
        // Contacted → Follow Up: 3 days no messages
        await db.query(`
            UPDATE customers SET status = 'Follow Up'
            WHERE status = 'Contacted' AND tipe = 'Chat Only'
            AND id NOT IN (
                SELECT DISTINCT customer_id FROM messages
                WHERE sent_at > NOW() - INTERVAL '3 days'
            )
            AND created_at < NOW() - INTERVAL '3 days'
        `);

        // Follow Up → Inactive: 7 days no messages
        await db.query(`
            UPDATE customers SET status = 'Inactive'
            WHERE status = 'Follow Up' AND tipe = 'Chat Only'
            AND id NOT IN (
                SELECT DISTINCT customer_id FROM messages
                WHERE sent_at > NOW() - INTERVAL '7 days'
            )
            AND created_at < NOW() - INTERVAL '7 days'
        `);

        const { rows } = await db.query('SELECT * FROM customer_stats');

        // Pipeline stats with month comparisons
        const { rows: pipeline } = await db.query(`
            SELECT
                COUNT(*) FILTER (WHERE status IN ('New','Contacted','Follow Up')) as pipeline_active,
                COUNT(*) FILTER (WHERE status = 'Completed') as pipeline_success,
                COUNT(*) FILTER (WHERE status = 'Inactive') as pipeline_lost,
                COALESCE(SUM(harga * qty) FILTER (WHERE status = 'Completed'), 0) as total_omzet,

                -- Bulan ini
                COUNT(*) FILTER (WHERE status IN ('New','Contacted','Follow Up') AND created_at >= DATE_TRUNC('month', NOW())) as active_bulan_ini,
                COUNT(*) FILTER (WHERE status = 'Completed' AND created_at >= DATE_TRUNC('month', NOW())) as success_bulan_ini,
                COALESCE(SUM(harga * qty) FILTER (WHERE status = 'Completed' AND created_at >= DATE_TRUNC('month', NOW())), 0) as omzet_bulan_ini,
                COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())) as total_bulan_ini,

                -- Bulan lalu
                COUNT(*) FILTER (WHERE status IN ('New','Contacted','Follow Up') AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND created_at < DATE_TRUNC('month', NOW())) as active_bulan_lalu,
                COUNT(*) FILTER (WHERE status = 'Completed' AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND created_at < DATE_TRUNC('month', NOW())) as success_bulan_lalu,
                COALESCE(SUM(harga * qty) FILTER (WHERE status = 'Completed' AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND created_at < DATE_TRUNC('month', NOW())), 0) as omzet_bulan_lalu,
                COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND created_at < DATE_TRUNC('month', NOW())) as total_bulan_lalu,

                -- Tipe
                COUNT(*) FILTER (WHERE tipe = 'Belanja') as total_belanja,
                COUNT(*) FILTER (WHERE tipe = 'Chat Only') as total_chat_only,

                -- Per status detail
                COUNT(*) FILTER (WHERE status = 'New') as status_new,
                COUNT(*) FILTER (WHERE status = 'Contacted') as status_contacted,
                COUNT(*) FILTER (WHERE status = 'Follow Up') as status_follow_up
            FROM customers
        `);

        res.json({
            success: true,
            data: { ...rows[0], ...pipeline[0] }
        });

    } catch (error) {
        console.error('❌ Stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil statistik'
        });
    }
};

/**
 * Get monthly pipeline breakdown
 * GET /api/admin/pipeline/monthly
 */
exports.getPipelineMonthly = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT
                TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as bulan,
                TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') as label,
                COUNT(*) FILTER (WHERE status = 'Completed') as sukses,
                COUNT(*) FILTER (WHERE status IN ('New','Contacted','Follow Up')) as active,
                COUNT(*) FILTER (WHERE status = 'Inactive') as lost,
                COUNT(*) as total,
                COALESCE(SUM(harga * qty) FILTER (WHERE status = 'Completed'), 0) as omzet
            FROM customers
            GROUP BY DATE_TRUNC('month', created_at)
            ORDER BY DATE_TRUNC('month', created_at) DESC
            LIMIT 12
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('❌ Pipeline monthly error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data pipeline' });
    }
};

/**
 * Get all customers
 * GET /api/admin/customers
 */
exports.getCustomers = async (req, res) => {
    try {
        const { rows: customers } = await db.query(
            `SELECT c.id, c.nama_lengkap, c.nama_sales, c.merk_unit, c.tipe_unit,
                c.harga, c.qty, c.whatsapp, c.metode_pembayaran,
                c.source, c.status, c.tipe, c.created_at, c.catatan, c.wa_sent,
                COALESCE(p.purchase_count, 0)::int as purchase_count
            FROM customers c
            LEFT JOIN (
                SELECT customer_id, COUNT(*) as purchase_count FROM purchases GROUP BY customer_id
            ) p ON p.customer_id = c.id
            ORDER BY c.created_at DESC`
        );

        res.json({
            success: true,
            data: customers
        });

    } catch (error) {
        console.error('❌ Get customers error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data customer'
        });
    }
};

/**
 * Get customer detail by ID
 * GET /api/admin/customers/:id
 */
exports.getCustomerById = async (req, res) => {
    try {
        const { id } = req.params;

        const { rows: customers } = await db.query(
            'SELECT * FROM customers WHERE id = $1',
            [id]
        );

        if (customers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Customer tidak ditemukan'
            });
        }

        // Include purchase history
        const { rows: purchases } = await db.query(
            `SELECT id, merk_unit, tipe_unit, harga, qty, nama_sales, metode_pembayaran, source, created_at
             FROM purchases WHERE customer_id = $1 ORDER BY created_at DESC`,
            [id]
        );

        // Include chat history (last 50 messages)
        const { rows: messages } = await db.query(
            `SELECT id, direction, message, channel, sent_at, created_at
             FROM messages WHERE customer_id = $1
             ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 50`,
            [id]
        );

        res.json({
            success: true,
            data: { ...customers[0], purchases, purchase_count: purchases.length, messages }
        });

    } catch (error) {
        console.error('❌ Get customer error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data customer'
        });
    }
};

/**
 * Update customer status
 * PATCH /api/admin/customers/:id/status
 */
exports.updateCustomerStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!status || !VALID_STATUSES.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Status tidak valid. Pilihan: ${VALID_STATUSES.join(', ')}`
            });
        }

        const { rowCount } = await db.query(
            'UPDATE customers SET status = $1, updated_at = NOW() WHERE id = $2',
            [status, id]
        );

        if (rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Customer tidak ditemukan' });
        }

        res.json({ success: true, message: 'Status berhasil diubah', data: { id: Number(id), status } });
    } catch (error) {
        console.error('❌ Update status error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengubah status' });
    }
};

/**
 * Update customer notes (catatan)
 * PATCH /api/admin/customers/:id/catatan
 */
exports.updateCustomerCatatan = async (req, res) => {
    try {
        const { id } = req.params;
        const { catatan } = req.body;

        const { rowCount } = await db.query(
            'UPDATE customers SET catatan = $1, updated_at = NOW() WHERE id = $2',
            [catatan || null, id]
        );

        if (rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Customer tidak ditemukan' });
        }

        res.json({ success: true, message: 'Catatan berhasil disimpan' });
    } catch (error) {
        console.error('❌ Update catatan error:', error);
        res.status(500).json({ success: false, message: 'Gagal menyimpan catatan' });
    }
};

/**
 * Get all messages (chat log)
 * GET /api/admin/messages
 */
exports.getMessages = async (req, res) => {
    try {
        const { rows: messages } = await db.query(
            `SELECT
                m.id, m.customer_id, m.direction, m.message, m.sent_at,
                c.nama_lengkap, c.whatsapp
            FROM messages m
            JOIN customers c ON m.customer_id = c.id
            ORDER BY m.sent_at DESC
            LIMIT 100`
        );

        res.json({
            success: true,
            data: messages
        });

    } catch (error) {
        console.error('❌ Get messages error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data pesan'
        });
    }
};

/**
 * Update admin profile (name)
 * PATCH /api/admin/profile
 */
exports.updateProfile = async (req, res) => {
    try {
        const { nama } = req.body;
        const adminId = req.admin && req.admin.id;

        if (!adminId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (!nama || String(nama).trim() === '') {
            return res.status(400).json({ success: false, message: 'Nama tidak boleh kosong' });
        }

        await db.query('UPDATE admins SET nama = $1 WHERE id = $2', [String(nama).trim(), adminId]);

        res.json({ success: true, message: 'Profil diperbarui', data: { id: adminId, nama: String(nama).trim() } });
    } catch (error) {
        console.error('❌ Update profile error:', error);
        res.status(500).json({ success: false, message: 'Gagal memperbarui profil' });
    }
};

/**
 * Change username/password
 * PATCH /api/admin/credentials
 */
exports.changeCredentials = async (req, res) => {
    try {
        const adminId = req.admin && req.admin.id;
        const { current_password, new_password, new_username, nama } = req.body;

        if (!adminId) return res.status(401).json({ success: false, message: 'Unauthorized' });
        if (!current_password) return res.status(400).json({ success: false, message: 'Current password is required' });

        const { rows } = await db.query('SELECT * FROM admins WHERE id = $1', [adminId]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Admin not found' });

        const admin = rows[0];
        const isValid = await bcrypt.compare(current_password, admin.password);
        if (!isValid) return res.status(401).json({ success: false, message: 'Current password is incorrect' });

        const updates = [];
        const params = [];
        let paramCount = 1;

        if (new_username && String(new_username).trim() !== admin.username) {
            const { rows: u } = await db.query('SELECT id FROM admins WHERE username = $1 AND id != $2', [String(new_username).trim(), adminId]);
            if (u.length > 0) return res.status(409).json({ success: false, message: 'Username already taken' });
            updates.push(`username = $${paramCount++}`); params.push(String(new_username).trim());
        }

        if (nama && String(nama).trim() !== admin.nama) {
            updates.push(`nama = $${paramCount++}`); params.push(String(nama).trim());
        }

        let passwordChanged = false;
        if (new_password) {
            if (String(new_password).length < 6) return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
            const hashed = await bcrypt.hash(new_password, 10);
            updates.push(`password = $${paramCount++}`); params.push(hashed);
            passwordChanged = true;
        }

        if (updates.length > 0) {
            params.push(adminId);
            await db.query(`UPDATE admins SET ${updates.join(', ')} WHERE id = $${paramCount}`, params);
        }

        const token = jwt.sign(
            { id: adminId, username: new_username ? String(new_username).trim() : admin.username },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        const responseData = {
            id: adminId,
            username: new_username ? String(new_username).trim() : admin.username,
            nama: nama ? String(nama).trim() : admin.nama
        };

        res.json({ success: true, message: 'Credentials updated', token, data: responseData });

    } catch (error) {
        console.error('❌ Change credentials error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengubah credentials' });
    }
};

/**
 * Get messages by customer ID
 * GET /api/admin/messages/:customerId
 */
exports.getMessagesByCustomer = async (req, res) => {
    try {
        const { customerId } = req.params;

        const { rows: messages } = await db.query(
            `SELECT * FROM messages
            WHERE customer_id = $1
            ORDER BY sent_at ASC`,
            [customerId]
        );

        res.json({
            success: true,
            data: messages
        });

    } catch (error) {
        console.error('❌ Get customer messages error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil pesan customer'
        });
    }
};

/**
 * POST /api/admin/forgot
 */
exports.forgotPassword = async (req, res) => {
    try {
        const { usernameOrEmail } = req.body;
        if (!usernameOrEmail) return res.status(400).json({ success: false, message: 'username or email is required' });

        const { rows } = await db.query(
            'SELECT id, username, email, nama FROM admins WHERE username = $1 OR email = $2',
            [usernameOrEmail, usernameOrEmail]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Admin not found' });
        const admin = rows[0];

        const crypto = require('crypto');
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + (60 * 60 * 1000));

        await db.query(
            'INSERT INTO admin_reset_tokens (admin_id, token, expires_at) VALUES ($1, $2, $3)',
            [admin.id, token, expiresAt]
        );

        const nodemailer = require('nodemailer');
        if (process.env.MAIL_HOST && process.env.MAIL_USER) {
            const transporter = nodemailer.createTransport({
                host: process.env.MAIL_HOST,
                port: Number(process.env.MAIL_PORT) || 587,
                secure: (process.env.MAIL_SECURE === 'true'),
                auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS }
            });

            const from = process.env.MAIL_FROM || process.env.MAIL_USER;
            const frontend = process.env.FRONTEND_URL || 'http://localhost:5500';
            const resetLink = `${frontend.replace(/\/$/, '')}/admin/reset.html?token=${token}`;

            await transporter.sendMail({
                from,
                to: admin.email || process.env.MAIL_USER,
                subject: 'Reset password admin - Cahaya Phone',
                text: `Halo ${admin.nama || admin.username},\n\nGunakan link berikut untuk mereset password Anda (berlaku 1 jam): ${resetLink}`,
                html: `<p>Halo ${admin.nama || admin.username},</p><p>Klik link berikut untuk reset password (berlaku 1 jam): <a href="${resetLink}">${resetLink}</a></p>`
            });

            return res.json({ success: true, message: 'Reset link dikirim ke email admin.' });
        }

        return res.json({ success: true, message: 'Reset token created (no mail configured)', token });
    } catch (error) {
        console.error('❌ Forgot password error:', error);
        res.status(500).json({ success: false, message: 'Gagal membuat reset token' });
    }
};

/**
 * GET /api/admin/reset/validate?token=...
 */
exports.validateResetToken = async (req, res) => {
    try {
        const token = req.query.token;
        if (!token) return res.status(400).json({ success: false, message: 'Token is required' });

        const { rows } = await db.query(
            'SELECT id, admin_id, expires_at, used FROM admin_reset_tokens WHERE token = $1',
            [token]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Token not found' });
        const rec = rows[0];
        if (rec.used) return res.status(400).json({ success: false, message: 'Token already used' });
        if (new Date(rec.expires_at) < new Date()) return res.status(400).json({ success: false, message: 'Token expired' });

        res.json({ success: true, message: 'Token valid' });
    } catch (error) {
        console.error('❌ Validate token error:', error);
        res.status(500).json({ success: false, message: 'Gagal validasi token' });
    }
};

/**
 * Export all customers as CSV
 * GET /api/admin/customers/export
 * ?format=full (default) → all columns CSV
 * ?format=simple → Name + Phone CSV
 */
exports.exportContacts = async (req, res) => {
    try {
        console.log('📥 Export contacts requested');

        const format = req.query.format || 'full';
        const { where, params } = buildExportFilter(req.query);

        const { rows: customers } = await db.query(
            `SELECT nama_lengkap, whatsapp, nama_sales, merk_unit, tipe_unit,
                    source, status, opted_in, created_at
             FROM customers ${where} ORDER BY created_at DESC`,
            params
        );

        console.log(`📥 Export: found ${customers.length} customers (format=${format})`);

        const esc = v => `"${String(v || '').replace(/"/g, '""')}"`;
        let header, csvRows;

        if (format === 'simple') {
            header = 'Name,Phone\n';
            csvRows = customers.map(c => {
                const phone = sanitizePhone(c.whatsapp);
                return [esc(c.nama_lengkap), esc(phone)].join(',');
            }).join('\n');
        } else {
            header = 'Nama,Nomor WhatsApp,Sales,Merk,Tipe,Source,Status,Opted In,Tanggal Daftar\n';
            csvRows = customers.map(c => {
                const phone = sanitizePhone(c.whatsapp);
                const date = c.created_at ? new Date(c.created_at).toLocaleDateString('id-ID') : '';
                return [
                    esc(c.nama_lengkap),
                    esc(phone),
                    esc(c.nama_sales),
                    esc(c.merk_unit),
                    esc(c.tipe_unit),
                    esc(c.source),
                    esc(c.status),
                    c.opted_in ? 'Ya' : 'Tidak',
                    esc(date)
                ].join(',');
            }).join('\n');
        }

        const csv = header + csvRows;
        const suffix = format === 'simple' ? 'contacts' : 'customers';
        const filename = `${suffix}_${new Date().toISOString().slice(0,10)}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\uFEFF' + csv);

    } catch (error) {
        console.error('❌ Export contacts error:', error.message, error.stack);
        res.status(500).json({ success: false, message: 'Gagal export data: ' + error.message });
    }
};

/**
 * Export all customers as vCard (.vcf) — direct phone contact import
 * GET /api/admin/customers/export/vcf
 * Tap the .vcf file on phone → all contacts auto-saved
 */
exports.exportVCard = async (req, res) => {
    try {
        console.log('📥 Export vCard requested');

        const { where, params } = buildExportFilter(req.query);

        const { rows: customers } = await db.query(
            `SELECT nama_lengkap, whatsapp FROM customers ${where} ORDER BY created_at DESC`,
            params
        );

        console.log(`📥 Export vCard: found ${customers.length} customers`);

        // Build vCard 3.0 format — universally supported on iOS & Android
        const vcards = customers.map(c => {
            const phone = sanitizePhone(c.whatsapp);
            const name = String(c.nama_lengkap || '').trim();
            // Escape special vCard characters
            const escapedName = name.replace(/[;,\\]/g, m => '\\' + m);
            return [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${escapedName}`,
                `TEL;TYPE=CELL:+${phone}`,
                `NOTE:Customer Cahaya Phone`,
                'END:VCARD'
            ].join('\r\n');
        }).join('\r\n');

        const filename = `cahaya_phone_contacts_${new Date().toISOString().slice(0,10)}.vcf`;

        res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(vcards);

    } catch (error) {
        console.error('❌ Export vCard error:', error.message, error.stack);
        res.status(500).json({ success: false, message: 'Gagal export vCard: ' + error.message });
    }
};

/**
 * Quick-sync VCF — no login, uses secret key
 * GET /api/sync/contacts?key=SECRET
 * Optional: ?key=SECRET&since=2026-03-20 (only new contacts since date)
 */
exports.quickSyncVCF = async (req, res) => {
    try {
        const { since } = req.query;
        const syncKey = process.env.SYNC_SECRET;
        const authHeader = req.headers['x-sync-key'] || req.query.key;

        if (!syncKey || authHeader !== syncKey) {
            return res.status(403).json({ success: false, message: 'Invalid or missing sync key' });
        }

        let query = `SELECT nama_lengkap, whatsapp, created_at FROM customers ORDER BY created_at DESC`;
        const params = [];

        if (since) {
            query = `SELECT nama_lengkap, whatsapp, created_at FROM customers WHERE created_at >= $1 ORDER BY created_at DESC`;
            params.push(since);
        }

        const { rows: customers } = await db.query(query, params);

        if (customers.length === 0) {
            return res.status(200).send('Tidak ada kontak baru.');
        }

        const vcards = customers.map(c => {
            const phone = sanitizePhone(c.whatsapp);
            const name = String(c.nama_lengkap || '').trim();
            const escapedName = name.replace(/[;,\\]/g, m => '\\' + m);
            return [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${escapedName} - CP`,
                `TEL;TYPE=CELL:+${phone}`,
                `NOTE:Customer Cahaya Phone`,
                'END:VCARD'
            ].join('\r\n');
        }).join('\r\n');

        const filename = `cp_contacts_${new Date().toISOString().slice(0,10)}.vcf`;
        res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(vcards);

    } catch (error) {
        console.error('❌ Quick sync error:', error);
        res.status(500).json({ success: false, message: 'Gagal sync: ' + error.message });
    }
};

/**
 * Quick-sync: list customers by date (JSON)
 * GET /api/sync/list?key=SECRET&date=2026-03-20
 */
exports.quickSyncList = async (req, res) => {
    try {
        const { date } = req.query;
        const syncKey = process.env.SYNC_SECRET;
        const authHeader = req.headers['x-sync-key'] || req.query.key;

        if (!syncKey || authHeader !== syncKey) {
            return res.status(403).json({ success: false, message: 'Invalid or missing sync key' });
        }

        let query, params;
        if (date) {
            query = `SELECT id, nama_lengkap, whatsapp, merk_unit, tipe_unit, created_at FROM customers WHERE DATE(created_at) = $1 ORDER BY created_at DESC`;
            params = [date];
        } else {
            query = `SELECT id, nama_lengkap, whatsapp, merk_unit, tipe_unit, created_at FROM customers ORDER BY created_at DESC LIMIT 100`;
            params = [];
        }

        const { rows } = await db.query(query, params);
        res.json({ success: true, count: rows.length, customers: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Quick-sync: download VCF for specific customer IDs
 * POST /api/sync/contacts/selected
 * Body: { key, ids: [1, 2, 3] }
 */
exports.quickSyncSelected = async (req, res) => {
    try {
        const { ids } = req.body;
        const syncKey = process.env.SYNC_SECRET;
        const authHeader = req.headers['x-sync-key'] || req.body.key;

        if (!syncKey || authHeader !== syncKey) {
            return res.status(403).json({ success: false, message: 'Invalid or missing sync key' });
        }

        if (!ids || !ids.length) {
            return res.status(400).json({ success: false, message: 'Tidak ada kontak dipilih' });
        }

        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
        const { rows: customers } = await db.query(
            `SELECT nama_lengkap, whatsapp FROM customers WHERE id IN (${placeholders})`,
            ids
        );

        const vcards = customers.map(c => {
            const phone = sanitizePhone(c.whatsapp);
            const name = String(c.nama_lengkap || '').trim();
            const escapedName = name.replace(/[;,\\]/g, m => '\\' + m);
            return [
                'BEGIN:VCARD',
                'VERSION:3.0',
                `FN:${escapedName} - CP`,
                `TEL;TYPE=CELL:+${phone}`,
                `NOTE:Customer Cahaya Phone`,
                'END:VCARD'
            ].join('\r\n');
        }).join('\r\n');

        const filename = `cp_contacts_selected.vcf`;
        res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(vcards);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get daily broadcast sent count
 * GET /api/admin/broadcast/daily-count
 */
exports.getDailySentCount = async (req, res) => {
    try {
        const count = await getDailySentCount();
        res.json({ success: true, daily_sent: count });
    } catch (error) {
        console.error('❌ Daily count error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil jumlah harian' });
    }
};

/**
 * Start broadcast (DB-backed, Cloud API template)
 * POST /api/admin/broadcast/start
 * Body: { template_name, template_language?, message?, source_filter?, merk_filter?, metode_filter? }
 *
 * Cloud API: broadcast HARUS pakai template (inisiasi percakapan)
 * Field 'message' tetap disimpan sebagai catatan/label di broadcast_jobs
 */
exports.startBroadcast = async (req, res) => {
    try {
        const { message, template_name, template_language, source_filter, merk_filter, metode_filter } = req.body;

        // Cloud API memerlukan template untuk broadcast
        const broadcastTemplate = template_name || whatsappService.templates.broadcast;

        if (!broadcastTemplate) {
            return res.status(400).json({ success: false, message: 'Template name wajib untuk broadcast Cloud API' });
        }

        const broadcastLabel = message || `[TEMPLATE] ${broadcastTemplate}`;

        // Check if there's already an active broadcast
        const { rows: active } = await db.query(
            `SELECT id FROM broadcast_jobs WHERE status = 'running' LIMIT 1`
        );
        if (active.length > 0) {
            return res.status(409).json({
                success: false,
                message: 'Broadcast sedang berjalan. Stop dulu sebelum memulai baru.'
            });
        }

        // Get opted-in customers with filters
        let query = `SELECT id, nama_lengkap, whatsapp FROM customers WHERE opted_in IS NOT FALSE`;
        const params = [];
        if (source_filter) {
            query += ` AND source = $${params.length + 1}`;
            params.push(source_filter);
        }
        if (merk_filter) {
            query += ` AND merk_unit = $${params.length + 1}`;
            params.push(merk_filter);
        }
        if (metode_filter) {
            query += ` AND metode_pembayaran = $${params.length + 1}`;
            params.push(metode_filter);
        }
        query += ` ORDER BY created_at ASC`;

        const { rows: customers } = await db.query(query, params);

        if (customers.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada customer opted-in untuk dibroadcast' });
        }

        // Create broadcast job (simpan template info di message field)
        const { rows: [job] } = await db.query(
            `INSERT INTO broadcast_jobs (message, source_filter, status, total) VALUES ($1, $2, 'running', $3) RETURNING id`,
            [JSON.stringify({ template_name: broadcastTemplate, template_language: template_language || 'id', label: broadcastLabel }), source_filter || null, customers.length]
        );

        // Insert all recipients
        const values = customers.map((c, i) => {
            const offset = i * 4;
            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`;
        }).join(', ');
        const recipientParams = customers.flatMap(c => [job.id, c.id, c.nama_lengkap, sanitizePhone(c.whatsapp)]);

        await db.query(
            `INSERT INTO broadcast_recipients (job_id, customer_id, customer_name, customer_phone) VALUES ${values}`,
            recipientParams
        );

        // Anti-spam: daily sent count for soft warning
        const dailySent = await getDailySentCount();

        res.json({
            success: true,
            message: `Broadcast dimulai untuk ${customers.length} customer`,
            job_id: job.id,
            status: { running: true, paused: false, total: customers.length, sent: 0, failed: 0, queued: customers.length, daily_sent: dailySent, log: [] }
        });

    } catch (error) {
        console.error('❌ Start broadcast error:', error);
        res.status(500).json({ success: false, message: 'Gagal memulai broadcast' });
    }
};

/**
 * Process broadcast — now backend-driven via wa-worker.js
 * This endpoint just returns current status (backward compatibility)
 * POST /api/admin/broadcast/process
 */
exports.processBroadcast = async (req, res) => {
    try {
        const { rows: jobs } = await db.query(
            `SELECT id, status FROM broadcast_jobs ORDER BY id DESC LIMIT 1`
        );

        if (jobs.length === 0) {
            return res.json({ success: true, status: { running: false, paused: false, total: 0, sent: 0, failed: 0, queued: 0, log: [] } });
        }

        const job = jobs[0];
        const { rows: [counts] } = await db.query(
            `SELECT
                COUNT(*) FILTER (WHERE status IN ('pending', 'sending')) as queued,
                COUNT(*) FILTER (WHERE status = 'sent') as sent,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) as total
             FROM broadcast_recipients WHERE job_id = $1`,
            [job.id]
        );

        const { rows: recentLog } = await db.query(
            `SELECT customer_name as name, customer_phone as phone, status, error
             FROM broadcast_recipients WHERE job_id = $1 AND status NOT IN ('pending', 'sending')
             ORDER BY sent_at DESC LIMIT 20`,
            [job.id]
        );

        const log = recentLog.map(r => ({
            success: r.status === 'sent',
            name: r.name,
            phone: r.phone,
            error: r.error
        }));

        const dailySent = await getDailySentCount();

        res.json({
            success: true,
            status: {
                running: job.status === 'running',
                paused: job.status === 'paused',
                total: parseInt(counts.total),
                sent: parseInt(counts.sent),
                failed: parseInt(counts.failed),
                queued: parseInt(counts.queued),
                daily_sent: dailySent,
                log
            }
        });

    } catch (error) {
        console.error('❌ Process broadcast error:', error);
        res.status(500).json({ success: false, message: 'Gagal memproses broadcast' });
    }
};

/**
 * Stop broadcast
 * POST /api/admin/broadcast/stop
 */
exports.stopBroadcast = async (req, res) => {
    try {
        await db.query(`UPDATE broadcast_jobs SET status = 'stopped' WHERE status IN ('running', 'paused')`);
        await db.query(
            `UPDATE broadcast_recipients SET status = 'skipped'
             WHERE job_id IN (SELECT id FROM broadcast_jobs WHERE status = 'stopped') AND status IN ('pending', 'sending')`
        );
        res.json({ success: true, message: 'Broadcast dihentikan', status: { running: false, paused: false, total: 0, sent: 0, failed: 0, queued: 0, log: [] } });
    } catch (error) {
        console.error('❌ Stop broadcast error:', error);
        res.status(500).json({ success: false, message: 'Gagal menghentikan broadcast' });
    }
};

/**
 * Pause broadcast
 * POST /api/admin/broadcast/pause
 */
exports.pauseBroadcast = async (req, res) => {
    try {
        await db.query(`UPDATE broadcast_jobs SET status = 'paused' WHERE status = 'running'`);
        res.json({ success: true, message: 'Broadcast dijeda' });
    } catch (error) {
        console.error('❌ Pause broadcast error:', error);
        res.status(500).json({ success: false, message: 'Gagal menjeda broadcast' });
    }
};

/**
 * Resume broadcast
 * POST /api/admin/broadcast/resume
 */
exports.resumeBroadcast = async (req, res) => {
    try {
        await db.query(`UPDATE broadcast_jobs SET status = 'running' WHERE status = 'paused'`);
        res.json({ success: true, message: 'Broadcast dilanjutkan' });
    } catch (error) {
        console.error('❌ Resume broadcast error:', error);
        res.status(500).json({ success: false, message: 'Gagal melanjutkan broadcast' });
    }
};

/**
 * Get broadcast status
 * GET /api/admin/broadcast/status
 */
exports.getBroadcastStatus = async (req, res) => {
    try {
        const { rows: jobs } = await db.query(
            `SELECT id, status, total, created_at FROM broadcast_jobs ORDER BY id DESC LIMIT 1`
        );

        if (jobs.length === 0) {
            return res.json({ success: true, status: { running: false, paused: false, total: 0, sent: 0, failed: 0, queued: 0, log: [] } });
        }

        const job = jobs[0];
        const { rows: [counts] } = await db.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'pending') as queued,
                COUNT(*) FILTER (WHERE status = 'sent') as sent,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) as total
             FROM broadcast_recipients WHERE job_id = $1`,
            [job.id]
        );

        const { rows: recentLog } = await db.query(
            `SELECT customer_name as name, customer_phone as phone, status, error
             FROM broadcast_recipients WHERE job_id = $1 AND status != 'pending'
             ORDER BY sent_at DESC LIMIT 20`,
            [job.id]
        );

        const log = recentLog.map(r => ({
            success: r.status === 'sent',
            name: r.name,
            phone: r.phone,
            error: r.error
        }));

        // Anti-spam: daily sent count for soft warning
        const dailySent = await getDailySentCount();

        res.json({
            success: true,
            status: {
                running: job.status === 'running',
                paused: job.status === 'paused',
                total: parseInt(counts.total),
                sent: parseInt(counts.sent),
                failed: parseInt(counts.failed),
                queued: parseInt(counts.queued),
                daily_sent: dailySent,
                log
            }
        });
    } catch (error) {
        console.error('❌ Get broadcast status error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil status broadcast' });
    }
};

/**
 * POST /api/admin/reset
 */
exports.resetPassword = async (req, res) => {
    try {
        const { token, new_password } = req.body;
        if (!token || !new_password) return res.status(400).json({ success: false, message: 'Token and new_password are required' });

        const { rows } = await db.query(
            'SELECT id, admin_id, expires_at, used FROM admin_reset_tokens WHERE token = $1',
            [token]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Token not found' });
        const rec = rows[0];
        if (rec.used) return res.status(400).json({ success: false, message: 'Token already used' });
        if (new Date(rec.expires_at) < new Date()) return res.status(400).json({ success: false, message: 'Token expired' });

        const hash = await bcrypt.hash(new_password, 10);
        await db.query('UPDATE admins SET password = $1 WHERE id = $2', [hash, rec.admin_id]);
        await db.query('UPDATE admin_reset_tokens SET used = TRUE WHERE id = $1', [rec.id]);

        res.json({ success: true, message: 'Password telah direset' });
    } catch (error) {
        console.error('❌ Reset password error:', error);
        res.status(500).json({ success: false, message: 'Gagal mereset password' });
    }
};

// ============================================
// ANALYTICS ENDPOINTS
// ============================================

/**
 * Top buyers — customers with most purchases
 * GET /api/admin/analytics/top-buyers
 */
exports.getTopBuyers = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT c.id, c.nama_lengkap, c.whatsapp,
                   COUNT(p.id) as total_purchases,
                   COALESCE(SUM(p.harga * p.qty), 0) as total_spent
            FROM customers c
            JOIN purchases p ON p.customer_id = c.id
            GROUP BY c.id, c.nama_lengkap, c.whatsapp
            ORDER BY total_purchases DESC, total_spent DESC
            LIMIT 20
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('❌ Top buyers error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data' });
    }
};

/**
 * Top products — most sold phone models
 * GET /api/admin/analytics/top-products
 */
exports.getTopProducts = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT merk_unit, tipe_unit,
                   COUNT(*) as total_sold,
                   SUM(qty) as total_qty,
                   COALESCE(SUM(harga * qty), 0) as total_revenue
            FROM purchases
            WHERE merk_unit IS NOT NULL AND merk_unit != ''
            GROUP BY merk_unit, tipe_unit
            ORDER BY total_sold DESC
            LIMIT 20
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('❌ Top products error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data' });
    }
};

/**
 * Brand stats — sales by brand
 * GET /api/admin/analytics/top-brands
 */
exports.getTopBrands = async (req, res) => {
    try {
        const { rows } = await db.query(`
            SELECT merk_unit as brand,
                   COUNT(*) as total_sold,
                   SUM(qty) as total_qty,
                   COALESCE(SUM(harga * qty), 0) as total_revenue
            FROM purchases
            WHERE merk_unit IS NOT NULL AND merk_unit != ''
            GROUP BY merk_unit
            ORDER BY total_sold DESC
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('❌ Top brands error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil data' });
    }
};

// ============================================
// WA CLIENT ENDPOINTS (langsung, bukan proxy HTTP)
// ============================================

/**
 * Get WA Cloud API connection status
 * GET /api/admin/wa/status
 */
exports.getWABridgeStatus = async (req, res) => {
    try {
        const status = await whatsappService.getStatus();

        // Include worker queue status
        const waWorker = require('../config/wa-worker');
        const queueStatus = await waWorker.getQueueStatus();

        res.json({ ...status, queue: queueStatus });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * Update auto-reply settings (disimpan di memory, reset saat restart)
 * POST /api/admin/wa/auto-reply
 */
exports.updateWAAutoReply = async (req, res) => {
    // Auto-reply sekarang hanya untuk form submit, tidak untuk chat masuk
    // Setting ini mengubah pesan auto-reply yang dikirim setelah form submit
    res.json({ success: true, message: 'Auto-reply hanya aktif untuk form submission' });
};

/**
 * Get auto-reply settings
 * GET /api/admin/wa/auto-reply
 */
exports.getWAAutoReply = async (req, res) => {
    res.json({ success: true, autoReply: true, message: 'Auto-reply aktif untuk form submission saja' });
};

/**
 * Disconnect WhatsApp (Fonnte: no-op, API selalu ready)
 * POST /api/admin/wa/disconnect
 */
exports.disconnectWA = async (req, res) => {
    res.json({ success: true, message: 'Fonnte API tidak perlu disconnect — selalu tersedia selama API key valid' });
};

/**
 * Restart WhatsApp (reload settings + restart worker)
 * POST /api/admin/wa/restart
 */
exports.restartWA = async (req, res) => {
    try {
        await whatsappService.loadSettings();

        // Restart worker (recover stuck messages)
        const waWorker = require('../config/wa-worker');
        waWorker.stop();
        await waWorker.start();

        const status = await whatsappService.getStatus();
        res.json({ success: true, message: 'WA Service reloaded + worker restarted', ...status });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
};

/**
 * Update WA settings (daily limit, etc)
 * POST /api/admin/wa/settings
 */
exports.updateWASettings = async (req, res) => {
    try {
        const result = await whatsappService.setDailyLimit(req.body.dailyLimit);
        res.json(result);
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
};

// ============================================
// RETRY FAILED WA MESSAGES
// ============================================

/**
 * Get customers with failed WA delivery
 * GET /api/admin/wa/failed
 */
exports.getFailedWA = async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT id, nama_lengkap, whatsapp, wa_sent, tipe, created_at
             FROM customers WHERE wa_sent = FALSE ORDER BY created_at DESC`
        );
        res.json({ success: true, data: rows, count: rows.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Retry sending WA message to a specific customer
 * POST /api/admin/wa/retry/:id
 */
exports.retryWA = async (req, res) => {
    try {
        const { id } = req.params;
        const { rows } = await db.query('SELECT id, nama_lengkap, whatsapp FROM customers WHERE id = $1', [id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'Customer tidak ditemukan' });

        const customer = rows[0];
        const waResult = await whatsappService.sendAutoReply({ nama_lengkap: customer.nama_lengkap, whatsapp: customer.whatsapp });
        const waSent = waResult && waResult.success;
        await db.query('UPDATE customers SET wa_sent = $1, status = CASE WHEN $1 = TRUE THEN $2 ELSE status END WHERE id = $3',
            [waSent, 'Completed', customer.id]);

        res.json({ success: waSent, message: waSent ? 'Pesan berhasil dikirim ulang' : ('Gagal kirim ulang: ' + (waResult?.error || 'WA tidak tersedia')) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Retry all failed WA messages
 * POST /api/admin/wa/retry-all
 */
exports.retryAllWA = async (req, res) => {
    try {
        const { rows } = await db.query(
            `SELECT id, nama_lengkap, whatsapp FROM customers WHERE wa_sent = FALSE ORDER BY created_at ASC`
        );
        if (rows.length === 0) return res.json({ success: true, message: 'Tidak ada pesan gagal', retried: 0 });

        let sent = 0, failed = 0;
        for (const customer of rows) {
            try {
                const waResult = await whatsappService.sendAutoReply({ nama_lengkap: customer.nama_lengkap, whatsapp: customer.whatsapp });
                const waSent = waResult && waResult.success;
                await db.query('UPDATE customers SET wa_sent = $1, status = CASE WHEN $1 = TRUE THEN $2 ELSE status END WHERE id = $3',
                    [waSent, 'Completed', customer.id]);
                if (waSent) sent++; else failed++;
                // Anti-spam delay
                await new Promise(r => setTimeout(r, 3000 + Math.random() * 5000));
            } catch (e) {
                failed++;
                await db.query('UPDATE customers SET wa_sent = FALSE WHERE id = $1', [customer.id]).catch(() => {});
            }
        }

        res.json({ success: true, message: `Kirim ulang selesai: ${sent} berhasil, ${failed} gagal`, sent, failed });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Get WA message log (semua pengiriman WA tercatat di DB)
 * GET /api/admin/wa/log?limit=50&status=failed
 */
exports.getWAMessageLog = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const statusFilter = req.query.status;

        let query = `SELECT id, phone, type, template_name, message_body, wa_message_id,
                     status, retry_count, error_code, error_detail,
                     created_at, sent_at, delivered_at, read_at
                     FROM whatsapp_logs`;
        const params = [];

        if (statusFilter) {
            query += ` WHERE status = $1`;
            params.push(statusFilter);
        }

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);

        const { rows } = await db.query(query, params);

        // Daily stats
        const stats = await whatsappService.getStats();

        res.json({ success: true, data: rows, stats });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ============================================
// DATA CLEANUP (Chat Log & Broadcast Log)
// ============================================
//
// Strategi cleanup (prioritas hemat database):
// 1. admin_reset_tokens → hapus otomatis setiap request (used/expired)
// 2. broadcast_recipients → hapus 30 hari setelah JOB SELESAI
// 3. messages (chat log) → hapus > 30 hari
// 4. broadcast_jobs → hapus 30 hari setelah selesai
// 5. whatsapp_logs → hapus > 30 hari
// 6. wa_daily_stats → hapus > 90 hari
//
// TIDAK PERNAH DIHAPUS: customers, purchases, invoices, google_tokens

const CLEANUP_DAYS = 30;

/**
 * Auto-clean sampah setiap kali cleanup/status dipanggil
 * Reset tokens yang used/expired langsung dihapus tanpa nunggu
 */
async function autoCleanTrash() {
    try {
        const { rowCount } = await db.query(
            `DELETE FROM admin_reset_tokens WHERE used = TRUE OR expires_at < NOW()`
        );
        if (rowCount > 0) console.log(`🗑️ Auto-clean: ${rowCount} expired/used reset tokens deleted`);
    } catch (e) {
        console.warn('Auto-clean tokens failed:', e.message);
    }
}

/**
 * Get cleanup status - berapa data lama, warning countdown
 * GET /api/admin/cleanup/status
 */
exports.getCleanupStatus = async (req, res) => {
    try {
        // Auto-clean sampah dulu
        await autoCleanTrash();

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_DAYS);

        // Messages > 30 hari
        const { rows: [msgCount] } = await db.query(
            `SELECT COUNT(*) as total FROM messages WHERE sent_at < $1`,
            [cutoffDate]
        );

        // Broadcast jobs yang SELESAI > 30 hari lalu
        const { rows: [bcastJobCount] } = await db.query(
            `SELECT COUNT(*) as total FROM broadcast_jobs
             WHERE status IN ('completed','stopped') AND created_at < $1`,
            [cutoffDate]
        );

        // Broadcast recipients dari job yang SELESAI > 30 hari lalu
        const { rows: [bcastRecCount] } = await db.query(
            `SELECT COUNT(*) as total FROM broadcast_recipients
             WHERE job_id IN (
                SELECT id FROM broadcast_jobs
                WHERE status IN ('completed','stopped') AND created_at < $1
             )`,
            [cutoffDate]
        );

        // WA message log > 30 hari
        const { rows: [waLogCount] } = await db.query(
            `SELECT COUNT(*) as total FROM whatsapp_logs WHERE created_at < $1`,
            [cutoffDate]
        );

        // WA daily stats > 90 hari
        const cutoff90 = new Date();
        cutoff90.setDate(cutoff90.getDate() - 90);
        const { rows: [waDailyCount] } = await db.query(
            `SELECT COUNT(*) as total FROM wa_daily_stats WHERE stat_date < $1`,
            [cutoff90]
        );

        // Audit logs > 90 hari
        const { rows: [auditCount] } = await db.query(
            `SELECT COUNT(*) as total FROM admin_activity_logs WHERE created_at < $1`,
            [cutoff90]
        );

        // Cari tanggal data paling lama
        const { rows: [oldest] } = await db.query(
            `SELECT MIN(sent_at) as oldest_message FROM messages`
        );

        // Hitung hari sampai cleanup berikutnya
        let daysUntilCleanup = null;
        if (oldest.oldest_message) {
            const oldestDate = new Date(oldest.oldest_message);
            const cleanupDate = new Date(oldestDate);
            cleanupDate.setDate(cleanupDate.getDate() + CLEANUP_DAYS);
            const now = new Date();
            daysUntilCleanup = Math.max(0, Math.ceil((cleanupDate - now) / (1000 * 60 * 60 * 24)));
        }

        const totalOldRecords = parseInt(msgCount.total) + parseInt(bcastJobCount.total) + parseInt(bcastRecCount.total) + parseInt(waLogCount.total) + parseInt(waDailyCount.total) + parseInt(auditCount.total);

        res.json({
            success: true,
            data: {
                oldMessages: parseInt(msgCount.total),
                oldBroadcastJobs: parseInt(bcastJobCount.total),
                oldBroadcastRecipients: parseInt(bcastRecCount.total),
                oldWALogs: parseInt(waLogCount.total),
                oldWADailyStats: parseInt(waDailyCount.total),
                oldAuditLogs: parseInt(auditCount.total),
                totalOldRecords,
                cutoffDate: cutoffDate.toISOString(),
                daysUntilCleanup,
                cleanupDays: CLEANUP_DAYS
            }
        });
    } catch (error) {
        console.error('❌ Cleanup status error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil status cleanup' });
    }
};

/**
 * Export old logs to CSV before deletion
 * GET /api/admin/cleanup/export
 */
exports.exportOldLogs = async (req, res) => {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_DAYS);

        // Export messages
        const { rows: messages } = await db.query(
            `SELECT m.id, m.direction, m.message, m.sent_at,
                    c.nama_lengkap, c.whatsapp
             FROM messages m
             LEFT JOIN customers c ON c.id = m.customer_id
             WHERE m.sent_at < $1
             ORDER BY m.sent_at ASC`,
            [cutoffDate]
        );

        // Export broadcast jobs (selesai) + recipients
        const { rows: broadcasts } = await db.query(
            `SELECT bj.id as job_id, bj.message as broadcast_message, bj.status as job_status,
                    bj.total, bj.sent, bj.failed, bj.created_at as job_date,
                    br.customer_name, br.customer_phone, br.status as recipient_status,
                    br.error, br.sent_at
             FROM broadcast_jobs bj
             LEFT JOIN broadcast_recipients br ON br.job_id = bj.id
             WHERE bj.status IN ('completed','stopped') AND bj.created_at < $1
             ORDER BY bj.created_at ASC, br.id ASC`,
            [cutoffDate]
        );

        // Build CSV
        let csv = 'CHAT LOG\n';
        csv += 'ID,Nama,WhatsApp,Direction,Pesan,Tanggal\n';
        messages.forEach(m => {
            const msg = (m.message || '').replace(/"/g, '""').replace(/\n/g, ' ');
            const date = new Date(m.sent_at).toLocaleString('id-ID');
            csv += `${m.id},"${m.nama_lengkap || ''}","${m.whatsapp || ''}",${m.direction},"${msg}","${date}"\n`;
        });

        csv += '\n\nBROADCAST LOG\n';
        csv += 'Job ID,Pesan Broadcast,Status Job,Total,Sent,Failed,Tanggal Job,Nama Penerima,No HP,Status Kirim,Error,Tanggal Kirim\n';
        broadcasts.forEach(b => {
            const bMsg = (b.broadcast_message || '').replace(/"/g, '""').replace(/\n/g, ' ');
            const jobDate = new Date(b.job_date).toLocaleString('id-ID');
            const sentDate = b.sent_at ? new Date(b.sent_at).toLocaleString('id-ID') : '';
            csv += `${b.job_id},"${bMsg}",${b.job_status},${b.total},${b.sent},${b.failed},"${jobDate}","${b.customer_name || ''}","${b.customer_phone || ''}",${b.recipient_status || ''},"${b.error || ''}","${sentDate}"\n`;
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="backup-logs-${new Date().toISOString().slice(0,10)}.csv"`);
        res.send('\uFEFF' + csv); // BOM for Excel
    } catch (error) {
        console.error('❌ Export logs error:', error);
        res.status(500).json({ success: false, message: 'Gagal export data' });
    }
};

/**
 * Delete old logs (permanent)
 * POST /api/admin/cleanup/delete
 */
exports.deleteOldLogs = async (req, res) => {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - CLEANUP_DAYS);

        // 1. Hapus reset tokens (sampah, langsung hapus semua yg used/expired)
        const { rowCount: tokenDeleted } = await db.query(
            `DELETE FROM admin_reset_tokens WHERE used = TRUE OR expires_at < NOW()`
        );

        // 2. Hapus broadcast recipients dari job yang SELESAI > 30 hari
        const { rowCount: recDeleted } = await db.query(
            `DELETE FROM broadcast_recipients
             WHERE job_id IN (
                SELECT id FROM broadcast_jobs
                WHERE status IN ('completed','stopped') AND created_at < $1
             )`,
            [cutoffDate]
        );

        // 3. Hapus broadcast jobs yang SELESAI > 30 hari
        const { rowCount: jobDeleted } = await db.query(
            `DELETE FROM broadcast_jobs
             WHERE status IN ('completed','stopped') AND created_at < $1`,
            [cutoffDate]
        );

        // 4. Hapus messages > 30 hari
        const { rowCount: msgDeleted } = await db.query(
            `DELETE FROM messages WHERE sent_at < $1`,
            [cutoffDate]
        );

        // 5. Hapus whatsapp_logs > 30 hari
        const { rowCount: waLogDeleted } = await db.query(
            `DELETE FROM whatsapp_logs WHERE created_at < $1`,
            [cutoffDate]
        );

        // 6. Hapus wa_daily_stats > 90 hari
        const cutoff90 = new Date();
        cutoff90.setDate(cutoff90.getDate() - 90);
        const { rowCount: waDailyDeleted } = await db.query(
            `DELETE FROM wa_daily_stats WHERE stat_date < $1`,
            [cutoff90]
        );

        // 7. Hapus admin_activity_logs > 90 hari
        const { rowCount: auditDeleted } = await db.query(
            `DELETE FROM admin_activity_logs WHERE created_at < $1`,
            [cutoff90]
        );

        const totalDeleted = recDeleted + jobDeleted + msgDeleted + tokenDeleted + waLogDeleted + waDailyDeleted + auditDeleted;

        console.log(`Cleanup: ${msgDeleted} messages, ${jobDeleted} jobs, ${recDeleted} recipients, ${tokenDeleted} tokens, ${waLogDeleted} wa_logs, ${waDailyDeleted} wa_daily, ${auditDeleted} audit_logs`);

        res.json({
            success: true,
            message: `${totalDeleted} data lama berhasil dihapus`,
            deleted: {
                messages: msgDeleted,
                broadcastJobs: jobDeleted,
                broadcastRecipients: recDeleted,
                expiredTokens: tokenDeleted,
                waMessageLogs: waLogDeleted,
                waDailyStats: waDailyDeleted,
                auditLogs: auditDeleted,
                total: totalDeleted
            }
        });
    } catch (error) {
        console.error('❌ Delete logs error:', error);
        res.status(500).json({ success: false, message: 'Gagal menghapus data' });
    }
};

// ============================================
// AUDIT TRAIL
// ============================================

/**
 * Get admin activity logs
 * GET /api/admin/audit-log?limit=50
 */
exports.getAuditLog = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const { rows } = await db.query(
            `SELECT id, admin_username, action, detail, ip_address, created_at
             FROM admin_activity_logs
             ORDER BY created_at DESC LIMIT $1`,
            [limit]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('❌ Audit log error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil audit log' });
    }
};
