// ============================================
// ADMIN CONTROLLER
// Handle admin authentication & data
// ============================================

const db = require('../config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const whatsappService = require('../config/whatsapp');
const { sanitizePhone } = require('../utils/phoneUtils');

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

        const { rows: customers } = await db.query(
            `SELECT nama_lengkap, whatsapp, nama_sales, merk_unit, tipe_unit,
                    source, status, opted_in, created_at
             FROM customers ORDER BY created_at DESC`
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

        const { rows: customers } = await db.query(
            `SELECT nama_lengkap, whatsapp FROM customers ORDER BY created_at DESC`
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
 * Start broadcast
 * POST /api/admin/broadcast/start
 * Body: { message, source_filter? }
 */
exports.startBroadcast = async (req, res) => {
    try {
        const { message, source_filter } = req.body;

        if (!message || String(message).trim() === '') {
            return res.status(400).json({ success: false, message: 'Pesan broadcast tidak boleh kosong' });
        }

        // Check if broadcast already running
        const currentStatus = whatsappService.getBroadcastStatus();
        if (currentStatus.running && !currentStatus.paused) {
            return res.status(409).json({
                success: false,
                message: 'Broadcast sedang berjalan. Stop dulu sebelum memulai baru.',
                status: currentStatus
            });
        }

        // Get opted-in customers
        let query = `SELECT id, nama_lengkap, whatsapp FROM customers WHERE opted_in = TRUE`;
        const params = [];
        if (source_filter) {
            query += ` AND source = $1`;
            params.push(source_filter);
        }
        query += ` ORDER BY created_at ASC`;

        const { rows: customers } = await db.query(query, params);

        if (customers.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada customer opted-in untuk dibroadcast' });
        }

        // Log message delivery to DB
        const onLog = async (customerId, msg, deliveryStatus) => {
            const direction = deliveryStatus === 'sent' ? 'out' : 'out';
            await db.query(
                `INSERT INTO messages (customer_id, direction, message) VALUES ($1, $2, $3)`,
                [customerId, direction, `[BROADCAST][${deliveryStatus.toUpperCase()}] ${msg}`]
            );
        };

        const status = whatsappService.startBroadcast(customers, message, onLog);

        res.json({
            success: true,
            message: `Broadcast dimulai untuk ${customers.length} customer`,
            status
        });

    } catch (error) {
        console.error('❌ Start broadcast error:', error);
        res.status(500).json({ success: false, message: 'Gagal memulai broadcast' });
    }
};

/**
 * Stop broadcast
 * POST /api/admin/broadcast/stop
 */
exports.stopBroadcast = async (req, res) => {
    const status = whatsappService.stopBroadcast();
    res.json({ success: true, message: 'Broadcast dihentikan', status });
};

/**
 * Pause broadcast
 * POST /api/admin/broadcast/pause
 */
exports.pauseBroadcast = async (req, res) => {
    const status = whatsappService.pauseBroadcast();
    res.json({ success: true, message: 'Broadcast dijeda', status });
};

/**
 * Resume broadcast
 * POST /api/admin/broadcast/resume
 */
exports.resumeBroadcast = async (req, res) => {
    const status = whatsappService.resumeBroadcast();
    res.json({ success: true, message: 'Broadcast dilanjutkan', status });
};

/**
 * Get broadcast status
 * GET /api/admin/broadcast/status
 */
exports.getBroadcastStatus = async (req, res) => {
    const status = whatsappService.getBroadcastStatus();
    res.json({ success: true, status });
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
