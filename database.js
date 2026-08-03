const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

class Database {
    constructor() {
        this.db = new sqlite3.Database(path.join(__dirname, 'price_tracker.db'), (err) => {
            if (err) {
                console.error('Veritabanı bağlantı hatası:', err);
            } else {
                console.log('✅ Veritabanına bağlanıldı');
                this.initDatabase();
            }
        });
    }

    initDatabase() {
        this.db.serialize(() => {
            // Ürünler tablosu
            this.db.run(`
                CREATE TABLE IF NOT EXISTS products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    url TEXT NOT NULL UNIQUE,
                    title TEXT,
                    current_price REAL,
                    target_price REAL,
                    image_url TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Fiyat geçmişi tablosu
            this.db.run(`
                CREATE TABLE IF NOT EXISTS price_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id INTEGER,
                    price REAL NOT NULL,
                    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
                )
            `);

            // Bildirimler tablosu
            this.db.run(`
                CREATE TABLE IF NOT EXISTS notifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id INTEGER,
                    message TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    is_read INTEGER DEFAULT 0,
                    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
                )
            `);

            // Aynı ürünün farklı mağaza kayıtlarını kullanıcı tanımlı bir adla bağlar.
            // Ayrı bir tablo kullanıldığı için mevcut veritabanına migration gerekmez.
            this.db.run(`
                CREATE TABLE IF NOT EXISTS comparison_groups (
                    product_id INTEGER PRIMARY KEY,
                    group_name TEXT NOT NULL,
                    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
                )
            `);

            // Her saat Amazon Çok Satanlar listesinin bir anlık görüntüsünü saklar.
            this.db.run(`
                CREATE TABLE IF NOT EXISTS amazon_bestseller_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id TEXT NOT NULL,
                    rank INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    price REAL NOT NULL,
                    category_id TEXT NOT NULL DEFAULT 'featured',
                    category_name TEXT NOT NULL DEFAULT 'Öne Çıkan Ürünler',
                    product_url TEXT NOT NULL,
                    image_url TEXT,
                    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            this.db.all('PRAGMA table_info(amazon_bestseller_snapshots)', (error, columns) => {
                if (error) return;
                if (!columns.some(column => column.name === 'category_id')) this.db.run("ALTER TABLE amazon_bestseller_snapshots ADD COLUMN category_id TEXT NOT NULL DEFAULT 'featured'");
                if (!columns.some(column => column.name === 'category_name')) this.db.run("ALTER TABLE amazon_bestseller_snapshots ADD COLUMN category_name TEXT NOT NULL DEFAULT 'Öne Çıkan Ürünler'");
            });

            // Amazon “Fiyatları Dondurduk” kampanya vitrininin saatlik görünümü.
            this.db.run(`
                CREATE TABLE IF NOT EXISTS amazon_deal_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id TEXT NOT NULL,
                    asin TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    price REAL NOT NULL,
                    original_price REAL,
                    discount_percent INTEGER NOT NULL DEFAULT 0,
                    review_count INTEGER,
                    rating REAL,
                    monthly_sales_minimum INTEGER,
                    monthly_sales_text TEXT,
                    product_url TEXT NOT NULL,
                    image_url TEXT,
                    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            this.db.all('PRAGMA table_info(amazon_deal_snapshots)', (error, columns) => {
                if (error) return;
                if (!columns.some(column => column.name === 'monthly_sales_minimum')) this.db.run('ALTER TABLE amazon_deal_snapshots ADD COLUMN monthly_sales_minimum INTEGER');
                if (!columns.some(column => column.name === 'monthly_sales_text')) this.db.run('ALTER TABLE amazon_deal_snapshots ADD COLUMN monthly_sales_text TEXT');
            });

            // En düşük fiyatlar merkezinin kategori ve dönem bazlı anlık görüntüleri.
            this.db.run(`
                CREATE TABLE IF NOT EXISTS amazon_low_price_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id TEXT NOT NULL,
                    category_id TEXT NOT NULL,
                    category_name TEXT NOT NULL,
                    low_price_period INTEGER NOT NULL,
                    asin TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    price REAL NOT NULL,
                    original_price REAL,
                    discount_percent INTEGER NOT NULL DEFAULT 0,
                    monthly_sales_minimum INTEGER,
                    monthly_sales_text TEXT,
                    review_count INTEGER,
                    rating REAL,
                    product_url TEXT NOT NULL,
                    image_url TEXT,
                    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            this.db.run(`
                CREATE TABLE IF NOT EXISTS amazon_low_price_batches (
                    batch_id TEXT PRIMARY KEY,
                    category_id TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Kullanıcının Google Alışveriş veya başka bir kaynaktan elle aktardığı teklifler.
            this.db.run(`
                CREATE TABLE IF NOT EXISTS external_offers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id INTEGER NOT NULL,
                    source TEXT NOT NULL DEFAULT 'Google Alışveriş',
                    store_name TEXT NOT NULL,
                    offer_title TEXT,
                    price REAL NOT NULL,
                    shipping_price REAL NOT NULL DEFAULT 0,
                    offer_url TEXT,
                    image_url TEXT,
                    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
                )
            `);

            this.db.run(`
                CREATE TABLE IF NOT EXISTS product_alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source TEXT NOT NULL,
                    category_name TEXT,
                    title TEXT NOT NULL,
                    product_url TEXT NOT NULL,
                    base_price REAL NOT NULL,
                    target_price REAL,
                    discount_percent REAL,
                    email TEXT NOT NULL,
                    last_price REAL,
                    last_notified_price REAL,
                    active INTEGER NOT NULL DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_checked DATETIME
                )
            `);

            // Amazon kategori sayfalarındaki ürünlerin yıldız ve yorum sayısına
            // göre kaydedilen yorum radarı anlık görüntüleri.
            this.db.run(`
                CREATE TABLE IF NOT EXISTS amazon_review_radar_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_id TEXT NOT NULL,
                    asin TEXT NOT NULL,
                    title TEXT NOT NULL,
                    price REAL,
                    category_id TEXT NOT NULL DEFAULT 'featured',
                    category_name TEXT NOT NULL DEFAULT 'Öne Çıkan Ürünler',
                    rating REAL NOT NULL DEFAULT 0,
                    review_count INTEGER NOT NULL DEFAULT 0,
                    image_url TEXT,
                    product_url TEXT NOT NULL,
                    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            this.db.all('PRAGMA table_info(amazon_review_radar_snapshots)', (error, columns) => {
                if (error) return;
                if (!columns.some(column => column.name === 'category_id')) this.db.run("ALTER TABLE amazon_review_radar_snapshots ADD COLUMN category_id TEXT NOT NULL DEFAULT 'featured'");
                if (!columns.some(column => column.name === 'category_name')) this.db.run("ALTER TABLE amazon_review_radar_snapshots ADD COLUMN category_name TEXT NOT NULL DEFAULT 'Öne Çıkan Ürünler'");
            });

            // Mevcut kurulumlarda tablo daha önce görselsiz oluşturulmuş olabilir.
            this.db.all('PRAGMA table_info(external_offers)', (error, columns) => {
                if (!error && !columns.some(column => column.name === 'image_url')) {
                    this.db.run('ALTER TABLE external_offers ADD COLUMN image_url TEXT');
                }
            });

            console.log('✅ Veritabanı tabloları hazır');
        });
    }

    // Ürün ekle
    addProduct(url, title, price, imageUrl, targetPrice = null) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO products (url, title, current_price, image_url, target_price) 
                         VALUES (?, ?, ?, ?, ?)`;
            
            this.db.run(sql, [url, title, price, imageUrl, targetPrice], function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
        });
    }

    // Ürün getir
    getProduct(id) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM products WHERE id = ?`;
            this.db.get(sql, [id], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    // Tüm ürünleri getir
    getAllProducts() {
        return new Promise((resolve, reject) => {
            const sql = `SELECT p.*, cg.group_name
                         FROM products p
                         LEFT JOIN comparison_groups cg ON cg.product_id = p.id
                         ORDER BY p.created_at DESC`;
            this.db.all(sql, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Ürün sil
    deleteProduct(id) {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run('DELETE FROM comparison_groups WHERE product_id = ?', [id]);
                this.db.run('DELETE FROM products WHERE id = ?', [id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    }

    // Ürün fiyatını güncelle
    updatePrice(productId, newPrice) {
        return new Promise((resolve, reject) => {
            const sql = `UPDATE products SET current_price = ?, last_checked = CURRENT_TIMESTAMP 
                         WHERE id = ?`;
            
            this.db.run(sql, [newPrice, productId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Hedef fiyat güncelle
    updateTargetPrice(productId, targetPrice) {
        return new Promise((resolve, reject) => {
            const sql = `UPDATE products SET target_price = ? WHERE id = ?`;
            this.db.run(sql, [targetPrice, productId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Fiyat geçmişine ekle
    addPriceHistory(productId, price) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO price_history (product_id, price) VALUES (?, ?)`;
            this.db.run(sql, [productId, price], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Fiyat geçmişini getir
    getPriceHistory(productId, limit = 100) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM price_history 
                         WHERE product_id = ? 
                         ORDER BY recorded_at DESC 
                         LIMIT ?`;
            
            this.db.all(sql, [productId, limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Bildirim ekle
    addNotification(productId, message) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO notifications (product_id, message) VALUES (?, ?)`;
            this.db.run(sql, [productId, message], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    // Okunmamış bildirimleri getir
    getUnreadNotifications() {
        return new Promise((resolve, reject) => {
            const sql = `SELECT n.*, p.title, p.url 
                         FROM notifications n 
                         JOIN products p ON n.product_id = p.id 
                         WHERE n.is_read = 0 
                         ORDER BY n.created_at DESC`;
            
            this.db.all(sql, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // URL'ye göre ürün bul
    getProductByUrl(url) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT * FROM products WHERE url = ?`;
            this.db.get(sql, [url], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    setComparisonGroup(productId, groupName) {
        return new Promise((resolve, reject) => {
            const name = String(groupName || '').trim();
            if (!name) {
                this.db.run('DELETE FROM comparison_groups WHERE product_id = ?', [productId], err => err ? reject(err) : resolve(null));
                return;
            }
            const sql = `INSERT INTO comparison_groups (product_id, group_name) VALUES (?, ?)
                         ON CONFLICT(product_id) DO UPDATE SET group_name = excluded.group_name`;
            this.db.run(sql, [productId, name.slice(0, 120)], err => err ? reject(err) : resolve(name.slice(0, 120)));
        });
    }

    getProductComparison(productId) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT p.id, p.title, p.url, p.current_price, p.image_url, cg.group_name
                         FROM comparison_groups current
                         JOIN comparison_groups cg ON cg.group_name = current.group_name
                         JOIN products p ON p.id = cg.product_id
                         WHERE current.product_id = ?
                         ORDER BY p.current_price ASC`;
            this.db.all(sql, [productId], (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

    saveAmazonBestSellerSnapshot(items, category = { id: 'featured', name: 'Öne Çıkan Ürünler' }) {
        return new Promise((resolve, reject) => {
            if (!items.length) return resolve(0);
            const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const statement = this.db.prepare(`INSERT INTO amazon_bestseller_snapshots
                (batch_id, rank, title, price, category_id, category_name, product_url, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            this.db.serialize(() => {
                for (const item of items) statement.run(batchId, item.rank, item.title, item.price, category.id, category.name, item.url, item.imageUrl || null);
                statement.finalize(err => err ? reject(err) : resolve(items.length));
            });
        });
    }

    getLatestAmazonBestSellers(categoryId = 'featured', limit = 100) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT rank, title, price, category_id, category_name, product_url, image_url, captured_at
                         FROM amazon_bestseller_snapshots
                         WHERE category_id = ? AND batch_id = (SELECT batch_id FROM amazon_bestseller_snapshots WHERE category_id = ? ORDER BY id DESC LIMIT 1)
                         ORDER BY rank ASC LIMIT ?`;
            this.db.all(sql, [categoryId, categoryId, limit], (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

    getMonthlyAmazonBestSellers(month, limit = 20) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT product_url, MAX(title) AS title, MAX(image_url) AS image_url,
                         ROUND(AVG(rank), 2) AS average_rank, COUNT(*) AS samples,
                         (SELECT price FROM amazon_bestseller_snapshots recent
                          WHERE recent.product_url = amazon_bestseller_snapshots.product_url
                          ORDER BY recent.id DESC LIMIT 1) AS current_price
                         FROM amazon_bestseller_snapshots
                         WHERE strftime('%Y-%m', captured_at) = ?
                         GROUP BY product_url
                         ORDER BY samples DESC, average_rank ASC LIMIT ?`;
            this.db.all(sql, [month, limit], (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

    saveAmazonDealSnapshot(items) {
        return new Promise((resolve, reject) => {
            if (!items.length) return resolve(0);
            const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const statement = this.db.prepare(`INSERT INTO amazon_deal_snapshots
                (batch_id, asin, position, title, price, original_price, discount_percent, review_count, rating, monthly_sales_minimum, monthly_sales_text, product_url, image_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            this.db.serialize(() => {
                for (const item of items) {
                    statement.run(batchId, item.asin, item.position, item.title, item.price, item.originalPrice || null,
                        item.discountPercent || 0, item.reviewCount || null, item.rating || null, item.monthlySalesMinimum || null,
                        item.monthlySalesText || null, item.productUrl, item.imageUrl || null);
                }
                statement.finalize(err => err ? reject(err) : resolve(items.length));
            });
        });
    }

    getLatestAmazonDeals(limit = 24) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT asin, position, title, price, original_price, discount_percent, review_count, rating, monthly_sales_minimum, monthly_sales_text, product_url, image_url, captured_at
                         FROM amazon_deal_snapshots
                         WHERE batch_id = (SELECT batch_id FROM amazon_deal_snapshots ORDER BY id DESC LIMIT 1)
                         ORDER BY position ASC LIMIT ?`;
            this.db.all(sql, [limit], (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

    saveAmazonLowPriceSnapshot(category, items) {
        return new Promise((resolve, reject) => {
            if (!items.length) return resolve({ saved: false, count: 0 });
            const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const fingerprint = crypto.createHash('sha256').update(JSON.stringify(items
                .map(item => ({ asin: item.asin, period: item.lowPricePeriod, price: item.price, originalPrice: item.originalPrice,
                    discount: item.discountPercent, monthlySales: item.monthlySalesMinimum, salesText: item.monthlySalesText }))
                .sort((left, right) => `${left.asin}|${left.period}`.localeCompare(`${right.asin}|${right.period}`)))).digest('hex');
            this.db.serialize(() => {
                this.db.get(`SELECT fingerprint FROM amazon_low_price_batches WHERE category_id = ? ORDER BY captured_at DESC, rowid DESC LIMIT 1`, [category.id], (error, latest) => {
                    if (error) return reject(error);
                    if (latest?.fingerprint === fingerprint) return resolve({ saved: false, count: 0 });
                    this.db.run(`INSERT INTO amazon_low_price_batches (batch_id, category_id, fingerprint) VALUES (?, ?, ?)`, [batchId, category.id, fingerprint], error => {
                        if (error) return reject(error);
                        const statement = this.db.prepare(`INSERT INTO amazon_low_price_snapshots
                            (batch_id, category_id, category_name, low_price_period, asin, position, title, price, original_price, discount_percent,
                             monthly_sales_minimum, monthly_sales_text, review_count, rating, product_url, image_url)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
                        for (const item of items) {
                            statement.run(batchId, category.id, category.name, item.lowPricePeriod, item.asin, item.position, item.title,
                                item.price, item.originalPrice || null, item.discountPercent || 0, item.monthlySalesMinimum || null,
                                item.monthlySalesText || null, item.reviewCount || null, item.rating || null, item.productUrl, item.imageUrl || null);
                        }
                        statement.finalize(error => error ? reject(error) : resolve({ saved: true, count: items.length }));
                    });
                });
            });
        });
    }

    getLatestAmazonLowPriceItems(categoryId) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT category_id, category_name, low_price_period, asin, position, title, price, original_price, discount_percent,
                         monthly_sales_minimum, monthly_sales_text, review_count, rating, product_url, image_url, captured_at
                         FROM amazon_low_price_snapshots
                         WHERE category_id = ? AND id IN (
                            SELECT MAX(id) FROM amazon_low_price_snapshots WHERE category_id = ? GROUP BY asin, low_price_period
                         )
                         ORDER BY low_price_period ASC, position ASC`;
            this.db.all(sql, [categoryId, categoryId], (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

    addExternalOffers(productId, offers) {
        return new Promise((resolve, reject) => {
            const statement = this.db.prepare(`INSERT INTO external_offers
                (product_id, source, store_name, offer_title, price, shipping_price, offer_url, image_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            this.db.serialize(() => {
                for (const offer of offers) {
                    statement.run(productId, 'Google Alışveriş', offer.storeName, offer.title || null,
                        offer.price, offer.shippingPrice || 0, offer.url || null, offer.imageUrl || null);
                }
                statement.finalize(err => err ? reject(err) : resolve(offers.length));
            });
        });
    }

    getLatestExternalOffers(productId) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT id, source, store_name, offer_title, price, shipping_price, offer_url, image_url, captured_at,
                         ROUND(price + shipping_price, 2) AS total_price
                         FROM external_offers
                         WHERE id IN (
                             SELECT MAX(id) FROM external_offers WHERE product_id = ? GROUP BY lower(store_name)
                         )
                         ORDER BY total_price ASC, store_name ASC`;
            this.db.all(sql, [productId], (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

    saveAmazonReviewRadarSnapshot(items, category = { id: 'featured', name: 'Öne Çıkan Ürünler' }) {
        return new Promise((resolve, reject) => {
            if (!items.length) return resolve(0);
            const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const statement = this.db.prepare(`INSERT INTO amazon_review_radar_snapshots
                (batch_id, asin, title, price, category_id, category_name, rating, review_count, image_url, product_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            this.db.serialize(() => {
                for (const item of items) {
                    statement.run(batchId, item.asin, item.title, item.price ?? null, category.id, category.name, item.rating || 0,
                        item.reviewCount || 0, item.imageUrl || null, item.productUrl);
                }
                statement.finalize(error => error ? reject(error) : resolve(items.length));
            });
        });
    }

    getLatestAmazonReviewRadar(categoryId = 'featured', limit = 600) {
        return new Promise((resolve, reject) => {
            const sql = `SELECT asin, title, price, category_id, category_name, rating, review_count, image_url, product_url, captured_at
                         FROM amazon_review_radar_snapshots
                         WHERE category_id = ? AND batch_id = (SELECT batch_id FROM amazon_review_radar_snapshots WHERE category_id = ? ORDER BY id DESC LIMIT 1)
                         ORDER BY rating DESC, review_count DESC, title ASC
                         LIMIT ?`;
            this.db.all(sql, [categoryId, categoryId, limit], (error, rows) => error ? reject(error) : resolve(rows));
        });
    }

    addProductAlert(alert) {
        return new Promise((resolve, reject) => {
            const sql = `INSERT INTO product_alerts (source, category_name, title, product_url, base_price, target_price, discount_percent, email, last_price)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            this.db.run(sql, [alert.source, alert.categoryName || null, alert.title, alert.productUrl, alert.basePrice,
                alert.targetPrice || null, alert.discountPercent || null, alert.email, alert.basePrice], function(error) {
                error ? reject(error) : resolve(this.lastID);
            });
        });
    }

    getActiveProductAlerts() {
        return new Promise((resolve, reject) => this.db.all('SELECT * FROM product_alerts WHERE active = 1 ORDER BY id DESC', (error, rows) => error ? reject(error) : resolve(rows)));
    }

    getProductAlerts() {
        return new Promise((resolve, reject) => this.db.all('SELECT * FROM product_alerts ORDER BY active DESC, id DESC', (error, rows) => error ? reject(error) : resolve(rows)));
    }

    deleteProductAlert(id) {
        return new Promise((resolve, reject) => this.db.run('DELETE FROM product_alerts WHERE id = ?', [id], function(error) {
            error ? reject(error) : resolve(this.changes);
        }));
    }

    updateProductAlertCheck(id, price, notified) {
        return new Promise((resolve, reject) => {
            const sql = `UPDATE product_alerts SET last_price = ?, last_checked = CURRENT_TIMESTAMP${notified ? ', last_notified_price = ?' : ''} WHERE id = ?`;
            const values = notified ? [price, price, id] : [price, id];
            this.db.run(sql, values, error => error ? reject(error) : resolve());
        });
    }

    close() {
        this.db.close((err) => {
            if (err) {
                console.error('Veritabanı kapatma hatası:', err);
            } else {
                console.log('✅ Veritabanı bağlantısı kapatıldı');
            }
        });
    }
}

module.exports = Database;
