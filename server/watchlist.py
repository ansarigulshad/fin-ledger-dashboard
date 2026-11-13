"""Shared family watchlist: local storage, instrument search, and quotes.

Price lookup order for each symbol:
  1. a family member holds it  -> LTP / close straight from that account's holdings
  2. a logged-in Kite session   -> /quote (Kite Connect or web session; skipped for 10 min if the plan refuses)
  3. Yahoo Finance chart API    -> no login needed (SYMBOL.NS / SYMBOL.BO)
"""
from __future__ import annotations

import csv
import io
import threading
import time
from pathlib import Path

import requests

from . import kite, store

WATCHLIST_FILE = store.DATA_DIR / "watchlist.json"
INSTRUMENTS_FILE = store.DATA_DIR / "instruments_NSE.csv"
_lock = threading.Lock()
_instruments: list[dict] = []
_instruments_loaded_at = 0.0
_quote_cache: dict[str, tuple[float, dict]] = {}
_quote_unsupported: dict[str, float] = {}  # session kind -> until timestamp
QUOTE_TTL = 30


# ---------------------------------------------------------------- storage
def load() -> list[dict]:
    with _lock:
        return store._read(WATCHLIST_FILE, {"items": []}).get("items", [])


def save(items: list[dict]) -> None:
    with _lock:
        store._write(WATCHLIST_FILE, {"items": items})


def add(symbol: str, exchange: str = "NSE", name: str = "", note: str = "") -> list[dict]:
    symbol, exchange = symbol.strip().upper(), (exchange or "NSE").strip().upper()
    items = load()
    if not any(i["symbol"] == symbol and i["exchange"] == exchange for i in items):
        if not name:
            m = next((x for x in instruments() if x["symbol"] == symbol), None)
            name = m["name"] if m else ""
        items.append({"symbol": symbol, "exchange": exchange, "name": name, "note": note, "added_at": time.time()})
        save(items)
    return items


def remove(symbol: str, exchange: str) -> list[dict]:
    items = [i for i in load() if not (i["symbol"] == symbol.upper() and i["exchange"] == exchange.upper())]
    save(items)
    return items


def set_note(symbol: str, exchange: str, note: str) -> list[dict]:
    items = load()
    for i in items:
        if i["symbol"] == symbol.upper() and i["exchange"] == exchange.upper():
            i["note"] = note
    save(items)
    return items


# ---------------------------------------------------------------- instruments (public CSV, refreshed daily)
def instruments() -> list[dict]:
    global _instruments, _instruments_loaded_at
    now = time.time()
    if _instruments and now - _instruments_loaded_at < 3600:
        return _instruments
    text = None
    if INSTRUMENTS_FILE.exists() and now - INSTRUMENTS_FILE.stat().st_mtime < 86400:
        text = INSTRUMENTS_FILE.read_text()
    else:
        try:
            r = requests.get("https://api.kite.trade/instruments/NSE", timeout=30, headers={"User-Agent": kite.UA})
            r.raise_for_status()
            text = r.text
            store.DATA_DIR.mkdir(parents=True, exist_ok=True)
            INSTRUMENTS_FILE.write_text(text)
        except Exception:
            text = INSTRUMENTS_FILE.read_text() if INSTRUMENTS_FILE.exists() else ""
    rows = []
    for row in csv.DictReader(io.StringIO(text)):
        if row.get("instrument_type") == "EQ" and row.get("segment") in ("NSE", "INDICES"):
            rows.append({"symbol": row["tradingsymbol"], "name": row["name"], "exchange": "NSE",
                         "index": row.get("segment") == "INDICES", "instrument_token": int(row["instrument_token"] or 0)})
    _instruments, _instruments_loaded_at = rows, now
    return rows


def lookup(symbol: str) -> dict | None:
    symbol = symbol.strip().upper()
    return next((r for r in instruments() if r["symbol"] == symbol), None)


def search(q: str, limit: int = 10) -> list[dict]:
    q = q.strip().upper()
    if not q:
        return []
    rows = instruments()
    starts = [r for r in rows if r["symbol"].startswith(q)]
    names = [r for r in rows if r not in starts and (q in r["symbol"] or q in r["name"].upper())]
    starts.sort(key=lambda r: (r["index"], len(r["symbol"])))
    return (starts + names)[:limit]


# ---------------------------------------------------------------- quotes
def _yahoo(symbol: str, exchange: str) -> dict | None:
    suffix = ".BO" if exchange == "BSE" else ".NS"
    ysym = {"NIFTY 50": "^NSEI", "NIFTY BANK": "^NSEBANK", "SENSEX": "^BSESN"}.get(symbol, symbol.replace("&", "%26") + suffix)
    try:
        r = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}",
                         params={"range": "1d", "interval": "1d"}, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        if r.status_code != 200:
            return None
        m = r.json()["chart"]["result"][0]["meta"]
        last, prev = m.get("regularMarketPrice"), m.get("chartPreviousClose") or m.get("previousClose")
        if last is None:
            return None
        return {"last_price": last, "close_price": prev or last, "source": "yahoo", "ts": m.get("regularMarketTime")}
    except Exception:
        return None


def _kite_quotes(session: kite.KiteSession, keys: list[str]) -> dict[str, dict]:
    """keys like 'NSE:INFY'. Returns {key: quote}. Raises KiteError if the plan refuses."""
    out = {}
    for i in range(0, len(keys), 100):
        chunk = keys[i:i + 100]
        r = session.s.get(session.base + "/quote", params=[("i", k) for k in chunk], timeout=20)
        data = kite._unwrap(r) or {}
        for k, q in data.items():
            out[k] = {"last_price": q.get("last_price"), "close_price": (q.get("ohlc") or {}).get("close") or q.get("last_price"),
                      "source": "kite", "ts": None}
    return out


def quotes(items: list[dict], holdings_by_symbol: dict[str, dict], sessions: list[kite.KiteSession]) -> dict[str, dict]:
    """Return {'NSE:INFY': {last_price, close_price, source}} for every watchlist item."""
    now = time.time()
    result: dict[str, dict] = {}
    pending: list[dict] = []
    for it in items:
        key = f"{it['exchange']}:{it['symbol']}"
        h = holdings_by_symbol.get(it["symbol"])
        if h:
            result[key] = {"last_price": h["last_price"], "close_price": h["close_price"], "source": "holdings", "ts": None}
            continue
        c = _quote_cache.get(key)
        if c and now - c[0] < QUOTE_TTL:
            result[key] = c[1]
            continue
        pending.append(it)
    if not pending:
        return result
    keys = [f"{it['exchange']}:{it['symbol']}" for it in pending]
    # 2. any Kite session that supports /quote
    for s in sessions:
        if _quote_unsupported.get(s.kind, 0) > now:
            continue
        try:
            got = _kite_quotes(s, keys)
        except Exception:
            _quote_unsupported[s.kind] = now + 600
            continue
        for k, q in got.items():
            if q.get("last_price") is not None:
                result[k] = q
                _quote_cache[k] = (now, q)
        keys = [k for k in keys if k not in result]
        if not keys:
            return result
    # 3. Yahoo fallback
    for k in keys:
        ex, sym = k.split(":", 1)
        q = _yahoo(sym, ex)
        if q:
            result[k] = q
            _quote_cache[k] = (now, q)
    return result
