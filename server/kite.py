"""
Kite client supporting two session kinds:

  kc   Official Kite Connect (free "Personal" app per Zerodha account).
       Login happens in the browser; we exchange the request_token for an access_token.
       Base: https://api.kite.trade   Auth: "token <api_key>:<access_token>"

  enc  The kite.zerodha.com web session (enctoken cookie) — pasted from a logged-in tab,
       or obtained via /api/login + /api/twofa (TOTP).  Zerodha now often puts a CAPTCHA
       in front of that endpoint, so automated password login may fail.
       Base: https://kite.zerodha.com/oms   Auth: "enctoken <token>"

Both return identical JSON shapes for holdings/positions/margins/orders/mf.
"""
from __future__ import annotations

import hashlib
import time
from typing import Any
from urllib.parse import urlencode

import pyotp
import requests

KITE_WEB = "https://kite.zerodha.com"
KITE_API = "https://api.kite.trade"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
BASE_HEADERS = {"X-Kite-Version": "3", "User-Agent": UA}


class KiteError(Exception):
    def __init__(self, message: str, error_type: str = "GeneralException", status: int = 400):
        super().__init__(message)
        self.error_type = error_type
        self.status = status


def _unwrap(resp: requests.Response) -> Any:
    try:
        body = resp.json()
    except ValueError:
        raise KiteError(f"Kite returned a non-JSON response (HTTP {resp.status_code})", status=resp.status_code)
    if body.get("status") != "success":
        raise KiteError(body.get("message", "Unknown Kite error"),
                        body.get("error_type", "GeneralException"), resp.status_code)
    return body.get("data")


# ---------------------------------------------------------------- Kite Connect
def kc_login_url(api_key: str, redirect_params: dict | None = None) -> str:
    q = {"v": "3", "api_key": api_key}
    if redirect_params:
        q["redirect_params"] = urlencode(redirect_params)
    return KITE_WEB + "/connect/login?" + urlencode(q)


def kc_exchange(api_key: str, api_secret: str, request_token: str) -> dict:
    """Exchange a request_token for a session (access_token, user_id, ...)."""
    checksum = hashlib.sha256((api_key + request_token + api_secret).encode()).hexdigest()
    r = requests.post(KITE_API + "/session/token", headers=BASE_HEADERS,
                      data={"api_key": api_key, "request_token": request_token, "checksum": checksum}, timeout=20)
    return _unwrap(r)


# ---------------------------------------------------------------- web session (enctoken)
def totp_now(secret: str) -> str:
    return pyotp.TOTP(secret.replace(" ", "").strip()).now()


def web_login(user_id: str, password: str, totp_value: str | None = None,
              totp_secret: str | None = None) -> str:
    """Password + TOTP login against kite.zerodha.com. Returns the enctoken."""
    s = requests.Session()
    s.headers.update({**BASE_HEADERS, "Referer": KITE_WEB + "/"})
    s.get(KITE_WEB + "/", timeout=15)
    r = s.post(KITE_WEB + "/api/login", data={"user_id": user_id, "password": password}, timeout=20)
    data = _unwrap(r)
    if not totp_value:
        if not totp_secret:
            raise KiteError("TOTP code required", "TwoFARequired", 401)
        totp_value = totp_now(totp_secret)
    r = s.post(KITE_WEB + "/api/twofa", data={
        "user_id": user_id, "request_id": data["request_id"], "twofa_value": totp_value,
        "twofa_type": data.get("twofa_type", "totp"), "skip_session": "true",
    }, timeout=20)
    _unwrap(r)
    tok = s.cookies.get("enctoken")
    if not tok:
        raise KiteError("Login succeeded but no enctoken cookie was returned", "TokenException", 401)
    return tok


# ---------------------------------------------------------------- session wrapper
class KiteSession:
    def __init__(self, kind: str, token: str, api_key: str | None = None):
        self.kind = kind
        self.s = requests.Session()
        self.s.headers.update(BASE_HEADERS)
        if kind == "kc":
            self.base = KITE_API
            self.s.headers["Authorization"] = f"token {api_key}:{token}"
        else:
            self.base = KITE_WEB + "/oms"
            self.s.headers["Authorization"] = "enctoken " + token
            self.s.headers["Referer"] = KITE_WEB + "/"

    def get(self, path: str, **params) -> Any:
        r = self.s.get(self.base + path, params=params or None, timeout=20)
        return _unwrap(r)

    def profile(self):   return self.get("/user/profile")
    def margins(self):   return self.get("/user/margins")
    def holdings(self):  return self.get("/portfolio/holdings")
    def positions(self): return self.get("/portfolio/positions")
    def orders(self):    return self.get("/orders")
    def mf_holdings(self):
        try:
            return self.get("/mf/holdings")
        except KiteError as e:
            if e.error_type == "TokenException":
                raise
            return []

    def snapshot(self) -> dict:
        out: dict[str, Any] = {"fetched_at": time.time()}
        out["profile"] = self.profile()
        out["holdings"] = self.holdings() or []
        out["positions"] = self.positions() or {"net": [], "day": []}
        out["margins"] = self.margins() or {}
        out["orders"] = self.orders() or []
        out["mf"] = self.mf_holdings() or []
        return out
