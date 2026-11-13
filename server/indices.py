"""Major Indian indices: live level, day change and an intraday sparkline from Yahoo Finance (no login needed)."""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor

import requests

# (display name, Yahoo ticker, TradingView symbol, Kite tradingsymbol in the NSE instrument list, group)
INDICES = [
    ("NIFTY 50", "^NSEI", "NSE:NIFTY", "NIFTY 50", "Broad market"),
    ("SENSEX", "^BSESN", "BSE:SENSEX", None, "Broad market"),
    ("NIFTY NEXT 50", "^NSMIDCP", "NSE:NIFTYJR", "NIFTY NEXT 50", "Broad market"),
    ("NIFTY 100", "^CNX100", "NSE:CNX100", "NIFTY 100", "Broad market"),
    ("NIFTY 500", "^CRSLDX", "NSE:CNX500", "NIFTY 500", "Broad market"),
    ("NIFTY MIDCAP 50", "^NSEMDCP50", "NSE:NIFTYMIDCAP50", "NIFTY MIDCAP 50", "Broad market"),
    ("NIFTY MIDCAP 100", "NIFTY_MIDCAP_100.NS", "NSE:CNXMIDCAP", "NIFTY MIDCAP 100", "Broad market"),
    ("NIFTY MIDCAP 150", "NIFTYMIDCAP150.NS", "NSE:NIFTYMIDCAP150", "NIFTY MIDCAP 150", "Broad market"),
    ("NIFTY SMALLCAP 100", "^CNXSC", "NSE:CNXSMALLCAP", "NIFTY SMLCAP 100", "Broad market"),
    ("NIFTY SMALLCAP 250", "NIFTYSMLCAP250.NS", "NSE:NIFTYSMLCAP250", "NIFTY SMLCAP 250", "Broad market"),
    ("INDIA VIX", "^INDIAVIX", "NSE:INDIAVIX", "INDIA VIX", "Broad market"),
    ("NIFTY BANK", "^NSEBANK", "NSE:BANKNIFTY", "NIFTY BANK", "Sectoral"),
    ("NIFTY PVT BANK", "NIFTY_PVT_BANK.NS", "NSE:NIFTY_PVT_BANK", "NIFTY PVT BANK", "Sectoral"),
    ("NIFTY PSU BANK", "^CNXPSUBANK", "NSE:CNXPSUBANK", "NIFTY PSU BANK", "Sectoral"),
    ("NIFTY FIN SERVICE", "NIFTY_FIN_SERVICE.NS", "NSE:CNXFINANCE", "NIFTY FIN SERVICE", "Sectoral"),
    ("NIFTY IT", "^CNXIT", "NSE:CNXIT", "NIFTY IT", "Sectoral"),
    ("NIFTY AUTO", "^CNXAUTO", "NSE:CNXAUTO", "NIFTY AUTO", "Sectoral"),
    ("NIFTY PHARMA", "^CNXPHARMA", "NSE:CNXPHARMA", "NIFTY PHARMA", "Sectoral"),
    ("NIFTY HEALTHCARE", "NIFTY_HEALTHCARE.NS", "NSE:NIFTY_HEALTHCARE", "NIFTY HEALTHCARE", "Sectoral"),
    ("NIFTY FMCG", "^CNXFMCG", "NSE:CNXFMCG", "NIFTY FMCG", "Sectoral"),
    ("NIFTY CONSUMPTION", "^CNXCONSUM", "NSE:CNXCONSUMPTION", "NIFTY CONSUMPTION", "Sectoral"),
    ("NIFTY METAL", "^CNXMETAL", "NSE:CNXMETAL", "NIFTY METAL", "Sectoral"),
    ("NIFTY ENERGY", "^CNXENERGY", "NSE:CNXENERGY", "NIFTY ENERGY", "Sectoral"),
    ("NIFTY OIL & GAS", "NIFTY_OIL_AND_GAS.NS", "NSE:NIFTY_OIL_AND_GAS", "NIFTY OIL AND GAS", "Sectoral"),
    ("NIFTY INFRA", "^CNXINFRA", "NSE:CNXINFRA", "NIFTY INFRA", "Sectoral"),
    ("NIFTY REALTY", "^CNXREALTY", "NSE:CNXREALTY", "NIFTY REALTY", "Sectoral"),
    ("NIFTY MEDIA", "^CNXMEDIA", "NSE:CNXMEDIA", "NIFTY MEDIA", "Sectoral"),
    ("NIFTY PSE", "^CNXPSE", "NSE:CNXPSE", "NIFTY PSE", "Sectoral"),
    ("NIFTY MNC", "^CNXMNC", "NSE:CNXMNC", "NIFTY MNC", "Sectoral"),
    ("NIFTY COMMODITIES", "^CNXCMDT", "NSE:CNXCOMMODITIES", "NIFTY COMMODITIES", "Sectoral"),
    ("NIFTY SERVICES", "^CNXSERVICE", "NSE:CNXSERVICE", "NIFTY SERV SECTOR", "Sectoral"),
    ("NIFTY INDIA DEFENCE", "NIFTY_IND_DEFENCE.NS", "NSE:NIFTY_IND_DEFENCE", "NIFTY IND DEFENCE", "Sectoral"),
]

_cache: tuple[float, list] | None = None
TTL = 45
_pool = ThreadPoolExecutor(max_workers=8)


def _fetch(entry) -> dict:
    name, ysym, tv, kite_sym, group = entry
    out = {"name": name, "tv": tv, "kite_symbol": kite_sym, "group": group, "last": None, "close": None, "spark": []}
    try:
        r = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(ysym)}",
                         params={"range": "1d", "interval": "15m"}, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        if r.status_code != 200:
            return out
        res = r.json()["chart"]["result"][0]
        m = res["meta"]
        out["last"] = m.get("regularMarketPrice")
        out["close"] = m.get("chartPreviousClose") or m.get("previousClose")
        out["ts"] = m.get("regularMarketTime")
        closes = (res.get("indicators", {}).get("quote") or [{}])[0].get("close") or []
        out["spark"] = [c for c in closes if c is not None][-40:]
        out["high"] = m.get("regularMarketDayHigh"); out["low"] = m.get("regularMarketDayLow")
        out["year_high"] = m.get("fiftyTwoWeekHigh"); out["year_low"] = m.get("fiftyTwoWeekLow")
    except Exception:
        pass
    return out


def all_indices(force: bool = False) -> list[dict]:
    global _cache
    now = time.time()
    if _cache and not force and now - _cache[0] < TTL:
        return _cache[1]
    rows = list(_pool.map(_fetch, INDICES))
    _cache = (now, rows)
    return rows
