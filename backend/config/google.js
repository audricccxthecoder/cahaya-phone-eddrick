// ============================================
// GOOGLE CONTACTS SERVICE
// OAuth 2.0 + People API for auto-saving contacts
// ============================================

const { google } = require('googleapis');
const db = require('./database');
require('dotenv').config();

class GoogleContactsService {
    constructor() {
        this.clientId = process.env.GOOGLE_CLIENT_ID;
        this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        this.redirectUri = process.env.GOOGLE_REDIRECT_URI;
    }

    getOAuth2Client() {
        return new google.auth.OAuth2(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );
    }

    getAuthUrl() {
        const oauth2Client = this.getOAuth2Client();
        return oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: [
                'https://www.googleapis.com/auth/contacts'
            ]
        });
    }

    async handleCallback(code) {
        const oauth2Client = this.getOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);

        // Store tokens in database
        await db.query(`
            CREATE TABLE IF NOT EXISTS google_tokens (
                id SERIAL PRIMARY KEY,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expiry_date BIGINT,
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // Upsert: delete old, insert new
        await db.query('DELETE FROM google_tokens');
        await db.query(
            `INSERT INTO google_tokens (access_token, refresh_token, expiry_date) VALUES ($1, $2, $3)`,
            [tokens.access_token, tokens.refresh_token, tokens.expiry_date]
        );

        return tokens;
    }

    async getAuthenticatedClient() {
        const result = await db.query('SELECT * FROM google_tokens ORDER BY id DESC LIMIT 1');
        if (result.rows.length === 0) return null;

        const token = result.rows[0];
        const oauth2Client = this.getOAuth2Client();
        oauth2Client.setCredentials({
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expiry_date: parseInt(token.expiry_date)
        });

        // Auto-refresh if expired
        oauth2Client.on('tokens', async (newTokens) => {
            const updates = [newTokens.access_token, newTokens.expiry_date];
            if (newTokens.refresh_token) {
                await db.query(
                    `UPDATE google_tokens SET access_token = $1, refresh_token = $2, expiry_date = $3, updated_at = NOW()`,
                    [newTokens.access_token, newTokens.refresh_token, newTokens.expiry_date]
                );
            } else {
                await db.query(
                    `UPDATE google_tokens SET access_token = $1, expiry_date = $2, updated_at = NOW()`,
                    updates
                );
            }
        });

        return oauth2Client;
    }

    async isConnected() {
        try {
            const result = await db.query('SELECT * FROM google_tokens ORDER BY id DESC LIMIT 1');
            return result.rows.length > 0 && !!result.rows[0].refresh_token;
        } catch {
            return false;
        }
    }

    async saveContact(customer) {
        try {
            const auth = await this.getAuthenticatedClient();
            if (!auth) {
                console.warn('⚠️ Google Contacts not connected, skipping save');
                return { success: false, error: 'Not connected' };
            }

            const people = google.people({ version: 'v1', auth });

            // Format phone: ensure +62 prefix
            let phone = customer.whatsapp || '';
            if (phone.startsWith('62')) phone = '+' + phone;
            else if (!phone.startsWith('+')) phone = '+62' + phone;

            const contactData = {
                names: [{
                    givenName: `${customer.nama_lengkap} - CP`,
                    displayName: `${customer.nama_lengkap} - CP`
                }],
                phoneNumbers: [{
                    value: phone,
                    type: 'mobile'
                }]
            };

            // Add address if available
            if (customer.alamat) {
                contactData.addresses = [{
                    formattedValue: customer.alamat,
                    type: 'home'
                }];
            }

            // Add notes with purchase info
            const notes = [];
            if (customer.merk_unit) notes.push(`Merk: ${customer.merk_unit}`);
            if (customer.tipe_unit) notes.push(`Tipe: ${customer.tipe_unit}`);
            if (customer.metode_pembayaran) notes.push(`Bayar: ${customer.metode_pembayaran}`);
            if (customer.source) notes.push(`Dari: ${customer.source}`);
            notes.push(`Daftar: ${new Date().toLocaleDateString('id-ID')}`);

            if (notes.length > 0) {
                contactData.biographies = [{
                    value: `[Cahaya Phone Customer]\n${notes.join('\n')}`,
                    contentType: 'TEXT_PLAIN'
                }];
            }

            const result = await people.people.createContact({
                requestBody: contactData
            });

            console.log(`✅ Google Contact saved: ${customer.nama_lengkap}`);
            return { success: true, resourceName: result.data.resourceName };

        } catch (error) {
            console.error('❌ Google Contact save failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    async disconnect() {
        try {
            const auth = await this.getAuthenticatedClient();
            if (auth) {
                await auth.revokeCredentials().catch(() => {});
            }
            await db.query('DELETE FROM google_tokens');
            return { success: true };
        } catch (error) {
            await db.query('DELETE FROM google_tokens').catch(() => {});
            return { success: true };
        }
    }
}

module.exports = new GoogleContactsService();
