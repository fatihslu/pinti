const express = require('express');
const path = require('path');
const Database = require('./database');
const PriceTracker = require('./priceTracker');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
// Google Shopping HTML'sinden gelen küçük gömülü WebP görselleri, teklif
// içe aktarım isteğini varsayılan 100 KB sınırının üstüne çıkarabilir.
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));
// Görev Zamanlayıcı uygulamayı farklı bir çalışma klasöründen başlatabilir.
// Statik arayüzün bu durumda da bulunması için yolu proje köküne sabitle.
app.use(express.static(path.join(__dirname, 'public')));

// Veritabanı ve fiyat takipçi başlat
const db = new Database();
const tracker = new PriceTracker(db);
const lowPriceFullScan = {
    status: 'idle', startedAt: null, finishedAt: null, total: 0, completed: 0,
    changedCategories: 0, savedCount: 0, currentCategory: null, failures: [], logs: []
};
const DEFAULT_ANALYSIS_CATEGORY = { id: 'featured', name: 'Öne Çıkan Ürünler', url: 'https://www.amazon.com.tr/b?node=21034466031&ref_=nav_em_0_1_1_29&enabledRefinements=%5B%7B%22rid%22%3A%22p_72%22%2C%22value%22%3A%2213136589031%22%2C%22ridType%22%3A%22SEARCH_SHORT_ID%22%2C%22type%22%3A%22BROWSE_NODE%22%7D%5D' };
const reviewRadarScan = { status: 'idle', startedAt: null, finishedAt: null, count: 0, error: null };

async function resolveAnalysisCategory(categoryId) {
    if (!categoryId || categoryId === DEFAULT_ANALYSIS_CATEGORY.id) return DEFAULT_ANALYSIS_CATEGORY;
    const categories = await tracker.getAmazonAnalysisCategories();
    return categories.find(category => category.id === categoryId) || DEFAULT_ANALYSIS_CATEGORY;
}

function startReviewRadarScan(category) {
    if (reviewRadarScan.status === 'running') return false;
    Object.assign(reviewRadarScan, { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, count: 0, error: null });
    tracker.refreshAmazonReviewRadar(category)
        .then(items => Object.assign(reviewRadarScan, { status: 'completed', finishedAt: new Date().toISOString(), count: items.length }))
        .catch(error => Object.assign(reviewRadarScan, { status: 'failed', finishedAt: new Date().toISOString(), error: error.message }));
    return true;
}

function addLowPriceScanLog(message) {
    lowPriceFullScan.logs.push({ at: new Date().toISOString(), message });
    if (lowPriceFullScan.logs.length > 120) lowPriceFullScan.logs.shift();
}

function startFullLowPriceScan() {
    if (lowPriceFullScan.status === 'running') return false;
    Object.assign(lowPriceFullScan, {
        status: 'running', startedAt: new Date().toISOString(), finishedAt: null, total: 0, completed: 0,
        changedCategories: 0, savedCount: 0, currentCategory: null, failures: [], logs: []
    });
    addLowPriceScanLog('Tam kategori taraması başlatıldı.');
    tracker.refreshAllAmazonLowPriceCategories(progress => {
        Object.assign(lowPriceFullScan, progress, { currentCategory: progress.category?.name || null, failures: progress.failures || [] });
        if (progress.result) {
            addLowPriceScanLog(progress.result.saved
                ? `${progress.category.name}: ${progress.result.items.length} ürün tarandı, ${progress.result.savedCount} yeni/değişen kayıt kaydedildi.`
                : `${progress.category.name}: ${progress.result.items.length} ürün tarandı, değişiklik bulunmadı.`);
        } else if (progress.retrying) {
            addLowPriceScanLog(`${progress.category.name}: ilk deneme başarısız, turun sonunda yeniden denenecek.`);
        } else if (progress.failures?.length) {
            const failure = progress.failures[progress.failures.length - 1];
            addLowPriceScanLog(`${failure.category}: tarama atlandı (${failure.error}).`);
        }
    }).then(result => {
        Object.assign(lowPriceFullScan, result, { status: 'completed', currentCategory: null, finishedAt: new Date().toISOString() });
        addLowPriceScanLog(`Tarama tamamlandı: ${result.savedCount} kayıt eklendi/değişti.`);
    }).catch(error => {
        Object.assign(lowPriceFullScan, { status: 'failed', currentCategory: null, error: error.message, finishedAt: new Date().toISOString() });
        addLowPriceScanLog(`Tarama durdu: ${error.message}`);
    });
    return true;
}

// Mağaza keşfi ek üründür; erişim engeli yüzünden ana ürün ekleme işlemi başarısız olmamalı.
async function discoverAlternativesSafely(product, groupName) {
    try {
        return await tracker.findAndAddAlternatives(product, groupName);
    } catch (error) {
        console.warn(`Alternatif mağaza araması atlandı: ${error.message}`);
        return { added: [], unavailableSites: [{ site: 'Diğer mağazalar', reason: error.message }] };
    }
}

// Amazon ürünleri için Google Shopping sonuçlarını teklif listesine ekler.
// Google doğrulama isterse ana ürün zaten kaydedilmiş olur; hata kullanıcıya bilgi
// olarak döner ve daha sonra HTML yapıştırma yöntemi kullanılabilir.
async function importGoogleShoppingSafely(product) {
    if (tracker.detectSiteType(product.url) !== 'amazon') return { attempted: false, count: 0 };
    try {
        return await tracker.importGoogleShoppingOffers(product);
    } catch (error) {
        console.warn(`Google Shopping teklifleri alınamadı: ${error.message}`);
        return { attempted: true, count: 0, error: error.message };
    }
}

// API Endpoints

// Yeni ürün ekle
app.post('/api/products', async (req, res) => {
    try {
        const { url, targetPrice, manualTitle, manualPrice, manualImage, comparisonGroup } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL gereklidir' });
        }

        // Eğer manuel veri verilmişse, scraping yapmadan direkt ekle
        if (manualTitle && manualPrice) {
            console.log('📝 Manuel veri ile ürün ekleniyor...');
            
            const productId = await db.addProduct(
                url,
                manualTitle,
                parseFloat(manualPrice),
                manualImage || 'https://via.placeholder.com/300x300?text=Urun',
                targetPrice
            );
            
            await db.addPriceHistory(productId, parseFloat(manualPrice));
            const groupName = comparisonGroup?.trim() || manualTitle;
            await db.setComparisonGroup(productId, groupName);
            
            const product = await db.getProduct(productId);
            const discovery = await discoverAlternativesSafely(product, groupName);
            const googleShopping = await importGoogleShoppingSafely(product);
            return res.json({ success: true, product, isManual: true, alternatives: discovery.added, unavailableSites: discovery.unavailableSites, googleShopping });
        }

        // Normal scraping işlemi
        const product = await tracker.addProduct(url, targetPrice);
        const groupName = comparisonGroup?.trim() || product.title;
        await db.setComparisonGroup(product.id, groupName);
        const discovery = await discoverAlternativesSafely(product, groupName);
        const googleShopping = await importGoogleShoppingSafely(product);
        res.json({ success: true, product, alternatives: discovery.added, unavailableSites: discovery.unavailableSites, googleShopping });
    } catch (error) {
        console.error('Ürün eklenirken hata:', error);
        res.status(500).json({ error: error.message });
    }
});

// Tüm ürünleri listele
app.get('/api/products', async (req, res) => {
    try {
        const products = await db.getAllProducts();
        res.json(products);
    } catch (error) {
        console.error('Ürünler alınırken hata:', error);
        res.status(500).json({ error: error.message });
    }
});

// Belirli bir ürünün fiyat geçmişini getir
app.get('/api/products/:id/history', async (req, res) => {
    try {
        const { id } = req.params;
        const history = await db.getPriceHistory(id);
        res.json(history);
    } catch (error) {
        console.error('Fiyat geçmişi alınırken hata:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/amazon/analysis-categories', async (req, res) => {
    try { res.json([DEFAULT_ANALYSIS_CATEGORY, ...(await tracker.getAmazonAnalysisCategories()).filter(category => category.id !== DEFAULT_ANALYSIS_CATEGORY.id)]); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/amazon/analysis-runs', async (req, res) => {
    try { res.json(await db.getLatestAnalysisRuns()); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

// Arayüz, hangi sekme açık olursa olsun bu ortak durumla tam ekran çalışma perdesini gösterir.
app.get('/api/automation/status', async (req, res) => {
    try {
        const hourly = tracker.getHourlyAnalysisStatus();
        if (hourly.status === 'running') return res.json({ mode: 'hourly', ...hourly });
        if (lowPriceFullScan.status === 'running') return res.json({
            status: 'running', mode: 'low-price-manual', source: 'low-prices', step: 0, total: 1,
            startedAt: lowPriceFullScan.startedAt, completed: lowPriceFullScan.completed,
            categoryTotal: lowPriceFullScan.total, currentCategory: lowPriceFullScan.currentCategory
        });
        if (reviewRadarScan.status === 'running') return res.json({
            status: 'running', mode: 'review-manual', source: 'review-radar', step: 0, total: 1,
            startedAt: reviewRadarScan.startedAt
        });
        const running = (await db.getLatestAnalysisRuns()).find(run => run.status === 'running');
        return res.json(running
            ? { status: 'running', mode: 'single', source: running.source, step: 0, total: 1, startedAt: running.started_at }
            : { status: 'idle' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/amazon/price-history', async (req, res) => {
    try {
        const allowedSources = new Set(['low-prices', 'deals', 'best-sellers', 'review-radar']);
        if (!allowedSources.has(req.query.source) || !req.query.key) return res.status(400).json({ error: 'Geçerli kaynak ve ürün anahtarı gerekli.' });
        res.json(await db.getAmazonPriceHistory({
            source: req.query.source,
            key: req.query.key,
            categoryId: req.query.categoryId || DEFAULT_ANALYSIS_CATEGORY.id,
            period: req.query.period,
            limit: req.query.limit
        }));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/amazon/best-sellers', async (req, res) => {
    try { res.json(await db.getLatestAmazonBestSellers(req.query.categoryId || DEFAULT_ANALYSIS_CATEGORY.id)); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/amazon/best-sellers/month/:month', async (req, res) => {
    try {
        if (!/^\d{4}-\d{2}$/.test(req.params.month)) return res.status(400).json({ error: 'Ay YYYY-AA biçiminde olmalı.' });
        res.json(await db.getMonthlyAmazonBestSellers(req.params.month));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/amazon/best-sellers/refresh', async (req, res) => {
    try {
        const category = await resolveAnalysisCategory(req.body.categoryId);
        res.json({ success: true, category, products: await tracker.refreshAmazonBestSellers(category) });
    }
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/amazon/deals', async (req, res) => {
    try { res.json(await db.getLatestAmazonDeals()); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/amazon/deals/refresh', async (req, res) => {
    try { res.json({ success: true, products: await tracker.refreshAmazonDeals() }); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/amazon/low-prices/categories', async (req, res) => {
    try { res.json(await tracker.getAmazonLowPriceCategories()); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/amazon/review-radar', async (req, res) => {
    try { res.json(await db.getLatestAmazonReviewRadar(req.query.categoryId || DEFAULT_ANALYSIS_CATEGORY.id)); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/amazon/review-radar/refresh', async (req, res) => {
    try {
        const category = await resolveAnalysisCategory(req.body.categoryId);
        const started = startReviewRadarScan(category);
        res.status(started ? 202 : 200).json({ started, category, ...reviewRadarScan });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/amazon/review-radar/scan-status', (req, res) => res.json(reviewRadarScan));

app.post('/api/alerts', async (req, res) => {
    try {
        const { source, categoryName, title, productUrl, basePrice, targetPrice, discountPercent } = req.body;
        if (!source || !title || !productUrl || !Number.isFinite(Number(basePrice))) return res.status(400).json({ error: 'Alarm için ürün ve başlangıç fiyatı gerekli.' });
        const target = Number(targetPrice);
        const discount = Number(discountPercent);
        if (!(target > 0) && !(discount > 0)) return res.status(400).json({ error: 'Hedef fiyat veya indirim oranından en az biri girilmeli.' });
        const id = await db.addProductAlert({ source, categoryName, title: String(title).slice(0, 500), productUrl, basePrice: Number(basePrice), targetPrice: target > 0 ? target : null, discountPercent: discount > 0 ? discount : null, email: 'faatihuslu@gmail.com' });
        res.json({ success: true, id });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/alerts', async (req, res) => {
    try { res.json(await db.getProductAlerts()); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/alerts/:id', async (req, res) => {
    try { res.json({ success: true, deleted: await db.deleteProductAlert(req.params.id) }); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/amazon/low-prices/refresh-all', (req, res) => {
    const started = startFullLowPriceScan();
    res.status(started ? 202 : 200).json({ started, ...lowPriceFullScan });
});

app.get('/api/amazon/low-prices/scan-status', (req, res) => {
    res.json(lowPriceFullScan);
});

app.get('/api/amazon/low-prices/:categoryId', async (req, res) => {
    try { res.json(await db.getLatestAmazonLowPriceItems(req.params.categoryId)); }
    catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/amazon/low-prices/:categoryId/refresh', async (req, res) => {
    try {
        const categories = await tracker.getAmazonLowPriceCategories();
        const category = categories.find(item => item.id === req.params.categoryId);
        if (!category) return res.status(404).json({ error: 'Amazon sayfasında kategori bulunamadı.' });
        const result = await tracker.refreshAmazonLowPriceCategory(category);
        res.json({ success: true, category, products: result.items, saved: result.saved, savedCount: result.savedCount });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Aynı karşılaştırma grubundaki mağaza kayıtlarını düşük fiyata göre döndür.
app.get('/api/products/:id/comparison', async (req, res) => {
    try {
        const products = await db.getProductComparison(req.params.id);
        if (!products.length) return res.status(404).json({ error: 'Bu ürün henüz bir karşılaştırma grubunda değil.' });
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/products/:id/comparison-group', async (req, res) => {
    try {
        const groupName = await db.setComparisonGroup(req.params.id, req.body.groupName);
        res.json({ success: true, groupName });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Kullanıcı isterse aynı ürün için mağaza aramasını tekrar çalıştırabilir.
app.post('/api/products/:id/find-alternatives', async (req, res) => {
    try {
        const product = await db.getProduct(req.params.id);
        if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
        const existing = (await db.getProductComparison(product.id))[0];
        const groupName = existing?.group_name || product.title;
        await db.setComparisonGroup(product.id, groupName);
        const discovery = await tracker.findAndAddAlternatives(product, groupName);
        res.json({ success: true, alternatives: discovery.added, unavailableSites: discovery.unavailableSites });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/products/:id/external-offers', async (req, res) => {
    try {
        const product = await db.getProduct(req.params.id);
        if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
        res.json(await db.getLatestExternalOffers(product.id));
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/products/:id/external-offers', async (req, res) => {
    try {
        const product = await db.getProduct(req.params.id);
        if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
        const rawOffers = Array.isArray(req.body.offers) ? req.body.offers : [req.body];
        if (!rawOffers.length || rawOffers.length > 30) return res.status(400).json({ error: '1 ile 30 arası teklif ekleyebilirsin.' });
        const offers = rawOffers.map(offer => ({
            storeName: String(offer.storeName || '').trim().slice(0, 120),
            title: String(offer.title || '').trim().slice(0, 300),
            price: Number(offer.price),
            shippingPrice: Number(offer.shippingPrice || 0),
            url: String(offer.url || '').trim().slice(0, 2000),
            imageUrl: String(offer.imageUrl || '').trim().slice(0, 60000)
        }));
        for (const offer of offers) {
            if (!offer.storeName || !Number.isFinite(offer.price) || offer.price <= 0 || !Number.isFinite(offer.shippingPrice) || offer.shippingPrice < 0) {
                return res.status(400).json({ error: 'Her teklif için mağaza ve geçerli fiyat gerekli; kargo negatif olamaz.' });
            }
            if (offer.url) {
                try {
                    const protocol = new URL(offer.url).protocol;
                    if (!['http:', 'https:'].includes(protocol)) throw new Error('Geçersiz protokol');
                } catch (_) { return res.status(400).json({ error: 'Teklif bağlantısı geçerli bir http/https URL olmalı.' }); }
            }
            if (offer.imageUrl) {
                try {
                    const isEmbeddedImage = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(offer.imageUrl);
                    if (!isEmbeddedImage) {
                        const protocol = new URL(offer.imageUrl).protocol;
                        if (!['http:', 'https:'].includes(protocol)) throw new Error('Geçersiz protokol');
                    }
                } catch (_) { return res.status(400).json({ error: 'Görsel bağlantısı geçerli bir http/https URL olmalı.' }); }
            }
        }
        const count = await db.addExternalOffers(product.id, offers);
        res.json({ success: true, count, offers: await db.getLatestExternalOffers(product.id) });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Ürün sil
app.delete('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.deleteProduct(id);
        res.json({ success: true });
    } catch (error) {
        console.error('Ürün silinirken hata:', error);
        res.status(500).json({ error: error.message });
    }
});

// Hedef fiyat güncelle
app.put('/api/products/:id/target-price', async (req, res) => {
    try {
        const { id } = req.params;
        const { targetPrice } = req.body;
        await db.updateTargetPrice(id, targetPrice);
        res.json({ success: true });
    } catch (error) {
        console.error('Hedef fiyat güncellenirken hata:', error);
        res.status(500).json({ error: error.message });
    }
});

// Manuel fiyat kontrolü
app.post('/api/products/:id/check-price', async (req, res) => {
    try {
        const { id } = req.params;
        const product = await db.getProduct(id);
        
        if (!product) {
            return res.status(404).json({ error: 'Ürün bulunamadı' });
        }

        const result = await tracker.checkPrice(product);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Fiyat kontrol edilirken hata:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ana sayfa
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Sunucuyu başlat
app.listen(PORT, () => {
    console.log(`🚀 Sunucu http://localhost:${PORT} adresinde çalışıyor`);
    console.log('📊 Fiyat takip uygulaması hazır!');
    
    // Otomatik fiyat kontrolünü başlat (her 6 saatte bir)
    tracker.startAutoCheck();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Sunucu kapatılıyor...');
    db.close();
    process.exit(0);
});
