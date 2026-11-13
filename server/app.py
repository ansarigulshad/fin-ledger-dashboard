from __future__ import annotations

import html
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import browsers, caps, demo, indices, kite, store, watchlist

DEMO = os.environ.get("DEMO") == "1"
CACHE_TTL = float(os.environ.get("CACHE_TTL", "20"))
WEB = Path(__file__).resolve().parent.parent / "web"

app = FastAPI(title="Family Kite Dashboard")
_cache: dict[str, tuple[float, dict]] = {}
_pool = ThreadPoolExecutor(max_workers=8)


# ---------------------------------------------------------------- helpers
def _accounts() -> list[dict]:
    return demo.DEMO_ACCOUNTS if DEMO else store.list_accounts()


def _account(acc_id: str) -> dict:
    acc = next((a for a in _accounts() if a["id"] == acc_id), None)
    if not acc:
        raise HTTPException(404, "Unknown account")
    return acc


def _status(acc: dict) -> dict:
    if DEMO:
        return {**acc, "has_password": True, "has_totp_secret": True, "has_api": True, "logged_in": True, "session_kind": "kc"}
    pub = store.public_account(acc)
    sess = store.get_session(acc["id"])
    pub["logged_in"] = bool(sess)
    pub["session_kind"] = sess["kind"] if sess else None
    return pub


def _session_for(acc: dict) -> kite.KiteSession | None:
    sess = store.get_session(acc["id"])
    if not sess:
        return None
    return kite.KiteSession(sess["kind"], sess["token"], acc.get("api_key"))


def _fetch(acc: dict, force: bool = False) -> dict:
    """Snapshot for one account; cached for CACHE_TTL seconds."""
    now = time.time()
    hit = _cache.get(acc["id"])
    if hit and not force and now - hit[0] < CACHE_TTL:
        return hit[1]
    if DEMO:
        snap = demo.snapshot(acc)
    else:
        ks = _session_for(acc)
        if not ks:
            return {"error": "not_logged_in"}
        try:
            snap = ks.snapshot()
        except kite.KiteError as e:
            if e.error_type == "TokenException" or e.status in (401, 403):
                store.set_session(acc["id"], None, None, now)
                _cache.pop(acc["id"], None)
                return {"error": "session_expired", "message": str(e)}
            return {"error": "kite_error", "message": str(e)}
        except Exception as e:  # network etc.
            return {"error": "network", "message": str(e)}
    snap = {**snap, "account": _status(acc)}
    _cache[acc["id"]] = (now, snap)
    return snap


def _store_session(acc: dict, kind: str, token: str) -> None:
    store.set_session(acc["id"], kind, token, time.time())
    _cache.pop(acc["id"], None)


# ---------------------------------------------------------------- models
class AccountIn(BaseModel):
    id: str | None = None
    name: str | None = None
    user_id: str | None = None
    password: str | None = None
    totp_secret: str | None = None
    api_key: str | None = None
    api_secret: str | None = None
    browser_profile: str | None = None
    color: int | None = None
    clear_totp_secret: bool = False
    clear_password: bool = False
    clear_api_key: bool = False
    clear_api_secret: bool = False


class LoginIn(BaseModel):
    totp: str | None = None
    enctoken: str | None = None


class OrderIn(BaseModel):
    ids: list[str]


class WatchIn(BaseModel):
    symbol: str
    exchange: str = "NSE"
    name: str = ""
    note: str = ""


class NoteIn(BaseModel):
    note: str = ""


# ---------------------------------------------------------------- routes: config/accounts
@app.get("/api/config")
def config(request: Request):
    return {"demo": DEMO, "cache_ttl": CACHE_TTL,
            "redirect_url": str(request.base_url).rstrip("/") + "/api/kc/callback"}


@app.get("/api/accounts")
def accounts():
    return [_status(a) for a in _accounts()]


@app.post("/api/accounts")
def save_account(body: AccountIn):
    if DEMO:
        raise HTTPException(400, "Accounts cannot be edited in demo mode")
    if not body.id and not body.user_id:
        raise HTTPException(400, "user_id is required")
    rec = store.upsert_account(body.model_dump())
    return _status(rec)


@app.delete("/api/accounts/{acc_id}")
def remove_account(acc_id: str):
    if DEMO:
        raise HTTPException(400, "Demo mode")
    store.delete_account(acc_id)
    _cache.pop(acc_id, None)
    return {"ok": True}


@app.post("/api/accounts/order")
def reorder(body: OrderIn):
    if not DEMO:
        store.reorder_accounts(body.ids)
    return {"ok": True}


# ---------------------------------------------------------------- routes: login
@app.get("/api/accounts/{acc_id}/kc_login")
def kc_login(acc_id: str):
    """Redirects the browser to Kite Connect's login page for this account's app."""
    acc = _account(acc_id)
    if DEMO:
        return RedirectResponse(f"/api/kc/callback?acc={acc_id}&status=success&request_token=demo")
    if not acc.get("api_key"):
        raise HTTPException(400, "No Kite Connect API key saved for this account")
    return RedirectResponse(kite.kc_login_url(acc["api_key"], {"acc": acc_id}))


@app.get("/api/caps")
def get_caps():
    """Market-cap bucket + industry for NSE symbols (from NSE index lists)."""
    return caps.cap_map()


@app.get("/api/indices")
def get_indices(force: bool = False):
    rows = indices.all_indices(force)
    for r in rows:  # Kite instrument token so the chart overlay can link to Kite's own chart
        tok = (watchlist.lookup(r["kite_symbol"]) or {}).get("instrument_token") if r.get("kite_symbol") else None
        r["instrument_token"] = tok
    return {"items": rows, "generated_at": time.time()}


@app.get("/api/browser/profiles")
def browser_profiles():
    return browsers.profiles()


@app.post("/api/accounts/{acc_id}/kc_launch")
def kc_launch(acc_id: str, request: Request):
    """Open this account's Kite Connect login in its configured browser profile (server-side launch)."""
    acc = _account(acc_id)
    prof = acc.get("browser_profile")
    if not prof:
        raise HTTPException(400, "No browser profile set for this account")
    url = str(request.base_url).rstrip("/") + f"/api/accounts/{acc_id}/kc_login"
    try:
        browsers.launch(prof, url)
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@app.post("/api/accounts/{acc_id}/open_kite")
def open_kite(acc_id: str):
    """Open kite.zerodha.com in this account's configured browser profile (server-side launch)."""
    acc = _account(acc_id)
    prof = acc.get("browser_profile")
    if not prof:
        raise HTTPException(400, "No browser profile set for this account")
    try:
        browsers.launch(prof, "https://kite.zerodha.com/")
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


def _callback_page(ok: bool, title: str, detail: str = "", acc_id: str = "") -> HTMLResponse:
    body = f"""<!doctype html><meta charset="utf-8"><title>{html.escape(title)}</title>
<style>body{{font:15px/1.5 -apple-system,system-ui,sans-serif;background:#0f100e;color:#efece4;display:grid;place-items:center;height:100vh;margin:0}}
.c{{text-align:center;max-width:420px;padding:24px}}h1{{font-weight:400;font-size:26px;margin:0 0 8px;color:{'#3fcf7f' if ok else '#ff6b6b'}}}p{{color:#b9b5a9}}a{{color:#e8b24a}}</style>
<div class="c"><h1>{html.escape(title)}</h1><p>{html.escape(detail)}</p><p><a href="/#a={html.escape(acc_id or 'all')}">Back to the dashboard</a></p></div>
<script>
try {{ if (window.opener) {{ window.opener.postMessage({{type:'kc-login', ok:{str(ok).lower()}, acc:{acc_id!r}, message:{detail!r}}}, '*'); setTimeout(() => window.close(), {600 if ok else 4000}); }} }} catch (e) {{}}
</script>"""
    return HTMLResponse(body)


@app.get("/api/kc/callback")
def kc_callback(request_token: str | None = None, status: str | None = None, acc: str | None = None,
                action: str | None = None):
    """Kite Connect redirects here after the user logs in."""
    if DEMO:
        return _callback_page(True, "Logged in (demo)", "", acc or "")
    if status != "success" or not request_token:
        return _callback_page(False, "Login was not completed", f"Kite returned status={status!r}.", acc or "")
    candidates = [a for a in _accounts() if a.get("api_key") and a.get("api_secret")]
    if acc:
        candidates = [a for a in candidates if a["id"] == acc] + [a for a in candidates if a["id"] != acc]
    last_err = "No account has Kite Connect credentials saved."
    for a in candidates:
        try:
            sess = kite.kc_exchange(a["api_key"], a["api_secret"], request_token)
        except kite.KiteError as e:
            last_err = str(e)
            continue
        uid = (sess.get("user_id") or "").upper()
        if a.get("user_id") and uid and uid != a["user_id"].upper():
            return _callback_page(False, "Wrong Kite user",
                                  f"This app belongs to {a['name']} ({a['user_id']}) but Kite logged in {uid}. "
                                  "Log out of Kite in this browser and try again.", a["id"])
        _store_session(a, "kc", sess["access_token"])
        return _callback_page(True, f"{a['name']} is logged in", "You can close this window.", a["id"])
    return _callback_page(False, "Could not create a session", last_err, acc or "")


@app.post("/api/accounts/{acc_id}/login")
def login(acc_id: str, body: LoginIn):
    """Manual paths: pasted enctoken, or password + TOTP (may be blocked by Kite's CAPTCHA)."""
    acc = _account(acc_id)
    if DEMO:
        return {"ok": True}
    try:
        if body.enctoken:
            tok = body.enctoken.strip()
            kite.KiteSession("enc", tok).profile()  # validate before saving
        else:
            if not acc.get("password"):
                raise HTTPException(400, "No password saved for this account — use Kite Connect or paste an enctoken")
            tok = kite.web_login(acc["user_id"], acc["password"], totp_value=(body.totp or "").strip() or None,
                                 totp_secret=acc.get("totp_secret"))
    except kite.KiteError as e:
        msg = str(e)
        if "CAPTCHA" in msg.upper():
            msg += " — Kite blocks scripted password logins; use Kite Connect login or paste an enctoken instead."
        raise HTTPException(401 if e.error_type in ("TwoFARequired", "TokenException") else 400,
                            {"error_type": e.error_type, "message": msg})
    _store_session(acc, "enc", tok)
    return {"ok": True}


@app.post("/api/accounts/{acc_id}/logout")
def logout(acc_id: str):
    store.set_session(acc_id, None, None, time.time())
    _cache.pop(acc_id, None)
    return {"ok": True}


# ---------------------------------------------------------------- routes: data
@app.get("/api/accounts/{acc_id}/snapshot")
def snapshot(acc_id: str, force: bool = False):
    return _fetch(_account(acc_id), force)


@app.get("/api/overview")
def overview(force: bool = False):
    accs = _accounts()
    snaps = list(_pool.map(lambda a: _fetch(a, force), accs))
    return {"generated_at": time.time(),
            "accounts": [{**_status(a), "snapshot": s} for a, s in zip(accs, snaps)]}


# ---------------------------------------------------------------- routes: watchlist
def _watchlist_view() -> dict:
    items = watchlist.load()
    accs = _accounts()
    # who holds what (from cached snapshots; never forces a refetch)
    holders: dict[str, list] = {}
    holdings_by_symbol: dict[str, dict] = {}
    sessions: list[kite.KiteSession] = []
    for a in accs:
        snap = _fetch(a)
        if snap.get("error"):
            continue
        if not DEMO:
            ks = _session_for(a)
            if ks:
                sessions.append(ks)
        for h in snap.get("holdings", []):
            q = (h.get("quantity") or 0) + (h.get("t1_quantity") or 0) + (h.get("collateral_quantity") or 0)
            if q <= 0:
                continue
            holdings_by_symbol.setdefault(h["tradingsymbol"], h)
            holders.setdefault(h["tradingsymbol"], []).append({
                "id": a["id"], "name": a["name"], "color": a.get("color", 1), "qty": q,
                "avg": h["average_price"], "pnl": q * (h["last_price"] - h["average_price"])})
    if DEMO:
        qs = {f"{it['exchange']}:{it['symbol']}": demo.quote(it["symbol"], holdings_by_symbol.get(it["symbol"])) for it in items}
    else:
        qs = watchlist.quotes(items, holdings_by_symbol, sessions)
    out = []
    for it in items:
        key = f"{it['exchange']}:{it['symbol']}"
        q = qs.get(key) or {}
        tok = (holdings_by_symbol.get(it["symbol"]) or {}).get("instrument_token") or (watchlist.lookup(it["symbol"]) or {}).get("instrument_token")
        out.append({**it, **q, "instrument_token": tok, "holders": holders.get(it["symbol"], [])})
    return {"items": out, "generated_at": time.time()}


@app.get("/api/watchlist")
def get_watchlist():
    return _watchlist_view()


@app.post("/api/watchlist")
def add_watch(body: WatchIn):
    if not body.symbol.strip():
        raise HTTPException(400, "symbol required")
    watchlist.add(body.symbol, body.exchange, body.name, body.note)
    return _watchlist_view()


@app.delete("/api/watchlist/{exchange}/{symbol}")
def del_watch(exchange: str, symbol: str):
    watchlist.remove(symbol, exchange)
    return _watchlist_view()


@app.put("/api/watchlist/{exchange}/{symbol}")
def note_watch(exchange: str, symbol: str, body: NoteIn):
    watchlist.set_note(symbol, exchange, body.note.strip())
    return _watchlist_view()


@app.get("/api/instruments/lookup")
def instruments_lookup(symbol: str):
    return watchlist.lookup(symbol) or {}


@app.get("/api/instruments/search")
def instruments_search(q: str = ""):
    return watchlist.search(q)


@app.post("/api/shutdown")
def shutdown():
    """Stop the local server (used by the dashboard's Stop button and the Desktop launcher)."""
    import threading
    threading.Timer(0.4, lambda: os._exit(0)).start()
    return {"ok": True}


# ---------------------------------------------------------------- static
@app.get("/")
def index():
    html_text = (WEB / "index.html").read_text()
    for f in ("app.js", "styles.css"):
        v = int((WEB / f).stat().st_mtime)
        html_text = html_text.replace(f"/static/{f}", f"/static/{f}?v={v}")
    return HTMLResponse(html_text, headers={"Cache-Control": "no-store"})


app.mount("/static", StaticFiles(directory=WEB), name="static")
