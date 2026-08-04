let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { /* SMTP yapılandırılana kadar isteğe bağlıdır. */ }
const config = require('./email.config');

function resolveFrom(user) {
    const configured = String(config.from || process.env.MAIL_FROM || '').trim();
    // Yalnız görünen ad yazılırsa Gmail mesajı kabul etse bile teslimi güvenilir
    // olmayabilir. Her zaman geçerli bir RFC adresi kullan.
    if (!configured) return user;
    return configured.includes('@') ? configured : `"${configured.replace(/"/g, '')}" <${user}>`;
}

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
        from: resolveFrom(user),
        to: config.recipient || alert.email,
        subject: `PİNTİ alarmı: ${alert.title}`,
        text: `${alert.title}\nGüncel fiyat: ${Number(price).toLocaleString('tr-TR')} TL\nTetikleyici: ${reasons.join(', ')}\n${alert.product_url}`
    });
    console.log(`Alarm e-postası gönderildi: ${alert.title}`);
    return true;
}

async function sendPriceChangesEmail(sourceLabel, changes, recipient = 'faatihuslu@gmail.com') {
    const host = config.host || process.env.SMTP_HOST;
    const user = config.user || process.env.SMTP_USER;
    const pass = config.pass || process.env.SMTP_PASS;
    if (!changes.length || !nodemailer || !host || !user || !pass) {
        if (changes.length) console.warn(`Fiyat değişim e-postası gönderilmedi (SMTP yapılandırılmamış): ${sourceLabel}`);
        return false;
    }
    const transport = nodemailer.createTransport({
        host,
        port: Number(config.port || process.env.SMTP_PORT || 587),
        secure: config.secure || process.env.SMTP_SECURE === 'true',
        auth: { user, pass }
    });
    const price = value => `${Number(value).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
    const lines = changes.map((change, index) => [
        `${index + 1}. ${change.title}`,
        `Önceki fiyat: ${price(change.previousPrice)}`,
        `Yeni fiyat: ${price(change.currentPrice)}`,
        change.productUrl
    ].join('\n'));
    await transport.sendMail({
        from: resolveFrom(user),
        to: config.recipient || recipient,
        subject: `PİNTİ fiyat değişimi: ${sourceLabel} (${changes.length} ürün)`,
        text: `${sourceLabel} taramasında fiyatı değişen ürünler:\n\n${lines.join('\n\n')}`
    });
    console.log(`Fiyat değişimi e-postası gönderildi: ${sourceLabel} (${changes.length} ürün).`);
    return true;
}

module.exports = { sendAlertEmail, sendPriceChangesEmail };
