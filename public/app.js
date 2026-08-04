const categorySelect = document.getElementById('categorySelect');
const refreshCategoryBtn = document.getElementById('refreshCategoryBtn');
const refreshAllBtn = document.getElementById('refreshAllBtn');
const scanStatus = document.getElementById('scanStatus');
const lastUpdateStatus = document.getElementById('lastUpdateStatus');
const summary = document.getElementById('summary');
const scanOverlay = document.getElementById('scanOverlay');
const overlayTitle = document.getElementById('overlayTitle');
const overlayProgress = document.getElementById('overlayProgress');
const scanLogs = document.getElementById('scanLogs');
const controlsPanel = document.querySelector('.controls-panel');
const periodTabs = document.getElementById('periodTabs');
const filterPanel = document.getElementById('filterPanel');
const filters = Object.fromEntries(['minPrice', 'maxPrice', 'minDiscount', 'minSales', 'sortSelect'].map(id => [id, document.getElementById(id)]));
const viewTitle = document.getElementById('viewTitle');
const priceChartOverlay = document.getElementById('priceChartOverlay');
const priceChartTitle = document.getElementById('priceChartTitle');
const priceChartContent = document.getElementById('priceChartContent');
let categories = [], analysisCategories = [], currentItems = [], activePeriod = 30, activeView = 'low-prices', scanPollTimer;
let bestSellerCategoryId = 'featured', reviewRadarCategoryId = 'featured';
let analysisRuns = {};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const price = value => value != null && Number.isFinite(Number(value))
    ? Number(value).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' TL'
    : 'Fiyat belirtilmemiş';
const inputNumber = element => Number(element.value || 0);
const sqliteUtcDate = value => value ? new Date(`${String(value).replace(' ', 'T').replace(/Z$/, '')}Z`) : null;

async function loadAnalysisRuns() {
    const response = await fetch('/api/amazon/analysis-runs');
    const rows = await response.json();
    if (!response.ok) throw new Error(rows.error || 'Son çalışma bilgisi alınamadı.');
    analysisRuns = Object.fromEntries(rows.map(run => [run.source, run]));
}

function lastRunMarkup(source) {
    const run = analysisRuns[source];
    if (!run) return '<p class="last-run">Son çalışma: Henüz kayıt yok.</p>';
    const when = run.finished_at ? sqliteUtcDate(run.finished_at).toLocaleString('tr-TR') : 'Devam ediyor';
    const detail = run.status === 'completed'
        ? `${Number(run.item_count || 0)} ürün · ${Number(run.changed_count || 0)} fiyat değişimi`
        : run.status === 'running' ? 'Tarama sürüyor…' : `Hata: ${escapeHtml(run.error || 'Bilinmeyen hata')}`;
    return `<p class="last-run ${run.status === 'completed' ? '' : 'failed'}">Son çalışma: ${when} · ${detail}</p>`;
}

function updateLastUpdateStatus(source = activeView) {
    const run = analysisRuns[source];
    if (!run) {
        lastUpdateStatus.textContent = source === 'alerts'
            ? 'Son güncelleme: Alarmlar saatlik kontrol edilir.'
            : 'Son güncelleme: Henüz tamamlanmış tarama yok.';
        return;
    }
    const when = run.finished_at ? sqliteUtcDate(run.finished_at).toLocaleString('tr-TR') : 'Devam ediyor';
    lastUpdateStatus.textContent = run.status === 'completed'
        ? `Son güncelleme: ${when} · ${Number(run.item_count || 0)} ürün · ${Number(run.changed_count || 0)} fiyat değişimi`
        : run.status === 'running' ? `Tarama sürüyor: ${when}` : `Son güncelleme başarısız: ${when} · ${run.error || 'Bilinmeyen hata'}`;
}

async function updateLowPriceRunIndicator() {
    if (activeView !== 'low-prices') return;
    try {
        const response = await fetch('/api/amazon/low-prices/scan-status');
        const status = await response.json();
        if (status.status === 'running') {
            lastUpdateStatus.textContent = `Saatlik tam tarama sürüyor: ${status.completed || 0}/${status.total || '?'} kategori · ${status.currentCategory || 'hazırlanıyor'}`;
        }
    } catch (_) { /* Durum bilgisi alınamazsa son tamamlanan kayıt gösterilir. */ }
}

function alarmButton(item, source) {
    const url = item.product_url || item.url || '';
    return `<button class="set-alert" data-source="${escapeHtml(source)}" data-title="${escapeHtml(item.title)}" data-url="${escapeHtml(url)}" data-price="${Number(item.price) || 0}" data-category="${escapeHtml(item.category_name || item.categoryName || '')}">Alarm kur</button>`;
}

function graphButton(item, source) {
    const key = item.asin || item.product_url || item.url || '';
    if (!key) return '';
    return `<button class="show-chart" data-source="${escapeHtml(source)}" data-key="${escapeHtml(key)}" data-category="${escapeHtml(item.category_id || '')}" data-period="${escapeHtml(item.low_price_period || '')}" data-title="${escapeHtml(item.title)}">Grafik</button>`;
}

function card(item, bestSeller = false, source = 'low-prices') {
    const discount = Number(item.discount_percent || 0);
    const sales = item.monthly_sales_minimum == null ? 'Satış etiketi yok' : `Geçen ay ≥${Number(item.monthly_sales_minimum).toLocaleString('tr-TR')} satış`;
    return `<div class="product-with-alert"><a class="summary-product" href="${escapeHtml(item.product_url || item.url || '#')}" target="_blank" rel="noopener">
        <img src="${escapeHtml(item.image_url || '')}" alt=""><div>
        <div class="product-title">${bestSeller && item.rank != null ? `#${Number(item.rank)} · ` : ''}${escapeHtml(item.title)}</div>
        <div class="price-row">${price(item.price)}${discount ? `<span class="discount">%${discount} indirim</span>` : ''}</div>
        ${item.original_price ? `<span class="old-price">Önceki: ${price(item.original_price)}</span>` : ''}
        <span class="meta ${item.monthly_sales_minimum == null ? '' : 'sales'}">${bestSeller ? escapeHtml(item.sourceLabel || 'Amazon Çok Satanlar') : sales}</span>
        ${bestSeller ? '' : `<span class="meta">${activePeriod} günün en düşük fiyatı · ${escapeHtml(item.category_name)}</span>`}</div></a>${alarmButton(item, source)}</div>`;
}

function wireAlertButtons() {
    document.querySelectorAll('.set-alert').forEach(button => button.addEventListener('click', async () => {
        const targetPrice = prompt(`${button.dataset.title}\nHedef fiyat (TL, isteğe bağlı):`, '');
        if (targetPrice === null) return;
        const discountPercent = prompt('Başlangıç fiyatına göre minimum indirim oranı (% , isteğe bağlı):', '');
        if (discountPercent === null) return;
        const response = await fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: button.dataset.source, categoryName: button.dataset.category, title: button.dataset.title, productUrl: button.dataset.url, basePrice: Number(button.dataset.price), targetPrice: Number(targetPrice), discountPercent: Number(discountPercent) }) });
        const result = await response.json();
        alert(response.ok ? 'Alarm kuruldu. Fiyat her saat kontrol edilecek.' : (result.error || 'Alarm kurulamadı.'));
    }));
    wireGraphButtons();
}

function chartMarkup(history) {
    const values = history.map(item => Number(item.price)).filter(Number.isFinite);
    if (!values.length) return '<div class="empty-state">Bu ürün için henüz fiyat ölçümü yok.</div>';
    const width = 680, height = 230, inset = 30;
    const min = Math.min(...values), max = Math.max(...values), range = max - min || Math.max(max * 0.04, 1);
    const x = index => inset + (values.length === 1 ? (width - inset * 2) / 2 : index * (width - inset * 2) / (values.length - 1));
    const y = value => height - inset - ((value - min) / range) * (height - inset * 2);
    const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
    const first = history[0], last = history[history.length - 1];
    const change = Number(last.price) - Number(first.price);
    const changeText = change === 0 ? 'Değişim yok' : `${change < 0 ? 'Düşüş' : 'Artış'}: ${price(Math.abs(change))}`;
    return `<div class="chart-stats"><strong>${price(last.price)}</strong><span>${history.length} ölçüm · ${changeText}</span></div><svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Fiyat geçmişi grafiği"><line x1="${inset}" y1="${inset}" x2="${inset}" y2="${height - inset}"/><line x1="${inset}" y1="${height - inset}" x2="${width - inset}" y2="${height - inset}"/><polyline points="${points}"/><circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(values.at(-1)).toFixed(1)}" r="4"/></svg><div class="chart-labels"><span>${sqliteUtcDate(first.captured_at).toLocaleString('tr-TR')}</span><span>${sqliteUtcDate(last.captured_at).toLocaleString('tr-TR')}</span></div>`;
}

function wireGraphButtons() {
    document.querySelectorAll('.set-alert').forEach(alertButton => {
        const row = alertButton.closest('.product-with-alert');
        if (!row || row.querySelector('.show-chart')) return;
        const link = row.querySelector('.summary-product')?.href || '';
        const source = alertButton.dataset.source;
        const asin = link.match(/\/dp\/([A-Z0-9]{10})/i)?.[1] || '';
        const key = asin || link;
        if (!key) return;
        const category = source === 'best-sellers' ? bestSellerCategoryId : source === 'review-radar' ? reviewRadarCategoryId : source === 'low-prices' ? categorySelect.value : '';
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'show-chart'; button.textContent = 'Grafik';
        button.dataset.source = source; button.dataset.key = key; button.dataset.category = category;
        button.dataset.period = source === 'low-prices' ? String(activePeriod) : '';
        button.dataset.title = row.querySelector('.product-title')?.textContent?.trim() || 'Ürün fiyat grafiği';
        alertButton.before(button);
        button.addEventListener('click', async () => {
            priceChartOverlay.hidden = false;
            priceChartTitle.textContent = button.dataset.title;
            priceChartContent.innerHTML = '<p>Fiyat geçmişi yükleniyor…</p>';
            try {
                const query = new URLSearchParams({ source: button.dataset.source, key: button.dataset.key });
                if (button.dataset.category) query.set('categoryId', button.dataset.category);
                if (button.dataset.period) query.set('period', button.dataset.period);
                const response = await fetch(`/api/amazon/price-history?${query}`);
                const history = await response.json();
                if (!response.ok) throw new Error(history.error || 'Fiyat geçmişi alınamadı.');
                priceChartContent.innerHTML = chartMarkup(history);
            } catch (error) { priceChartContent.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
        });
    });
}

function filterItems() {
    const minPrice = inputNumber(filters.minPrice), maxPrice = Number(filters.maxPrice.value || Infinity);
    const minDiscount = inputNumber(filters.minDiscount), minSales = inputNumber(filters.minSales);
    const sales = item => item.monthly_sales_minimum == null ? null : Number(item.monthly_sales_minimum);
    const order = {
        'price-asc': (a, b) => Number(a.price) - Number(b.price),
        'price-desc': (a, b) => Number(b.price) - Number(a.price),
        'discount-desc': (a, b) => Number(b.discount_percent || 0) - Number(a.discount_percent || 0) || Number(a.price) - Number(b.price),
        'sales-desc': (a, b) => (sales(b) ?? -1) - (sales(a) ?? -1) || Number(b.discount_percent || 0) - Number(a.discount_percent || 0)
    }[filters.sortSelect.value];
    return currentItems.filter(item => Number(item.low_price_period) === activePeriod)
        .filter(item => Number(item.price) >= minPrice && Number(item.price) <= maxPrice)
        .filter(item => Number(item.discount_percent || 0) >= minDiscount)
        .filter(item => minSales <= 0 || (sales(item) !== null && sales(item) >= minSales))
        .sort(order);
}

function renderLowPrices() {
    const items = filterItems();
    summary.innerHTML = `<article class="summary-card full-width"><h2>${items.length} ürün · Birleşik filtre sonucu</h2>${items.length ? `<div class="product-list">${items.map(item => card(item)).join('')}</div>` : '<div class="empty-state">Bu filtre kombinasyonunda ürün bulunamadı.</div>'}</article>`;
    summary.querySelector('h2')?.insertAdjacentHTML('afterend', lastRunMarkup('low-prices'));
    wireAlertButtons();
}

async function loadSnapshot() {
    if (!categorySelect.value) return;
    await loadAnalysisRuns();
    updateLastUpdateStatus('low-prices');
    await updateLowPriceRunIndicator();
    const response = await fetch(`/api/amazon/low-prices/${encodeURIComponent(categorySelect.value)}`);
    const items = await response.json();
    if (!response.ok) throw new Error(items.error || 'Kayıt alınamadı');
    currentItems = items;
    scanStatus.textContent = items.length ? `${categorySelect.selectedOptions[0].text}: ${items.length} ürün hazır.` : 'Bu kategori henüz taranmadı.';
    renderLowPrices();
}

async function loadAnalysisCategories() {
    if (analysisCategories.length) return analysisCategories;
    const response = await fetch('/api/amazon/analysis-categories'); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Amazon kategori listesi alınamadı.');
    analysisCategories = data;
    return data;
}

function analysisCategoryOptions(selected) {
    return analysisCategories.map(category => `<option value="${escapeHtml(category.id)}" ${category.id === selected ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('');
}

async function loadBestSellers() {
    await loadAnalysisRuns();
    updateLastUpdateStatus('best-sellers');
    await loadAnalysisCategories();
    const response = await fetch(`/api/amazon/best-sellers?categoryId=${encodeURIComponent(bestSellerCategoryId)}`);
    const items = await response.json();
    if (!response.ok) throw new Error(items.error || 'Çok Satanlar kaydı alınamadı');
    const render = () => {
        const min = Number(document.getElementById('bestMinPrice')?.value || 0), max = Number(document.getElementById('bestMaxPrice')?.value || Infinity);
        const sort = document.getElementById('bestSort')?.value || 'rank';
        const filtered = items.filter(item => Number(item.price) >= min && Number(item.price) <= max).sort(sort === 'price-asc' ? (a, b) => a.price - b.price : sort === 'price-desc' ? (a, b) => b.price - a.price : (a, b) => a.rank - b.rank);
        document.getElementById('bestSellerList').innerHTML = filtered.length ? filtered.map(item => card(item, true, 'best-sellers')).join('') : '<div class="empty-state">Bu filtrede ürün yok.</div>'; wireAlertButtons();
    };
    summary.innerHTML = `<article class="summary-card full-width"><h2>Amazon Çok Satanlar</h2><section class="filter-panel"><label>Kategori <select id="bestCategory">${analysisCategoryOptions(bestSellerCategoryId)}</select></label><label>Min. fiyat <input id="bestMinPrice" type="number" min="0"></label><label>Maks. fiyat <input id="bestMaxPrice" type="number" min="0"></label><label>Sıralama <select id="bestSort"><option value="rank">Amazon sırası</option><option value="price-asc">Fiyat: artan</option><option value="price-desc">Fiyat: azalan</option></select></label><button id="bestRefresh" class="primary">Seçili kategoriyi tara</button></section><div id="bestSellerList" class="product-list"></div></article>`;
    ['bestMinPrice', 'bestMaxPrice', 'bestSort'].forEach(id => document.getElementById(id).addEventListener('input', render));
    document.getElementById('bestCategory').addEventListener('change', event => { bestSellerCategoryId = event.target.value; loadBestSellers().catch(error => scanStatus.textContent = error.message); });
    document.getElementById('bestRefresh').addEventListener('click', () => (async () => { scanStatus.textContent = 'Çok Satanlar kategorisi taranıyor…'; const response = await fetch('/api/amazon/best-sellers/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: bestSellerCategoryId }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Tarama başlatılamadı.'); await loadBestSellers(); })().catch(error => scanStatus.textContent = error.message));
    render(); summary.querySelector('h2')?.insertAdjacentHTML('afterend', lastRunMarkup('best-sellers')); scanStatus.textContent = `${items.length} Çok Satanlar ürünü gösteriliyor.`;
}

function dealCard(item) {
    const discount = Number(item.discount_percent || 0);
    const sales = item.monthly_sales_minimum == null ? 'Sat\u0131\u015f etiketi yok' : `Ge\u00e7en ay \u2265${Number(item.monthly_sales_minimum).toLocaleString('tr-TR')} sat\u0131\u015f`;
    return `<div class="product-with-alert"><a class="summary-product" href="${escapeHtml(item.product_url || '#')}" target="_blank" rel="noopener">
        <img src="${escapeHtml(item.image_url || '')}" alt=""><div>
        <div class="product-title">${escapeHtml(item.title)}</div>
        <div class="price-row">${price(item.price)}${discount ? `<span class="discount">%${discount} indirim</span>` : ''}</div>
        ${item.original_price ? `<span class="old-price">\u00d6nceki: ${price(item.original_price)}</span>` : ''}
        <span class="meta ${item.monthly_sales_minimum == null ? '' : 'sales'}">${sales}</span>
        <span class="meta">Amazon F\u0131rsatlar\u0131</span>
        </div></a>${alarmButton(item, 'deals')}</div>`;
}

async function loadDeals() {
    await loadAnalysisRuns();
    updateLastUpdateStatus('deals');
    const response = await fetch('/api/amazon/deals');
    const items = await response.json();
    if (!response.ok) throw new Error(items.error || 'F\u0131rsat kayd\u0131 al\u0131namad\u0131.');
    const render = () => {
        const min = Number(document.getElementById('dealMinPrice')?.value || 0);
        const max = Number(document.getElementById('dealMaxPrice')?.value || Infinity);
        const minDiscount = Number(document.getElementById('dealMinDiscount')?.value || 0);
        const minSales = Number(document.getElementById('dealMinSales')?.value || 0);
        const sales = item => item.monthly_sales_minimum == null ? null : Number(item.monthly_sales_minimum);
        const sort = document.getElementById('dealSort')?.value || 'price-asc';
        const compare = {
            'price-asc': (a, b) => Number(a.price) - Number(b.price),
            'price-desc': (a, b) => Number(b.price) - Number(a.price),
            'discount-desc': (a, b) => Number(b.discount_percent || 0) - Number(a.discount_percent || 0) || Number(a.price) - Number(b.price),
            'sales-desc': (a, b) => (sales(b) ?? -1) - (sales(a) ?? -1) || Number(b.discount_percent || 0) - Number(a.discount_percent || 0)
        }[sort];
        const filtered = items
            .filter(item => Number(item.price) >= min && Number(item.price) <= max)
            .filter(item => Number(item.discount_percent || 0) >= minDiscount)
            .filter(item => minSales <= 0 || (sales(item) !== null && sales(item) >= minSales))
            .sort(compare);
        document.getElementById('dealList').innerHTML = filtered.length
            ? filtered.map(dealCard).join('')
            : '<div class="empty-state">Bu filtrede \u00fcr\u00fcn yok.</div>';
        wireAlertButtons();
    };
    summary.innerHTML = `<article class="summary-card full-width"><h2>Amazon F\u0131rsatlar\u0131</h2><p>Amazon Deals sayfas\u0131ndaki eri\u015filebilen koleksiyonlar birle\u015ftirilerek listelenir. Tarama, sekme a\u00e7\u0131ld\u0131\u011f\u0131nda otomatik ba\u015flamaz.</p><section class="filter-panel"><label>Minimum fiyat <input id="dealMinPrice" type="number" min="0" value="0"></label><label>Maksimum fiyat <input id="dealMaxPrice" type="number" min="0" placeholder="S\u0131n\u0131rs\u0131z"></label><label>En az indirim <input id="dealMinDiscount" type="number" min="0" max="100" value="0"></label><label>En az sat\u0131\u015f <input id="dealMinSales" type="number" min="0" value="0"></label><label>S\u0131ralama <select id="dealSort"><option value="price-asc">Fiyat: d\u00fc\u015f\u00fckten y\u00fckse\u011fe</option><option value="price-desc">Fiyat: y\u00fcksekten d\u00fc\u015f\u00fc\u011fe</option><option value="discount-desc">\u0130ndirim: y\u00fcksekten d\u00fc\u015f\u00fc\u011fe</option><option value="sales-desc">Sat\u0131\u015f: y\u00fcksekten d\u00fc\u015f\u00fc\u011fe</option></select></label><button id="dealRefresh" class="primary">T\u00fcm f\u0131rsatlar\u0131 tara</button></section><div id="dealList" class="product-list"></div></article>`;
    ['dealMinPrice', 'dealMaxPrice', 'dealMinDiscount', 'dealMinSales', 'dealSort'].forEach(id => {
        document.getElementById(id).addEventListener('input', render);
        document.getElementById(id).addEventListener('change', render);
    });
    document.getElementById('dealRefresh').addEventListener('click', () => (async () => {
        const refresh = document.getElementById('dealRefresh');
        refresh.disabled = true;
        scanStatus.textContent = 'Amazon F\u0131rsatlar\u0131 taran\u0131yor; koleksiyonlar birle\u015ftiriliyor\u2026';
        try {
            const result = await fetch('/api/amazon/deals/refresh', { method: 'POST' });
            const data = await result.json();
            if (!result.ok) throw new Error(data.error || 'F\u0131rsat taramas\u0131 ba\u015flat\u0131lamad\u0131.');
            await loadDeals();
        } finally {
            refresh.disabled = false;
        }
    })().catch(error => { scanStatus.textContent = error.message; }));
    render();
    summary.querySelector('h2')?.insertAdjacentHTML('afterend', lastRunMarkup('deals'));
    scanStatus.textContent = items.length ? `${items.length} Amazon F\u0131rsat\u0131 g\u00f6steriliyor.` : 'Hen\u00fcz f\u0131rsat kayd\u0131 yok. T\u00fcm f\u0131rsatlar\u0131 tara ile ba\u015flatabilirsin.';
}

function reviewCard(item, index) {
    return `<div class="product-with-alert"><a class="summary-product" href="${escapeHtml(item.product_url)}" target="_blank" rel="noopener">
        <img src="${escapeHtml(item.image_url || '')}" alt=""><div>
        <div class="product-title">#${index + 1} · ${escapeHtml(item.title)}</div>
        <div class="price-row">${price(item.price)}</div>
        <span class="meta sales">${Number(item.rating || 0).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ★ · ${Number(item.review_count || 0).toLocaleString('tr-TR')} müşteri yorumu</span>
        </div></a>${alarmButton(item, 'review-radar')}</div>`;
}

async function loadReviewRadar() {
    await loadAnalysisRuns();
    updateLastUpdateStatus('review-radar');
    await loadAnalysisCategories();
    const response = await fetch(`/api/amazon/review-radar?categoryId=${encodeURIComponent(reviewRadarCategoryId)}`);
    const items = await response.json();
    if (!response.ok) throw new Error(items.error || 'Yorum radarı kaydı alınamadı.');
    const render = () => {
        const min = Number(document.getElementById('reviewMinPrice')?.value || 0), max = Number(document.getElementById('reviewMaxPrice')?.value || Infinity);
        const minRating = Number(document.getElementById('reviewMinRating')?.value || 0), minCount = Number(document.getElementById('reviewMinCount')?.value || 0);
        const sort = document.getElementById('reviewSort')?.value || 'rating';
        const filtered = items.filter(item => Number(item.price || 0) >= min && Number(item.price || 0) <= max && Number(item.rating || 0) >= minRating && Number(item.review_count || 0) >= minCount).sort(sort === 'reviews' ? (a, b) => b.review_count - a.review_count || b.rating - a.rating : sort === 'price-asc' ? (a, b) => a.price - b.price : sort === 'price-desc' ? (a, b) => b.price - a.price : (a, b) => b.rating - a.rating || b.review_count - a.review_count);
        document.getElementById('reviewRadarList').innerHTML = filtered.length ? filtered.map((item, index) => reviewCard(item, index)).join('') : '<div class="empty-state">Bu filtrede ürün yok.</div>'; wireAlertButtons();
    };
    summary.innerHTML = `<article class="summary-card full-width"><h2>Amazon Yorum Radarı</h2><p>Önce yıldız puanı, eşitlikte müşteri yorum sayısı büyükten küçüğe sıralanır.</p><section class="filter-panel"><label>Kategori <select id="reviewCategory">${analysisCategoryOptions(reviewRadarCategoryId)}</select></label><label>Min. fiyat <input id="reviewMinPrice" type="number" min="0"></label><label>Maks. fiyat <input id="reviewMaxPrice" type="number" min="0"></label><label>En az yıldız <input id="reviewMinRating" type="number" min="0" max="5" step="0.1" value="0"></label><label>En az yorum <input id="reviewMinCount" type="number" min="0" value="0"></label><label>Sıralama <select id="reviewSort"><option value="rating">Yıldız, sonra yorum</option><option value="reviews">Yorum sayısı</option><option value="price-asc">Fiyat: artan</option><option value="price-desc">Fiyat: azalan</option></select></label><button id="refreshReviewRadarBtn" class="primary">Arka planda analizi başlat</button></section><div id="reviewRadarList" class="product-list"></div></article>`;
    ['reviewMinPrice', 'reviewMaxPrice', 'reviewMinRating', 'reviewMinCount', 'reviewSort'].forEach(id => document.getElementById(id).addEventListener('input', render));
    document.getElementById('reviewCategory').addEventListener('change', event => { reviewRadarCategoryId = event.target.value; loadReviewRadar().catch(error => scanStatus.textContent = error.message); });
    document.getElementById('refreshReviewRadarBtn').addEventListener('click', () => startReviewRadar().catch(error => scanStatus.textContent = error.message));
    render();
    summary.querySelector('h2')?.insertAdjacentHTML('afterend', lastRunMarkup('review-radar'));
    scanStatus.textContent = items.length ? `${items.length} ürün yıldız ve yorum sayısına göre sıralandı.` : 'Analiz başlatılmayı bekliyor.';
}

async function startReviewRadar() {
    const response = await fetch('/api/amazon/review-radar/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: reviewRadarCategoryId }) });
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || 'Yorum analizi başlatılamadı.');
    scanStatus.textContent = 'Amazon yorum analizi arka planda çalışıyor…';
    const wait = async () => {
        const current = await (await fetch('/api/amazon/review-radar/scan-status')).json();
        if (current.status === 'running') return setTimeout(wait, 2500);
        if (current.status !== 'completed') throw new Error(current.error || 'Yorum analizi tamamlanamadı.');
        await loadReviewRadar();
    };
    try { await wait(); } catch (error) { scanStatus.textContent = error.message; }
}

async function loadAlerts() {
    const response = await fetch('/api/alerts'); const alerts = await response.json();
    if (!response.ok) throw new Error(alerts.error || 'Alarmlar alınamadı.');
    summary.innerHTML = `<article class="summary-card full-width"><h2>Kurulu Alarmlar</h2>${alerts.length ? `<div class="alert-list">${alerts.map(alert => `<article class="alert-row"><div><strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.source)}${alert.category_name ? ` · ${escapeHtml(alert.category_name)}` : ''}</span><span>Başlangıç: ${price(alert.base_price)} · Son: ${price(alert.last_price)}</span><span>${alert.target_price ? `Hedef: ${price(alert.target_price)}` : ''}${alert.target_price && alert.discount_percent ? ' · ' : ''}${alert.discount_percent ? `İndirim: %${alert.discount_percent}` : ''}</span><span>Son kontrol: ${alert.last_checked ? new Date(alert.last_checked).toLocaleString('tr-TR') : 'Henüz kontrol edilmedi'}</span></div><button class="delete-alert" data-id="${alert.id}">Sil</button></article>`).join('')}</div>` : '<div class="empty-state">Henüz kurulu alarm yok.</div>'}</article>`;
    document.querySelectorAll('.delete-alert').forEach(button => button.addEventListener('click', async () => {
        if (!confirm('Bu alarm silinsin mi?')) return;
        const remove = await fetch(`/api/alerts/${button.dataset.id}`, { method: 'DELETE' });
        if (!remove.ok) return alert('Alarm silinemedi.');
        loadAlerts().catch(error => scanStatus.textContent = error.message);
    }));
    scanStatus.textContent = `${alerts.length} alarm kurulu.`;
}

async function loadCategories() {
    try {
        const response = await fetch('/api/amazon/low-prices/categories');
        const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Kategori listesi alınamadı');
        categories = data; categorySelect.innerHTML = data.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
        categorySelect.disabled = refreshCategoryBtn.disabled = refreshAllBtn.disabled = !data.length;
        await loadSnapshot();
    } catch (error) { scanStatus.textContent = error.message; summary.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`; }
}

function renderScan(status) {
    const running = status.status === 'running'; scanOverlay.hidden = !running; if (!running) return;
    overlayTitle.textContent = 'Amazon verileri hazırlanıyor'; overlayProgress.textContent = `${status.completed || 0}/${status.total || '?'} kategori · ${status.currentCategory || 'hazırlanıyor'}`;
    scanLogs.innerHTML = (status.logs || []).map(log => `<div class="scan-log"><time>${new Date(log.at).toLocaleTimeString('tr-TR')}</time><span>${escapeHtml(log.message)}</span></div>`).join('');
    scanLogs.scrollTop = scanLogs.scrollHeight;
}

async function pollScan() {
    try {
        const response = await fetch('/api/amazon/low-prices/scan-status'); const status = await response.json(); renderScan(status);
        if (status.status === 'running') { scanStatus.textContent = `${status.completed || 0}/${status.total || '?'} kategori taranıyor · ${status.currentCategory || ''}`; scanPollTimer = setTimeout(pollScan, 3000); }
        else if (status.status === 'completed' && activeView === 'low-prices') await loadSnapshot();
    } catch (error) { scanStatus.textContent = error.message; }
}

async function startAutomaticFullScan() {
    try { const response = await fetch('/api/amazon/low-prices/refresh-all', { method: 'POST' }); const status = await response.json(); if (!response.ok) throw new Error(status.error); renderScan(status); clearTimeout(scanPollTimer); scanPollTimer = setTimeout(pollScan, 800); }
    catch (error) { scanStatus.textContent = error.message; }
}

async function refreshCurrentCategory() {
    const category = categories.find(item => item.id === categorySelect.value); if (!category) return;
    refreshCategoryBtn.disabled = true; scanStatus.textContent = `${category.name} taranıyor…`;
    try { const response = await fetch(`/api/amazon/low-prices/${encodeURIComponent(category.id)}/refresh`, { method: 'POST' }); const data = await response.json(); if (!response.ok) throw new Error(data.error); currentItems = data.products; renderLowPrices(); }
    catch (error) { scanStatus.textContent = error.message; } finally { refreshCategoryBtn.disabled = false; }
}

document.querySelectorAll('.source-tab').forEach(button => button.addEventListener('click', async () => {
    activeView = button.dataset.view; document.querySelectorAll('.source-tab').forEach(tab => tab.classList.toggle('active', tab === button));
    viewTitle.textContent = button.textContent.trim();
    updateLastUpdateStatus(activeView);
    const low = activeView === 'low-prices'; controlsPanel.hidden = filterPanel.hidden = periodTabs.hidden = !low;
    try { if (low) renderLowPrices(); else if (activeView === 'deals') await loadDeals(); else if (activeView === 'best-sellers') await loadBestSellers(); else if (activeView === 'review-radar') await loadReviewRadar(); else await loadAlerts(); } catch (error) { scanStatus.textContent = error.message; }
}));
categorySelect.addEventListener('change', () => loadSnapshot().catch(error => { scanStatus.textContent = error.message; }));
refreshCategoryBtn.addEventListener('click', refreshCurrentCategory);
refreshAllBtn.addEventListener('click', startAutomaticFullScan);
document.querySelectorAll('.period-tab').forEach(button => button.addEventListener('click', () => { activePeriod = Number(button.dataset.period); document.querySelectorAll('.period-tab').forEach(tab => tab.classList.toggle('active', tab === button)); renderLowPrices(); }));
Object.values(filters).forEach(control => control.addEventListener('input', renderLowPrices));
document.getElementById('clearFiltersBtn').addEventListener('click', () => { filters.minPrice.value = filters.maxPrice.value = ''; filters.minDiscount.value = filters.minSales.value = 0; filters.sortSelect.value = 'price-asc'; renderLowPrices(); });
document.getElementById('closePriceChart').addEventListener('click', () => { priceChartOverlay.hidden = true; });
priceChartOverlay.addEventListener('click', event => { if (event.target === priceChartOverlay) priceChartOverlay.hidden = true; });

let dashboardRefreshInFlight = false;
async function refreshActiveDashboard() {
    if (dashboardRefreshInFlight) return;
    dashboardRefreshInFlight = true;
    try {
        const previousFinishedAt = analysisRuns[activeView]?.finished_at || '';
        await loadAnalysisRuns();
        updateLastUpdateStatus(activeView);
        await updateLowPriceRunIndicator();
        const latestFinishedAt = analysisRuns[activeView]?.finished_at || '';
        if (!latestFinishedAt || latestFinishedAt === previousFinishedAt) return;
        if (activeView === 'low-prices') await loadSnapshot();
        else if (activeView === 'deals') await loadDeals();
        else if (activeView === 'best-sellers') await loadBestSellers();
        else if (activeView === 'review-radar') await loadReviewRadar();
    } catch (error) {
        console.warn(`Pano güncellenemedi: ${error.message}`);
    } finally {
        dashboardRefreshInFlight = false;
    }
}

setInterval(refreshActiveDashboard, 60000);
loadCategories();
