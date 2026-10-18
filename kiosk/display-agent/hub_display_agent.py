#!/usr/bin/env python3
"""Home Hub display agent (hub-xcr.1): switches the monitor on/off and wakes it on touch.

Runs on the Pi kiosk as a systemd user unit. Python 3 standard library only.

Contract with the hub server (see kiosk/README.md, "Display power"); the server owns the
schedule, "sleep now" and the night re-sleep timeout, the agent only obeys:
  GET  {HUB_URL}/api/display/power  -> {"power": "on"|"off", "reason": "...", "until"?: "..."}
  POST {HUB_URL}/api/display/wake   -> same body (sent when the screen is touched)

Power is switched with `wlr-randr --output NAME --off|--on` (real HDMI off), with an optional
CEC fallback (cec-ctl or cec-client) when wlr-randr fails. Touch is read straight from
/dev/input/event* so it still works while the output is off.
"""

import errno
import json
import logging
import os
import selectors
import shlex
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Sequence, Tuple

log = logging.getLogger("hub-display-agent")

# linux/input-event-codes.h
EV_KEY, EV_ABS = 0x01, 0x03
BTN_TOUCH = 0x14A
ABS_X, ABS_MT_POSITION_X, ABS_MT_TRACKING_ID = 0x00, 0x35, 0x39

# struct input_event { struct timeval time; __u16 type; __u16 code; __s32 value; } (64-bit Pi OS)
EVENT_FORMAT = "llHHi"
EVENT_SIZE = struct.calcsize(EVENT_FORMAT)

# EVIOCGRAB = _IOW('E', 0x90, int): while grabbed, only this process receives the device's events.
EVIOCGRAB = (1 << 30) | (4 << 16) | (ord("E") << 8) | 0x90

Runner = Callable[..., Tuple[int, str]]  # (argv, optional stdin text) -> (exit code, output)


class HubError(Exception):
    """The hub could not be reached or answered nonsense."""


@dataclass
class Config:
    hub_url: str = "http://hub.local:3000"
    output: str = ""  # kiosk.conf OUTPUT; blank or unknown -> auto-detect
    poll_seconds: float = 1.0  # SLP-2: monitor off within 2 s of "Sleep now"
    max_backoff_seconds: float = 30.0
    touch_device: str = ""  # blank -> scan /dev/input/event*
    cec_backend: str = ""  # "", "cec-ctl" or "cec-client"
    cec_device: str = "/dev/cec0"
    cec_address: str = "0"  # logical address of the TV/monitor
    offline_hold_seconds: float = 120.0  # touch-wake kept on this long if the hub is unreachable
    wake_repost_seconds: float = 20.0  # re-POST wake on touch while on, to restart the night timeout


def parse_conf(text: str) -> Dict[str, str]:
    """kiosk.conf is shell KEY="value" lines; read it without executing anything."""
    out: Dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        try:
            parts = shlex.split(value, comments=True)
        except ValueError:
            continue
        out[key.strip()] = parts[0] if parts else ""
    return out


def config_from(conf: Dict[str, str]) -> Config:
    def num(key: str, default: float) -> float:
        try:
            return float(conf.get(key, "") or default)
        except ValueError:
            return default

    d = Config()
    return Config(
        hub_url=conf.get("HUB_URL", d.hub_url).rstrip("/"),
        output=conf.get("OUTPUT", d.output),
        poll_seconds=max(0.5, num("POWER_POLL_SECONDS", d.poll_seconds)),
        touch_device=conf.get("TOUCH_DEVICE", d.touch_device),
        cec_backend=conf.get("CEC_BACKEND", d.cec_backend),
        cec_device=conf.get("CEC_DEVICE", d.cec_device),
        cec_address=conf.get("CEC_ADDRESS", d.cec_address),
        offline_hold_seconds=num("OFFLINE_WAKE_SECONDS", d.offline_hold_seconds),
    )


def run_command(argv: Sequence[str], input_text: Optional[str] = None) -> Tuple[int, str]:
    """The real command runner: (exit code, combined output). Never raises."""
    try:
        p = subprocess.run(
            list(argv), input=input_text, capture_output=True, text=True, timeout=10, check=False
        )
        return p.returncode, (p.stdout + p.stderr).strip()
    except (OSError, subprocess.SubprocessError) as e:
        return 127, str(e)


# ---------------------------------------------------------------- screen power


def parse_outputs(text: str) -> List[Tuple[str, bool]]:
    """`wlr-randr` text -> [(output name, enabled)]. Output lines start in column 0."""
    outputs: List[Tuple[str, bool]] = []
    for line in text.splitlines():
        if line and not line[0].isspace():
            outputs.append((line.split()[0], True))
        elif outputs and line.strip().lower().startswith("enabled:"):
            outputs[-1] = (outputs[-1][0], line.split(":", 1)[1].strip().lower() == "yes")
    return outputs


class Screen:
    """Turns the monitor on or off. `run` is injected so tests never touch a real command."""

    def __init__(self, cfg: Config, run: Runner = run_command):
        self.cfg = cfg
        self.run = run
        self.output = ""

    def _resolve_output(self) -> str:
        rc, out = self.run(["wlr-randr"])
        names = [n for n, _ in parse_outputs(out)] if rc == 0 else []
        if self.cfg.output and (not names or self.cfg.output in names):
            return self.cfg.output
        if names:
            if self.cfg.output:
                log.warning("OUTPUT %s not found; using %s", self.cfg.output, names[0])
            return names[0]
        return self.cfg.output

    def probe(self) -> Optional[bool]:
        """Is the output currently enabled? None when it cannot be told."""
        rc, out = self.run(["wlr-randr"])
        if rc != 0:
            return None
        found = dict(parse_outputs(out))
        name = self.output or self.cfg.output
        if name in found:
            return found[name]
        return next(iter(found.values())) if found else None

    def _cec(self, on: bool) -> bool:
        backend = self.cfg.cec_backend
        addr = self.cfg.cec_address
        if backend == "cec-ctl":
            argv = ["cec-ctl", "-d", self.cfg.cec_device, "--to", addr]
            argv.append("--image-view-on" if on else "--standby")
            rc, out = self.run(argv)
        elif backend == "cec-client":
            rc, out = self.run(
                ["cec-client", "-s", "-d", "1"], ("on " if on else "standby ") + addr + "\n"
            )
        else:
            return False
        if rc != 0:
            log.error("CEC %s failed (%s): %s", "on" if on else "standby", backend, out)
        return rc == 0

    def set_power(self, on: bool) -> bool:
        if not self.output:
            self.output = self._resolve_output()
        rc, out = self.run(["wlr-randr", "--output", self.output, "--on" if on else "--off"])
        if rc == 0:
            log.info("screen %s via wlr-randr (%s)", "on" if on else "off", self.output)
            return True
        log.error("wlr-randr failed for %s: %s", self.output, out)
        self.output = ""  # find the output again next time
        if self.cfg.cec_backend and self._cec(on):
            log.info("screen %s via CEC (%s)", "on" if on else "off", self.cfg.cec_backend)
            return True
        return False


# ---------------------------------------------------------------- hub client


class HubClient:
    def __init__(self, base_url: str, timeout: float = 4.0):
        self.base = base_url.rstrip("/")
        self.timeout = timeout

    def _call(self, method: str, path: str) -> Dict[str, object]:
        req = urllib.request.Request(
            self.base + path, method=method, data=b"" if method == "POST" else None
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                body = json.loads(res.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise HubError(str(e)) from e
        if not isinstance(body, dict) or body.get("power") not in ("on", "off"):
            raise HubError("unexpected body: %r" % (body,))
        return body

    def get_power(self) -> Dict[str, object]:
        return self._call("GET", "/api/display/power")

    def post_wake(self) -> Dict[str, object]:
        return self._call("POST", "/api/display/wake")


# ---------------------------------------------------------------- decision logic


class Agent:
    """Pure decision logic: no sleeping, no sockets. Time, screen and hub are injected."""

    def __init__(self, cfg: Config, screen, hub, clock: Callable[[], float] = time.monotonic):
        self.cfg, self.screen, self.hub, self.clock = cfg, screen, hub, clock
        self.lit: Optional[bool] = screen.probe()
        self.reason = ""
        self.hold_until = 0.0  # ignore "off" from the hub until then (touch-wake while hub is down)
        self.last_wake_post = float("-inf")
        self.failures = 0
        self.waking = False  # a touch that woke the screen is still down
        log.info("start: screen is %s", {True: "on", False: "off", None: "unknown"}[self.lit])

    def _apply(self, power: str) -> None:
        want = power == "on"
        if not want and self.clock() < self.hold_until:
            return
        if self.lit is want:
            return
        if self.screen.set_power(want):
            self.lit = want

    def poll(self) -> float:
        """One poll of the hub. Returns the seconds to wait before the next one."""
        try:
            state = self.hub.get_power()
        except HubError as e:
            self.failures += 1
            if self.failures == 1:
                log.warning("hub unreachable, keeping the screen as it is: %s", e)
            # Back off 1 s -> 30 s. The screen is never changed on a failed poll.
            return min(self.cfg.max_backoff_seconds, self.cfg.poll_seconds * 2 ** min(self.failures, 6))
        if self.failures:
            log.info("hub reachable again after %d failed polls", self.failures)
            self.failures = 0
        self.reason = str(state.get("reason", ""))
        self._apply(str(state["power"]))
        return self.cfg.poll_seconds

    def touch(self) -> None:
        """A touch-down arrived (any touch device)."""
        now = self.clock()
        if self.lit is not True:
            self.waking = True  # keep this touch away from Chromium until the finger lifts
            # Optimistic: light the screen first, then tell the hub.
            if self.screen.set_power(True):
                self.lit = True
            try:
                state = self.hub.post_wake()
                self.last_wake_post = now
                self.reason = str(state.get("reason", ""))
                self._apply(str(state["power"]))
            except HubError as e:
                log.warning("wake not recorded by hub, holding screen on: %s", e)
                self.hold_until = now + self.cfg.offline_hold_seconds
        elif self.reason == "wake" and now - self.last_wake_post >= self.cfg.wake_repost_seconds:
            # Night, touch-woken: a touch restarts the hub's re-sleep timeout.
            self.last_wake_post = now
            try:
                self.hub.post_wake()
            except HubError as e:
                log.warning("could not restart the re-sleep timeout: %s", e)

    def touch_ended(self) -> None:
        """All fingers lifted."""
        self.waking = False

    def wants_grab(self) -> bool:
        """Hold the touch device exclusively (SLP-3): while the screen is off, and until the
        finger that woke it lifts, so Chromium never sees the wake tap. Unknown state: no grab."""
        return self.lit is False or self.waking


# ---------------------------------------------------------------- touch input


def parse_touch_down(buf: bytes) -> bool:
    """True if a buffer of input_event structs contains a finger/touch going down."""
    for off in range(0, len(buf) - EVENT_SIZE + 1, EVENT_SIZE):
        _, _, etype, code, value = struct.unpack_from(EVENT_FORMAT, buf, off)
        if etype == EV_KEY and code == BTN_TOUCH and value == 1:
            return True
        if etype == EV_ABS and code == ABS_MT_TRACKING_ID and value != -1:
            return True
    return False


def touch_state(buf: bytes, touching: bool) -> bool:
    """Is a finger down after this buffer of input_event structs? `touching` is the state before."""
    for off in range(0, len(buf) - EVENT_SIZE + 1, EVENT_SIZE):
        _, _, etype, code, value = struct.unpack_from(EVENT_FORMAT, buf, off)
        if etype == EV_KEY and code == BTN_TOUCH:
            touching = value != 0
        elif etype == EV_ABS and code == ABS_MT_TRACKING_ID:
            touching = value != -1
    return touching


def has_bit(mask: bytes, bit: int) -> bool:
    return bit // 8 < len(mask) and bool(mask[bit // 8] >> (bit % 8) & 1)


def is_touch_device(abs_mask: bytes, key_mask: bytes) -> bool:
    """A touchscreen has multitouch X, or single-touch X plus BTN_TOUCH."""
    return has_bit(abs_mask, ABS_MT_POSITION_X) or (
        has_bit(abs_mask, ABS_X) and has_bit(key_mask, BTN_TOUCH)
    )


def _eviocgbit(ev: int, length: int) -> int:
    return (2 << 30) | (length << 16) | (ord("E") << 8) | (0x20 + ev)


def _capability(fd: int, ev: int, length: int) -> bytes:
    import fcntl  # Linux only; imported late so the module loads on a dev laptop

    buf = bytearray(length)
    fcntl.ioctl(fd, _eviocgbit(ev, length), buf)
    return bytes(buf)


class TouchWatcher:
    """Opens the touch devices and reports touch-downs. Re-scans so hot-plug and replug work."""

    RESCAN_SECONDS = 10.0

    def __init__(self, device: str = "", ioctl: Optional[Callable[[int, int, int], object]] = None):
        self.device = device
        self.sel = selectors.DefaultSelector()
        self.last_scan = float("-inf")
        self._ioctl = ioctl  # injected in tests; the real fcntl.ioctl is imported late (Linux only)
        self.grabbed = False
        self.down: Dict[int, bool] = {}  # fd -> finger currently down

    @property
    def touching(self) -> bool:
        return any(self.down.values())

    def _grab_fd(self, fd: int, on: bool) -> bool:
        try:
            if self._ioctl is None:
                import fcntl

                self._ioctl = fcntl.ioctl
            self._ioctl(fd, EVIOCGRAB, 1 if on else 0)
            return True
        except OSError as e:
            log.warning("EVIOCGRAB %s failed: %s", "on" if on else "off", e)
            return False

    def set_grab(self, want: bool) -> None:
        """Grab (or release) every watched device. A grab waits for the finger to lift, so
        Chromium is never left holding a touch whose end it cannot see."""
        if want == self.grabbed or (want and self.touching):
            return
        for key in list(self.sel.get_map().values()):
            self._grab_fd(key.fd, want)
        self.grabbed = want
        log.info("touch devices %s", "grabbed" if want else "released")

    def _candidates(self) -> List[str]:
        if self.device:
            return [self.device]
        try:
            names = sorted(n for n in os.listdir("/dev/input") if n.startswith("event"))
        except OSError:
            return []
        return ["/dev/input/" + n for n in names]

    def _scan(self) -> None:
        open_paths = {k.data for k in self.sel.get_map().values()}
        for path in self._candidates():
            if path in open_paths:
                continue
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            except OSError:
                continue
            try:
                ok = bool(self.device) or is_touch_device(
                    _capability(fd, EV_ABS, 8), _capability(fd, EV_KEY, 96)
                )
            except OSError:
                ok = False
            if ok:
                self.sel.register(fd, selectors.EVENT_READ, path)
                self.down[fd] = False
                if self.grabbed:
                    self._grab_fd(fd, True)
                log.info("watching touch device %s", path)
            else:
                os.close(fd)

    def wait(self, timeout: float) -> bool:
        """Block up to `timeout` seconds; True if a touch-down arrived."""
        now = time.monotonic()
        if now - self.last_scan >= self.RESCAN_SECONDS:
            self.last_scan = now
            self._scan()
        if not self.sel.get_map():
            time.sleep(timeout)
            return False
        touched = False
        for key, _ in self.sel.select(timeout):
            try:
                data = os.read(key.fd, EVENT_SIZE * 64)
            except OSError as e:
                if e.errno not in (errno.EAGAIN, errno.EWOULDBLOCK):
                    log.warning("touch device %s gone: %s", key.data, e)
                    self.sel.unregister(key.fd)
                    self.down.pop(key.fd, None)
                    os.close(key.fd)
                continue
            touched = parse_touch_down(data) or touched
            self.down[key.fd] = touch_state(data, self.down.get(key.fd, False))
        return touched


# ---------------------------------------------------------------- main


def main(argv: Sequence[str]) -> int:
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(levelname)s %(message)s")
    conf_path = os.environ.get("HUB_KIOSK_CONF", "/etc/hub-kiosk/kiosk.conf")
    try:
        with open(conf_path, encoding="utf-8") as f:
            conf = parse_conf(f.read())
    except OSError as e:
        log.error("cannot read %s: %s", conf_path, e)
        return 1
    cfg = config_from(conf)
    try:
        import hub_speaker  # installed next to this script

        hub_speaker.start(conf)
    except Exception:  # the speaker is optional; screen power must keep working without it
        log.exception("speaker support failed to start")
    agent = Agent(cfg, Screen(cfg), HubClient(cfg.hub_url))
    touch = TouchWatcher(cfg.touch_device)
    next_poll = 0.0
    while True:
        now = time.monotonic()
        if now >= next_poll:
            next_poll = time.monotonic() + agent.poll()
        was_touching = touch.touching
        touched = touch.wait(max(0.05, min(0.5, next_poll - time.monotonic())))
        if touched:
            agent.touch()
        if was_touching and not touch.touching:
            agent.touch_ended()
        touch.set_grab(agent.wants_grab())
        if touched:
            # Re-check soon so a night re-sleep or a hub override is not left waiting.
            next_poll = min(next_poll, time.monotonic() + cfg.poll_seconds)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
