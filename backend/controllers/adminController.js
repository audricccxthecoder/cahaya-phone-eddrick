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
    '', '', '', // empty = no prefix (most common, keeps original message)
    'Halo, ', 'Hi, ', 'Hai, ',
];

const RANDOM_CLOSINGS = [
    '', '', '', // empty = no closing (most common)
    ' 😊', ' 🙏', ' ✨', ' 👍',
    '\n\nTerima kasih!', '\n\nSalam hangat!', '\n\nSukses selalu!',
];

/**
 * Add subtle random variations to broadcast message so each one is unique
 * Prevents WhatsApp from detecting identical bulk messages
 */
function variasiPesan(message, customerName) {
    let msg = message.replace(/{nama}/gi, customerName || 'Kak');

    // Random greeting prefix (only if message doesn't already start with greeting)
    const startsWithGreeting = /^(halo|hai|hi|hey|selamat)/i.test(msg);
    if (!startsWithGreeting) {
        const greeting = RANDOM_GREETINGS[Math.floor(Math.random() * RANDOM_GREETINGS.length)];
        if (greeting) msg = greeting + msg;
    }

    // Random closing/emoji at end
    const closing = RANDOM_CLOSINGS[Math.floor(Math.random() * RANDOM_CLOSINGS.length)];
    msg = msg + closing;

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
         WHERE status = 'sent' AND sent_at::date = CURRENT_DATE`
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
        const { rows } = await db.query('SELECT * FROM customer_stats');

        res.json({
            success: true,
            data: rows[0]
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
 * Get all customers
 * GET /api/admin/customers
 */
exports.getCustomers = async (req, res) => {
    try {
        const { rows: customers } = await db.query(
            `SELECT
                id, nama_lengkap, nama_sales, merk_unit, tipe_unit,
                harga, qty, whatsapp, metode_pembayaran,
                source, status, created_at
            FROM customers
            ORDER BY created_at DESC`
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

        res.json({
            success: true,
            data: customers[0]
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
 * Debug: list admins (development only)
 * GET /api/debug/admins
 */
exports.debugAdmins = async (req, res) => {
    if (process.env.NODE_ENV !== 'development') {
        return res.status(403).json({ success: false, message: 'Not allowed' });
    }

    try {
        const { rows } = await db.query('SELECT id, username, nama FROM admins');
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('❌ Debug admins error:', error);
        res.status(500).json({ success: false, message: 'Gagal mengambil admins' });
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
 * Start broadcast (DB-backed, serverless-safe)
 * POST /api/admin/broadcast/start
 * Body: { message, source_filter? }
 */
exports.startBroadcast = async (req, res) => {
    try {
        const { message, source_filter } = req.body;

        if (!message || String(message).trim() === '') {
            return res.status(400).json({ success: false, message: 'Pesan broadcast tidak boleh kosong' });
        }

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

        // Get opted-in customers
        let query = `SELECT id, nama_lengkap, whatsapp FROM customers WHERE opted_in IS NOT FALSE`;
        const params = [];
        if (source_filter) {
            query += ` AND source = $${params.length + 1}`;
            params.push(source_filter);
        }
        query += ` ORDER BY created_at ASC`;

        const { rows: customers } = await db.query(query, params);

        if (customers.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada customer opted-in untuk dibroadcast' });
        }

        // Create broadcast job
        const { rows: [job] } = await db.query(
            `INSERT INTO broadcast_jobs (message, source_filter, status, total) VALUES ($1, $2, 'running', $3) RETURNING id`,
            [message.trim(), source_filter || null, customers.length]
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
 * Process next batch of broadcast messages (serverless-safe)
 * POST /api/admin/broadcast/process
 * Sends up to 5 messages concurrently per call
 */
exports.processBroadcast = async (req, res) => {
    try {
        // Find active broadcast job
        const { rows: jobs } = await db.query(
            `SELECT id, message FROM broadcast_jobs WHERE status = 'running' ORDER BY id DESC LIMIT 1`
        );

        if (jobs.length === 0) {
            return res.json({ success: true, status: { running: false, paused: false, total: 0, sent: 0, failed: 0, queued: 0, log: [] } });
        }

        const job = jobs[0];

        // Anti-spam: send ONE message at a time with random delay
        const { rows: batch } = await db.query(
            `SELECT id, customer_id, customer_name, customer_phone FROM broadcast_recipients
             WHERE job_id = $1 AND status = 'pending' ORDER BY id ASC LIMIT 1`,
            [job.id]
        );

        if (batch.length > 0) {
            const recipient = batch[0];

            // Anti-spam: random delay 3-8 seconds before sending
            await randomDelay(3000, 8000);

            // Anti-spam: variasi pesan agar tidak identik
            const message = variasiPesan(job.message, recipient.customer_name);
            const result = await whatsappService.sendMessage(recipient.customer_phone, message);

            const status = result.success ? 'sent' : 'failed';

            // Update recipient status
            await db.query(
                `UPDATE broadcast_recipients SET status = $1, error = $2, sent_at = NOW() WHERE id = $3`,
                [status, result.error || null, recipient.id]
            );

            // Log to messages table
            await db.query(
                `INSERT INTO messages (customer_id, direction, message) VALUES ($1, 'out', $2)`,
                [recipient.customer_id, `[BROADCAST][${status.toUpperCase()}] ${message}`]
            ).catch(() => {});

            // Auto-advance: New → Contacted on success
            if (result.success) {
                await db.query(
                    `UPDATE customers SET status = 'Contacted' WHERE id = $1 AND status = 'New'`,
                    [recipient.customer_id]
                ).catch(() => {});
            }

            // Update job counters
            const sentCount = result.success ? 1 : 0;
            const failedCount = result.success ? 0 : 1;
            await db.query(
                `UPDATE broadcast_jobs SET sent = sent + $1, failed = failed + $2 WHERE id = $3`,
                [sentCount, failedCount, job.id]
            );
        }

        // Check if all done
        const { rows: [counts] } = await db.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'pending') as queued,
                COUNT(*) FILTER (WHERE status = 'sent') as sent,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) as total
             FROM broadcast_recipients WHERE job_id = $1`,
            [job.id]
        );

        const allDone = parseInt(counts.queued) === 0;
        if (allDone) {
            await db.query(`UPDATE broadcast_jobs SET status = 'completed' WHERE id = $1`, [job.id]);
        }

        // Get recent log entries
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
                running: !allDone,
                paused: false,
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
        await db.query(`UPDATE broadcast_jobs SET status = 'stopped' WHERE status = 'running'`);
        await db.query(
            `UPDATE broadcast_recipients SET status = 'skipped'
             WHERE job_id IN (SELECT id FROM broadcast_jobs WHERE status = 'stopped') AND status = 'pending'`
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
