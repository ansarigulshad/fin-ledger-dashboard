"""Market-cap classification from NSE's index constituent lists (refreshed daily).

SEBI/AMFI buckets: large = top 100, mid = 101-250, small = 251+.  NSE's NIFTY 100, NIFTY MIDCAP 150,
NIFTY SMALLCAP 250 and NIFTY MICROCAP 250 lists track those buckets, and ship an Industry column too.
"""
from __future__ import annotations

import csv
import io
import threading
import time

import requests

from . import store

LISTS = [  # (bucket, NSE file)
    ("Large", "ind_nifty100list.csv"),
    ("Mid", "ind_niftymidcap150list.csv"),
    ("Small", "ind_niftysmallcap250list.csv"),
    ("Micro", "ind_niftymicrocap250_list.csv"),
]
_lock = threading.Lock()
_map: dict[str, dict] = {}
_loaded_at = 0.0


def _load_file(name: str) -> str:
    path = store.DATA_DIR / name
    if path.exists() and time.time() - path.stat().st_mtime < 86400:
        return path.read_text()
    try:
        r = requests.get(f"https://archives.nseindia.com/content/indices/{name}", timeout=20,
                         headers={"User-Agent": "Mozilla/5.0"})
        r.raise_for_status()
        store.DATA_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(r.text)
        return r.text
    except Exception:
        return path.read_text() if path.exists() else ""


def cap_map() -> dict[str, dict]:
    """{symbol: {cap, industry, name}} — also keyed by ISIN for symbol changes."""
    global _map, _loaded_at
    with _lock:
        if _map and time.time() - _loaded_at < 3600:
            return _map
        m: dict[str, dict] = {}
        for bucket, fname in LISTS:
            for row in csv.DictReader(io.StringIO(_load_file(fname))):
                sym = (row.get("Symbol") or "").strip()
                if not sym:
                    continue
                rec = {"cap": bucket, "industry": (row.get("Industry") or "").strip(), "name": (row.get("Company Name") or "").strip()}
                m.setdefault(sym, rec)
                isin = (row.get("ISIN Code") or "").strip()
                if isin:
                    m.setdefault(isin, rec)
        if m:
            _map, _loaded_at = m, time.time()
        return _map
