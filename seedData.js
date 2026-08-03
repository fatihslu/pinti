// Test verisi ekleme script'i
const Database = require('./database');

const db = new Database();

async function seedData() {
    console.log('📦 Test verileri ekleniyor...\n');

    try {
        // Örnek ürünler
        const products = [
            {
                url: 'https://www.amazon.com.tr/product/laptop-123',
                title: 'Apple MacBook Air M2 13.6" 8GB 256GB SSD Notebook',
                price: 34999.99,
                imageUrl: 'https://via.placeholder.com/300x300/4A90E2/FFFFFF?text=MacBook+Air',
                targetPrice: 32000
            },
            {
                url: 'https://www.amazon.com.tr/product/phone-456',
                title: 'Samsung Galaxy S24 Ultra 256GB Akıllı Telefon',
                price: 54999.00,
                imageUrl: 'https://via.placeholder.com/300x300/50C878/FFFFFF?text=Galaxy+S24',
                targetPrice: 50000
            },
            {
                url: 'https://www.amazon.com.tr/product/headphone-789',
                title: 'Sony WH-1000XM5 Kablosuz Kulaklık',
                price: 9499.90,
                imageUrl: 'https://via.placeholder.com/300x300/FF6B6B/FFFFFF?text=Sony+WH-1000XM5',
                targetPrice: 8500
            },
            {
                url: 'https://www.amazon.com.tr/product/watch-101',
                title: 'Apple Watch Series 9 GPS 45mm',
                price: 13999.00,
                imageUrl: 'https://via.placeholder.com/300x300/9B59B6/FFFFFF?text=Apple+Watch',
                targetPrice: 12000
            },
            {
                url: 'https://www.amazon.com.tr/product/tablet-202',
                title: 'iPad Air 11" M2 Wi-Fi 128GB',
                price: 24999.00,
                imageUrl: 'https://via.placeholder.com/300x300/F39C12/FFFFFF?text=iPad+Air',
                targetPrice: 23000
            }
        ];

        for (const product of products) {
            try {
                // Ürünü ekle
                const productId = await db.addProduct(
                    product.url,
                    product.title,
                    product.price,
                    product.imageUrl,
                    product.targetPrice
                );

                console.log(`✅ ${product.title} eklendi (ID: ${productId})`);

                // Fiyat geçmişi için rastgele 10 fiyat ekle (son 30 gün)
                const today = new Date();
                for (let i = 9; i >= 0; i--) {
                    const date = new Date(today);
                    date.setDate(date.getDate() - i * 3); // Her 3 günde bir
                    
                    // Fiyatı %10 civarında değiştir
                    const variation = (Math.random() - 0.5) * 0.2; // -10% ile +10% arası
                    const historicalPrice = product.price * (1 + variation);

                    await db.db.run(
                        `INSERT INTO price_history (product_id, price, recorded_at) VALUES (?, ?, ?)`,
                        [productId, historicalPrice.toFixed(2), date.toISOString()]
                    );
                }

                console.log(`  📊 ${product.title} için fiyat geçmişi eklendi\n`);

            } catch (error) {
                if (error.message.includes('UNIQUE constraint failed')) {
                    console.log(`⚠️  ${product.title} zaten mevcut, atlanıyor\n`);
                } else {
                    console.error(`❌ ${product.title} eklenirken hata:`, error.message, '\n');
                }
            }
        }

        console.log('✅ Test verileri başarıyla eklendi!');
        console.log('\n📝 Artık http://localhost:3000 adresine gidip uygulamayı test edebilirsiniz.');
        
    } catch (error) {
        console.error('❌ Veri ekleme hatası:', error);
    } finally {
        db.close();
    }
}

seedData();
