"""Historical statements imported from Zerodha Console: the funds LEDGER and the TRADEBOOK.

Storage model (per account, under data/history/<account id>/):
  ledger.json  {"rows": [...], "archived": ["FY2020-21", ...], "imports": [...]}
  trades.json  same shape

Import rules (what the user asked for):
  * The first upload is the full history.
  * Later uploads cover the current financial year (1 April -> today) and may repeat rows already
    stored. An upload REPLACES every stored row that falls inside the uploaded file's date range,
    so re-uploading the current FY refreshes it cleanly.
  * A financial year that has ended is ARCHIVED after it has been imported once: later uploads never
    delete or alter its rows unless the import is run with replace_archived=True.
Financial year: 1 April -> 31 March, labelled "FY2024-25".
"""
from __future__ import annotations

import csv
import io
import json
import re
import threading
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from . import store

_lock = threading.Lock()


# ---------------------------------------------------------------- helpers
def fy_of(d: date) -> str:
    y = d.year if d.month >= 4 else d.year - 1
    return f"FY{y}-{str(y + 1)[2:]}"


def fy_end(fy: str) -> date:
    y = int(fy[2:6])
    return date(y + 1, 3, 31)


def fy_start_of_today() -> date:
    t = date.today()
    return date(t.year if t.month >= 4 else t.year - 1, 4, 1)


def _parse_date(s: str) -> date | None:
    s = (s or "").strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s[:19] if " " in s else s, fmt).date()
        except ValueError:
            continue
    return None


def _f(x) -> float:
    try:
        return float(str(x).replace(",", "").strip() or 0)
    except ValueError:
        return 0.0


def _dir(acc_id: str) -> Path:
    return store.DATA_DIR / "history" / acc_id


def _load(acc_id: str, kind: str) -> dict:
    p = _dir(acc_id) / f"{kind}.json"
    if p.exists():
        with p.open() as f:
            return json.load(f)
    return {"rows": [], "archived": [], "imports": []}


def _save(acc_id: str, kind: str, doc: dict) -> None:
    d = _dir(acc_id)
    d.mkdir(parents=True, exist_ok=True)
    store._write(d / f"{kind}.json", doc)


# ---------------------------------------------------------------- CSV detection + parsing
LEDGER_COLS = {"particulars", "posting_date", "voucher_type", "debit", "credit"}
TRADE_COLS = {"symbol", "trade_date", "trade_type", "quantity", "price"}


def detect(text: str) -> str | None:
    head = text.lstrip("﻿")[:2000].splitlines()[0].lower() if text.strip() else ""
    cols = {c.strip().strip('"') for c in head.split(",")}
    if LEDGER_COLS <= cols:
        return "ledger"
    if TRADE_COLS <= cols:
        return "trades"
    return None


# classification of ledger rows by their 'particulars' text
LEDGER_RULES = [
    ("deposit", re.compile(r"^Funds added", re.I)),
    ("withdrawal", re.compile(r"^(Instant )?Payout of|^Funds transferred back|^Funds auto-settled", re.I)),
    ("equity", re.compile(r"^Net settlement", re.I)),
    ("fno", re.compile(r"^Net obligation for", re.I)),
    ("margin", re.compile(r"margin (blocked|reversed)", re.I)),
    ("charge:dp", re.compile(r"^DP Charges", re.I)),
    ("charge:amc", re.compile(r"^AMC for", re.I)),
    ("charge:gateway", re.compile(r"payment gateway charges", re.I)),
    ("charge:interest", re.compile(r"^Delayed payment charges", re.I)),
    ("charge:pledge", re.compile(r"pledge charges", re.I)),
    ("charge:penalty", re.compile(r"penalty|excess collateral", re.I)),
    ("charge:tax", re.compile(r"^(Securities Transaction Tax|STT |Stamp Duty|SEBI turnover)", re.I)),
    ("charge:brokerage", re.compile(r"Brokerage", re.I)),
    ("charge:other", re.compile(r"^Charges for|^Being .*charges", re.I)),
    ("opening", re.compile(r"^(Opening|Closing) Balance", re.I)),
]


def _segment(cost_center: str) -> str:
    cc = (cost_center or "").upper()
    if "CDS" in cc:
        return "Currency F&O"
    if "MCX" in cc:
        return "MCX"
    if "F&O" in cc or "FO" in cc:
        return "Equity F&O"
    return "Equity"


def parse_ledger(text: str) -> list[dict]:
    rows = []
    for r in csv.DictReader(io.StringIO(text.lstrip("﻿"))):
        d = _parse_date(r.get("posting_date", ""))
        if not d:
            continue  # opening/closing balance lines have no date
        part = (r.get("particulars") or "").strip()
        kind = "other"
        for k, rx in LEDGER_RULES:
            if rx.search(part):
                kind = k
                break
        debit, credit = _f(r.get("debit")), _f(r.get("credit"))
        rows.append({
            "date": d.isoformat(), "fy": fy_of(d), "particulars": part, "segment": _segment(r.get("cost_center", "")),
            "voucher": (r.get("voucher_type") or "").strip(), "debit": debit, "credit": credit,
            "amount": round(credit - debit, 6), "balance": _f(r.get("net_balance")), "kind": kind,
        })
    return rows


def parse_trades(text: str) -> list[dict]:
    rows = []
    for r in csv.DictReader(io.StringIO(text.lstrip("﻿"))):
        d = _parse_date(r.get("trade_date", ""))
        if not d:
            continue
        rows.append({
            "date": d.isoformat(), "fy": fy_of(d), "symbol": (r.get("symbol") or "").strip().upper(),
            "isin": (r.get("isin") or "").strip(), "exchange": (r.get("exchange") or "").strip(),
            "segment": (r.get("segment") or "").strip(), "series": (r.get("series") or "").strip(),
            "side": (r.get("trade_type") or "").strip().lower(), "qty": _f(r.get("quantity")), "price": _f(r.get("price")),
            "trade_id": (r.get("trade_id") or "").strip(), "order_id": (r.get("order_id") or "").strip(),
            "time": (r.get("order_execution_time") or "").strip(),
        })
    return rows


def _row_key(kind: str, r: dict) -> str:
    if kind == "trades" and r.get("trade_id"):
        return "t:" + r["trade_id"]
    return "|".join(str(r.get(k, "")) for k in ("date", "particulars", "debit", "credit", "balance", "symbol", "qty", "price", "time"))


# ---------------------------------------------------------------- import
def preview(acc_id: str, kind: str, rows: list[dict]) -> dict:
    """What an import would do, without doing it."""
    doc = _load(acc_id, kind)
    if not rows:
        return {"rows": 0}
    dates = sorted(r["date"] for r in rows)
    lo, hi = dates[0], dates[-1]
    fys = sorted({r["fy"] for r in rows})
    archived = set(doc.get("archived", []))
    existing_in_range = [r for r in doc["rows"] if lo <= r["date"] <= hi]
    return {
        "rows": len(rows), "from": lo, "to": hi, "fys": fys,
        "fys_archived": [f for f in fys if f in archived],
        "fys_new": [f for f in fys if f not in archived],
        "replaces": len(existing_in_range), "stored_rows": len(doc["rows"]),
    }


def import_rows(acc_id: str, kind: str, rows: list[dict], filename: str = "", replace_archived: bool = False) -> dict:
    with _lock:
        doc = _load(acc_id, kind)
        if not rows:
            return {"added": 0, "removed": 0, "total": len(doc["rows"])}
        dates = sorted(r["date"] for r in rows)
        lo, hi = dates[0], dates[-1]
        archived = set(doc.get("archived", []))
        protected = set() if replace_archived else archived
        # drop stored rows inside the uploaded range, except rows of protected (archived) FYs
        before = len(doc["rows"])
        kept = [r for r in doc["rows"] if not (lo <= r["date"] <= hi) or r["fy"] in protected]
        removed = before - len(kept)
        incoming = [r for r in rows if r["fy"] not in protected]
        skipped = len(rows) - len(incoming)
        # de-duplicate against what we keep (covers overlapping partial uploads)
        seen = {_row_key(kind, r) for r in kept}
        added = []
        for r in incoming:
            k = _row_key(kind, r)
            if k not in seen:
                seen.add(k)
                added.append(r)
        new_rows = sorted(kept + added, key=lambda r: (r["date"], r.get("time", "")))
        # archive every FY that has ended and now has data
        today = date.today()
        for fy in {r["fy"] for r in new_rows}:
            if fy_end(fy) < today:
                archived.add(fy)
        doc["rows"] = new_rows
        doc["archived"] = sorted(archived)
        doc.setdefault("imports", []).append({"at": datetime.now().isoformat(timespec="seconds"), "file": filename,
                                              "rows": len(rows), "from": lo, "to": hi, "added": len(added),
                                              "removed": removed, "skipped_archived": skipped})
        doc["imports"] = doc["imports"][-50:]
        _save(acc_id, kind, doc)
        return {"added": len(added), "removed": removed, "skipped_archived": skipped, "total": len(new_rows),
                "archived": doc["archived"]}


def status(acc_id: str) -> dict:
    out = {}
    for kind in ("ledger", "trades"):
        doc = _load(acc_id, kind)
        rows = doc["rows"]
        by_fy = defaultdict(int)
        for r in rows:
            by_fy[r["fy"]] += 1
        out[kind] = {"rows": len(rows), "from": rows[0]["date"] if rows else None, "to": rows[-1]["date"] if rows else None,
                     "fys": [{"fy": fy, "rows": n, "archived": fy in doc.get("archived", [])} for fy, n in sorted(by_fy.items())],
                     "last_import": doc.get("imports", [])[-1] if doc.get("imports") else None}
    return out


# ---------------------------------------------------------------- analytics: ledger
def xirr(flows: list[tuple[date, float]]) -> float | None:
    """Annualised IRR for dated cash flows (negative = money in, positive = money out). Bisection, robust."""
    flows = [(d, a) for d, a in flows if a]
    if len(flows) < 2 or not any(a < 0 for _, a in flows) or not any(a > 0 for _, a in flows):
        return None
    t0 = min(d for d, _ in flows)
    yrs = [((d - t0).days / 365.0, a) for d, a in flows]

    def npv(r):
        return sum(a / (1 + r) ** t for t, a in yrs)

    lo, hi = -0.99, 10.0
    f_lo, f_hi = npv(lo), npv(hi)
    if f_lo * f_hi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv(mid)
        if abs(f_mid) < 1e-6:
            break
        if f_lo * f_mid < 0:
            hi, f_hi = mid, f_mid
        else:
            lo, f_lo = mid, f_mid
    return round(mid * 100, 2)


def ledger_summary(acc_id: str, current_value: float | None) -> dict:
    rows = _load(acc_id, "ledger")["rows"]
    if not rows:
        return {"empty": True}
    dep = wd = 0.0
    monthly = defaultdict(lambda: {"in": 0.0, "out": 0.0})
    yearly = defaultdict(lambda: {"in": 0.0, "out": 0.0, "fno": 0.0, "charges": 0.0, "equity_buy": 0.0, "equity_sell": 0.0})
    fno_month = defaultdict(lambda: defaultdict(float))  # segment -> month -> pnl
    fno_total = defaultdict(float)
    fno_days = defaultdict(lambda: {"win": 0, "loss": 0})
    charges = defaultdict(float)
    flows: list[tuple[date, float]] = []
    balance_series = []
    last_month = None
    first_date = rows[0]["date"]
    for r in rows:
        d = date.fromisoformat(r["date"])
        m = r["date"][:7]
        fy = r["fy"]
        k = r["kind"]
        if k == "deposit":
            dep += r["credit"]; monthly[m]["in"] += r["credit"]; yearly[fy]["in"] += r["credit"]
            flows.append((d, -r["credit"]))
        elif k == "withdrawal":
            wd += r["debit"]; monthly[m]["out"] += r["debit"]; yearly[fy]["out"] += r["debit"]
            flows.append((d, r["debit"]))
        elif k == "fno":
            seg = r["segment"]
            fno_month[seg][m] += r["amount"]; fno_total[seg] += r["amount"]; yearly[fy]["fno"] += r["amount"]
            fno_days[seg]["win" if r["amount"] > 0 else "loss"] += 1
        elif k.startswith("charge"):
            charges[k.split(":")[1]] += r["debit"] - r["credit"]; yearly[fy]["charges"] += r["debit"] - r["credit"]
        elif k == "equity":
            if r["debit"]:
                yearly[fy]["equity_buy"] += r["debit"]
            else:
                yearly[fy]["equity_sell"] += r["credit"]
        if m != last_month:  # one balance point per month (last entry of the month wins below)
            last_month = m
        balance_series.append((m, r["balance"]))
    # month-end balance
    bal = {}
    for m, b in balance_series:
        bal[m] = b
    neg_months = sum(1 for b in bal.values() if b < 0)
    net_in = dep - wd
    result = {
        "from": first_date, "to": rows[-1]["date"], "rows": len(rows),
        "deposits": round(dep, 2), "withdrawals": round(wd, 2), "net_invested": round(net_in, 2),
        "monthly": [{"month": m, **{kk: round(v, 2) for kk, v in vv.items()}} for m, vv in sorted(monthly.items())],
        "yearly": [{"fy": fy, **{kk: round(v, 2) for kk, v in vv.items()}} for fy, vv in sorted(yearly.items())],
        "fno": {seg: {"total": round(v, 2), "days": fno_days[seg],
                      "monthly": [{"month": m, "pnl": round(p, 2)} for m, p in sorted(fno_month[seg].items())]}
                for seg, v in fno_total.items()},
        "fno_total": round(sum(fno_total.values()), 2),
        "charges": {k: round(v, 2) for k, v in sorted(charges.items(), key=lambda x: -x[1])},
        "charges_total": round(sum(charges.values()), 2),
        "balance": [{"month": m, "balance": round(b, 2)} for m, b in sorted(bal.items())],
        "negative_months": neg_months,
        "current_value": current_value,
    }
    if current_value is not None:
        all_flows = flows + [(date.today(), current_value)]
        result["xirr"] = xirr(all_flows)
        result["absolute_gain"] = round(current_value - net_in, 2)
        yrs = max((date.today() - date.fromisoformat(first_date)).days / 365.0, 0.01)
        result["years"] = round(yrs, 2)
        if net_in > 0 and current_value > 0:
            result["simple_cagr"] = round(((current_value / net_in) ** (1 / yrs) - 1) * 100, 2)
    return result


# ---------------------------------------------------------------- analytics: trades (FIFO realised P&L)
def trades_summary(acc_id: str) -> dict:
    rows = _load(acc_id, "trades")["rows"]
    if not rows:
        return {"empty": True}
    rows = sorted(rows, key=lambda r: (r["date"], r.get("time", "")))
    lots: dict[str, list[list[float]]] = defaultdict(list)  # symbol -> [[qty, price, date]]
    realised: list[dict] = []
    per_symbol = defaultdict(lambda: {"buys": 0.0, "sells": 0.0, "buy_qty": 0.0, "sell_qty": 0.0, "realised": 0.0, "trades": 0, "first": None, "last": None, "open_qty": 0.0, "open_cost": 0.0})
    monthly = defaultdict(lambda: {"trades": 0, "buy": 0.0, "sell": 0.0, "realised": 0.0})
    yearly = defaultdict(lambda: {"trades": 0, "buy": 0.0, "sell": 0.0, "realised": 0.0, "wins": 0, "losses": 0})
    hold_days = []
    for t in rows:
        s, q, p, d, m, fy = t["symbol"], t["qty"], t["price"], t["date"], t["date"][:7], t["fy"]
        ps = per_symbol[s]
        ps["trades"] += 1; ps["first"] = ps["first"] or d; ps["last"] = d
        monthly[m]["trades"] += 1; yearly[fy]["trades"] += 1
        if t["side"] == "buy":
            lots[s].append([q, p, d]); ps["buys"] += q * p; ps["buy_qty"] += q
            monthly[m]["buy"] += q * p; yearly[fy]["buy"] += q * p
        else:
            ps["sells"] += q * p; ps["sell_qty"] += q
            monthly[m]["sell"] += q * p; yearly[fy]["sell"] += q * p
            remaining, cost, pnl = q, 0.0, 0.0
            while remaining > 1e-9 and lots[s]:
                lot = lots[s][0]
                take = min(remaining, lot[0])
                cost += take * lot[1]; pnl += take * (p - lot[1]); remaining -= take; lot[0] -= take
                hold_days.append((date.fromisoformat(d) - date.fromisoformat(lot[2])).days)
                if lot[0] <= 1e-9:
                    lots[s].pop(0)
            if remaining > 1e-9:  # sold more than we have on record (pre-history buys / transfers) -> cost unknown
                pnl += 0
            realised.append({"date": d, "fy": fy, "symbol": s, "qty": q, "price": p, "cost": round(cost, 2), "pnl": round(pnl, 2)})
            ps["realised"] += pnl; monthly[m]["realised"] += pnl; yearly[fy]["realised"] += pnl
            yearly[fy]["wins" if pnl >= 0 else "losses"] += 1
    for s, ls in lots.items():
        per_symbol[s]["open_qty"] = sum(l[0] for l in ls)
        per_symbol[s]["open_cost"] = sum(l[0] * l[1] for l in ls)
    symbols = [{"symbol": s, **{k: (round(v, 2) if isinstance(v, float) else v) for k, v in d.items()}} for s, d in per_symbol.items()]
    symbols.sort(key=lambda x: -abs(x["realised"]))
    total_real = sum(r["pnl"] for r in realised)
    wins = sum(1 for r in realised if r["pnl"] >= 0)
    return {
        "from": rows[0]["date"], "to": rows[-1]["date"], "trades": len(rows), "symbols": len(per_symbol),
        "realised_total": round(total_real, 2), "sell_count": len(realised), "win_rate": round(wins / len(realised) * 100, 1) if realised else None,
        "avg_hold_days": round(sum(hold_days) / len(hold_days), 1) if hold_days else None,
        "best": sorted(symbols, key=lambda x: -x["realised"])[:5], "worst": sorted(symbols, key=lambda x: x["realised"])[:5],
        "by_symbol": symbols,
        "monthly": [{"month": m, **{k: round(v, 2) for k, v in vv.items()}} for m, vv in sorted(monthly.items())],
        "yearly": [{"fy": fy, **{k: round(v, 2) for k, v in vv.items()}} for fy, vv in sorted(yearly.items())],
        "recent": realised[-50:][::-1],
    }
