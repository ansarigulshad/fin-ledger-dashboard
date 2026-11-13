"""Local, file-backed storage for account credentials and daily session tokens."""
from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path

DATA_DIR = Path(os.environ.get("KITE_DASH_DATA", Path(__file__).resolve().parent.parent / "data"))
ACCOUNTS_FILE = DATA_DIR / "accounts.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"
_lock = threading.Lock()


def _read(path: Path, default):
    if not path.exists():
        return default
    with path.open() as f:
        return json.load(f)


def _write(path: Path, obj) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w") as f:
        json.dump(obj, f, indent=2)
    os.chmod(tmp, 0o600)
    tmp.replace(path)


# ---- accounts ---------------------------------------------------------------
def list_accounts() -> list[dict]:
    with _lock:
        return _read(ACCOUNTS_FILE, [])


def public_account(a: dict) -> dict:
    """Strip secrets before sending to the browser."""
    return {
        "id": a["id"], "name": a["name"], "user_id": a["user_id"],
        "color": a.get("color", 1),
        "has_password": bool(a.get("password")),
        "has_totp_secret": bool(a.get("totp_secret")),
        "has_api": bool(a.get("api_key") and a.get("api_secret")),
        "browser_profile": a.get("browser_profile", ""),
        "api_key": a.get("api_key", ""),
    }


def upsert_account(payload: dict) -> dict:
    with _lock:
        accounts = _read(ACCOUNTS_FILE, [])
        acc_id = payload.get("id") or uuid.uuid4().hex[:8]
        existing = next((a for a in accounts if a["id"] == acc_id), None)
        rec = dict(existing or {"id": acc_id})
        for k in ("name", "user_id", "color"):
            if k in payload and payload[k] not in (None, ""):
                rec[k] = payload[k]
        if "browser_profile" in payload and payload["browser_profile"] is not None:
            rec["browser_profile"] = payload["browser_profile"]
        # secrets: only overwrite if a non-empty value is supplied
        for k in ("password", "totp_secret", "api_key", "api_secret"):
            if payload.get(k):
                rec[k] = payload[k].strip()
            elif payload.get("clear_" + k):
                rec.pop(k, None)
        rec["user_id"] = rec.get("user_id", "").strip().upper()
        rec.setdefault("name", rec["user_id"])
        if existing:
            accounts[accounts.index(existing)] = rec
        else:
            used = {a.get("color") for a in accounts}
            rec.setdefault("color", next((c for c in range(1, 9) if c not in used), 1))
            accounts.append(rec)
        _write(ACCOUNTS_FILE, accounts)
        return rec


def delete_account(acc_id: str) -> None:
    with _lock:
        accounts = [a for a in _read(ACCOUNTS_FILE, []) if a["id"] != acc_id]
        _write(ACCOUNTS_FILE, accounts)
        sessions = _read(SESSIONS_FILE, {})
        sessions.pop(acc_id, None)
        _write(SESSIONS_FILE, sessions)


def reorder_accounts(ids: list[str]) -> None:
    with _lock:
        accounts = _read(ACCOUNTS_FILE, [])
        by_id = {a["id"]: a for a in accounts}
        ordered = [by_id[i] for i in ids if i in by_id] + [a for a in accounts if a["id"] not in ids]
        _write(ACCOUNTS_FILE, ordered)


# ---- sessions ---------------------------------------------------------------
def get_session(acc_id: str) -> dict | None:
    """{"kind": "kc"|"enc", "token": str, "ts": float} or None."""
    with _lock:
        return _read(SESSIONS_FILE, {}).get(acc_id)


def set_session(acc_id: str, kind: str | None, token: str | None, ts: float) -> None:
    with _lock:
        sessions = _read(SESSIONS_FILE, {})
        if token:
            sessions[acc_id] = {"kind": kind, "token": token, "ts": ts}
        else:
            sessions.pop(acc_id, None)
        _write(SESSIONS_FILE, sessions)
