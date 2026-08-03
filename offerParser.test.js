const assert = require('node:assert/strict');
const { parseGoogleShoppingText } = require('./public/offerParser');

const copiedGoogleText = `
Google Alışveriş sonuç metnini doğrudan yapıştırabilir veya Mağaza | Fiyat | Kargo | URL biçiminde yazabilirsin.
Kafa Lambası 300 Lümen USB Şarj Edilebilir LED Kafa Lambası
En yüksek ₺350
DÜŞÜK FİYAT
Kafa Lambası 300 Lümen USB Şarj Edilebilir LED Kafa Lambası
₺169,00
Amazon.com.tr - Amazon.com.tr – pazaryeri
Kafa Lambası 300 Lümen USB Şarj Edilebilir LED Kafa Lambası Siyah
₺148,80
trendyol.com
Ücretli sponsorlu reklam
Kafa Lambası 20000 Lümen | Yüksek Kaliteli Ürünler
amazon.com.tr
`;

const offers = parseGoogleShoppingText(copiedGoogleText, 'Kafa Lambası 300 Lümen USB Şarj Edilebilir LED Kafa Lambası');
assert.equal(offers.length, 2);
assert.deepEqual(offers.map(item => [item.storeName, item.price]), [
    ['Amazon.com.tr - Amazon.com.tr – pazaryeri', 169], ['trendyol.com', 148.8]
]);

console.log('Google Shopping pasted-text parser tests passed.');
