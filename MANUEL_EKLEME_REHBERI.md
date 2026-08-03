# 📝 Manuel Ürün Ekleme Rehberi

Amazon ve diğer sitelerin bot koruması nedeniyle otomatik veri çekme başarısız olabilir. Bu durumda **Manuel Ekleme** özelliğini kullanabilirsiniz.

## 🎯 Neden Manuel Ekleme?

E-ticaret siteleri bot koruması kullanır:
- **Amazon**: CAPTCHA, bot tespiti
- **Trendyol**: Rate limiting, anti-bot
- **Hepsiburada**: CloudFlare koruması

Bu durumda manuel olarak ürün bilgilerini girebilirsiniz.

---

## 📖 Adım Adım Manuel Ekleme

### 1️⃣ Ürün Sayfasını Açın

Örnek Amazon URL:
```
https://www.amazon.com.tr/Mobius-Gelecekten-Mesajın-Adam-Fawer/dp/6259864396
```

Tarayıcınızda bu sayfayı açın.

### 2️⃣ Ürün Bilgilerini Kopyalayın

#### Ürün Adı:
- Sayfadaki ürün başlığını kopyalayın
- Örnek: `Mobius: Gelecekten Bir Mesajın Izi - Adam Fawer`

#### Fiyat:
- Güncel fiyatı kopyalayın
- Sadece sayıyı girin (₺ işareti olmadan)
- Örnek: `189.50`

#### Görsel URL (İsteğe Bağlı):
- Ürün görselini sağ tıklayın → "Görüntü Adresini Kopyala"
- Örnek: `https://m.media-amazon.com/images/I/...jpg`

### 3️⃣ Uygulamaya Ekleyin

1. http://localhost:3001 adresine gidin
2. **✍️ Manuel** sekmesine tıklayın
3. Formu doldurun:
   - **Ürün URL'si**: Kopyaladığınız sayfa URL'si
   - **Ürün adı**: Ürün başlığı
   - **Güncel fiyat**: Fiyat (sadece sayı)
   - **Ürün görseli URL'si**: Görsel linki (isteğe bağlı)
   - **Hedef fiyat**: İstediğiniz fiyat (isteğe bağlı)
4. **Manuel Ekle** butonuna tıklayın

### 4️⃣ Takip Edin

- Ürün listeye eklenecek
- Fiyat geçmişi kaydedilmeye başlayacak
- Manuel fiyat kontrolü yapabilirsiniz
- Hedef fiyata ulaşınca bildirim alırsınız

---

## 📸 Örnek: Amazon Kitap Ekleme

### Sayfa Bilgileri:
```
URL: https://www.amazon.com.tr/Mobius-Gelecekten-Mesajın-Adam-Fawer/dp/6259864396

Ürün Adı: Mobius: Gelecekten Bir Mesajın Izi

Fiyat: 189.50

Görsel: https://m.media-amazon.com/images/I/51xF9Y0XJPL._SY445_SX342_.jpg
```

### Form:
```
✍️ Manuel Tab'ı seç

Ürün URL'si: [yukarıdaki URL'yi yapıştır]
Ürün adı: Mobius: Gelecekten Bir Mesajın Izi
Güncel fiyat: 189.50
Ürün görseli: [görsel URL'sini yapıştır]
Hedef fiyat: 150 (isteğe bağlı)

[Manuel Ekle] butonu
```

---

## 💡 İpuçları

### Fiyat Formatı:
- ✅ Doğru: `189.50` veya `189`
- ❌ Yanlış: `189,50 TL` veya `₺189`

### Görsel URL:
- Görseli sağ tıklayıp "Görüntü Adresini Kopyala" seçin
- HTTP veya HTTPS ile başlamalı
- Örnek: `https://...jpg` veya `https://...png`

### Hedef Fiyat:
- Fiyat bu değere düştüğünde bildirim alırsınız
- İsteğe bağlıdır, boş bırakabilirsiniz

---

## 🔄 Manuel Fiyat Güncelleme

Eklenen ürünlerin fiyatını manuel olarak güncelleyebilirsiniz:

1. Ürün kartındaki **🔄 Fiyat Kontrol** butonuna tıklayın
2. Site otomatik veri çekmeyi deneyecek
3. Başarısız olursa eski fiyat kalır
4. İsterseniz manuel olarak yeni fiyat girebilirsiniz

---

## 🤖 Otomatik vs Manuel

| Özellik | Otomatik | Manuel |
|---------|----------|--------|
| Hız | ⚡ Çok hızlı | 🐌 Yavaş (elle giriş) |
| Başarı Oranı | ⚠️ Değişken | ✅ %100 |
| Fiyat Güncelleme | 🔄 Otomatik (6 saatte bir) | 🔄 Manuel kontrol |
| Kullanım | 🤖 URL yapıştır | ✍️ Form doldur |

**Öneri**: 
- Küçük siteler için: Otomatik deneyin
- Amazon, Trendyol gibi büyük siteler: Manuel kullanın
- İlk ekleme manuel, sonra otomatik güncelleme

---

## ❓ Sık Sorulan Sorular

### "Demo Ürün" gösteriyor, ne yapmalıyım?
→ Manuel ekleme sekmesini kullanın

### Görseli nasıl bulurum?
→ Ürün görselini sağ tıklayın → "Görüntü Adresini Kopyala"

### Fiyat virgüllü olmalı mı?
→ Hayır, nokta kullanın (189.50) veya tam sayı (189)

### Hedef fiyat zorunlu mu?
→ Hayır, isteğe bağlıdır. Boş bırakabilirsiniz.

### Eklediğim ürünü nasıl silerim?
→ Ürün kartındaki 🗑️ Sil butonuna tıklayın

---

## 🚀 Gelecek Güncellemeler (Planlanan)

- [ ] Tarayıcı eklentisi (tek tıkla ekleme)
- [ ] CSV ile toplu ekleme
- [ ] Mobil uygulama
- [ ] Otomatik fiyat çekme için API entegrasyonu
- [ ] Tarayıcı içi scraping (background script)

---

Sorularınız için: GitHub Issues veya README.md dosyasına bakın.
