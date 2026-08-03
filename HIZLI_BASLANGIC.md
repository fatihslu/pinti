# ⚡ Hızlı Başlangıç

## 🎯 Amazon Kitap Örneği

Amazon'dan kitap eklemek istiyorsunuz ama "Demo Ürün" gösteriyor? İşte çözüm:

### Adım 1: Amazon'dan Bilgileri Kopyalayın

```
https://www.amazon.com.tr/Mobius-Gelecekten-Mesajın-Adam-Fawer/dp/6259864396
```

Bu sayfayı açın ve şu bilgileri kopyalayın:

- **Ürün Adı**: Mobius: Gelecekten Bir Mesajın Izi
- **Fiyat**: 189.50 (sadece sayı, ₺ olmadan)
- **Görsel**: Resmi sağ tıkla → "Görüntü Adresini Kopyala"

### Adım 2: Uygulamaya Gidin

```
http://localhost:3001
```

### Adım 3: Manuel Sekmesi

1. **✍️ Manuel** butonuna tıklayın
2. Formu doldurun:
   ```
   Ürün URL'si: [Amazon linki]
   Ürün adı: Mobius: Gelecekten Bir Mesajın Izi
   Güncel fiyat: 189.50
   Görsel URL: [kopyaladığınız görsel linki]
   Hedef fiyat: 150 (isteğe bağlı)
   ```
3. **Manuel Ekle** butonuna tıklayın

### Adım 4: Takip Edin

✅ Ürün listeye eklendi!

- 📊 **Fiyat Geçmişi** ile grafiği görün
- 🔄 **Fiyat Kontrol** ile güncel fiyatı çekin (otomatik dener)
- 🎯 Hedef fiyata ulaşınca bildirim alın

---

## 🚀 Sunucu Çalışıyor mu?

Terminal/CMD'de görmeli:
```
🚀 Sunucu http://localhost:3001 adresinde çalışıyor
📊 Fiyat takip uygulaması hazır!
```

Görmüyorsanız:
```bash
cd AmazonPriceTracker
npm start
```

---

## 💡 İpuçları

### Otomatik Çalışmıyor
→ Manuel ekleme kullanın (büyük siteler bot koruması kullanır)

### Görsel Bulamıyorum
→ Boş bırakın, placeholder görsel gösterilir

### Fiyat Formatı
- ✅ Doğru: `189.50` veya `189`
- ❌ Yanlış: `189,50 TL`

### Hedef Fiyat
→ İsteğe bağlı, fiyat düşünce bildirim almak için

---

## 📚 Daha Fazla Bilgi

- [MANUEL_EKLEME_REHBERI.md](MANUEL_EKLEME_REHBERI.md) - Detaylı rehber
- [README.md](README.md) - Tam dokümantasyon
- [TEST_URLS.md](TEST_URLS.md) - Test URL'leri ve örnekler
