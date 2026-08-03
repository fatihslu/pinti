let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { /* SMTP yapılandırılana kadar isteğe bağlıdır. */ }
const config = require('./email.config');

async function sendAlertEmail(alert, price, reasons) {
    const host = config.host || process.env.SMTP_HOST;
    const user = config.user || process.env.SMTP_USER;
    const pass = config.pass || process.env.SMTP_PASS;
    if (!nodemailer || !host || !user || !pass) {
        console.warn(`E-posta gönderilmedi (SMTP yapılandırılmamış): ${alert.title}`);
        return false;
    }
    const transport = nodemailer.createTransport({
        host,
        port: Number(config.port || process.env.SMTP_PORT || 587),
        secure: config.secure || process.env.SMTP_SECURE === 'true',
        auth: { user, pass }
    });
    await transport.sendMail({
        from: config.from || process.env.MAIL_FROM || user,
        to: config.recipient || alert.email,
        subject: `PİNTİ alarmı: ${alert.title}`,
        text: `${alert.title}\nGüncel fiyat: ${Number(price).toLocaleString('tr-TR')} TL\nTetikleyici: ${reasons.join(', ')}\n${alert.product_url}`
    });
    return true;
}

module.exports = { sendAlertEmail };
