const assert = require('node:assert/strict');
const PriceTracker = require('./priceTracker');

const calls = { history: [], updates: [] };
const tracker = new PriceTracker({
    addPriceHistory: async (id, price) => calls.history.push([id, price]),
    updatePrice: async (id, price) => calls.updates.push([id, price]),
    addNotification: async () => {},
    getProductByUrl: async () => null,
    addProduct: async (url, title, price) => { calls.added = [url, title, price]; return 42; },
    setComparisonGroup: async (id, name) => { calls.group = [id, name]; },
    addExternalOffers: async (id, offers) => { calls.externalOffers = [id, offers]; return offers.length; },
    saveAmazonDealSnapshot: async offers => { calls.dealSnapshot = offers; return offers.length; }
});
tracker.scrapeProduct = async () => ({ price: 90 });

(async () => {
    const result = await tracker.checkPrice({ id: 1, url: 'https://example.com/p', title: 'Test', current_price: 100, target_price: null });
    assert.deepEqual(result, { price: 90, changed: true });
    assert.deepEqual(calls.history, [[1, 90]]);
    assert.deepEqual(calls.updates, [[1, 90]]);

    calls.history.length = 0;
    calls.updates.length = 0;
    tracker.scrapeProduct = async () => ({ price: 90 });
    const unchanged = await tracker.checkPrice({ id: 1, url: 'https://example.com/p', title: 'Test', current_price: 90, target_price: null });
    assert.deepEqual(unchanged, { price: 90, changed: false });
    assert.deepEqual(calls.history, [[1, 90]], 'değişmeyen fiyat da ölçüm olarak saklanmalı');
    assert.deepEqual(calls.updates, []);

    tracker.getAdvancedScraper = async () => ({
        findAlternatives: async () => ({
            matches: [{ url: 'https://www.n11.com/urun/test', title: 'Test Ürün', price: 85, imageUrl: null }],
            unavailableSites: [{ site: 'Trendyol', reason: 'bot doğrulaması' }]
        }),
        searchGoogleShopping: async title => ({
            query: title,
            offers: [{ storeName: 'Test Store', title, price: 80, shippingPrice: 0, url: '', imageUrl: '' }]
        }),
        scrapeAmazonDeals: async () => ([{ asin: 'B000000001', position: 1, title: 'Deal Product', price: 100, productUrl: 'https://www.amazon.com.tr/dp/B000000001' }])
    });
    const discovery = await tracker.findAndAddAlternatives({ title: 'Test Ürün', url: 'https://amazon.com.tr/dp/test' }, 'Test Grubu');
    assert.equal(discovery.added.length, 1);
    assert.equal(discovery.unavailableSites[0].site, 'Trendyol');
    assert.deepEqual(calls.added, ['https://www.n11.com/urun/test', 'Test Ürün', 85]);
    assert.deepEqual(calls.group, [42, 'Test Grubu']);
    const imported = await tracker.importGoogleShoppingOffers({ id: 7, title: 'Test Product', url: 'https://www.amazon.com.tr/dp/test' });
    assert.deepEqual(imported, { attempted: true, count: 1, query: 'Test Product' });
    assert.equal(calls.externalOffers[0], 7);
    assert.equal(calls.externalOffers[1][0].storeName, 'Test Store');
    const deals = await tracker.refreshAmazonDeals();
    assert.equal(deals.length, 1);
    assert.equal(calls.dealSnapshot[0].asin, 'B000000001');

    tracker.getAmazonLowPriceCategories = async () => ([{ id: 'all', name: 'All' }, { id: '1', name: 'Category' }]);
    tracker.refreshAmazonLowPriceCategory = async category => ({ items: [], saved: category.id === '1', savedCount: category.id === '1' ? 3 : 0 });
    const progress = [];
    const fullScan = await tracker.refreshAllAmazonLowPriceCategories(status => progress.push(status));
    assert.deepEqual(fullScan, { total: 2, completed: 2, changedCategories: 1, savedCount: 3, failures: [] });
    assert.equal(progress.length, 2);
    console.log('Tracker history tests passed.');
})().catch(error => { console.error(error); process.exit(1); });
