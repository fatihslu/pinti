const axios = require('axios');
const cron = require('node-cron');
const { detectSiteType, extractPrice, extractProductFromHtml } = require('./productExtractor');
const { sendAlertEmail } = require('./emailNotifier');

let AdvancedScraper = null;
try { AdvancedScraper = require('./advancedScraper'); } catch (_) { /* İsteğe bağlı tarayıcı desteği */ }

const REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8'
};

class PriceTracker {
    constructor(database) {
        this.db = database;
        this.advancedScraper = null;
        this.usePuppeteer = AdvancedScraper !== null && process.env.USE_PUPPETEER !== 'false';
    }

    detectSiteType(url) { return detectSiteType(url); }
    extractPrice(text) { return extractPrice(text); }
    cleanText(text) { return String(text || '').replace(/\s+/g, ' ').trim().substring(0, 300); }

    async getAdvancedScraper() {
        if (!this.advancedScraper && AdvancedScraper) this.advancedScraper = new AdvancedScraper();
        return this.advancedScraper;
    }

    async scrapeProduct(url) {
        try { new URL(url); } catch (_) { throw new Error('Geçerli bir ürün URL’si girin.'); }
        let axiosError;
        try {
            const response = await axios.get(url, {
                headers: REQUEST_HEADERS, timeout: 20000, maxRedirects: 5,
                responseType: 'text', validateStatus: status => status >= 200 && status < 400
            });
            return extractProductFromHtml(response.data, response.request?.res?.responseUrl || url);
        } catch (error) {
            axiosError = error;
            console.warn(`HTTP ile çekilemedi: ${error.message}`);
        }

        if (this.usePuppeteer) {
            try { return await (await this.getAdvancedScraper()).scrapeProduct(url); }
            catch (error) { throw new Error(`Fiyat çekilemedi. HTTP: ${axiosError.message}; tarayıcı: ${error.message}`); }
        }
        throw new Error(`Fiyat çekilemedi: ${axiosError.message}. Dinamik siteler için 'npm install' ile Puppeteer bağımlılığını kurun.`);
    }

    async addProduct(url, targetPrice = null) {
        const existing = await this.db.getProductByUrl(url);
        if (existing) return { message: 'Bu ürün zaten takip ediliyor', product: existing };
        const productData = await this.scrapeProduct(url);
        const productId = await this.db.addProduct(url, productData.title, productData.price, productData.imageUrl, targetPrice);
        await this.db.addPriceHistory(productId, productData.price);
        return { id: productId, ...productData, targetPrice };
    }

    async findAndAddAlternatives(sourceProduct, comparisonGroup) {
        if (!this.usePuppeteer) throw new Error('Diğer mağazalarda arama için tarayıcı desteği etkin olmalı.');
        const scraper = await this.getAdvancedScraper();
        const { matches: alternatives, unavailableSites } = await scraper.findAlternatives(sourceProduct.title, sourceProduct.url);
        const added = [];
        for (const item of alternatives) {
            if (await this.db.getProductByUrl(item.url)) continue;
            const productId = await this.db.addProduct(item.url, item.title, item.price, item.imageUrl, null);
            await this.db.addPriceHistory(productId, item.price);
            await this.db.setComparisonGroup(productId, comparisonGroup);
            added.push({ id: productId, ...item });
        }
        return { added, unavailableSites };
    }

    async importGoogleShoppingOffers(product) {
        if (detectSiteType(product.url) !== 'amazon') return { attempted: false, count: 0, query: null };
        if (!this.usePuppeteer) throw new Error('Google Shopping araması için tarayıcı desteği etkin olmalı.');
        const result = await (await this.getAdvancedScraper()).searchGoogleShopping(product.title, 40);
        await this.db.addExternalOffers(product.id, result.offers);
        return { attempted: true, count: result.offers.length, query: result.query };
    }

    async getAmazonAnalysisCategories() {
        if (!this.usePuppeteer) throw new Error('Amazon kategori listesi için tarayıcı desteği etkin olmalı.');
        return (await this.getAdvancedScraper()).getAmazonAnalysisCategories();
    }

    async refreshAmazonBestSellers(category = { id: 'featured', name: 'Öne Çıkan Ürünler', url: 'https://www.amazon.com.tr/b?node=21034466031' }) {
        if (!this.usePuppeteer) throw new Error('Amazon Çok Satanlar kolektörü için tarayıcı desteği etkin olmalı.');
        const items = await (await this.getAdvancedScraper()).scrapeAmazonBestSellers(20, category.url);
        if (!items.length) throw new Error('Amazon Çok Satanlar listesinden fiyatlı ürün alınamadı.');
        await this.db.saveAmazonBestSellerSnapshot(items, category);
        console.log(`Amazon Çok Satanlar anlık görüntüsü kaydedildi (${items.length} ürün).`);
        return items;
    }

    async refreshAmazonDeals() {
        if (!this.usePuppeteer) throw new Error('Amazon kampanya kolektörü için tarayıcı desteği etkin olmalı.');
        const items = await (await this.getAdvancedScraper()).scrapeAmazonDeals(600);
        if (!items.length) throw new Error('Amazon kampanya sayfasından fiyatlı ürün alınamadı.');
        await this.db.saveAmazonDealSnapshot(items);
        console.log(`Amazon indirim vitrini anlık görüntüsü kaydedildi (${items.length} ürün).`);
        return items;
    }

    async getAmazonLowPriceCategories() {
        if (!this.usePuppeteer) throw new Error('Amazon kategori listesi için tarayıcı desteği etkin olmalı.');
        return (await this.getAdvancedScraper()).getAmazonLowPriceCategories();
    }

    async refreshAmazonReviewRadar(category = { id: 'featured', name: 'Öne Çıkan Ürünler', url: 'https://www.amazon.com.tr/b?node=21034466031' }) {
        if (!this.usePuppeteer) throw new Error('Amazon yorum radarı için tarayıcı desteği etkin olmalı.');
        const items = await (await this.getAdvancedScraper()).scrapeAmazonReviewRadar(category.url, 600);
        if (!items.length) throw new Error('Amazon sayfasında ayrıştırılabilir ürün bulunamadı.');
        await this.db.saveAmazonReviewRadarSnapshot(items, category);
        console.log(`Amazon yorum radarı anlık görüntüsü kaydedildi (${items.length} ürün).`);
        return items;
    }

    async refreshAmazonLowPriceCategory(category) {
        if (!category?.id || !category?.name) throw new Error('Kategori bilgisi gerekli.');
        if (!this.usePuppeteer) throw new Error('Amazon en düşük fiyatlar taraması için tarayıcı desteği etkin olmalı.');
        const items = await (await this.getAdvancedScraper()).scrapeAmazonLowPriceCategory(category, 500);
        if (!items.length) throw new Error(`${category.name} kategorisinde ayrıştırılabilir düşük fiyat ürünü bulunamadı.`);
        const snapshot = await this.db.saveAmazonLowPriceSnapshot(category, items);
        console.log(snapshot.saved
            ? `Amazon düşük fiyat anlık görüntüsü kaydedildi: ${category.name} (${snapshot.count} ürün).`
            : `Amazon düşük fiyat vitrini değişmedi: ${category.name}.`);
        return { items, saved: snapshot.saved, savedCount: snapshot.count };
    }

    async refreshAllAmazonLowPriceCategories(onProgress = () => {}) {
        const categories = await this.getAmazonLowPriceCategories();
        const summary = { total: categories.length, completed: 0, changedCategories: 0, savedCount: 0, failures: [] };
        for (const category of categories) {
            try {
                const result = await this.refreshAmazonLowPriceCategory(category);
                summary.completed++;
                if (result.saved) summary.changedCategories++;
                summary.savedCount += result.savedCount;
                onProgress({ ...summary, category, result, status: 'running' });
            } catch (error) {
                summary.completed++;
                summary.failures.push({ category: category.name, error: error.message });
                onProgress({ ...summary, category, status: 'running' });
            }
        }
        return summary;
    }

    async checkPrice(product) {
        const productData = await this.scrapeProduct(product.url);
        const newPrice = productData.price;
        const oldPrice = product.current_price;
        // Keepa benzeri zaman serisi: fiyat değişmese bile her başarılı ölçümü sakla.
        await this.db.addPriceHistory(product.id, newPrice);
        const changed = newPrice !== oldPrice;
        if (changed) {
            await this.db.updatePrice(product.id, newPrice);
            const priceChange = ((newPrice - oldPrice) / oldPrice * 100).toFixed(2);
            if (product.target_price && newPrice <= product.target_price) await this.db.addNotification(product.id, `Hedef fiyata ulaşıldı: ${product.title} — ${newPrice} TL`);
            if (newPrice < oldPrice && Math.abs(priceChange) >= 20) await this.db.addNotification(product.id, `Büyük indirim: ${product.title} — %${Math.abs(priceChange)} indirim`);
        }
        return { price: newPrice, changed };
    }

    async checkAllPrices() {
        const products = await this.db.getAllProducts();
        for (const product of products) {
            try { await this.checkPrice(product); } catch (error) { console.error(`${product.title}: ${error.message}`); }
            await new Promise(resolve => setTimeout(resolve, 2500));
        }
    }

    async checkTabAlerts() {
        const alerts = await this.db.getActiveProductAlerts();
        for (const alert of alerts) {
            try {
                const product = await this.scrapeProduct(alert.product_url);
                const price = product.price;
                const reasons = [];
                if (alert.target_price && price <= alert.target_price) reasons.push(`hedef fiyat ${alert.target_price} TL`);
                const drop = alert.base_price > 0 ? (1 - price / alert.base_price) * 100 : 0;
                if (alert.discount_percent && drop >= alert.discount_percent) reasons.push(`%${drop.toFixed(1)} indirim`);
                const changedSinceNotice = alert.last_notified_price == null || Number(alert.last_notified_price) !== Number(price);
                const mailed = reasons.length && changedSinceNotice ? await sendAlertEmail(alert, price, reasons) : false;
                await this.db.updateProductAlertCheck(alert.id, price, mailed);
            } catch (error) { console.warn(`Alarm kontrolü atlandı: ${alert.title} (${error.message})`); }
        }
    }

    startAutoCheck() {
        cron.schedule('0 * * * *', async () => {
            if (this.lowPriceAutoScanRunning) return;
            this.lowPriceAutoScanRunning = true;
            try {
                const result = await this.refreshAllAmazonLowPriceCategories();
                console.log(`Amazon düşük fiyat kategorileri saatlik yenilendi (${result.savedCount} kayıt).`);
            } catch (error) {
                console.warn(`Amazon düşük fiyat vitrini güncellenemedi: ${error.message}`);
            } finally {
                this.lowPriceAutoScanRunning = false;
            }
        });
        cron.schedule('0 */3 * * *', async () => {
            if (this.bestSellerAutoScanRunning) return;
            this.bestSellerAutoScanRunning = true;
            try {
                const items = await this.refreshAmazonBestSellers();
                console.log(`Amazon Çok Satanlar 3 saatlik yenilendi (${items.length} ürün).`);
            } catch (error) {
                console.warn(`Amazon Çok Satanlar yenilenemedi: ${error.message}`);
            } finally {
                this.bestSellerAutoScanRunning = false;
            }
        });
        cron.schedule('15 * * * *', async () => {
            try { await this.checkTabAlerts(); }
            catch (error) { console.warn(`Alarm kontrolü yapılamadı: ${error.message}`); }
        });
        console.log('Amazon düşük fiyat kategorilerinin tamamı saat başı, Çok Satanlar ise 3 saatte bir yenilenir.');
    }
}

module.exports = PriceTracker;
