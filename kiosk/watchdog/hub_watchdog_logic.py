#!/usr/bin/env python3
"""Decision logic for the kiosk watchdog's "hub served an error page" recovery (hub-qwf).

The watchdog lists Chromium's tabs over DevTools; each has a title. When the hub is mid-redeploy
Chromium can load the hub's own SvelteKit error page ("500 Internal Error"), which is a normal
page to Chromium, not a chrome-error:// page. This module decides whether to reload.

CLI (used by hub-kiosk-watchdog):
  hub_watchdog_logic.py decide STATE_FILE TITLE HEALTHY(0|1) [NOW]
prints "reload" or "wait". Run tests: python3 -m unittest (in this folder).
"""

import json
import re
import sys
import time

BASE_DELAY = 30  # seconds before the second reload attempt
MAX_DELAY = 600  # never wait longer than this between attempts

_ERROR_TITLE = re.compile(
    r"^\s*5\d\d\b|internal error|bad gateway|service unavailable|gateway time-?out",
    re.IGNORECASE,
)


def is_hub_error_title(title):
    """True when a tab title looks like a server error page (5xx), not the app."""
    return bool(title) and bool(_ERROR_TITLE.search(title))


def decide(state, title, healthy, now):
    """Return (action, new_state). action is "reload" or "wait".

    state: {"attempts": int, "next_at": float}. A healthy page resets it. While /healthz is
    down we wait without touching state, so an outage never burns the backoff. Once /healthz
    answers we reload, then back off exponentially (30 s, 60 s, ... capped at 10 min) in case
    the hub keeps serving errors while /healthz is fine.
    """
    state = state or {}
    if not is_hub_error_title(title):
        return "wait", {"attempts": 0, "next_at": 0}
    attempts = int(state.get("attempts", 0))
    next_at = float(state.get("next_at", 0))
    if not healthy or now < next_at:
        return "wait", {"attempts": attempts, "next_at": next_at}
    delay = min(BASE_DELAY * (2**attempts), MAX_DELAY)
    return "reload", {"attempts": attempts + 1, "next_at": now + delay}


def _load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def main(argv):
    if len(argv) < 5 or argv[1] != "decide":
        print("usage: decide STATE_FILE TITLE HEALTHY [NOW]", file=sys.stderr)
        return 2
    path, title, healthy = argv[2], argv[3], argv[4] == "1"
    now = float(argv[5]) if len(argv) > 5 else time.time()
    action, state = decide(_load(path), title, healthy, now)
    try:
        with open(path, "w") as f:
            json.dump(state, f)
    except OSError:
        pass
    print(action)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
