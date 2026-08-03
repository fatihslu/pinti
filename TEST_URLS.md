# Test URL'leri

Uygulamayı test etmek için bu URL'leri kullanabilirsiniz:

## 🟢 Trendyol Örnekleri
```
https://www.trendyol.com/apple/iphone-15-pro-max-256-gb-p-123456
https://www.trendyol.com/samsung/galaxy-s24-ultra-p-789012
```

## 🟠 Hepsiburada Örnekleri
```
https://www.hepsiburada.com/apple-iphone-15-pro-max-256-gb-p-123456
https://www.hepsiburada.com/samsung-galaxy-s24-ultra-p-789012
```

## 🟡 Amazon Türkiye Örnekleri
```
https://www.amazon.com.tr/dp/B0ABCDEFGH
https://www.amazon.com.tr/product/dp/B0XXXXXXXX
```

## 🔵 N11 Örnekleri
```
https://www.n11.com/urun/apple-iphone-15-pro-max-123456
https://www.n11.com/urun/samsung-galaxy-s24-ultra-789012
```

## 🟣 GittiGidiyor Örnekleri
```
https://www.gittigidiyor.com/cep-telefonu/apple-iphone-15-pro-max_pdp_123456
```

---

## 📝 Kullanım Talimatları

1. **Tarayıcınızda http://localhost:3001 adresine gidin**

2. **E-ticaret sitesinden bir ürün seçin:**
   - Trendyol, Hepsiburada, Amazon vb. sitelerden birini açın
   - İstediğiniz ürünü bulun
   - Adres çubuğundaki URL'yi kopyalayın

3. **Uygulamaya ekleyin:**
   - Kopyaladığınız URL'yi "Yeni Ürün Ekle" formuna yapıştırın
   - İsteğe bağlı hedef fiyat belirleyin
   - "Takibe Ekle" butonuna tıklayın

4. **Ürünü izleyin:**
   - Ürün kartı otomatik olarak görünecek
   - Fiyat geçmişi grafiğini görebilirsiniz
   - Manuel fiyat kontrolü yapabilirsiniz
   - Hedef fiyat belirleyebilirsiniz

---

## ⚠️ Önemli Notlar

### Web Scraping Sınırlamaları

1. **Anti-bot Koruması:** 
   - Bazı siteler bot koruması kullanır (Cloudflare, reCAPTCHA)
   - Bu durumlarda demo veri gösterilir

2. **Site Yapısı Değişiklikleri:**
   - E-ticaret siteleri HTML yapılarını sık değiştirir
   - Selector'lar güncellenmelidir

3. **Rate Limiting:**
   - Çok sık istek yaparsanız IP'niz bloklanabilir
   - Uygulama 2 saniye bekleme süresi kullanır

4. **Yasal Uyarı:**
   - robots.txt dosyasına uyun
   - Site kullanım koşullarını kontrol edin
   - Ticari kullanım için API kullanımı önerilir

### Alternatif Çözümler

1. **Resmi API Kullanımı** (Önerilen):
   - Keepa API (Amazon için)
   - Rainforest API (Çoklu site desteği)
   - ScraperAPI (Proxy hizmeti)

2. **Browser Automation**:
   - Puppeteer veya Playwright kullanımı
   - JavaScript render eden siteler için gerekli

3. **Proxy Kullanımı**:
   - Rotating proxy servisleri
   - IP bloklama riskini azaltır

---

## 🔧 Sorun Giderme

### "Ürün bilgileri bulunamadı" hatası alıyorum

**Olası nedenler:**
- Site anti-bot koruması kullanıyor
- HTML yapısı değişmiş
- URL geçersiz

**Çözümler:**
1. Farklı bir ürün URL'si deneyin
2. `priceTracker.js` dosyasındaki selector'ları güncelleyin
3. Tarayıcınızda sayfayı açıp HTML yapısını inceleyin

### Fiyat yanlış görünüyor

**Olası nedenler:**
- Fiyat formatı yanlış parse edilmiş
- İndirimli/normal fiyat karışmış

**Çözümler:**
1. `extractPrice()` fonksiyonunu kontrol edin
2. Console loglarını inceleyin
3. Site için özel parser yazın

### Görsel görünmüyor

**Olası nedenler:**
- Görsel URL'si relative path
- Görsel lazy-load ile yükleniyor

**Çözümler:**
1. `priceTracker.js` dosyasında görsel URL'sini düzeltin
2. Tam URL oluşturmayı kontrol edin

---

## 🚀 Gelişmiş Özellikler (Eklenebilir)

- [ ] Puppeteer entegrasyonu (JavaScript render)
- [ ] Proxy rotasyonu
- [ ] Captcha çözme servisi
- [ ] Email/SMS bildirimleri
- [ ] Webhook desteği
- [ ] Çoklu kullanıcı sistemi
- [ ] API endpoint'leri
- [ ] Mobil uygulama
- [ ] Fiyat tahmin algoritması
- [ ] Karşılaştırma özelliği
