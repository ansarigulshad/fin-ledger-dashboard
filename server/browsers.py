"""Open a URL in a specific Chromium-family browser profile (so each family member's Kite login
lands in a profile that only remembers that person)."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

HOME = Path.home()
BROWSERS = {  # app name -> user-data directory
    "Brave Browser": HOME / "Library/Application Support/BraveSoftware/Brave-Browser",
    "Google Chrome": HOME / "Library/Application Support/Google/Chrome",
    "Microsoft Edge": HOME / "Library/Application Support/Microsoft Edge",
    "Chromium": HOME / "Library/Application Support/Chromium",
}


def profiles() -> list[dict]:
    """[{browser, dir, name, id}] for every installed browser profile found."""
    out = []
    for app, data in BROWSERS.items():
        if not Path(f"/Applications/{app}.app").exists():
            continue
        state = data / "Local State"
        cache = {}
        if state.exists():
            try:
                cache = json.loads(state.read_text()).get("profile", {}).get("info_cache", {})
            except Exception:
                cache = {}
        if not cache:
            cache = {"Default": {"name": "Default"}}
        for d, info in cache.items():
            out.append({"browser": app, "dir": d, "name": info.get("name") or d, "id": f"{app}|{d}"})
    return out


def launch(profile_id: str, url: str) -> None:
    app, _, d = profile_id.partition("|")
    if app not in BROWSERS or not d:
        raise ValueError("Unknown browser profile")
    subprocess.Popen(["open", "-na", f"/Applications/{app}.app", "--args", f"--profile-directory={d}", url],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
