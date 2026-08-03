// Amazon URL'sini test et
const axios = require('axios');
const cheerio = require('cheerio');

const url = 'https://www.amazon.com.tr/Mobius-Gelecekten-Mesaj%C4%B1n-Adam-Fawer/dp/6259864396';

async function testAmazon() {
    console.log('🧪 Amazon URL testi...\n');
    console.log('URL:', url, '\n');

    try {
        // Daha agresif headers
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Cache-Control': 'max-age=0'
            },
            timeout: 20000,
            maxRedirects: 5
        });

        console.log('✅ HTTP Status:', response.status);
        console.log('📄 İçerik boyutu:', response.data.length, 'karakter\n');

        const $ = cheerio.load(response.data);

        // Farklı selector'ları dene
        console.log('🔍 Başlık arama...');
        const titleSelectors = [
            '#productTitle',
            'h1#title',
            'h1 span#productTitle',
            '.product-title',
            '[data-feature-name="title"]'
        ];

        let title = null;
        for (const selector of titleSelectors) {
            const text = $(selector).text().trim();
            if (text) {
                console.log(`  ✅ "${selector}" ile bulundu:`, text);
                title = text;
                break;
            } else {
                console.log(`  ❌ "${selector}" boş`);
            }
        }

        // OG metatag'den dene
        if (!title) {
            title = $('meta[property="og:title"]').attr('content');
            if (title) console.log('  ✅ og:title ile bulundu:', title);
        }

        console.log('\n🔍 Fiyat arama...');
        const priceSelectors = [
            '.a-price .a-offscreen',
            'span.a-price-whole',
            '#priceblock_ourprice',
            '#priceblock_dealprice',
            '.a-price-range .a-offscreen',
            '[data-a-color="price"] .a-offscreen',
            '.priceToPay .a-offscreen'
        ];

        let price = null;
        for (const selector of priceSelectors) {
            const text = $(selector).first().text().trim();
            if (text) {
                console.log(`  ✅ "${selector}" ile bulundu:`, text);
                price = text;
                break;
            } else {
                console.log(`  ❌ "${selector}" boş`);
            }
        }

        console.log('\n🔍 Görsel arama...');
        const imageSelectors = [
            '#landingImage',
            '#imgBlkFront',
            '#main-image',
            '.a-dynamic-image'
        ];

        let imageUrl = null;
        for (const selector of imageSelectors) {
            const src = $(selector).first().attr('src') || $(selector).first().attr('data-old-hires');
            if (src) {
                console.log(`  ✅ "${selector}" ile bulundu:`, src.substring(0, 80) + '...');
                imageUrl = src;
                break;
            } else {
                console.log(`  ❌ "${selector}" boş`);
            }
        }

        // OG metatag'den dene
        if (!imageUrl) {
            imageUrl = $('meta[property="og:image"]').attr('content');
            if (imageUrl) console.log('  ✅ og:image ile bulundu:', imageUrl.substring(0, 80) + '...');
        }

        console.log('\n📊 SONUÇLAR:');
        console.log('─'.repeat(80));
        console.log('Başlık:', title || '❌ BULUNAMADI');
        console.log('Fiyat:', price || '❌ BULUNAMADI');
        console.log('Görsel:', imageUrl ? '✅ Var' : '❌ BULUNAMADI');

        // HTML'in bir kısmını kaydet
        const fs = require('fs');
        fs.writeFileSync('amazon_response.html', response.data);
        console.log('\n💾 HTML içeriği amazon_response.html dosyasına kaydedildi');

    } catch (error) {
        console.error('❌ HATA:', error.message);
        if (error.response) {
            console.error('HTTP Status:', error.response.status);
            console.error('Headers:', error.response.headers);
        }
    }
}

testAmazon();
