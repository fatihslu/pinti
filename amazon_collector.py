"""Small, server-safe Amazon catalogue collector for the Flask deployment.

It intentionally does not attempt to bypass Amazon verification pages.  A
verification response is surfaced to the caller so a scheduled task can stop
cleanly rather than repeatedly retrying it.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import quote, urlencode, urljoin

import requests
from bs4 import BeautifulSoup


AMAZON_ROOT = "https://www.amazon.com.tr"
LOW_PRICE_URL = f"{AMAZON_ROOT}/b/?node=219537826031"
HEADERS = {
    "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.7",
    "User-Agent": "PintiPriceMonitor/1.0 (+contact: site-owner)",
}
BLOCK_MARKERS = ("robot check", "captcha", "otomatik erişim", "type the characters", "enter the characters")


class AmazonCollectionError(RuntimeError):
    pass


@dataclass(frozen=True)
class Category:
    id: str
    name: str
    url: str = ""


def clean(value: str | None) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def parse_price(value: str | None) -> float | None:
    text = clean(value).replace("TL", "").replace("₺", "")
    match = re.search(r"\d[\d.\s,]*", text)
    if not match:
        return None
    number = match.group(0).replace(" ", "")
    comma, dot = number.rfind(","), number.rfind(".")
    if comma >= 0 and dot >= 0:
        number = number.replace(".", "").replace(",", ".") if comma > dot else number.replace(",", "")
    elif comma >= 0:
        number = number.replace(",", ".") if len(number) - comma <= 3 else number.replace(",", "")
    elif dot >= 0 and len(number) - dot > 3:
        number = number.replace(".", "")
    try:
        price = float(number)
        return price if price > 0 else None
    except ValueError:
        return None


def parse_count(value: str | None) -> int:
    text = clean(value).replace(".", "").replace(",", ".")
    match = re.search(r"(\d+(?:\.\d+)?)\s*([kmb])?", text, re.I)
    if not match:
        return 0
    number = float(match.group(1))
    unit = (match.group(2) or "").lower()
    return round(number * ({"k": 1_000, "b": 1_000, "m": 1_000_000}.get(unit, 1)))


def blocked(html: str) -> bool:
    normalized = html.casefold()
    return any(marker in normalized for marker in BLOCK_MARKERS)


class AmazonCollector:
    def __init__(self, timeout: int = 25):
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(HEADERS)

    def get_soup(self, url: str) -> BeautifulSoup:
        try:
            response = self.session.get(url, timeout=self.timeout)
            response.raise_for_status()
        except requests.RequestException as error:
            raise AmazonCollectionError(f"Amazon sayfasına erişilemedi: {error}") from error
        if blocked(response.text):
            raise AmazonCollectionError("Amazon doğrulama/CAPTCHA sayfası gösterdi; tarama durduruldu.")
        return BeautifulSoup(response.text, "html.parser")

    def low_price_categories(self) -> list[Category]:
        soup = self.get_soup(LOW_PRICE_URL)
        categories: list[Category] = [Category("all", "Tümü")]
        found = {"all"}
        for input_node in soup.select('input[type="radio"]'):
            category_id = clean(input_node.get("value"))
            if category_id != "all" and not re.fullmatch(r"\d{6,}", category_id):
                continue
            label = input_node.find_parent("label")
            name = clean(label.get_text(" ") if label else "")
            if not name:
                continue
            if category_id not in found:
                categories.append(Category(category_id, name))
                found.add(category_id)
        return categories

    @staticmethod
    def low_price_page_url(category: Category, start_index: int = 0) -> str:
        parameters = {
            "node": "219537826031",
            "promotionsSearchStartIndex": str(start_index),
            "promotionsSearchPageSize": "90",
        }
        if category.id != "all":
            state = {"state": {"refinementFilters": {"departments": [category.id]}}, "version": 1}
            parameters["discounts-widget"] = quote(json.dumps(json.dumps(state), separators=(",", ":")))
        return f"{AMAZON_ROOT}/b/?{urlencode(parameters)}"

    def low_prices(self, category: Category, limit: int = 360) -> list[dict]:
        products: dict[tuple[str, int], dict] = {}
        duplicate_pages = 0
        for start_index in range(0, 1_800, 30):
            if len(products) >= limit or duplicate_pages >= 2:
                break
            soup = self.get_soup(self.low_price_page_url(category, start_index))
            added = 0
            for position, card in enumerate(soup.select('[data-testid="product-card"][data-asin]'), start=1):
                asin = clean(card.get("data-asin"))
                text = clean(card.get_text(" "))
                period_match = re.search(r"(30|60|90|365)\s*g[üu]n[üu]n\s*en\s*d[üu]ş[üu]k\s*fiyat", text, re.I)
                if not asin or not period_match:
                    continue
                price_nodes = [clean(node.get_text()) for node in card.select(".a-price .a-offscreen")]
                price = parse_price(price_nodes[0] if price_nodes else "")
                original_price = parse_price(price_nodes[1] if len(price_nodes) > 1 else "")
                image = card.select_one("img")
                link = card.select_one('a[data-testid="product-card-link"][href], a[href*="/dp/"]')
                title = clean(image.get("alt") if image else "")
                url = urljoin(AMAZON_ROOT, link.get("href")) if link else ""
                if not title or not url or price is None:
                    continue
                period = int(period_match.group(1))
                key = (asin, period)
                if key in products:
                    continue
                explicit_discount = re.search(r"%(\d+)\s*indirim", text, re.I)
                discount = int(explicit_discount.group(1)) if explicit_discount else 0
                if not discount and original_price and original_price > price:
                    discount = round((1 - price / original_price) * 100)
                products[key] = {
                    "asin": asin, "position": len(products) + 1, "title": title,
                    "price": price, "original_price": original_price if original_price and original_price > price else None,
                    "discount_percent": discount, "low_price_period": period,
                    "product_url": url, "image_url": image.get("src") or image.get("data-src") if image else None,
                    "monthly_sales_minimum": None, "monthly_sales_text": "", "review_count": None, "rating": None,
                }
                added += 1
                if len(products) >= limit:
                    break
            duplicate_pages = 0 if added else duplicate_pages + 1
        if not products:
            raise AmazonCollectionError(f"{category.name} sayfasında ayrıştırılabilir düşük fiyat ürünü bulunamadı.")
        return list(products.values())

    def best_sellers(self, category: Category, limit: int = 20) -> list[dict]:
        soup = self.get_soup(category.url or f"{AMAZON_ROOT}/gp/bestsellers")
        selector = "#zg-ordered-list > li, .zg-grid-general-faceout, .zg-carousel-general-faceout, [id^='p13n-asin-index-']"
        items: list[dict] = []
        for index, card in enumerate(soup.select(selector), start=1):
            link = card.select_one('a[href*="/dp/"][href], a[href]')
            image = card.select_one("img")
            title = clean((image.get("alt") if image else "") or (link.get_text(" ") if link else ""))
            price_node = card.select_one(".a-price .a-offscreen, [class*='price']")
            price = parse_price(price_node.get_text() if price_node else "")
            if not link or not title or price is None:
                continue
            rank_text = clean((card.select_one(".zg-bdg-text, [class*='rank']") or card).get_text(" "))
            rank_match = re.search(r"#?\s*(\d+)", rank_text)
            items.append({
                "rank": int(rank_match.group(1)) if rank_match else index,
                "title": title, "price": price, "product_url": urljoin(AMAZON_ROOT, link.get("href")),
                "image_url": image.get("src") if image else None,
            })
            if len(items) >= limit:
                break
        if not items:
            raise AmazonCollectionError("Amazon Çok Satanlar sayfasında fiyatlı ürün bulunamadı.")
        return sorted(items, key=lambda item: item["rank"])

    def review_radar(self, category: Category, limit: int = 150) -> list[dict]:
        soup = self.get_soup(category.url)
        cards: Iterable = soup.select('[data-component-type="s-search-result"][data-asin], [data-asin][data-index]')
        if not cards:
            cards = [link.parent for link in soup.select('a[href*="/dp/"]')]
        products: dict[str, dict] = {}
        for card in cards:
            link = card.select_one('a[href*="/dp/"][href]') if card else None
            if not link:
                continue
            url = urljoin(AMAZON_ROOT, link.get("href"))
            asin_match = re.search(r"/dp/([A-Z0-9]{10})", url, re.I)
            asin = clean(card.get("data-asin") if card else "") or (asin_match.group(1) if asin_match else "")
            image = card.select_one("img")
            title_node = card.select_one("h2 span, [data-cy='title-recipe'] h2")
            title = clean((title_node.get_text(" ") if title_node else "") or (image.get("alt") if image else ""))
            if not asin or not title or asin in products:
                continue
            price_node = card.select_one(".a-price .a-offscreen")
            rating_node = card.select_one(".a-icon-alt")
            reviews_node = card.select_one('a[href*="customerReviews"], .a-size-base.s-underline-text')
            rating_match = re.search(r"(\d+[,.]\d+)", clean(rating_node.get_text() if rating_node else ""))
            products[asin] = {
                "asin": asin, "title": title, "price": parse_price(price_node.get_text() if price_node else ""),
                "rating": float(rating_match.group(1).replace(",", ".")) if rating_match else 0,
                "review_count": parse_count(reviews_node.get_text() if reviews_node else ""),
                "image_url": image.get("src") if image else None, "product_url": url,
            }
            if len(products) >= limit:
                break
        if not products:
            raise AmazonCollectionError("Amazon sayfasında yorum radarına uygun ürün bulunamadı.")
        return sorted(products.values(), key=lambda item: (-item["rating"], -item["review_count"]))
