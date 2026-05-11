// ============================================
// BILLING REMINDER — pings owner WA before Railway billing date
//
// Why: Railway auto-charges the card on file every billing cycle. If the
// charge fails (expired card, insufficient balance, dispute), services
// enter a grace period and then suspend — which would take Cahaya Phone
// CRM offline. A simple H-3 + H reminder gives the owner time to top up
// the card or update payment details, keeping operations smooth.
//
// Schedule (Asia/Makassar):
//   - H-3 (BILLING_DAY - 3) at 09:00 — "siap-siap"
//   - H   (BILLING_DAY)     at 09:00 — "hari ini billing"
//
// Recipient: OWNER_PHONE_REMINDER env var (Indonesian format, e.g. 6281xxxx)
// Billing day: BILLING_DAY env var, defaults to 11 (Hobby plan signup date)
// ============================================

const whatsappService = require('../config/whatsapp');
const { spinText } = require('../config/wa-worker');

const DEFAULT_BILLING_DAY = 11;
const DEFAULT_REMINDER_HOUR = 9;       // 09:00 WITA, well inside working hours

// Spintax-based templates for variation — each fire picks a random template
// AND each {x|y|z} group resolves to one option, so the same content reads
// slightly different every month. Less robotic feel.
const H3_TEMPLATES = [
    `{Halo|Hai|Pagi} Kak Eddrick! {👋|✨|☀️}

{Reminder|Ngingetin|Ngepingin} {santai|ramah|pelan-pelan} — 3 hari lagi (tanggal {tgl}) jadwal billing *Railway* buat hosting Cahaya Phone CRM 💳

{Pastiin|Mohon dicek} saldo kartu cukup ya, biar server gak {kena suspend|terputus} & operasional toko {tetep lancar|aman jalan terus} 🙏

— Auto-reminder sistem`,

    `{Halo|Hai} Kak! {📅|⏰}

H-3 nih dari tanggal billing *Railway* (tanggal {tgl}). Mumpung masih ada waktu, cek dashboard Railway: pastiin payment method aktif & saldo aman.

Kalau udah dicek tinggal {abaikan|skip} aja pesan ini ya 😄

— Auto-reminder sistem`,

    `{Selamat pagi|Pagi} Kak Eddrick! {☀️|🚀}

Ngingetin pelan: 3 hari lagi billing Railway (tanggal {tgl}) buat hosting Cahaya Phone. {Top up kartu kalo perlu|Mastiin pembayaran lancar} ya — biar bisnis {lancar tanpa hambatan|gak kena downtime} 🙌

— Auto-reminder sistem`
];

const H_TEMPLATES = [
    `{Halo|Hai} Kak Eddrick! {📅|💳|⏰}

Hari ini *tanggal billing Railway* (tgl {tgl}) buat hosting Cahaya Phone CRM. Sempetin cek dashboard sebentar, mastiin payment sukses & server CRM jalan terus 🙏

Kalau udah ke-charge, anggap aja gak ada chat ini 😄

— Auto-reminder sistem`,

    `Pagi Kak! {☀️|🌅}

{Reminder|Heads up}: hari H billing Railway nih. Cek email dari Railway buat status invoice — kalau sukses, semua aman. Kalau gagal, ada grace period ~7 hari sebelum suspend, masih sempet update.

— Auto-reminder sistem`,

    `{Halo|Hai|Pagi} Kak Eddrick! {⏰|💼}

Tanggal {tgl} = *Billing Day Railway* {🎯|🚀}. Cepetin cek dashboard biar gak ada surprise downtime nanti malam.

Server CRM Cahaya Phone aman selama payment OK 🙏

— Auto-reminder sistem`
];

function pickTemplate(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function todayDateWITA() {
    // WITA = UTC+8
    const wita = new Date(Date.now() + 8 * 60 * 60 * 1000);
    return wita.getUTCDate();   // 1..31
}

/**
 * Internal: actually fire the WA send for a given reminder type.
 * Type: 'h3' (3 days before) | 'h' (billing day)
 */
async function sendReminder(type) {
    const recipient = process.env.OWNER_PHONE_REMINDER;
    if (!recipient) {
        console.warn('[BillingReminder] OWNER_PHONE_REMINDER not configured — skipping');
        return { success: false, error: 'recipient_not_configured' };
    }

    const billingDay = Number(process.env.BILLING_DAY) || DEFAULT_BILLING_DAY;
    const templates = type === 'h3' ? H3_TEMPLATES : H_TEMPLATES;
    let message = spinText(pickTemplate(templates));
    message = message.replace(/\{tgl\}/g, String(billingDay));

    console.log(`[BillingReminder] Sending ${type} reminder to ${recipient}`);

    // skipOptCheck because owner can't opt-out of operational reminders.
    // category lets us see them separately in whatsapp_logs.
    const result = await whatsappService.sendText(recipient, message, {
        typing: true,
        skipOptCheck: true,
        category: 'billing_reminder'
    });

    if (result.success) {
        console.log(`[BillingReminder] ✅ ${type} reminder sent (wa_id: ${result.wa_message_id})`);
    } else {
        console.warn(`[BillingReminder] ❌ ${type} reminder failed: ${result.error}`);
    }
    return result;
}

/**
 * Daily cron entry point — checks today's WITA date against billing schedule
 * and fires the appropriate reminder. Wired to run once per day at 09:00 WITA
 * in server.js. Single cron handles BOTH H-3 and H cases for simplicity.
 */
async function cronDailyCheck() {
    const billingDay = Number(process.env.BILLING_DAY) || DEFAULT_BILLING_DAY;
    const today = todayDateWITA();

    // Compute H-3 day. If billingDay is 11 → H-3 is 8. We don't wrap around
    // months because Railway's billing date stays the same each month.
    const h3Day = billingDay - 3;

    if (today === h3Day) {
        return sendReminder('h3');
    }
    if (today === billingDay) {
        return sendReminder('h');
    }
    // Other days: do nothing.
    return { success: true, skipped: true };
}

/**
 * Manual test endpoint — owner can hit /api/admin/billing-reminder/test
 * to verify the WA template renders correctly without waiting for the cron.
 */
async function testReminder(req, res) {
    const type = (req.query.type === 'h') ? 'h' : 'h3';
    const result = await sendReminder(type);
    res.json({ success: !!result.success, type, result });
}

module.exports = {
    DEFAULT_REMINDER_HOUR,
    cronDailyCheck,
    sendReminder,
    testReminder
};
