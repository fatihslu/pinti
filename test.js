// Manuel test script'i
const Database = require('./database');
const PriceTracker = require('./priceTracker');

const db = new Database();
const tracker = new PriceTracker(db);

async function test() {
    console.log('🧪 Gerçek site testi başlıyor...\n');

    // Test URL'leri
    const testUrls = [
        'https://www.trendyol.com/casper/excalibur-g770-intel-core-i5-12500h-16gb-ram-500gb-ssd-gtx-1650-freedos-p-185184503',
        'https://www.hepsiburada.com/apple-iphone-13-128-gb-pm-HB00000WKDSL'
    ];

    for (const url of testUrls) {
        console.log(`\n📍 Test URL: ${url}\n`);
        
        try {
            const result = await tracker.scrapeProduct(url);
            
            console.log('✅ Sonuç:');
            console.log('  Başlık:', result.title);
            console.log('  Fiyat:', result.price, 'TL');
            console.log('  Görsel:', result.imageUrl ? 'Var' : 'Yok');
            console.log('  Görsel URL:', result.imageUrl?.substring(0, 80) + '...');
            
        } catch (error) {
            console.error('❌ Hata:', error.message);
        }

        console.log('\n' + '='.repeat(80) + '\n');
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    db.close();
    console.log('\n✅ Test tamamlandı!');
}

test().catch(console.error);
