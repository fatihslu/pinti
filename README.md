# Fiyat Takip Uygulaması

Amazon benzeri e-ticaret sitelerinde ürün fiyatlarını takip eden, fiyat geçmişini gösteren ve fiyat düşüşlerinde bildirim gönderen bir web uygulaması.

## Özellikler

- 🔍 Ürün URL'si ile fiyat takibi
- 📊 Fiyat geçmişi grafiği
- 🔔 Fiyat düşüş bildirimleri
- 💾 Yerel veritabanı ile veri saklama
- 📱 Responsive tasarım

## Teknolojiler

- **Backend**: Node.js, Express
- **Frontend**: HTML, CSS, JavaScript, Chart.js
- **Veritabanı**: SQLite
- **Scraping**: Axios, Cheerio

## Kurulum

```bash
# Proje klasörüne git
cd AmazonPriceTracker

# Bağımlılıklar zaten yüklü (node_modules var)
# Eğer yoksa: npm install
```

## Çalıştırma

### 1. Test Verisi Ekle (İlk Kullanım)
```bash
npm run seed
```
Bu komut 5 örnek ürün ve fiyat geçmişi ekler.

### 2. Sunucuyu Başlat
```bash
npm start
```

Uygulama http://localhost:3001 adresinde çalışacaktır.

## Desteklenen Siteler

✅ **Trendyol** - trendyol.com
✅ **Hepsiburada** - hepsiburada.com
✅ **Amazon Türkiye** - amazon.com.tr
✅ **N11** - n11.com
✅ **GittiGidiyor** - gittigidiyor.com
⚠️ **Diğer siteler** - Genel parsing (başarı oranı düşük)

## Kullanım

### 🤖 Otomatik Mod (Önerilen: Küçük siteler)
1. http://localhost:3001 adresine gidin
2. Ürün URL'sini "Otomatik" sekmesine yapıştırın
3. "Takibe Ekle" butonuna tıklayın

**Not**: Amazon, Trendyol gibi büyük siteler bot koruması kullanır ve başarısız olabilir.

### ✍️ Manuel Mod (Önerilen: Amazon, Trendyol, Hepsiburada)
1. E-ticaret sitesinden ürün bilgilerini kopyalayın (ad, fiyat, görsel)
2. "Manuel" sekmesini seçin
3. Formu doldurun ve "Manuel Ekle" butonuna tıklayın

**Detaylı Rehber**: [MANUEL_EKLEME_REHBERI.md](MANUEL_EKLEME_REHBERI.md) dosyasına bakın.

### Fiyat Takibi
- **Otomatik kontrol**: Her 6 saatte bir
- **Manuel kontrol**: "🔄 Fiyat Kontrol" butonu ile
- **Fiyat geçmişi**: "📊 Fiyat Geçmişi" ile grafik ve istatistikler
- **Hedef fiyat**: Belirli fiyata düşünce bildirim

## Notlar

- Bu uygulama eğitim amaçlıdır
- Gerçek e-ticaret sitelerini scrape ederken robots.txt kurallarına ve site kullanım koşullarına uyun
- Üretim ortamında API kullanımı önerilir
