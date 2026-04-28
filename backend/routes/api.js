// ============================================
// API ROUTES
// ============================================

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

// Controllers
const formController = require('../controllers/formController');
const webhookController = require('../controllers/webhookController');
const adminController = require('../controllers/adminController');
const googleController = require('../controllers/googleController');
const birthdayController = require('../controllers/birthdayController');

// Middleware
const authMiddleware = require('../config/authMiddleware');
const { auditLog } = require('../config/auditLog');

// Rate limiters for public endpoints
const formLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Terlalu banyak pengiriman form. Coba lagi dalam 15 menit.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' },
    standardHeaders: true,
    legacyHeaders: false
});

const forgotLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Terlalu banyak permintaan reset password. Coba lagi dalam 1 jam.' },
    standardHeaders: true,
    legacyHeaders: false
});

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

// Customer form submission (rate limited)
router.post('/form-submit', formLimiter, formController.submitForm);

// WhatsApp webhook — incoming messages from wa-bridge (Baileys)
router.post('/webhook/whatsapp', webhookController.handleWhatsAppWebhook);
router.get('/webhook/test', webhookController.testWebhook);

// Quick-sync contacts (protected by secret key in Authorization header)
router.get('/sync/contacts', adminController.quickSyncVCF);
router.get('/sync/list', adminController.quickSyncList);
router.post('/sync/contacts/selected', adminController.quickSyncSelected);

// Google Contacts OAuth
router.get('/google/auth', googleController.authorize);
router.get('/google/callback', googleController.callback);
router.get('/google/status', authMiddleware, googleController.status);
router.post('/google/disconnect', authMiddleware, googleController.disconnect);

// Admin login (rate limited)
router.post('/admin/login', loginLimiter, adminController.login);

// Admin profile update (edit name)
router.patch('/admin/profile', authMiddleware, adminController.updateProfile);

// Admin change credentials (username/password)
router.patch('/admin/credentials', authMiddleware, adminController.changeCredentials);

// Forgot password / reset (rate limited)
router.post('/admin/forgot', forgotLimiter, adminController.forgotPassword);
router.get('/admin/reset/validate', adminController.validateResetToken);
router.post('/admin/reset', adminController.resetPassword);

// ============================================
// PROTECTED ROUTES (Authentication required)
// ============================================

// Dashboard statistics
router.get('/admin/stats', authMiddleware, adminController.getStats);
router.get('/admin/pipeline/monthly', authMiddleware, adminController.getPipelineMonthly);

// Customers
router.get('/admin/customers', authMiddleware, adminController.getCustomers);
router.get('/admin/customers/export', authMiddleware, adminController.exportContacts);
router.get('/admin/customers/export/vcf', authMiddleware, adminController.exportVCard);
router.patch('/admin/customers/:id/status', authMiddleware, auditLog('update_customer_status'), adminController.updateCustomerStatus);
router.patch('/admin/customers/:id/catatan', authMiddleware, auditLog('update_customer_catatan'), adminController.updateCustomerCatatan);
router.get('/admin/customers/:id', authMiddleware, adminController.getCustomerById);

// Messages
router.get('/admin/messages', authMiddleware, adminController.getMessages);
router.get('/admin/messages/:customerId', authMiddleware, adminController.getMessagesByCustomer);

// Analytics
router.get('/admin/analytics/top-buyers', authMiddleware, adminController.getTopBuyers);
router.get('/admin/analytics/top-products', authMiddleware, adminController.getTopProducts);
router.get('/admin/analytics/top-brands', authMiddleware, adminController.getTopBrands);

// Broadcast
router.post('/admin/broadcast/start', authMiddleware, auditLog('broadcast_start'), adminController.startBroadcast);
router.post('/admin/broadcast/process', authMiddleware, adminController.processBroadcast);
router.post('/admin/broadcast/stop', authMiddleware, auditLog('broadcast_stop'), adminController.stopBroadcast);
router.post('/admin/broadcast/pause', authMiddleware, auditLog('broadcast_pause'), adminController.pauseBroadcast);
router.post('/admin/broadcast/resume', authMiddleware, auditLog('broadcast_resume'), adminController.resumeBroadcast);
router.get('/admin/broadcast/status', authMiddleware, adminController.getBroadcastStatus);
router.get('/admin/broadcast/daily-count', authMiddleware, adminController.getDailySentCount);

// WA API routes (Fonnte)
router.get('/admin/wa/status', authMiddleware, adminController.getWABridgeStatus);
router.post('/admin/wa/auto-reply', authMiddleware, adminController.updateWAAutoReply);
router.get('/admin/wa/auto-reply', authMiddleware, adminController.getWAAutoReply);
router.post('/admin/wa/disconnect', authMiddleware, adminController.disconnectWA);
router.post('/admin/wa/restart', authMiddleware, adminController.restartWA);
router.post('/admin/wa/settings', authMiddleware, auditLog('update_wa_settings'), adminController.updateWASettings);
router.get('/admin/wa/failed', authMiddleware, adminController.getFailedWA);
router.post('/admin/wa/retry/:id', authMiddleware, adminController.retryWA);
router.post('/admin/wa/retry-all', authMiddleware, adminController.retryAllWA);
router.get('/admin/wa/log', authMiddleware, adminController.getWAMessageLog);

// Birthday greetings
router.get('/admin/birthday/today', authMiddleware, birthdayController.getTodayBirthdays);
router.post('/admin/birthday/send', authMiddleware, birthdayController.sendGreeting);
router.post('/admin/birthday/send-all', authMiddleware, birthdayController.sendAllGreetings);
router.put('/admin/birthday/message', authMiddleware, birthdayController.updateMessage);
router.post('/admin/birthday/auto-send', authMiddleware, birthdayController.toggleAutoSend);
router.get('/admin/birthday/history', authMiddleware, birthdayController.getHistory);

// Data cleanup
router.get('/admin/cleanup/status', authMiddleware, adminController.getCleanupStatus);
router.get('/admin/cleanup/export', authMiddleware, adminController.exportOldLogs);
router.post('/admin/cleanup/delete', authMiddleware, auditLog('cleanup_delete'), adminController.deleteOldLogs);

// Audit trail
router.get('/admin/audit-log', authMiddleware, adminController.getAuditLog);

// App settings — global auto toggles
router.get('/admin/settings/auto-toggles', authMiddleware, adminController.getAutoToggles);
router.post('/admin/settings/auto-toggles', authMiddleware, auditLog('update_auto_toggle'), adminController.setAutoToggle);

module.exports = router;