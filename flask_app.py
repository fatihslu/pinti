"""PythonAnywhere-compatible Flask entry point for PİNTİ.

The existing public UI is served unchanged.  This module reads the same SQLite
schema used locally, so previously captured snapshots remain visible after the
database is migrated to a persistent database.
"""
from __future__ import annotations

import os
import re
import sqlite3
from pathlib import Path
from flask import Flask, jsonify, request

ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("PINTI_DATABASE", ROOT / "price_tracker.db"))
app = Flask(__name__, static_folder="public", static_url_path="")

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


def ensure_alerts_table():
    with db() as connection:
        connection.execute("""CREATE TABLE IF NOT EXISTS product_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL,
            category_name TEXT, title TEXT NOT NULL, product_url TEXT NOT NULL,
            base_price REAL NOT NULL, target_price REAL, discount_percent REAL,
            email TEXT NOT NULL, last_price REAL, last_notified_price REAL,
            active INTEGER NOT NULL DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_checked DATETIME)""")


@app.get("/")
def home():
    return app.send_static_file("index.html")


@app.get("/api/amazon/analysis-categories")
def analysis_categories():
    return jsonify(ANALYSIS_CATEGORIES)


@app.get("/api/amazon/best-sellers")
def best_sellers():
    category_id = request.args.get("categoryId", "featured")
    sql = """SELECT rank,title,price,category_id,category_name,product_url,image_url,captured_at
             FROM amazon_bestseller_snapshots WHERE category_id=?
             AND batch_id=(SELECT batch_id FROM amazon_bestseller_snapshots WHERE category_id=? ORDER BY id DESC LIMIT 1)
             ORDER BY rank ASC LIMIT 100"""
    return jsonify(rows(sql, (category_id, category_id)))


@app.get("/api/amazon/review-radar")
def review_radar():
    category_id = request.args.get("categoryId", "featured")
    sql = """SELECT asin,title,price,category_id,category_name,rating,review_count,image_url,product_url,captured_at
             FROM amazon_review_radar_snapshots WHERE category_id=?
             AND batch_id=(SELECT batch_id FROM amazon_review_radar_snapshots WHERE category_id=? ORDER BY id DESC LIMIT 1)
             ORDER BY rating DESC,review_count DESC,title ASC LIMIT 600"""
    return jsonify(rows(sql, (category_id, category_id)))


@app.get("/api/amazon/low-prices/categories")
def low_price_categories():
    return jsonify(rows("SELECT DISTINCT category_id AS id, category_name AS name FROM amazon_low_price_snapshots ORDER BY name"))


@app.get("/api/amazon/low-prices/<category_id>")
def low_prices(category_id):
    sql = """SELECT category_id,category_name,low_price_period,asin,position,title,price,original_price,discount_percent,
             monthly_sales_minimum,monthly_sales_text,review_count,rating,product_url,image_url,captured_at
             FROM amazon_low_price_snapshots WHERE category_id=? ORDER BY low_price_period,position"""
    return jsonify(rows(sql, (category_id,)))


@app.get("/api/alerts")
def alerts():
    ensure_alerts_table()
    return jsonify(rows("SELECT * FROM product_alerts ORDER BY active DESC,id DESC"))


@app.post("/api/alerts")
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
