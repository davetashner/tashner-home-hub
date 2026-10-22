#!/usr/bin/env python3
"""Recover a dead kiosk session (hub-2ik). Runs as root from a system timer, outside the kiosk session.

LightDM autologins only when it starts. If labwc exits (a crash, a compositor error), the kiosk
user's session closes, LightDM shows the greeter, and the kiosk watchdog (a kiosk user service)
died with the session, so nothing brings the wall back. This checks every 30 s: when LightDM is
running but the kiosk user has had no session for SESSION_RECOVERY_MINUTES (kiosk.conf, default 2,
0 = off), it restarts LightDM so autologin runs again. A different user with a graphical (wayland/x11) session on seat0 is left
alone (and logged), so a person using the desktop is never kicked out.

Usage: hub_session_recovery.py [CONF]. Tests: python3 -m unittest (in this folder).
"""

import json
import os
import subprocess
import sys
import time
from typing import Dict, List, Optional, Tuple

KIOSK_USER = "kiosk"
DEFAULT_MINUTES = 2.0
STATE_FILE = "/run/hub-kiosk/session-recovery.json"
CONF = "/etc/hub-kiosk/kiosk.conf"
# Sessions owned by these never count as a person at the machine.
SYSTEM_USERS = ("lightdm", "gdm", "sddm")


GRAPHICAL = ("wayland", "x11", "mir")


def parse_session_ids(text: str) -> List[str]:
    """`loginctl list-sessions --no-legend` -> session ids (first column)."""
    return [line.split()[0] for line in text.splitlines() if line.split()]


def parse_session(text: str) -> Optional[Tuple[str, str, str]]:
    """`loginctl show-session ID -p Name -p Seat -p Type -p Class` -> (user, seat, type), or None
    unless it is a user-class session (drops the lightdm greeter, manager and background sessions)."""
    v = dict(line.split("=", 1) for line in text.splitlines() if "=" in line)
    if v.get("Class") != "user" or not v.get("Name"):
        return None
    return v["Name"], v.get("Seat") or "-", v.get("Type", "")


def decide(state: Optional[dict], sessions: List[Tuple[str, str, str]], lightdm_active: bool,
           now: float, grace_seconds: float) -> Tuple[str, dict]:
    """Return (action, new_state). Actions: ok | wait | restart | skip-other-user | skip-no-lightdm | off.

    state: {"missing_since": float | None}. The clock starts when the kiosk session is first seen
    missing with LightDM running, and resets whenever the session is back, another user holds the
    seat, LightDM is down, or after a restart (so at most one restart per grace period).
    """
    if grace_seconds <= 0:
        return "off", {"missing_since": None}
    # Only graphical sessions count: a text login on tty1 or an ssh session is not a person at the
    # desktop, and a kiosk "session" without a compositor is not a running kiosk.
    sessions = [x for x in sessions if x[2] in GRAPHICAL]
    if any(u == KIOSK_USER for u, _, _ in sessions):
        return "ok", {"missing_since": None}
    if not lightdm_active:
        return "skip-no-lightdm", {"missing_since": None}
    if any(st == "seat0" and u not in SYSTEM_USERS for u, st, _ in sessions):
        return "skip-other-user", {"missing_since": None}
    since = (state or {}).get("missing_since")
    if since is None or since > now:  # first sighting (or a stale state from before a reboot)
        return "wait", {"missing_since": now}
    if now - since >= grace_seconds:
        return "restart", {"missing_since": now}
    return "wait", {"missing_since": since}


def read_conf(path: str) -> Dict[str, str]:
    conf: Dict[str, str] = {}
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    conf[k.strip()] = v.strip().strip("\"'")
    except OSError:
        pass
    return conf


def grace_from_conf(conf: Dict[str, str]) -> float:
    try:
        minutes = float(conf.get("SESSION_RECOVERY_MINUTES", DEFAULT_MINUTES))
    except ValueError:
        minutes = DEFAULT_MINUTES
    return max(0.0, minutes) * 60


def _run(argv: List[str]) -> Tuple[int, str]:
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=30, check=False)
        return p.returncode, p.stdout.strip()
    except (OSError, subprocess.SubprocessError) as e:
        return 127, str(e)


def main(argv: List[str]) -> int:
    grace = grace_from_conf(read_conf(argv[1] if len(argv) > 1 else CONF))
    try:
        with open(STATE_FILE, encoding="utf-8") as fh:
            state = json.load(fh)
    except (OSError, ValueError):
        state = None
    rc, listing = _run(["loginctl", "list-sessions", "--no-legend"])
    if rc != 0:
        print("hub-kiosk-session-recovery: loginctl failed: %s" % listing)
        return 0
    sessions = []
    for sid in parse_session_ids(listing):
        rc, info = _run(["loginctl", "show-session", sid, "-p", "Name", "-p", "Seat", "-p", "Type", "-p", "Class"])
        got = parse_session(info) if rc == 0 else None
        if got:
            sessions.append(got)
    lightdm = _run(["systemctl", "is-active", "--quiet", "lightdm.service"])[0] == 0
    # CLOCK_MONOTONIC is system-wide on Linux and restarts at boot, matching /run's lifetime.
    action, new = decide(state, sessions, lightdm, time.monotonic(), grace)
    if action == "skip-other-user":
        who = sorted({u for u, st, t in sessions if st == "seat0" and t in GRAPHICAL and u not in SYSTEM_USERS})
        if (state or {}).get("last") != action:
            print("hub-kiosk-session-recovery: no kiosk session, but %s is logged in on seat0: leaving it alone" % ", ".join(who))
    elif action == "restart":
        print("hub-kiosk-session-recovery: no %s session for %d s: restarting lightdm" % (KIOSK_USER, grace))
        rc, out = _run(["systemctl", "restart", "lightdm.service"])
        if rc != 0:
            print("hub-kiosk-session-recovery: restart failed: %s" % out)
    new["last"] = action
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        with open(STATE_FILE, "w", encoding="utf-8") as fh:
            json.dump(new, fh)
    except OSError as e:
        print("hub-kiosk-session-recovery: cannot save state: %s" % e)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
