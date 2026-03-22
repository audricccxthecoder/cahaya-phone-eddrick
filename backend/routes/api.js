// ============================================
// API ROUTES
// ============================================

const express = require('express');
const router = express.Router();

// Controllers
const formController = require('../controllers/formController');
const webhookController = require('../controllers/webhookController');
const adminController = require('../controllers/adminController');
const invoiceController = require('../controllers/invoiceController');
const googleController = require('../controllers/googleController');

// Middleware
const authMiddleware = require('../config/authMiddleware');

// ============================================
// PUBLIC ROUTES (No authentication required)
// ============================================

// Customer form submission
router.post('/form-submit', formController.submitForm);

// WhatsApp webhook
router.post('/webhook/whatsapp', webhookController.handleWhatsAppWebhook);
router.get('/webhook/test', webhookController.testWebhook);

// Quick-sync contacts (no login, secret key)
router.get('/sync/contacts', adminController.quickSyncVCF);
router.get('/sync/list', adminController.quickSyncList);
router.post('/sync/contacts/selected', adminController.quickSyncSelected);

// Google Contacts OAuth
router.get('/google/auth', googleController.authorize);
router.get('/google/callback', googleController.callback);
router.get('/google/status', authMiddleware, googleController.status);
router.post('/google/disconnect', authMiddleware, googleController.disconnect);

// Public invoice view (no auth)
router.get('/nota/:token', invoiceController.getInvoicePublic);

// Admin login
router.post('/admin/login', adminController.login);

// Admin profile update (edit name)
router.patch('/admin/profile', authMiddleware, adminController.updateProfile);

// Admin change credentials (username/password)
router.patch('/admin/credentials', authMiddleware, adminController.changeCredentials);

// Forgot password / reset
router.post('/admin/forgot', adminController.forgotPassword);
router.get('/admin/reset/validate', adminController.validateResetToken);
router.post('/admin/reset', adminController.resetPassword);

// Debug route (development only) - list admins
router.get('/debug/admins', adminController.debugAdmins);

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
router.patch('/admin/customers/:id/status', authMiddleware, adminController.updateCustomerStatus);
router.patch('/admin/customers/:id/catatan', authMiddleware, adminController.updateCustomerCatatan);
router.get('/admin/customers/:id', authMiddleware, adminController.getCustomerById);

// Invoices (Nota Digital)
router.get('/admin/invoices', authMiddleware, invoiceController.getInvoices);
router.post('/admin/invoices', authMiddleware, invoiceController.createInvoice);
router.post('/admin/invoices/from-purchase', authMiddleware, invoiceController.createFromPurchase);
router.get('/admin/invoices/:id', authMiddleware, invoiceController.getInvoiceById);
router.delete('/admin/invoices/:id', authMiddleware, invoiceController.deleteInvoice);

// Messages
router.get('/admin/messages', authMiddleware, adminController.getMessages);
router.get('/admin/messages/:customerId', authMiddleware, adminController.getMessagesByCustomer);

// Analytics
router.get('/admin/analytics/top-buyers', authMiddleware, adminController.getTopBuyers);
router.get('/admin/analytics/top-products', authMiddleware, adminController.getTopProducts);
router.get('/admin/analytics/top-brands', authMiddleware, adminController.getTopBrands);

// Broadcast
router.post('/admin/broadcast/start', authMiddleware, adminController.startBroadcast);
router.post('/admin/broadcast/process', authMiddleware, adminController.processBroadcast);
router.post('/admin/broadcast/stop', authMiddleware, adminController.stopBroadcast);
router.post('/admin/broadcast/pause', authMiddleware, adminController.pauseBroadcast);
router.post('/admin/broadcast/resume', authMiddleware, adminController.resumeBroadcast);
router.get('/admin/broadcast/status', authMiddleware, adminController.getBroadcastStatus);
router.get('/admin/broadcast/daily-count', authMiddleware, adminController.getDailySentCount);

// WA Bridge proxy routes (admin dashboard → WA Bridge service)
router.get('/admin/wa/status', authMiddleware, adminController.getWABridgeStatus);
router.post('/admin/wa/auto-reply', authMiddleware, adminController.updateWAAutoReply);
router.get('/admin/wa/auto-reply', authMiddleware, adminController.getWAAutoReply);
router.post('/admin/wa/disconnect', authMiddleware, adminController.disconnectWA);
router.post('/admin/wa/restart', authMiddleware, adminController.restartWA);
router.post('/admin/wa/settings', authMiddleware, adminController.updateWASettings);

// Data cleanup
router.get('/admin/cleanup/status', authMiddleware, adminController.getCleanupStatus);
router.get('/admin/cleanup/export', authMiddleware, adminController.exportOldLogs);
router.post('/admin/cleanup/delete', authMiddleware, adminController.deleteOldLogs);

module.exports = router;