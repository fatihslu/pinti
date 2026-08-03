(function exposeOfferParser(root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.OfferParser = api;
})(typeof window === 'undefined' ? null : window, function createOfferParser() {
    function parseAmount(value) {
        const text = String(value || '').replace(/\s+/g, '').replace(/(?:TL|₺)/gi, '');
        if (!text) return NaN;
        const comma = text.lastIndexOf(',');
        const dot = text.lastIndexOf('.');
        let number = text;
        if (comma !== -1 && dot !== -1) number = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
        else if (comma !== -1) number = text.length - comma - 1 <= 2 ? text.replace(',', '.') : text.replace(/,/g, '');
        else if (dot !== -1 && text.length - dot - 1 > 2) number = text.replace(/\./g, '');
        return Number(number);
    }

    function isNoise(line) {
        return /^(ana içeriğe geç|sürekli kaydırmayı kapat|erişilebilirlik|sonuçları hassaslaştır|sıralama ölçütü|alaka düzeyi|fiyat:|fiyat$|ürünlere göz atın|düşük fiyat|indirim|ve daha fazlası|ücretli sponsorlu reklam|genellikle|\d+ gün içinde|türkiye$|yardım$|geri bildirim|gizlilik|şartlar|daha fazla|ai modu)/i.test(line)
            || /^\d+[,.]?\d*\s*\(\d+\)$/.test(line);
    }

    function modelTokens(value) {
        return (String(value || '').toLowerCase().match(/\b(?:gtr|gs|kb|gds)[-\s]?\d+[a-z]*\b/g) || []).map(token => token.replace(/[\s-]/g, ''));
    }

    function sameVariant(sourceTitle, candidateTitle) {
        const sourceModels = modelTokens(sourceTitle);
        const candidateModels = modelTokens(candidateTitle);
        if (sourceModels.length && candidateModels.length) return sourceModels.some(model => candidateModels.includes(model));
        return true;
    }

    function parseGoogleShoppingText(rawText, sourceTitle = '') {
        const lines = String(rawText || '').split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
        // Tek bir ürün başlığında "|" bulunabilir. Manuel biçim ancak en az
        // üç ayraçla (mağaza|fiyat|kargo|url) tanınır.
        const pipeLines = lines.filter(line => {
            const parts = line.split('|').map(value => value.trim());
            return parts.length >= 3 && Number.isFinite(parseAmount(parts[1]));
        });
        if (pipeLines.length) {
            return pipeLines.map(line => {
                const [storeName, price, shippingPrice = '0', url = '', imageUrl = ''] = line.split('|').map(value => value.trim());
                return { storeName, price: parseAmount(price), shippingPrice: parseAmount(shippingPrice), url, imageUrl, title: '', confirmed: true };
            });
        }

        const offers = [];
        for (let index = 0; index < lines.length; index++) {
            const price = parseAmount(lines[index]);
            if (!Number.isFinite(price) || !/[₺]|\bTL\b/i.test(lines[index]) || /^genellikle/i.test(lines[index])) continue;
            // İndirimlerde önce güncel fiyat, sonra üstü çizili eski fiyat gelir.
            if (index > 0 && Number.isFinite(parseAmount(lines[index - 1]))) continue;

            let title = '';
            for (let cursor = index - 1; cursor >= Math.max(0, index - 4); cursor--) {
                if (!isNoise(lines[cursor]) && !Number.isFinite(parseAmount(lines[cursor]))) { title = lines[cursor]; break; }
            }
            let storeName = '';
            for (let cursor = index + 1; cursor <= Math.min(lines.length - 1, index + 6); cursor++) {
                const value = lines[cursor];
                if (isNoise(value) || /^genellikle/i.test(value) || /[₺]|\bTL\b/i.test(value)) continue;
                storeName = value;
                break;
            }
            if (title && storeName) offers.push({ storeName, title, price, shippingPrice: 0, url: '', confirmed: sameVariant(sourceTitle, title) });
        }
        return offers.filter((offer, index, all) => all.findIndex(item => `${item.storeName}|${item.title}|${item.price}` === `${offer.storeName}|${offer.title}|${offer.price}`) === index);
    }

    function decodeGoogleValue(value) {
        try { return JSON.parse(`"${value}"`); }
        catch (_) {
            return String(value)
                .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
                .replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        }
    }

    function isSupportedImageUrl(value) {
        return /^https?:/i.test(value) || /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value);
    }

    // Google Shopping, görselleri ürün kartındaki img etiketine doğrudan koymak
    // yerine sayfanın veri eşlemesinde dimg_* anahtarlarıyla saklıyor.
    function getGoogleImageMap(html) {
        const images = new Map();
        const pattern = /"(dimg_[^"]+)":"([^"\\]*(?:\\.[^"\\]*)*)"/g;
        let match;
        while ((match = pattern.exec(html))) {
            const url = decodeGoogleValue(match[2]);
            if (isSupportedImageUrl(url)) images.set(match[1], url);
        }

        // İlk arama sonuçlarının ürün görselleri ayrı _setImagesSrc betikleri
        // ile yüklenir. Bir betik birden çok dimg_* kimliğine hizmet edebilir.
        const deferredPattern = /\(function\(\)\{var s='([^']+)';var ii=\[([^\]]*)\];_setImagesSrc\(ii,s\);\}\)\(\);/g;
        while ((match = deferredPattern.exec(html))) {
            const url = decodeGoogleValue(match[1]);
            if (!isSupportedImageUrl(url)) continue;
            const idPattern = /'((?:dimg_)[^']+)'/g;
            let idMatch;
            while ((idMatch = idPattern.exec(match[2]))) images.set(idMatch[1], url);
        }
        return images;
    }

    function parseGoogleShoppingHtml(rawHtml, sourceTitle = '') {
        if (typeof DOMParser === 'undefined') return [];
        const html = String(rawHtml || '');
        const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
        const imageMap = getGoogleImageMap(html);
        const cards = [...parsedDocument.querySelectorAll('div.UC8ZCe.QS8Cxb')];
        const offers = cards.map(card => {
            const title = card.querySelector('.gkQHve')?.textContent?.trim() || '';
            const priceText = card.querySelector('.lmQWe, [aria-label*="Şu Anki Fiyat"]')?.textContent || '';
            const price = parseAmount(priceText);
            const storeName = card.querySelector('.WJMUdc')?.textContent?.trim() || '';
            const imageId = card.querySelector('img[id^="dimg_"]')?.id;
            const imageUrl = imageId ? (imageMap.get(imageId) || '') : '';
            const link = card.closest('a[href]') || card.querySelector('a[href]');
            return {
                storeName,
                title,
                price,
                shippingPrice: 0,
                url: link?.href || '',
                imageUrl,
                confirmed: sameVariant(sourceTitle, title)
            };
        }).filter(offer => offer.storeName && offer.title && Number.isFinite(offer.price) && offer.price > 0);

        return offers.filter((offer, index, all) => all.findIndex(item =>
            `${item.storeName}|${item.title}|${item.price}` === `${offer.storeName}|${offer.title}|${offer.price}`
        ) === index);
    }

    function parseInput(rawInput, sourceTitle = '') {
        const value = String(rawInput || '');
        return /^\s*(?:<!doctype|<html)\b/i.test(value)
            ? parseGoogleShoppingHtml(value, sourceTitle)
            : parseGoogleShoppingText(value, sourceTitle);
    }

    return { parseAmount, parseGoogleShoppingText, parseGoogleShoppingHtml, parseInput };
});
