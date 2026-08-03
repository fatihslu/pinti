const assert = require('node:assert/strict');
const { extractPrice, extractProductFromHtml } = require('./productExtractor');

assert.equal(extractPrice('1.249,90 TL'), 1249.90);
assert.equal(extractPrice('₺2,499.50'), 2499.50);
assert.equal(extractPrice('3.499 TL'), 3499);

const amazon = extractProductFromHtml(`
  <meta property="og:image" content="/product.jpg">
  <span id="productTitle">Test Ürünü</span>
  <div id="corePriceDisplay_desktop_feature_div"><span class="a-offscreen">1.249,90 TL</span></div>`,
  'https://www.amazon.com.tr/dp/example');
assert.deepEqual(amazon, {
    title: 'Test Ürünü', price: 1249.90,
    imageUrl: 'https://www.amazon.com.tr/product.jpg', url: 'https://www.amazon.com.tr/dp/example'
});

const jsonLd = extractProductFromHtml(`
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"JSON Ürün","image":"https://images.example/1.jpg","offers":{"@type":"Offer","price":"899.95","priceCurrency":"TRY"}}</script>`,
  'https://example.com/product');
assert.equal(jsonLd.title, 'JSON Ürün');
assert.equal(jsonLd.price, 899.95);

assert.throws(() => extractProductFromHtml('<title>Robot Check</title><p>captcha</p>', 'https://example.com/p'), /bot doğrulaması/);
console.log('Scraper parser tests passed.');
