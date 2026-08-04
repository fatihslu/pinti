"""PythonAnywhere-compatible Flask entry point for PİNTİ.

The existing public UI is served unchanged.  This module reads the same SQLite
schema used locally, so previously captured snapshots remain visible after the
database is migrated to a persistent database.
"""
from __future__ import annotations

import os
import sqlite3
import secrets
import threading
import uuid
from pathlib import Path
from functools import wraps
from flask import Flask, jsonify, request, redirect, session, url_for, render_template_string
from amazon_collector import AmazonCollector, AmazonCollectionError, Category

ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("PINTI_DATABASE", ROOT / "price_tracker.db"))
app = Flask(__name__, static_folder="public", static_url_path="")
app.secret_key = os.environ.get("PINTI_SECRET_KEY", secrets.token_urlsafe(32))

ANALYSIS_CATEGORIES = [
    {"id": "featured", "name": "Öne Çıkan Ürünler", "url": "https://www.amazon.com.tr/b?node=21034466031"},
    {"id": "garden", "name": "Bahçe", "url": "https://www.amazon.com.tr/gp/bestsellers/garden"},
    {"id": "baby-products", "name": "Bebek", "url": "https://www.amazon.com.tr/gp/bestsellers/baby-products"},
    {"id": "computers", "name": "Bilgisayar", "url": "https://www.amazon.com.tr/gp/bestsellers/computers"},
    {"id": "electronics", "name": "Elektronik", "url": "https://www.amazon.com.tr/gp/bestsellers/electronics"},
    {"id": "books", "name": "Kitap", "url": "https://www.amazon.com.tr/gp/bestsellers/books"},
    {"id": "fashion", "name": "Moda", "url": "https://www.amazon.com.tr/gp/bestsellers/fashion"},
]


def db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def rows(sql, args=()):
    with db() as connection:
        return [dict(row) for row in connection.execute(sql, args).fetchall()]


def ensure_schema():
    """Create the local snapshot store on a fresh PythonAnywhere deployment.

    `price_tracker.db` is deliberately ignored by Git, so a freshly cloned
    application has no tables.  The Flask read endpoints must still return an
    empty JSON collection until the first scan has populated the database.
    """
    with db() as connection:
        connection.executescript("""
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
            );

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
            );

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
            );

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
            );
        """)


def ensure_alerts_table():
    ensure_schema()


ensure_schema()

collector = AmazonCollector()
low_price_scan = {"status": "idle", "startedAt": None, "finishedAt": None, "total": 0, "completed": 0,
                  "savedCount": 0, "currentCategory": None, "failures": [], "logs": []}
review_radar_scan = {"status": "idle", "startedAt": None, "finishedAt": None, "count": 0, "error": None}
scan_lock = threading.Lock()


def timestamp():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def category_for(category_id: str) -> Category:
    match = next((category for category in ANALYSIS_CATEGORIES if category["id"] == category_id), None)
    if not match:
        raise ValueError("Kategori bulunamadı.")
    return Category(match["id"], match["name"], match["url"])


def store_best_sellers(category: Category, items: list[dict]) -> None:
    batch_id = uuid.uuid4().hex
    with db() as connection:
        connection.executemany("""INSERT INTO amazon_bestseller_snapshots
            (batch_id,rank,title,price,category_id,category_name,product_url,image_url)
            VALUES (?,?,?,?,?,?,?,?)""", [
                (batch_id, item["rank"], item["title"], item["price"], category.id, category.name,
                 item["product_url"], item.get("image_url")) for item in items
            ])


def store_review_radar(category: Category, items: list[dict]) -> None:
    batch_id = uuid.uuid4().hex
    with db() as connection:
        connection.executemany("""INSERT INTO amazon_review_radar_snapshots
            (batch_id,asin,title,price,category_id,category_name,rating,review_count,image_url,product_url)
            VALUES (?,?,?,?,?,?,?,?,?,?)""", [
                (batch_id, item["asin"], item["title"], item.get("price"), category.id, category.name,
                 item["rating"], item["review_count"], item.get("image_url"), item["product_url"])
                for item in items
            ])


def store_low_prices(category: Category, items: list[dict]) -> None:
    batch_id = uuid.uuid4().hex
    with db() as connection:
        connection.executemany("""INSERT INTO amazon_low_price_snapshots
            (batch_id,category_id,category_name,low_price_period,asin,position,title,price,original_price,
             discount_percent,monthly_sales_minimum,monthly_sales_text,review_count,rating,product_url,image_url)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", [
                (batch_id, category.id, category.name, item["low_price_period"], item["asin"], item["position"],
                 item["title"], item["price"], item.get("original_price"), item["discount_percent"],
                 item.get("monthly_sales_minimum"), item.get("monthly_sales_text"), item.get("review_count"),
                 item.get("rating"), item["product_url"], item.get("image_url")) for item in items
            ])


def refresh_low_prices(category: Category) -> list[dict]:
    items = collector.low_prices(category)
    store_low_prices(category, items)
    return items


def append_low_price_log(message: str) -> None:
    low_price_scan["logs"].append({"at": timestamp(), "message": message})
    low_price_scan["logs"] = low_price_scan["logs"][-120:]


def run_full_low_price_scan() -> None:
    try:
        categories = collector.low_price_categories()
        low_price_scan.update(total=len(categories))
        for category in categories:
            low_price_scan["currentCategory"] = category.name
            try:
                items = refresh_low_prices(category)
                low_price_scan["completed"] += 1
                low_price_scan["savedCount"] += len(items)
                append_low_price_log(f"{category.name}: {len(items)} ürün kaydedildi.")
            except AmazonCollectionError as error:
                low_price_scan["completed"] += 1
                low_price_scan["failures"].append({"category": category.name, "error": str(error)})
                append_low_price_log(f"{category.name}: {error}")
        low_price_scan.update(status="completed", currentCategory=None, finishedAt=timestamp())
    except Exception as error:
        low_price_scan.update(status="failed", currentCategory=None, finishedAt=timestamp(), error=str(error))
        append_low_price_log(f"Tarama durdu: {error}")
    finally:
        scan_lock.release()


def start_full_low_price_scan() -> bool:
    if not scan_lock.acquire(blocking=False):
        return False
    low_price_scan.update(status="running", startedAt=timestamp(), finishedAt=None, total=0, completed=0,
                          savedCount=0, currentCategory=None, failures=[], logs=[])
    append_low_price_log("Tam kategori taraması başlatıldı.")
    threading.Thread(target=run_full_low_price_scan, daemon=True).start()
    return True


def start_review_radar_scan(category: Category) -> bool:
    if review_radar_scan["status"] == "running":
        return False
    review_radar_scan.update(status="running", startedAt=timestamp(), finishedAt=None, count=0, error=None)

    def work():
        try:
            items = collector.review_radar(category)
            store_review_radar(category, items)
            review_radar_scan.update(status="completed", finishedAt=timestamp(), count=len(items))
        except Exception as error:
            review_radar_scan.update(status="failed", finishedAt=timestamp(), error=str(error))

    threading.Thread(target=work, daemon=True).start()
    return True


def run_scheduled_collection() -> None:
    """Entry point for a PythonAnywhere Task; performs the hourly collection."""
    if not start_full_low_price_scan():
        return
    while low_price_scan["status"] == "running":
        threading.Event().wait(1)


def logged_in():
    return session.get("pinti_authenticated") is True


@app.before_request
def protect_application():
    # static_url_path kökte olduğu için index.html Flask'ın static handler'ına
    # düşebilir. Bu merkezi kontrol hem arayüzü hem API'leri korur.
    if request.path in {"/login", "/health", "/logout"} or logged_in():
        return None
    if request.path.startswith("/api/"):
        return jsonify(error="Oturum açmalısın."), 401
    return redirect(url_for("login"))


@app.errorhandler(sqlite3.Error)
def database_error(error):
    """API clients must never receive Flask's HTML error document as JSON."""
    if request.path.startswith("/api/"):
        return jsonify(error=f"Veritabanı hatası: {error}"), 500
    raise error


@app.errorhandler(404)
@app.errorhandler(405)
def api_route_error(error):
    """Keep the browser client on JSON even for unavailable API operations."""
    if request.path.startswith("/api/"):
        return jsonify(error=(
            "Bu tarama işlemi PythonAnywhere Flask sürümünde henüz etkin değil. "
            "Kaydedilmiş analiz kayıtları görüntülenebilir."
        )), error.code
    return error


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if logged_in():
            return view(*args, **kwargs)
        if request.path.startswith("/api/"):
            return jsonify(error="Oturum açmalısın."), 401
        return redirect(url_for("login"))
    return wrapped


@app.get("/login")
@app.post("/login")
def login():
    error = ""
    if request.method == "POST":
        expected_user = os.environ.get("PINTI_USERNAME")
        expected_password = os.environ.get("PINTI_PASSWORD")
        if expected_user and expected_password and request.form.get("username") == expected_user and request.form.get("password") == expected_password:
            session.clear()
            session["pinti_authenticated"] = True
            return redirect(url_for("home"))
        error = "Kullanıcı adı veya şifre hatalı."
    return render_template_string("""<!doctype html><html lang="tr"><meta charset="utf-8"><title>PİNTİ Giriş</title>
    <style>body{display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f7fb;font:15px system-ui}form{width:min(360px,calc(100% - 40px));padding:28px;background:#fff;border-radius:14px;box-shadow:0 8px 28px #15213422}label,input,button{display:block;width:100%;box-sizing:border-box}label{margin:13px 0 5px;font-weight:700}input{padding:11px;border:1px solid #cbd5e1;border-radius:7px}button{margin-top:18px;padding:11px;border:0;border-radius:7px;background:#1464b8;color:#fff;font-weight:800}.error{color:#b42318}</style>
    <form method="post"><h1>PİNTİ</h1><p>Yönetim paneline giriş yap.</p>{% if error %}<p class="error">{{ error }}</p>{% endif %}<label>Kullanıcı adı</label><input name="username" required autofocus><label>Şifre</label><input name="password" type="password" required><button>Giriş yap</button></form></html>""", error=error)


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.get("/")
@login_required
def home():
    return app.send_static_file("index.html")


@app.get("/api/amazon/analysis-categories")
@login_required
def analysis_categories():
    return jsonify(ANALYSIS_CATEGORIES)


@app.get("/api/amazon/best-sellers")
@login_required
def best_sellers():
    category_id = request.args.get("categoryId", "featured")
    sql = """SELECT rank,title,price,category_id,category_name,product_url,image_url,captured_at
             FROM amazon_bestseller_snapshots WHERE category_id=?
             AND batch_id=(SELECT batch_id FROM amazon_bestseller_snapshots WHERE category_id=? ORDER BY id DESC LIMIT 1)
             ORDER BY rank ASC LIMIT 100"""
    return jsonify(rows(sql, (category_id, category_id)))


@app.post("/api/amazon/best-sellers/refresh")
@login_required
def refresh_best_sellers():
    try:
        payload = request.get_json(silent=True) or {}
        category = category_for(payload.get("categoryId", "featured"))
        items = collector.best_sellers(category)
        store_best_sellers(category, items)
        return jsonify(success=True, category={"id": category.id, "name": category.name}, products=items)
    except (ValueError, AmazonCollectionError) as error:
        return jsonify(error=str(error)), 422


@app.get("/api/amazon/review-radar")
@login_required
def review_radar():
    category_id = request.args.get("categoryId", "featured")
    sql = """SELECT asin,title,price,category_id,category_name,rating,review_count,image_url,product_url,captured_at
             FROM amazon_review_radar_snapshots WHERE category_id=?
             AND batch_id=(SELECT batch_id FROM amazon_review_radar_snapshots WHERE category_id=? ORDER BY id DESC LIMIT 1)
             ORDER BY rating DESC,review_count DESC,title ASC LIMIT 600"""
    return jsonify(rows(sql, (category_id, category_id)))


@app.post("/api/amazon/review-radar/refresh")
@login_required
def refresh_review_radar():
    try:
        payload = request.get_json(silent=True) or {}
        category = category_for(payload.get("categoryId", "featured"))
        started = start_review_radar_scan(category)
        return jsonify(started=started, category={"id": category.id, "name": category.name}, **review_radar_scan), (202 if started else 200)
    except ValueError as error:
        return jsonify(error=str(error)), 400


@app.get("/api/amazon/review-radar/scan-status")
@login_required
def review_radar_status():
    return jsonify(review_radar_scan)


@app.get("/api/amazon/low-prices/categories")
@login_required
def low_price_categories():
    stored = rows("SELECT DISTINCT category_id AS id, category_name AS name FROM amazon_low_price_snapshots ORDER BY name")
    return jsonify(stored or [{"id": "all", "name": "Tümü"}])


@app.get("/api/amazon/low-prices/scan-status")
@login_required
def low_price_scan_status():
    return jsonify(low_price_scan)


@app.post("/api/amazon/low-prices/refresh-all")
@login_required
def refresh_all_low_prices():
    started = start_full_low_price_scan()
    return jsonify(started=started, **low_price_scan), (202 if started else 200)


@app.get("/api/amazon/low-prices/<category_id>")
@login_required
def low_prices(category_id):
    sql = """SELECT category_id,category_name,low_price_period,asin,position,title,price,original_price,discount_percent,
             monthly_sales_minimum,monthly_sales_text,review_count,rating,product_url,image_url,captured_at
             FROM amazon_low_price_snapshots WHERE category_id=? AND id IN (
                 SELECT MAX(id) FROM amazon_low_price_snapshots WHERE category_id=? GROUP BY asin,low_price_period
             ) ORDER BY low_price_period,position"""
    return jsonify(rows(sql, (category_id, category_id)))


@app.post("/api/amazon/low-prices/<category_id>/refresh")
@login_required
def refresh_low_price_category(category_id):
    try:
        categories = {category.id: category for category in collector.low_price_categories()}
        category = categories.get(category_id)
        if not category:
            return jsonify(error="Amazon sayfasında kategori bulunamadı. Önce tüm kategorileri tara."), 404
        items = refresh_low_prices(category)
        return jsonify(success=True, category={"id": category.id, "name": category.name}, products=items, saved=True, savedCount=len(items))
    except AmazonCollectionError as error:
        return jsonify(error=str(error)), 422


@app.get("/api/alerts")
@login_required
def alerts():
    ensure_alerts_table()
    return jsonify(rows("SELECT * FROM product_alerts ORDER BY active DESC,id DESC"))


@app.post("/api/alerts")
@login_required
def create_alert():
    ensure_alerts_table()
    payload = request.get_json(force=True)
    if not payload.get("title") or not payload.get("productUrl") or not payload.get("basePrice"):
        return jsonify(error="Alarm için ürün ve başlangıç fiyatı gerekli."), 400
    with db() as connection:
        cursor = connection.execute("""INSERT INTO product_alerts
          (source,category_name,title,product_url,base_price,target_price,discount_percent,email,last_price)
          VALUES (?,?,?,?,?,?,?,?,?)""", (payload.get("source", "amazon"), payload.get("categoryName"), payload["title"],
          payload["productUrl"], payload["basePrice"], payload.get("targetPrice") or None,
          payload.get("discountPercent") or None, "faatihuslu@gmail.com", payload["basePrice"]))
    return jsonify(success=True, id=cursor.lastrowid)


@app.delete("/api/alerts/<int:alert_id>")
@login_required
def delete_alert(alert_id):
    ensure_alerts_table()
    with db() as connection:
        cursor = connection.execute("DELETE FROM product_alerts WHERE id=?", (alert_id,))
    return jsonify(success=True, deleted=cursor.rowcount)


@app.get("/health")
def health():
    return jsonify(status="ok")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
