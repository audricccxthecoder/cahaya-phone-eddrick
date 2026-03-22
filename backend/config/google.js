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

    /**
     * Search existing contact by phone number
     */
    async findContactByPhone(people, phone) {
        try {
            const res = await people.people.searchContacts({
                query: phone,
                readMask: 'names,phoneNumbers',
                pageSize: 5
            });

            const results = res.data.results || [];
            // Match by phone number (strip non-digits for comparison)
            const cleanSearch = phone.replace(/\D/g, '');
            for (const r of results) {
                const phones = r.person?.phoneNumbers || [];
                for (const p of phones) {
                    if (p.value && p.value.replace(/\D/g, '').endsWith(cleanSearch.slice(-10))) {
                        return r.person;
                    }
                }
            }
            return null;
        } catch (err) {
            console.warn('⚠️ Contact search failed:', err.message);
            return null;
        }
    }

    async saveContact(customer) {
        try {
            console.log(`📇 Attempting to save contact: ${customer.nama_lengkap}`);
            const auth = await this.getAuthenticatedClient();
            if (!auth) {
                console.warn('⚠️ Google Contacts not connected, skipping save');
                return { success: false, error: 'Not connected' };
            }

            // Force token refresh if needed
            await auth.getAccessToken();

            const people = google.people({ version: 'v1', auth });

            // Format phone: ensure +62 prefix
            let phone = customer.whatsapp || '';
            if (phone.startsWith('62')) phone = '+' + phone;
            else if (!phone.startsWith('+')) phone = '+62' + phone;

            // Format tanggal: DD/MM/YYYY
            const now = new Date();
            const tanggal = `${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;

            // Nama kontak berdasarkan tipe:
            // Belanja (form submit): "Nama - 20/03/2026"
            // Chat Only (WA chat): "Customer - 20/03/2026"
            const tipe = customer.tipe || 'Belanja';
            let contactName;
            if (tipe === 'Chat Only') {
                contactName = `Customer - ${tanggal}`;
            } else {
                contactName = `${customer.nama_lengkap} - ${tanggal}`;
            }

            // Build contact data
            const contactData = {
                names: [{
                    givenName: contactName,
                    displayName: contactName
                }],
                phoneNumbers: [{
                    value: phone,
                    type: 'mobile'
                }]
            };

            if (customer.alamat) {
                contactData.addresses = [{
                    formattedValue: customer.alamat,
                    type: 'home'
                }];
            }

            const notes = [];
            notes.push(`Tipe: ${tipe}`);
            if (customer.merk_unit) notes.push(`Merk: ${customer.merk_unit}`);
            if (customer.tipe_unit) notes.push(`Unit: ${customer.tipe_unit}`);
            if (customer.metode_pembayaran) notes.push(`Bayar: ${customer.metode_pembayaran}`);
            if (customer.source) notes.push(`Dari: ${customer.source}`);
            notes.push(`Tanggal: ${tanggal}`);

            contactData.biographies = [{
                value: `[Cahaya Phone]\n${notes.join('\n')}`,
                contentType: 'TEXT_PLAIN'
            }];

            // Check if contact already exists by phone number
            const existing = await this.findContactByPhone(people, phone);

            let result;
            if (existing && existing.resourceName) {
                // Update existing contact
                const etag = existing.etag;
                const updateBody = { ...contactData, etag };
                result = await people.people.updateContact({
                    resourceName: existing.resourceName,
                    updatePersonFields: 'names,phoneNumbers,addresses,biographies',
                    requestBody: updateBody
                });
                console.log(`✅ Google Contact updated: ${contactName}`);
                return { success: true, resourceName: result.data.resourceName, action: 'updated' };
            } else {
                // Create new contact
                result = await people.people.createContact({
                    requestBody: contactData
                });
                console.log(`✅ Google Contact created: ${contactName}`);
                return { success: true, resourceName: result.data.resourceName, action: 'created' };
            }

        } catch (error) {
            console.error('❌ Google Contact save failed:', error.message);
            console.error('❌ Full error:', JSON.stringify(error.response?.data || error.errors || error.message));
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
