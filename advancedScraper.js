const puppeteer = require('puppeteer');
const fs = require('fs');
const { detectSiteType, extractPrice, extractProductFromHtml, isBlockedPage } = require('./productExtractor');
const { parseGoogleShoppingHtml } = require('./googleShoppingParser');

const SEARCH_SITES = [
    {
        id: 'amazon', name: 'Amazon',
        searchUrl: term => `https://www.amazon.com.tr/s?k=${encodeURIComponent(term)}`,
        cards: ['[data-component-type="s-search-result"]'],
        title: ['h2 span', 'h2'], price: ['.a-price .a-offscreen'], image: ['img.s-image'], link: ['h2 a[href]']
    },
    {
        id: 'trendyol', name: 'Trendyol',
        searchUrl: term => `https://www.trendyol.com/sr?q=${encodeURIComponent(term)}`,
        cards: ['.p-card-wrppr', '[class*="p-card-wrppr"]'],
        title: ['.prdct-desc-cntnr-ttl', '[class*="product-name"]', 'h3'],
        price: ['.prc-box-dscntd', '.prc-box-sllng', '[class*="price"]'], image: ['img'], link: ['a[href]']
    },
    {
        id: 'hepsiburada', name: 'Hepsiburada',
        searchUrl: term => `https://www.hepsiburada.com/ara?q=${encodeURIComponent(term)}`,
        cards: ['li[class*="productListContent"]', '[data-test-id="product-card"]', '[class*="productCard"]'],
        title: ['h3', '[data-test-id*="product-title"]', '[class*="product-title"]'],
        price: ['[data-test-id="price-current-price"]', '[data-test-id*="price"]', '[class*="price"]'], image: ['img'], link: ['a[href]']
    },
    {
        id: 'n11', name: 'N11',
        searchUrl: term => `https://www.n11.com/arama?q=${encodeURIComponent(term)}`,
        cards: ['.productItem', '[class*="productItem"]', '[class*="product-item"]'],
        title: ['.productName', '[class*="productName"]', 'h3'],
        price: ['.newPrice', '[class*="price"]'], image: ['img'], link: ['a[href]']
    }
];

const AMAZON_LOW_PRICE_PAGE_URL = 'https://www.amazon.com.tr/b/?node=219537826031';
const LOW_PRICE_PAGE_SIZE = 90;
const LOW_PRICE_PAGE_STEP = 30;
const LOW_PRICE_MAX_START_INDEX = 3000;
const LOW_PRICE_NAVIGATION_RETRIES = 3;
const SALES_SIGNAL_DETAIL_LIMIT = 18;
// Gerçek Chrome "User Data" kökünü Puppeteer ile açmak güvenilir değildir:
// Chrome profili kilitli olabilir ve sürüm farkları başlatmayı engelleyebilir.
// Bunun yerine bu uygulamaya ait, kalıcı ve kullanıcı tarafından normal şekilde
// giriş yapılabilen ayrı bir profil kullanılır.
// Toplayıcı sürümü için ayrı profil: önceden açık bir Chrome penceresinin
// yeni eklenti parametrelerini yok saymasını önler.

function buildAmazonLowPricePageUrl(category, startIndex = 0) {
    const url = new URL(AMAZON_LOW_PRICE_PAGE_URL);
    url.searchParams.set('promotionsSearchStartIndex', String(startIndex));
    url.searchParams.set('promotionsSearchPageSize', String(LOW_PRICE_PAGE_SIZE));

    // Amazon kategori seçimini URL'de iki kez encode edilmiş bir JSON değeriyle tutuyor.
    // Bu değeri her sayfa isteğine eklemezsek sayfalama kategori filtresini sıfırlıyor.
    if (category?.id && category.id !== 'all') {
        const filterState = {
            state: { refinementFilters: { departments: [String(category.id)] } },
            version: 1
        };
        url.searchParams.set('discounts-widget', encodeURIComponent(JSON.stringify(JSON.stringify(filterState))));
    }
    return url.href;
}

function normalizedTokens(value) {
    const stopWords = new Set(['ve', 'ile', 'icin', 'için', 'bir', 'bu', 'the', 'new', 'yeni', 'urun', 'ürün']);
    return new Set(String(value || '').toLocaleLowerCase('tr-TR').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length > 1 && !stopWords.has(word)) || []);
}

function similarity(left, right) {
    const a = normalizedTokens(left);
    const b = normalizedTokens(right);
    if (!a.size || !b.size) return 0;
    let common = 0;
    for (const token of a) if (b.has(token)) common++;
    return common / Math.max(a.size, b.size);
}

function findBrowser() {
    const candidates = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ].filter(Boolean);
    return candidates.find(candidate => fs.existsSync(candidate));
}

class AdvancedScraper {
    constructor() { this.browser = null; }

    async initBrowser() {
        if (!this.browser) {
            const executablePath = findBrowser();
            this.browser = await puppeteer.launch({
                headless: 'new',
                // Windows'ta zaten kurulu Chrome/Edge varsa Puppeteer'ın ayrıca
                // Chrome indirmesine gerek kalmaz.
                ...(executablePath ? { executablePath } : {}),
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
            });
        }
        return this.browser;
    }

    async scrapeProduct(url) {
        const browser = await this.initBrowser();
        const page = await browser.newPage();
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1440, height: 900 });
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await page.waitForTimeout(2500);
            return extractProductFromHtml(await page.content(), url);
        } finally {
            await page.close();
        }
    }

    async findAlternatives(title, sourceUrl) {
        const browser = await this.initBrowser();
        const source = detectSiteType(sourceUrl);
        const matches = [];
        const unavailableSites = [];

        for (const site of SEARCH_SITES.filter(item => item.id !== source)) {
            const page = await browser.newPage();
            try {
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
                await page.goto(site.searchUrl(title), { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(1800);
                if (isBlockedPage(await page.content())) throw new Error('bot doğrulaması veya erişim engeli');
                const selectorConfig = { cards: site.cards, title: site.title, price: site.price, image: site.image, link: site.link };
                const candidates = await page.evaluate((config) => {
                    const firstText = (root, selectors) => {
                        for (const selector of selectors) {
                            const node = root.querySelector(selector);
                            const value = node?.getAttribute('content') || node?.textContent;
                            if (value?.trim()) return value.trim();
                        }
                        return '';
                    };
                    const firstAttr = (root, selectors, attributes) => {
                        for (const selector of selectors) {
                            const node = root.querySelector(selector);
                            for (const attribute of attributes) {
                                const value = node?.getAttribute(attribute);
                                if (value) return value;
                            }
                        }
                        return '';
                    };
                    const cards = [...new Set(config.cards.flatMap(selector => [...document.querySelectorAll(selector)]))].slice(0, 12);
                    return cards.map(card => ({
                        title: firstText(card, config.title),
                        price: firstText(card, config.price),
                        imageUrl: firstAttr(card, config.image, ['src', 'data-src']),
                        url: firstAttr(card, config.link, ['href'])
                    }));
                }, selectorConfig);

                const best = candidates
                    .map(candidate => ({ ...candidate, price: extractPrice(candidate.price), score: similarity(title, candidate.title) }))
                    .filter(candidate => candidate.url && candidate.price && candidate.score >= 0.45)
                    .sort((a, b) => b.score - a.score)[0];
                if (best) {
                    matches.push({
                        title: best.title, price: best.price, imageUrl: best.imageUrl ? new URL(best.imageUrl, site.searchUrl(title)).href : null,
                        url: new URL(best.url, site.searchUrl(title)).href, site: site.id, score: best.score
                    });
                }
            } catch (error) {
                // Bir sitenin bot koruması diğer mağazaların aranmasını engellememeli.
                console.warn(`${site.name} ürün araması yapılamadı: ${error.message}`);
                unavailableSites.push({ site: site.name, reason: error.message });
            } finally {
                await page.close();
            }
            await new Promise(resolve => setTimeout(resolve, 1200));
        }
        return { matches, unavailableSites };
    }

    async searchGoogleShopping(title, limit = 40) {
        const browser = await this.initBrowser();
        const page = await browser.newPage();
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1440, height: 1100 });
            const url = `https://www.google.com/search?tbm=shop&hl=tr&gl=tr&q=${encodeURIComponent(title)}`;
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await page.waitForTimeout(1800);
            const html = await page.content();
            if (isBlockedPage(html)) throw new Error('Google Shopping doğrulama veya erişim engeli gösterdi.');
            const offers = parseGoogleShoppingHtml(html, limit);
            if (!offers.length) throw new Error('Google Shopping sonuçlarında ayrıştırılabilir teklif bulunamadı.');
            return { query: title, html, offers };
        } finally {
            await page.close();
        }
    }

    async getAmazonPopularitySignal(productUrl) {
        const browser = await this.initBrowser();
        const page = await browser.newPage();
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
            await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
            await page.waitForTimeout(700);
            const html = await page.content();
            if (isBlockedPage(html)) throw new Error('Amazon ürün sayfası doğrulama istedi.');
            return await page.evaluate(() => {
                const salesCandidates = [
                    ...document.querySelectorAll('#pqv-bought-in-last-month, #social-proofing-faceout-title-tk_bought, [id*="bought-in-last-month"]')
                ].map(element => element.textContent?.trim() || '');
                return {
                    reviewText: document.querySelector('#acrCustomerReviewText')?.textContent?.trim() || document.querySelector('[data-hook="total-review-count"]')?.textContent?.trim() || '',
                    ratingText: document.querySelector('#acrPopover')?.getAttribute('title') || document.querySelector('[data-hook="rating-out-of-text"]')?.textContent?.trim() || '',
                    // “görüntülenme” satış değildir; yalnızca Amazon'un satın alma
                    // ifadesi geçen etiketi aylık satış alt sınırı olarak kullanılır.
                    monthlySalesText: salesCandidates.find(text => /satın\s*alındı|purchased|\bbought\b/i.test(text)) || ''
                };
            });
        } finally {
            await page.close();
        }
    }

    async enrichAmazonSalesSignals(items) {
        const enrichItem = async item => {
            try {
                const signal = await this.getAmazonPopularitySignal(item.productUrl);
                item.reviewCount = extractPrice(signal.reviewText) || null;
                const rating = signal.ratingText.match(/üzerinden\s*(\d+[,.]\d+)/i)?.[1] || signal.ratingText.match(/(\d+[,.]\d+)\s*\/\s*5/i)?.[1];
                item.rating = rating ? Number(rating.replace(',', '.')) : null;
                item.monthlySalesText = signal.monthlySalesText || '';
                let monthlySalesMinimum = extractPrice(signal.monthlySalesText);
                if (/\b(?:bin|thousand|k)\b/i.test(signal.monthlySalesText || '')) monthlySalesMinimum *= 1000;
                item.monthlySalesMinimum = Number.isFinite(monthlySalesMinimum) && monthlySalesMinimum > 0 ? Math.round(monthlySalesMinimum) : null;
            } catch (error) {
                item.reviewCount = null;
                item.rating = null;
                item.monthlySalesText = '';
                item.monthlySalesMinimum = null;
                console.warn(`${item.asin} satış etiketi alınamadı: ${error.message}`);
            }
        };
        for (let start = 0; start < items.length; start += 3) {
            await Promise.all(items.slice(start, start + 3).map(enrichItem));
            if (start + 3 < items.length) await new Promise(resolve => setTimeout(resolve, 650));
        }
        return items;
    }

    async getAmazonLowPriceCategories() {
        const browser = await this.initBrowser();
        const page = await browser.newPage();
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
            await page.goto(AMAZON_LOW_PRICE_PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await page.waitForTimeout(1800);
            const html = await page.content();
            if (isBlockedPage(html)) throw new Error('Amazon en düşük fiyatlar sayfası doğrulama istedi.');
            await page.evaluate(() => {
                document.querySelector('button[aria-labelledby="see-more-departments-label"]')?.click();
            });
            await page.waitForTimeout(400);
            return await page.evaluate(() => {
                const categories = [];
                let foundFirstAll = false;
                for (const input of document.querySelectorAll('input[type="radio"]')) {
                    const label = input.labels?.[0]?.textContent?.replace(/\s+/g, ' ').trim() || '';
                    if (!label) continue;
                    if (label === 'Tümü') {
                        if (foundFirstAll) break;
                        foundFirstAll = true;
                    }
                    if (input.value === 'all' || /^\d{6,}$/.test(input.value || '')) {
                        if (!categories.some(category => category.id === input.value)) categories.push({ id: input.value, name: label });
                    }
                }
                return categories;
            });
        } finally {
            await page.close();
        }
    }

    async scrapeAmazonLowPriceCategory(category, limit = 500) {
        const browser = await this.initBrowser();
        const page = await browser.newPage();
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1440, height: 1100 });
            const uniqueItems = new Map();
            let consecutiveDuplicatePages = 0;

            for (let startIndex = 0; startIndex <= LOW_PRICE_MAX_START_INDEX && uniqueItems.size < limit; startIndex += LOW_PRICE_PAGE_STEP) {
                const targetUrl = buildAmazonLowPricePageUrl(category, startIndex);
                let navigationError;
                for (let attempt = 1; attempt <= LOW_PRICE_NAVIGATION_RETRIES; attempt++) {
                    try {
                        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                        navigationError = null;
                        break;
                    } catch (error) {
                        navigationError = error;
                        if (attempt < LOW_PRICE_NAVIGATION_RETRIES) await page.waitForTimeout(1000 * attempt);
                    }
                }
                if (navigationError) throw new Error(`${navigationError.message} (${LOW_PRICE_NAVIGATION_RETRIES} deneme)`);
                await page.waitForTimeout(1200);
                const html = await page.content();
                if (isBlockedPage(html)) throw new Error('Amazon en düşük fiyatlar sayfası doğrulama istedi.');

                const pageItems = await page.evaluate((categoryName) => {
                const parsePrice = value => {
                    const match = String(value || '').match(/\d{1,3}(?:[.\s,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/);
                    const text = String(match?.[0] || '').replace(/\s+/g, '');
                    const comma = text.lastIndexOf(',');
                    const dot = text.lastIndexOf('.');
                    let number = text;
                    if (comma !== -1 && dot !== -1) number = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
                    else if (comma !== -1) number = text.length - comma - 1 <= 2 ? text.replace(',', '.') : text.replace(/,/g, '');
                    else if (dot !== -1 && text.length - dot - 1 > 2) number = text.replace(/\./g, '');
                    return Number(number);
                };
                return [...document.querySelectorAll('[data-testid="product-card"][data-asin]')].map((card, index) => {
                    const cardText = card.innerText || '';
                    const period = Number(cardText.match(/(30|60|90|365)\s*g[üu]n[üu]n\s*en\s*d[üu][şs][üu]k\s*fiyat[ıi]/i)?.[1]) || null;
                    const prices = [...card.querySelectorAll('.a-price .a-offscreen')].map(node => node.textContent.trim()).filter(Boolean);
                    const price = parsePrice(prices[0]);
                    const originalPrice = parsePrice(prices[1]);
                    const explicitDiscount = Number(cardText.match(/%(\d+)\s*indirim/i)?.[1]) || 0;
                    const computedDiscount = originalPrice > price ? Math.round((1 - price / originalPrice) * 100) : 0;
                    return {
                        asin: card.getAttribute('data-asin'), categoryName, position: index + 1, lowPricePeriod: period,
                        title: card.querySelector('img')?.alt?.trim() || '', price,
                        originalPrice: Number.isFinite(originalPrice) && originalPrice > price ? originalPrice : null,
                        discountPercent: explicitDiscount || computedDiscount,
                        productUrl: card.querySelector('a[data-testid="product-card-link"][href]')?.href || '',
                        imageUrl: card.querySelector('img')?.currentSrc || card.querySelector('img')?.src || ''
                    };
                });
                }, category.name);

                let addedOnThisPage = 0;
                for (const item of pageItems) {
                    if (!item.asin || !item.lowPricePeriod || !item.title || !Number.isFinite(item.price) || item.price <= 0 || !item.productUrl) continue;
                    const key = `${item.asin}:${item.lowPricePeriod}`;
                    if (uniqueItems.has(key)) continue;
                    uniqueItems.set(key, { ...item, position: uniqueItems.size + 1 });
                    addedOnThisPage++;
                    if (uniqueItems.size >= limit) break;
                }

                // Amazon son sayfada son ürün grubunu tekrar döndürebiliyor.
                consecutiveDuplicatePages = addedOnThisPage ? 0 : consecutiveDuplicatePages + 1;
                if (consecutiveDuplicatePages >= 2) break;
            }

            const validItems = [...uniqueItems.values()];
            // Tüm ürün kartları kaydedilir. Ayrıntı sayfasından satış etiketi almak
            // daha pahalı olduğundan ilk grup zenginleştirilir; satış etiketi olmayan
            // ürünler de listede indirim bilgileriyle görünmeye devam eder.
            await this.enrichAmazonSalesSignals(validItems.slice(0, SALES_SIGNAL_DETAIL_LIMIT));
            for (const item of validItems.slice(SALES_SIGNAL_DETAIL_LIMIT)) {
                item.reviewCount = null;
                item.rating = null;
                item.monthlySalesText = '';
                item.monthlySalesMinimum = null;
            }
            return validItems;
        } finally {
            await page.close();
        }
    }

    async scrapeAmazonDeals(limit = 600) {
        const browser = await this.initBrowser();
        const page = await browser.newPage();
        const dealsPage = 'https://www.amazon.com.tr/deals/';
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1440, height: 1100 });
            await page.goto(dealsPage, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await page.waitForTimeout(2200);
            const html = await page.content();
            if (isBlockedPage(html)) throw new Error('Amazon kampanya sayfası doğrulama istedi.');
            const deals = await page.evaluate(maxItems => {
                const parsePrice = value => {
                    const priceMatch = String(value || '').match(/\d{1,3}(?:[.\s,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/);
                    const text = String(priceMatch?.[0] || '').replace(/\s+/g, '').replace(/(?:TL|₺)/gi, '');
                    const comma = text.lastIndexOf(',');
                    const dot = text.lastIndexOf('.');
                    let number = text;
                    if (comma !== -1 && dot !== -1) number = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
                    else if (comma !== -1) number = text.length - comma - 1 <= 2 ? text.replace(',', '.') : text.replace(/,/g, '');
                    else if (dot !== -1 && text.length - dot - 1 > 2) number = text.replace(/\./g, '');
                    return Number(number);
                };
                return [...document.querySelectorAll('[data-testid="product-card"][data-asin]')].slice(0, maxItems).map((card, index) => {
                    const priceTexts = [...card.querySelectorAll('.a-price .a-offscreen')].map(node => node.textContent.trim()).filter(Boolean);
                    const currentPrice = parsePrice(priceTexts[0]);
                    const originalPrice = parsePrice(priceTexts[1]);
                    const text = card.innerText || '';
                    const explicitDiscount = Number(text.match(/%(\d+)\s*İndirim/i)?.[1]) || 0;
                    const computedDiscount = originalPrice > currentPrice ? Math.round((1 - currentPrice / originalPrice) * 100) : 0;
                    const link = card.querySelector('a[data-testid="product-card-link"][href]')?.href || '';
                    const image = card.querySelector('img')?.currentSrc || card.querySelector('img')?.src || '';
                    const title = card.querySelector('img')?.alt?.trim() || '';
                    return {
                        asin: card.getAttribute('data-asin'), position: index + 1, title, price: currentPrice,
                        originalPrice: Number.isFinite(originalPrice) && originalPrice > currentPrice ? originalPrice : null,
                        discountPercent: explicitDiscount || computedDiscount,
                        productUrl: link, imageUrl: image
                    };
                });
            }, limit);

            // The landing view only renders one collection at a time. Visit every
            // visible Deals collection and merge the cards by ASIN for a complete list.
            const collections = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="filter-bubble-deals-collection-"]')]
                .map(button => ({ selector: `[data-testid="${button.getAttribute('data-testid')}"]`, name: (button.textContent || '').trim() }))
                .filter(item => item.name));
            const byAsin = new Map();
            const addDeal = deal => {
                if (!deal.asin || byAsin.has(deal.asin) || byAsin.size >= limit) return;
                byAsin.set(deal.asin, { ...deal, position: byAsin.size + 1 });
            };
            deals.forEach(addDeal);

            for (const collection of collections) {
                if (byAsin.size >= limit) break;
                try {
                    await page.click(collection.selector);
                    await page.waitForFunction(selector => document.querySelector(selector)?.getAttribute('aria-pressed') === 'true', { timeout: 6000 }, collection.selector);
                    await page.waitForTimeout(850);
                    if (isBlockedPage(await page.content())) throw new Error('Deals page requested verification.');
                    const extraCards = await page.evaluate(maxItems => [...document.querySelectorAll('[data-testid="product-card"][data-asin]')]
                        .slice(0, maxItems).map(card => {
                            const prices = [...card.querySelectorAll('.a-price .a-offscreen')].map(node => node.textContent.trim()).filter(Boolean);
                            const link = card.querySelector('a[data-testid="product-card-link"][href]')?.href || '';
                            const image = card.querySelector('img');
                            return {
                                asin: card.getAttribute('data-asin'), title: image?.alt?.trim() || '', priceText: prices[0] || '',
                                originalPriceText: prices[1] || '', discountText: card.innerText || '', productUrl: link,
                                imageUrl: image?.currentSrc || image?.src || ''
                            };
                        }), limit - byAsin.size);
                    for (const card of extraCards) {
                        const currentPrice = extractPrice(card.priceText);
                        const originalPrice = extractPrice(card.originalPriceText);
                        const explicitDiscount = Number(String(card.discountText).match(/%(\d+)/)?.[1]) || 0;
                        const computedDiscount = originalPrice > currentPrice ? Math.round((1 - currentPrice / originalPrice) * 100) : 0;
                        addDeal({
                            asin: card.asin, title: card.title, price: currentPrice,
                            originalPrice: originalPrice > currentPrice ? originalPrice : null,
                            discountPercent: explicitDiscount || computedDiscount,
                            productUrl: card.productUrl, imageUrl: card.imageUrl, categoryName: collection.name
                        });
                    }
                } catch (error) {
                    console.warn(`Deals collection skipped (${collection.name}): ${error.message}`);
                }
            }

            const validDeals = [...byAsin.values()].filter(deal => deal.asin && deal.title && Number.isFinite(deal.price) && deal.price > 0 && deal.productUrl);
            // Fırsatlar listesinde satış filtresi bulunuyor. Bu yüzden yalnızca ilk
            // ürünleri değil, listedeki bütün ürünlerin ayrıntı sayfasındaki satış
            // etiketini kontrol et ve mevcutsa kalıcı anlık görüntüye yaz.
            await this.enrichAmazonSalesSignals(validDeals);
            return validDeals;
        } finally {
            await page.close();
        }
    }

    async getAmazonAnalysisCategories() {
        const browser = await this.initBrowser();
        const page = await browser.newPage();
        try {
            await page.goto('https://www.amazon.com.tr/gp/bestsellers', { waitUntil: 'domcontentloaded', timeout: 45000 });
            await page.waitForTimeout(1000);
            const html = await page.content();
            if (isBlockedPage(html)) throw new Error('Amazon kategori listesi doğrulama istedi.');
            return await page.evaluate(() => {
                const categories = new Map();
                for (const link of document.querySelectorAll('a[href*="/gp/bestsellers/"]')) {
                    const name = (link.textContent || '').replace(/\s+/g, ' ').trim();
                    const url = link.href;
                    const id = url.match(/\/gp\/bestsellers\/([^/?#]+)/)?.[1];
                    if (id && !id.startsWith('ref=') && name.length > 1 && name.length < 70 && !categories.has(id)) categories.set(id, { id, name, url });
                }
                return [{ id: 'featured', name: 'Öne Çıkan Ürünler', url: 'https://www.amazon.com.tr/b?node=21034466031' }, ...categories.values()].slice(0, 40);
            });
        } finally {
            await page.close();
        }
    }

    async scrapeAmazonBestSellers(limit = 20, startUrl = 'https://www.amazon.com.tr/gp/bestsellers') {
        const browser = await this.initBrowser();
        const page = await browser.newPage();
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
            await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await page.waitForTimeout(2200);
            const html = await page.content();
            if (isBlockedPage(html)) throw new Error('Amazon Çok Satanlar sayfası bot doğrulaması istedi.');
            const items = await page.evaluate((maxItems) => {
                const allCards = [
                    ...document.querySelectorAll('#zg-ordered-list > li'),
                    ...document.querySelectorAll('.zg-grid-general-faceout'),
                    ...document.querySelectorAll('.zg-carousel-general-faceout'),
                    ...document.querySelectorAll('.p13n-sc-uncoverable-faceout'),
                    ...document.querySelectorAll('[id^="p13n-asin-index-"]')
                ];
                const cards = [...new Set(allCards)].slice(0, maxItems);
                return cards.map((card, index) => {
                    const text = selector => card.querySelector(selector)?.textContent?.trim() || '';
                    const link = card.querySelector('a[href*="/dp/"]')?.href || card.querySelector('a[href]')?.href || '';
                    const image = card.querySelector('img')?.currentSrc || card.querySelector('img')?.src || '';
                    const title = card.querySelector('img')?.alt || text('a[href*="/dp/"] span') || text('[class*="line-clamp"]') || text('a[href]');
                    const rankText = text('.zg-bdg-text') || text('[class*="rank"]');
                    const rank = Number.parseInt(rankText.replace(/\D/g, ''), 10) || index + 1;
                    return { rank, title, price: text('.a-price .a-offscreen') || text('a.a-text-normal') || text('[class*="price"]'), imageUrl: image, url: link };
                });
            }, limit);
            return items
                .map(item => ({ ...item, price: extractPrice(item.price) }))
                .filter(item => item.title && item.url && item.price)
                .sort((a, b) => a.rank - b.rank)
                .slice(0, limit);
        } finally {
            await page.close();
        }
    }

    async scrapeAmazonReviewRadar(startUrl, limit = 600) {
        const browser = await this.initBrowser();
        const page = await browser.newPage();
        const products = new Map();
        const visited = new Set();
        let pageUrl = startUrl;
        try {
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1440, height: 1100 });
            while (pageUrl && !visited.has(pageUrl) && visited.size < 80 && products.size < limit) {
                visited.add(pageUrl);
                await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
                await page.waitForTimeout(1300);
                const html = await page.content();
                if (isBlockedPage(html)) throw new Error('Amazon yorum analizi sayfası doğrulama istedi.');
                const result = await page.evaluate(() => {
                    const cards = [...document.querySelectorAll('[data-component-type="s-search-result"][data-asin], [data-asin][data-index]')];
                    const findCard = link => {
                        const bestsellerCard = link.closest('.p13n-sc-uncoverable-faceout, .zg-grid-general-faceout, .zg-carousel-general-faceout, [id^="p13n-asin-index-"]');
                        if (bestsellerCard) return bestsellerCard;
                        let node = link;
                        for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
                            if (node.querySelector?.('.a-icon-alt') && /\b(?:TL|₺)\b/.test(node.innerText || '')) return node;
                        }
                        return link.closest('[data-asin], li, article, div') || link;
                    };
                    const source = cards.length ? cards : [...document.querySelectorAll('a[href*="/dp/"]')].map(findCard);
                    const uniqueCards = [...new Set(source)];
                    const read = (root, selectors) => selectors.map(selector => root.querySelector(selector)?.textContent?.trim()).find(Boolean) || '';
                    return uniqueCards.map(card => {
                        const link = card.matches?.('a[href*="/dp/"]') ? card : card.querySelector('a[href*="/dp/"]');
                        if (!link) return null;
                        const url = link.href;
                        const asin = card.getAttribute?.('data-asin') || url.match(/\/dp\/([A-Z0-9]{10})/i)?.[1] || '';
                        const image = card.querySelector('img') || link.querySelector('img');
                        return {
                            asin, productUrl: url,
                            title: read(card, ['h2 span', '[data-cy="title-recipe"] h2', '[class*="p13n-sc-css-line-clamp"]']) || image?.alt || link.textContent?.trim() || '',
                            // Best-seller pages use a different product-card structure than search results.
                            priceText: read(card, ['.a-price .a-offscreen', '[class*="p13n-sc-price"]', '.a-color-price']),
                            ratingText: read(card, ['.a-icon-alt', '[data-cy="reviews-block"] .a-icon-alt', '[aria-label*="yıldız"]']),
                            reviewText: read(card, ['a[aria-label*="puan"] .a-size-small', '.a-icon-row .a-size-small', 'a[href*="#customerReviews"] span', 'a[href*="customerReviews"]', '.a-size-base.s-underline-text']),
                            imageUrl: image?.currentSrc || image?.src || ''
                        };
                    }).filter(Boolean);
                });
                for (const item of result) {
                    if (!item.asin || !item.productUrl || !item.title || products.has(item.asin)) continue;
                    const ratingText = item.ratingText || '';
                    const ratingMatch = ratingText.match(/(\d+[,.]\d+)/);
                    const rating = ratingMatch ? Number(ratingMatch[1].replace(',', '.')) : 0;
                    const reviewText = String(item.reviewText || '').replace(/\u00a0/g, ' ');
                    const reviewMatch = reviewText.match(/([\d.,]+)\s*([BbKkMm])?/);
                    let reviewCount = reviewMatch ? Number(reviewMatch[1].replace('.', '').replace(',', '.')) : 0;
                    const suffix = reviewMatch?.[2]?.toLocaleLowerCase('tr-TR');
                    if (suffix === 'b' || suffix === 'k') reviewCount *= 1000;
                    if (suffix === 'm') reviewCount *= 1000000;
                    products.set(item.asin, {
                        ...item,
                        price: extractPrice(item.priceText) || null,
                        rating: Number.isFinite(rating) ? rating : 0,
                        reviewCount: Number.isFinite(reviewCount) ? Math.round(reviewCount) : 0
                    });
                    if (products.size >= limit) break;
                }
                pageUrl = await page.evaluate(() => {
                    const next = document.querySelector('a.s-pagination-next:not(.s-pagination-disabled), a[aria-label*="Sonraki"]');
                    return next?.href || '';
                });
            }
            return [...products.values()].sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
        } finally {
            await page.close();
        }
    }

    async close() {
        if (this.browser) await this.browser.close();
        this.browser = null;
    }
}

module.exports = AdvancedScraper;
