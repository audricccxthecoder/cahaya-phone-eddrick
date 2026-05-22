// ============================================
// GOOGLE CONTROLLER
// OAuth flow + status for Google Contacts API
// ============================================

const googleService = require('../config/google');

/**
 * GET /api/google/auth — Redirect to Google OAuth
 */
exports.authorize = (req, res) => {
    try {
        // Debug: check if env vars are set
        if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
            return res.status(500).json({
                error: 'Google env vars missing',
                hasClientId: !!process.env.GOOGLE_CLIENT_ID,
                hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
                hasRedirectUri: !!process.env.GOOGLE_REDIRECT_URI
            });
        }
        const url = googleService.getAuthUrl();
        res.redirect(url);
    } catch (error) {
        console.error('❌ Google auth error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * GET /api/google/callback — Handle OAuth callback
 */
exports.callback = async (req, res) => {
    try {
        const { code, error } = req.query;

        if (error) {
            return res.redirect('/admin/dashboard.html?google=error&msg=' + encodeURIComponent(error));
        }

        if (!code) {
            return res.redirect('/admin/dashboard.html?google=error&msg=no_code');
        }

        await googleService.handleCallback(code);
        res.redirect('/admin/dashboard.html?google=connected');

    } catch (error) {
        console.error('❌ Google callback error:', error);
        res.redirect('/admin/dashboard.html?google=error&msg=' + encodeURIComponent(error.message));
    }
};

/**
 * GET /api/google/status — Check connection status
 */
exports.status = async (req, res) => {
    try {
        const connected = await googleService.isConnected();
        res.json({ success: true, connected });
    } catch (error) {
        res.json({ success: true, connected: false });
    }
};

/**
 * POST /api/google/disconnect — Disconnect Google account
 */
exports.disconnect = async (req, res) => {
    try {
        await googleService.disconnect();
        res.json({ success: true, message: 'Google account disconnected' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
