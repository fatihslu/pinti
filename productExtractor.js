const cheerio = require('cheerio');

const SITE_SELECTORS = {
    amazon: {
        title: ['#productTitle', '#title span', 'h1.a-size-large'],
        price: [
            '#corePriceDisplay_desktop_feature_div .a-offscreen',
            '#corePrice_feature_div .a-offscreen',
            '#apex_desktop .a-price .a-offscreen',
            '.priceToPay .a-offscreen',
            '#tp_price_block_total_price_ww .a-offscreen',
            '[data-a-color="price"] .a-offscreen',
            '#price_inside_buybox .a-offscreen',
            '#priceblock_ourprice', '#priceblock_dealprice'
        ],
        image: ['#landingImage', '#imgBlkFront', '.a-dynamic-image']
    },
    trendyol: {
        title: ['h1.pr-new-br', 'h1[class*="product"]', 'h1'],
        price: ['.prc-dsc', '.prc-slg', '.product-price-container [class*="price"]', '[data-testid*="price"]'],
        image: ['.product-image img', 'img[class*="product"]']
    },
    hepsiburada: {
        title: ['h1[data-test-id="product-name"]', 'h1#product-name', 'h1'],
        price: ['[data-test-id="price-current-price"]', '[data-test-id*="price"]', '.product-price'],
        image: ['#productMainImage', '[data-test-id="product-image"] img']
    },
    n11: {
        title: ['h1.proName', 'h1[class*="productName"]', 'h1'],
        price: ['.newPrice ins', '.newPrice', '.unf-p-summary-price', '[class*="price"] ins'],
        image: ['#imageContainer img', '.proDetailImage img']
    },
    generic: {
        title: ['h1', '[itemprop="name"]'],
        price: ['[itemprop="price"]', '[data-price]', '[data-testid*="price"]', '[class*="current-price"]'],
        image: ['[itemprop="image"]', 'img']
    }
};

function detectSiteType(url) {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('trendyol.com')) return 'trendyol';
    if (host.includes('hepsiburada.com')) return 'hepsiburada';
    if (host.includes('amazon.')) return 'amazon';
    if (host.includes('n11.com')) return 'n11';
    return 'generic';
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function extractPrice(value) {
    const text = cleanText(value)
        .replace(/\u00a0/g, ' ')
        .replace(/(?:TL|TRY|₺|\$|€|£)/gi, '')
        .trim();
    if (!text) return null;

    // Bir sayfada kampanya metni de bulunabilir; para biçimindeki ilk değeri al.
    const match = text.match(/\d{1,3}(?:[.\s,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/);
    if (!match) return null;
    let number = match[0].replace(/\s/g, '');
    const comma = number.lastIndexOf(',');
    const dot = number.lastIndexOf('.');
    if (comma !== -1 && dot !== -1) {
        number = comma > dot ? number.replace(/\./g, '').replace(',', '.') : number.replace(/,/g, '');
    } else if (comma !== -1) {
        number = number.length - comma - 1 <= 2 ? number.replace(',', '.') : number.replace(/,/g, '');
    } else if (dot !== -1 && number.length - dot - 1 > 2) {
        number = number.replace(/\./g, '');
    }
    const price = Number.parseFloat(number);
    return Number.isFinite(price) && price > 0 && price <= 10000000 ? price : null;
}

function walkJson(value, products) {
    if (Array.isArray(value)) return value.forEach(item => walkJson(item, products));
    if (!value || typeof value !== 'object') return;
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some(type => String(type).toLowerCase() === 'product')) products.push(value);
    Object.values(value).forEach(item => walkJson(item, products));
}

function productFromJsonLd($) {
    const products = [];
    $('script[type="application/ld+json"]').each((_, script) => {
        try { walkJson(JSON.parse($(script).contents().text()), products); } catch (_) { /* bozuk JSON-LD yoksayılır */ }
    });
    for (const product of products) {
        const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
        const offer = offers.find(Boolean) || {};
        const price = offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price;
        if (extractPrice(price)) {
            const image = Array.isArray(product.image) ? product.image[0] : product.image;
            return { title: product.name, price, imageUrl: image };
        }
    }
    return {};
}

function firstText($, selectors) {
    for (const selector of selectors) {
        let result = null;
        $(selector).each((_, element) => {
            if (result) return;
            const node = $(element);
            const value = node.attr('content') || node.attr('data-price') || node.attr('value') || node.text();
            if (cleanText(value)) result = cleanText(value);
        });
        if (result) return result;
    }
    return null;
}

function firstImage($, selectors) {
    for (const selector of selectors) {
        let result = null;
        $(selector).each((_, element) => {
            if (result) return;
            const node = $(element);
            const value = node.attr('src') || node.attr('data-src') || node.attr('data-old-hires') || node.attr('content');
            if (value) result = value.trim();
        });
        if (result) return result;
    }
    return null;
}

function toAbsoluteUrl(value, pageUrl) {
    if (!value) return null;
    try { return new URL(value, pageUrl).href; } catch (_) { return null; }
}

function isBlockedPage(html) {
    const text = String(html).slice(0, 250000).toLowerCase();
    return ['captcha', 'robot check', 'verify you are human', 'access denied', 'unusual traffic', 'just a moment', 'attention required', 'you have been blocked', 'güvenlik'].some(marker => text.includes(marker));
}

function extractProductFromHtml(html, url) {
    if (isBlockedPage(html)) throw new Error('Site bot doğrulaması istedi; fiyat alınamadı. Tarayıcıda doğrulama tamamlanmadan otomatik çekim yapılamaz.');
    const $ = cheerio.load(html);
    const selectors = SITE_SELECTORS[detectSiteType(url)];
    const jsonLd = productFromJsonLd($);
    const title = firstText($, selectors.title) || cleanText(jsonLd.title) || cleanText($('meta[property="og:title"]').attr('content'));
    const priceText = firstText($, selectors.price)
        || $('meta[property="product:price:amount"]').attr('content')
        || $('[itemprop="price"]').first().attr('content')
        || jsonLd.price;
    const price = extractPrice(priceText);
    const imageUrl = firstImage($, selectors.image)
        || jsonLd.imageUrl
        || $('meta[property="og:image"]').attr('content');

    if (!title || title.length < 3) throw new Error('Ürün başlığı bulunamadı; sayfa ürün sayfası olmayabilir.');
    if (!price) throw new Error('Geçerli güncel fiyat bulunamadı; satıcı veya varyant seçimi gerekebilir.');
    return { title, price, imageUrl: toAbsoluteUrl(imageUrl, url), url };
}

module.exports = { detectSiteType, extractPrice, extractProductFromHtml, isBlockedPage };
