const axios = require('axios');
const cron = require('node-cron');
const { detectSiteType, extractPrice, extractProductFromHtml } = require('./productExtractor');
const { sendAlertEmail, sendPriceChangesEmail } = require('./emailNotifier');

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
        this.hourlyAnalysisRunning = false;
        this.hourlyAnalysisStatus = { status: 'idle', source: null, step: 0, total: 4, startedAt: null, finishedAt: null, lowPriceProgress: null };
        this.lowPriceCategoriesCache = null;
        this.lowPriceCategoriesCacheUntil = 0;
    }

    detectSiteType(url) { return detectSiteType(url); }
    extractPrice(text) { return extractPrice(text); }
    cleanText(text) { return String(text || '').replace(/\s+/g, ' ').trim().substring(0, 300); }

    async getAdvancedScraper() {
        if (!this.advancedScraper && AdvancedScraper) this.advancedScraper = new AdvancedScraper();
        return this.advancedScraper;
    }

    async latestSnapshot(method, ...args) {
        return typeof this.db[method] === 'function' ? this.db[method](...args) : [];
    }

    priceChanges(source, items, previousItems, currentKey, previousKey) {
        if (!previousItems?.length) return [];
        const previous = new Map(previousItems.map(item => [previousKey(item), item]));
        return items.flatMap(item => {
            const before = previous.get(currentKey(item));
            const previousPrice = before?.price == null ? NaN : Number(before.price);
            const currentPrice = item.price == null ? NaN : Number(item.price);
            if (!before || !Number.isFinite(previousPrice) || !Number.isFinite(currentPrice) || previousPrice === currentPrice) return [];
            return [{
                source,
                title: item.title || before.title || 'Amazon ürünü',
                previousPrice,
                currentPrice,
                productUrl: item.productUrl || item.url || before.product_url || ''
            }];
        });
    }

    async notifyPriceChanges(source, changes) {
        if (!changes.length) return false;
        let savedBatchId = null;
        try {
            const saved = await this.db.savePriceChangeEvents(source, changes);
            savedBatchId = saved.batchId;
        } catch (error) {
            // Değişim günlüğü yazılamasa bile e-posta denemesi ve tarama devam eder.
            console.warn(`${source} fiyat değişimi günlüğe yazılamadı: ${error.message}`);
        }
        const labels = {
            'low-prices': 'Düşük Fiyat Radarı',
            deals: 'Amazon Fırsatları',
            'best-sellers': 'Amazon Çok Satanlar',
            'review-radar': 'Amazon Yorum Radarı'
        };
        try {
            const sent = await sendPriceChangesEmail(labels[source] || source, changes);
            if (savedBatchId) await this.db.markPriceChangeBatchEmail(savedBatchId, { sent });
            return sent;
        }
        catch (error) {
            if (savedBatchId) {
                try { await this.db.markPriceChangeBatchEmail(savedBatchId, { sent: false, error: error.message }); }
                catch (markError) { console.warn(`${source} e-posta durumu kaydedilemedi: ${markError.message}`); }
            }
            console.warn(`${source} fiyat değişim e-postası gönderilemedi: ${error.message}`);
            return false;
        }
    }

    async retryPendingPriceChangeEmails() {
        if (typeof this.db.getPendingPriceChangeBatches !== 'function') return 0;
        const rows = await this.db.getPendingPriceChangeBatches(20);
        const batches = new Map();
        for (const row of rows) {
            if (!batches.has(row.batch_id)) batches.set(row.batch_id, { source: row.source, changes: [] });
            batches.get(row.batch_id).changes.push({ title: row.title, previousPrice: row.previous_price, currentPrice: row.current_price, productUrl: row.product_url });
        }
        let delivered = 0;
        const labels = { 'low-prices': 'Düşük Fiyat Radarı', deals: 'Amazon Fırsatları', 'best-sellers': 'Amazon Çok Satanlar', 'review-radar': 'Amazon Yorum Radarı' };
        for (const [batchId, batch] of batches) {
            try {
                const sent = await sendPriceChangesEmail(labels[batch.source] || batch.source, batch.changes);
                await this.db.markPriceChangeBatchEmail(batchId, { sent });
                if (sent) delivered++;
            } catch (error) {
                await this.db.markPriceChangeBatchEmail(batchId, { sent: false, error: error.message });
                console.warn(`${batch.source} bekleyen e-posta gönderilemedi: ${error.message}`);
            }
        }
        return delivered;
    }

    async recordRun(source, itemCount, changedCount, error = null) {
        if (typeof this.db.recordAnalysisRun !== 'function') return;
        try {
            await this.db.recordAnalysisRun(source, {
                status: error ? 'failed' : 'completed', itemCount, changedCount, error
            });
        } catch (recordError) { console.warn(`Tarama kaydı yazılamadı: ${recordError.message}`); }
    }

    async markRunStarted(source) {
        if (typeof this.db.recordAnalysisRun !== 'function') return;
        try { await this.db.recordAnalysisRun(source, { status: 'running' }); }
        catch (error) { console.warn(`Tarama başlangıcı kaydedilemedi: ${error.message}`); }
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
        await this.markRunStarted('best-sellers');
        const previous = await this.latestSnapshot('getLatestAmazonBestSellers', category.id);
        const items = await (await this.getAdvancedScraper()).scrapeAmazonBestSellers(20, category.url);
        if (!items.length) throw new Error('Amazon Çok Satanlar listesinden fiyatlı ürün alınamadı.');
        await this.db.saveAmazonBestSellerSnapshot(items, category);
        const changes = this.priceChanges('best-sellers', items, previous, item => item.url, item => item.product_url);
        await this.notifyPriceChanges('best-sellers', changes);
        await this.recordRun('best-sellers', items.length, changes.length);
        console.log(`Amazon Çok Satanlar anlık görüntüsü kaydedildi (${items.length} ürün).`);
        return items;
    }

    async refreshAmazonDeals() {
        if (!this.usePuppeteer) throw new Error('Amazon kampanya kolektörü için tarayıcı desteği etkin olmalı.');
        await this.markRunStarted('deals');
        const previous = await this.latestSnapshot('getLatestAmazonDeals');
        const items = await (await this.getAdvancedScraper()).scrapeAmazonDeals(600);
        if (!items.length) throw new Error('Amazon kampanya sayfasından fiyatlı ürün alınamadı.');
        await this.db.saveAmazonDealSnapshot(items);
        const changes = this.priceChanges('deals', items, previous, item => item.asin, item => item.asin);
        await this.notifyPriceChanges('deals', changes);
        await this.recordRun('deals', items.length, changes.length);
        console.log(`Amazon indirim vitrini anlık görüntüsü kaydedildi (${items.length} ürün).`);
        return items;
    }

    async getAmazonLowPriceCategories() {
        if (!this.usePuppeteer) throw new Error('Amazon kategori listesi için tarayıcı desteği etkin olmalı.');
        if (this.lowPriceCategoriesCache && Date.now() < this.lowPriceCategoriesCacheUntil) return this.lowPriceCategoriesCache;
        const categories = await (await this.getAdvancedScraper()).getAmazonLowPriceCategories();
        this.lowPriceCategoriesCache = categories;
        this.lowPriceCategoriesCacheUntil = Date.now() + 6 * 60 * 60 * 1000;
        return categories;
    }

    async refreshAmazonReviewRadar(category = { id: 'featured', name: 'Öne Çıkan Ürünler', url: 'https://www.amazon.com.tr/b?node=21034466031' }) {
        if (!this.usePuppeteer) throw new Error('Amazon yorum radarı için tarayıcı desteği etkin olmalı.');
        await this.markRunStarted('review-radar');
        const previous = await this.latestSnapshot('getLatestAmazonReviewRadar', category.id);
        const items = await (await this.getAdvancedScraper()).scrapeAmazonReviewRadar(category.url, 600);
        if (!items.length) throw new Error('Amazon sayfasında ayrıştırılabilir ürün bulunamadı.');
        await this.db.saveAmazonReviewRadarSnapshot(items, category);
        const changes = this.priceChanges('review-radar', items, previous, item => item.asin, item => item.asin);
        await this.notifyPriceChanges('review-radar', changes);
        await this.recordRun('review-radar', items.length, changes.length);
        console.log(`Amazon yorum radarı anlık görüntüsü kaydedildi (${items.length} ürün).`);
        return items;
    }

    async refreshAmazonLowPriceCategory(category, { notify = true, recordRun = true } = {}) {
        if (!category?.id || !category?.name) throw new Error('Kategori bilgisi gerekli.');
        if (!this.usePuppeteer) throw new Error('Amazon en düşük fiyatlar taraması için tarayıcı desteği etkin olmalı.');
        if (recordRun) await this.markRunStarted('low-prices');
        const previous = await this.latestSnapshot('getLatestAmazonLowPriceItems', category.id);
        const items = await (await this.getAdvancedScraper()).scrapeAmazonLowPriceCategory(category, 500);
        if (!items.length) throw new Error(`${category.name} kategorisinde ayrıştırılabilir düşük fiyat ürünü bulunamadı.`);
        const snapshot = await this.db.saveAmazonLowPriceSnapshot(category, items);
        const changes = snapshot.saved
            ? this.priceChanges('low-prices', items, previous, item => `${item.asin}|${item.lowPricePeriod}`, item => `${item.asin}|${item.low_price_period}`)
            : [];
        if (notify) await this.notifyPriceChanges('low-prices', changes);
        if (recordRun) await this.recordRun('low-prices', items.length, changes.length);
        console.log(snapshot.saved
            ? `Amazon düşük fiyat anlık görüntüsü kaydedildi: ${category.name} (${snapshot.count} ürün).`
            : `Amazon düşük fiyat vitrini değişmedi: ${category.name}.`);
        return { items, saved: snapshot.saved, savedCount: snapshot.count, priceChanges: changes };
    }

    async refreshAllAmazonLowPriceCategories(onProgress = () => {}) {
        await this.markRunStarted('low-prices');
        const categories = await this.getAmazonLowPriceCategories();
        const summary = { total: categories.length, completed: 0, changedCategories: 0, savedCount: 0, failures: [] };
        const priceChanges = [];
        let scannedItemCount = 0;
        let pendingCategories = [...categories];
        for (let round = 1; round <= 2 && pendingCategories.length; round++) {
            const retryQueue = [];
            for (const category of pendingCategories) {
                try {
                    const result = await this.refreshAmazonLowPriceCategory(category, { notify: false, recordRun: false });
                    summary.completed++;
                    if (result.saved) summary.changedCategories++;
                    summary.savedCount += result.savedCount;
                    scannedItemCount += result.items.length;
                    priceChanges.push(...(result.priceChanges || []));
                    onProgress({ ...summary, category, result, status: 'running', round });
                } catch (error) {
                    if (round === 1) {
                        retryQueue.push(category);
                        onProgress({ ...summary, category, status: 'running', round, retrying: true, retryError: error.message });
                    } else {
                        summary.completed++;
                        summary.failures.push({ category: category.name, error: error.message });
                        onProgress({ ...summary, category, status: 'running', round });
                    }
                }
            }
            pendingCategories = retryQueue;
        }
        await this.notifyPriceChanges('low-prices', priceChanges);
        await this.recordRun('low-prices', scannedItemCount, priceChanges.length);
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

    async runHourlyAnalyses() {
        if (this.hourlyAnalysisRunning) {
            console.warn('Saatlik radar turu hâlâ çalışıyor; yeni tur atlandı.');
            return false;
        }
        this.hourlyAnalysisRunning = true;
        this.hourlyAnalysisStatus = { status: 'running', source: 'low-prices', step: 0, total: 4, startedAt: new Date().toISOString(), finishedAt: null, lowPriceProgress: null };
        const run = async (source, task) => {
            this.hourlyAnalysisStatus.source = source;
            try { await task(); }
            catch (error) {
                console.warn(`${source} saatlik taraması başarısız: ${error.message}`);
                await this.recordRun(source, 0, 0, error.message);
            } finally {
                this.hourlyAnalysisStatus.step++;
            }
        };
        try {
            // Aynı Chrome oturumuna eşzamanlı yük bindirmemek için radarlar sırayla çalışır.
            await run('low-prices', () => this.refreshAllAmazonLowPriceCategories(progress => {
                this.hourlyAnalysisStatus.lowPriceProgress = {
                    completed: progress.completed || 0,
                    total: progress.total || 0,
                    currentCategory: progress.category?.name || null
                };
            }));
            await run('best-sellers', () => this.refreshAmazonBestSellers());
            await run('review-radar', () => this.refreshAmazonReviewRadar());
            await run('deals', () => this.refreshAmazonDeals());
        } finally {
            this.hourlyAnalysisRunning = false;
            this.hourlyAnalysisStatus = { ...this.hourlyAnalysisStatus, status: 'completed', source: null, finishedAt: new Date().toISOString() };
        }
        return true;
    }

    getHourlyAnalysisStatus() {
        return { ...this.hourlyAnalysisStatus, lowPriceProgress: this.hourlyAnalysisStatus.lowPriceProgress && { ...this.hourlyAnalysisStatus.lowPriceProgress } };
    }

    async runMissedHourlyAnalyses() {
        if (typeof this.db.getLatestAnalysisRuns !== 'function') return false;
        try {
            const latestRuns = await this.db.getLatestAnalysisRuns();
            const bySource = new Map(latestRuns.map(run => [run.source, run]));
            const hourStart = new Date();
            hourStart.setMinutes(0, 0, 0);
            const requiredSources = ['low-prices', 'best-sellers', 'review-radar', 'deals'];
            const missed = requiredSources.some(source => {
                const run = bySource.get(source);
                if (!run || run.status !== 'completed' || !run.finished_at) return true;
                const finishedAt = new Date(`${String(run.finished_at).replace(' ', 'T').replace(/Z$/, '')}Z`);
                return finishedAt < hourStart;
            });
            if (!missed) return false;
            console.log('Bu saat için eksik radar turu bulundu; telafi taraması başlatılıyor.');
            return this.runHourlyAnalyses();
        } catch (error) {
            console.warn(`Telafi taraması kontrolü yapılamadı: ${error.message}`);
            return false;
        }
    }

    startAutoCheck() {
        cron.schedule('*/10 * * * *', () => {
            this.retryPendingPriceChangeEmails()
                .then(count => { if (count) console.log(`${count} bekleyen fiyat değişimi e-postası gönderildi.`); })
                .catch(error => console.warn(`Bekleyen e-posta kuyruğu kontrol edilemedi: ${error.message}`));
        });
        cron.schedule('0 * * * *', () => {
            this.runHourlyAnalyses().catch(error => console.warn(`Saatlik radar turu durdu: ${error.message}`));
        });
        cron.schedule('15 * * * *', async () => {
            try { await this.checkTabAlerts(); }
            catch (error) { console.warn(`Alarm kontrolü yapılamadı: ${error.message}`); }
        });
        // Sunucu tam saatten sonra yeniden başladıysa bir sonraki saati bekleme.
        setTimeout(() => this.runMissedHourlyAnalyses(), 12000);
        setTimeout(() => this.retryPendingPriceChangeEmails().catch(error => console.warn(`Bekleyen e-posta kuyruğu başlatılamadı: ${error.message}`)), 5000);
        console.log('Düşük Fiyat, Fırsatlar, Çok Satanlar ve Yorum Radarı her saat sırayla yenilenir.');
    }
}

module.exports = PriceTracker;
