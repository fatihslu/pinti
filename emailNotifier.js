let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { /* Optional until SMTP is configured. */ }
const config = require('./email.config');

function smtpSettings() {
    const host = config.host || process.env.SMTP_HOST;
    const user = config.user || process.env.SMTP_USER;
    const pass = config.pass || process.env.SMTP_PASS;
    if (!nodemailer || !host || !user || !pass) throw new Error('SMTP ayarı eksik: host, kullanıcı ve uygulama şifresi gerekli.');
    return { host, user, pass };
}

function resolveFrom(user) {
    const configured = String(config.from || process.env.MAIL_FROM || '').trim();
    if (!configured) return user;
    return configured.includes('@') ? configured : `"${configured.replace(/"/g, '')}" <${user}>`;
}

function transportFor({ host, user, pass }) {
    return nodemailer.createTransport({
        host,
        port: Number(config.port || process.env.SMTP_PORT || 465),
        secure: config.secure ?? (process.env.SMTP_SECURE !== 'false'),
        auth: { user, pass },
        connectionTimeout: 20000,
        greetingTimeout: 20000,
        socketTimeout: 30000
    });
}

function money(value) {
    return `${Number(value).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
}

function changeDetail(change) {
    const previous = Number(change.previousPrice);
    const current = Number(change.currentPrice);
    const difference = current - previous;
    const percentage = previous > 0 ? Math.abs(difference / previous * 100) : 0;
    return {
        previous,
        current,
        difference,
        percentage,
        direction: difference < 0 ? 'düştü' : 'arttı',
        directionLabel: difference < 0 ? 'DÜŞTÜ' : 'ARTTI',
        amount: Math.abs(difference)
    };
}

async function sendAlertEmail(alert, currentPrice, reasons) {
    const settings = smtpSettings();
    await transportFor(settings).sendMail({
        from: resolveFrom(settings.user),
        to: config.recipient || alert.email,
        subject: `PİNTİ alarmı: ${alert.title}`,
        text: `${alert.title}\nGüncel fiyat: ${money(currentPrice)}\nTetikleyici: ${reasons.join(', ')}\n${alert.product_url}`
    });
    console.log(`Alarm e-postası gönderildi: ${alert.title}`);
    return true;
}

async function sendPriceChangesEmail(sourceLabel, changes, recipient = 'faatihuslu@gmail.com') {
    if (!changes.length) return false;
    const settings = smtpSettings();
    const textRows = changes.map((change, index) => {
        const info = changeDetail(change);
        return `${index + 1}. ${change.title}\nÖnceki: ${money(info.previous)}\nYeni: ${money(info.current)}\n${info.directionLabel}: ${money(info.amount)} (%${info.percentage.toFixed(2)})\n${change.productUrl}`;
    });
    const htmlRows = changes.map(change => {
        const info = changeDetail(change);
        const color = info.difference < 0 ? '#168342' : '#b12704';
        return `<tr><td style="padding:12px;border-bottom:1px solid #e5e7eb"><a href="${change.productUrl}" style="color:#007185;font-weight:700">${change.title}</a></td><td style="padding:12px;border-bottom:1px solid #e5e7eb;text-decoration:line-through;color:#6b7280">${money(info.previous)}</td><td style="padding:12px;border-bottom:1px solid #e5e7eb;font-weight:700">${money(info.current)}</td><td style="padding:12px;border-bottom:1px solid #e5e7eb;color:${color};font-weight:800">${money(info.amount)} (%${info.percentage.toFixed(2)}) ${info.direction}</td></tr>`;
    }).join('');
    await transportFor(settings).sendMail({
        from: resolveFrom(settings.user),
        to: config.recipient || recipient,
        subject: `PİNTİ fiyat değişimi: ${sourceLabel} (${changes.length} ürün)`,
        text: `${sourceLabel} taramasında fiyatı değişen ürünler:\n\n${textRows.join('\n\n')}`,
        html: `<main style="font-family:Arial,sans-serif;color:#1f2937"><h2 style="margin:0 0 8px">PİNTİ fiyat değişimi</h2><p>${sourceLabel} taramasında ${changes.length} ürünün fiyatı değişti.</p><table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Ürün</th><th align="left">Önceki</th><th align="left">Yeni</th><th align="left">Değişim</th></tr></thead><tbody>${htmlRows}</tbody></table></main>`
    });
    console.log(`Fiyat değişimi e-postası gönderildi: ${sourceLabel} (${changes.length} ürün).`);
    return true;
}

module.exports = { sendAlertEmail, sendPriceChangesEmail };
