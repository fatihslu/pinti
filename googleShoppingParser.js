const cheerio = require('cheerio');
const { extractPrice } = require('./productExtractor');

function decodeGoogleValue(value) {
    try { return JSON.parse(`"${value}"`); }
    catch (_) {
        return String(value)
            .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/\\u003d/g, '=')
            .replace(/\\u0026/g, '&')
            .replace(/\\\//g, '/');
    }
}

function isSupportedImageUrl(value) {
    return /^https?:/i.test(value) || /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value);
}

function getGoogleImageMap(html) {
    const images = new Map();
    const directPattern = /"(dimg_[^"]+)":"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    let match;
    while ((match = directPattern.exec(html))) {
        const url = decodeGoogleValue(match[2]);
        if (isSupportedImageUrl(url)) images.set(match[1], url);
    }

    const deferredPattern = /\(function\(\)\{var s='([^']+)';var ii=\[([^\]]*)\];_setImagesSrc\(ii,s\);\}\)\(\);/g;
    while ((match = deferredPattern.exec(html))) {
        const url = decodeGoogleValue(match[1]);
        if (!isSupportedImageUrl(url)) continue;
        const imageIdPattern = /'((?:dimg_)[^']+)'/g;
        let imageId;
        while ((imageId = imageIdPattern.exec(match[2]))) images.set(imageId[1], url);
    }
    return images;
}

function parseGoogleShoppingHtml(rawHtml, limit = 40) {
    const html = String(rawHtml || '');
    const $ = cheerio.load(html);
    const imageMap = getGoogleImageMap(html);
    const offers = [];

    $('div.UC8ZCe.QS8Cxb').each((_, element) => {
        if (offers.length >= limit) return false;
        const card = $(element);
        const title = card.find('.gkQHve').first().text().replace(/\s+/g, ' ').trim();
        const price = extractPrice(card.find('.lmQWe, [aria-label*="Şu Anki Fiyat"]').first().text());
        const storeName = card.find('.WJMUdc').first().text().replace(/\s+/g, ' ').trim();
        const imageId = card.find('img[id^="dimg_"]').first().attr('id');
        const href = card.closest('a[href]').attr('href') || card.find('a[href]').first().attr('href') || '';
        let url = '';
        try {
            const parsedUrl = new URL(href, 'https://www.google.com');
            if (['http:', 'https:'].includes(parsedUrl.protocol)) url = parsedUrl.href;
        } catch (_) { /* Google kartı doğrudan bağlantı içermeyebilir. */ }
        if (!title || !storeName || !price || price <= 0) return;
        const key = `${storeName.toLocaleLowerCase('tr-TR')}|${title.toLocaleLowerCase('tr-TR')}|${price}`;
        if (offers.some(offer => offer.key === key)) return;
        offers.push({
            key,
            storeName,
            title,
            price,
            shippingPrice: 0,
            url,
            imageUrl: imageId ? (imageMap.get(imageId) || '') : ''
        });
    });

    return offers.map(({ key, ...offer }) => offer);
}

module.exports = { parseGoogleShoppingHtml };
