"""Bluetooth speaker for the kiosk (hub-txj.1): scan, pair, keep connected, play a test chime.

Started by the display agent as two daemon threads: a small authenticated HTTP API that the hub
server proxies for Settings > Music > Speaker, and a loop that reconnects the chosen speaker
after it powers on or the Pi reboots and keeps it the default PipeWire sink. Python 3 standard
library only; every command goes through an injected runner so tests never touch Bluetooth.

API (Authorization: Bearer <token from SPEAKER_API_TOKEN_FILE>; off when the file is missing):
  GET  /speaker        -> status (see Speaker.status)
  POST /speaker/scan   -> {"devices": [{mac, name, kind, rssi, bars, paired, connected}]}
  POST /speaker/use    {"mac": "AA:BB:CC:DD:EE:FF"} -> status, after pair, trust, connect
  POST /speaker/test   -> {"ok": true} once the chime has played on the speaker
"""

import hmac
import io
import json
import logging
import math
import os
import re
import struct
import subprocess
import tempfile
import threading
import time
import wave
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, Dict, List, Optional, Sequence, Tuple

log = logging.getLogger("hub-display-agent.speaker")

MAC_RE = re.compile(r"^[0-9A-F]{2}(:[0-9A-F]{2}){5}$")

Run = Callable[..., Tuple[int, str]]  # (argv, timeout=seconds) -> (exit code, output)


def run_command(argv: Sequence[str], timeout: float = 10) -> Tuple[int, str]:
    """The real command runner: (exit code, combined output). Never raises."""
    try:
        p = subprocess.run(list(argv), capture_output=True, text=True, timeout=timeout, check=False)
        return p.returncode, (p.stdout + p.stderr).strip()
    except (OSError, subprocess.SubprocessError) as e:
        return 127, str(e)


def spawn_scan(seconds: float):
    """Starts discovery in the background; the caller stops it with .terminate()."""
    return subprocess.Popen(
        ["bluetoothctl", "--timeout", str(int(seconds) + 2), "scan", "on"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


@dataclass
class SpeakerConfig:
    mac: str = ""  # kiosk.conf BT_SPEAKER: install-time fallback until one is chosen in Settings
    port: int = 8742
    bind: str = "0.0.0.0"
    token_file: str = "/etc/hub-kiosk/speaker-api.token"
    state_file: str = ""  # the chosen speaker; blank -> $XDG_STATE_HOME/hub-kiosk/speaker
    scan_seconds: float = 8.0
    reconnect_seconds: float = 30.0
    repair_seconds: float = 300.0  # how often to retry pairing a configured, unpaired speaker


def normalize_mac(mac: object) -> Optional[str]:
    m = str(mac or "").strip().upper().replace("-", ":")
    return m if MAC_RE.match(m) else None


def speaker_config_from(conf: Dict[str, str]) -> SpeakerConfig:
    d = SpeakerConfig()
    try:
        port = int(conf.get("SPEAKER_API_PORT", "") or d.port)
    except ValueError:
        port = d.port
    state = os.path.join(
        os.environ.get("XDG_STATE_HOME") or os.path.expanduser("~/.local/state"), "hub-kiosk", "speaker"
    )
    return SpeakerConfig(
        mac=normalize_mac(conf.get("BT_SPEAKER")) or "",
        port=port,
        bind=conf.get("SPEAKER_API_BIND", "") or d.bind,
        token_file=conf.get("SPEAKER_API_TOKEN_FILE", "") or d.token_file,
        state_file=state,
    )


# ---------------------------------------------------------------- parsing


def parse_devices(text: str) -> List[str]:
    """`bluetoothctl devices` -> MACs."""
    out = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] == "Device" and normalize_mac(parts[1]):
            out.append(parts[1].upper())
    return out


def parse_info(text: str) -> Dict[str, object]:
    """`bluetoothctl info MAC` -> the fields the API uses."""
    info: Dict[str, object] = {"uuids": []}
    for raw in text.splitlines():
        line = raw.strip()
        key, sep, value = line.partition(": ")
        if not sep:
            continue
        value = value.strip()
        if key in ("Name", "Alias", "Icon"):
            info[key.lower()] = value
        elif key in ("Paired", "Trusted", "Connected"):
            info[key.lower()] = value == "yes"
        elif key == "Class":
            try:
                info["class"] = int(value.split()[0], 16)
            except ValueError:
                pass
        elif key == "RSSI":
            m = re.search(r"\((-?\d+)\)", value) or re.match(r"(-?\d+)$", value)
            if m:
                info["rssi"] = int(m.group(1))
        elif key == "UUID":
            info["uuids"].append(value.split("(")[0].strip())  # type: ignore[union-attr]
    return info


def device_kind(info: Dict[str, object]) -> str:
    """speaker | phone | other, from the icon, then the class of device, then the profiles."""
    icon = str(info.get("icon", ""))
    major = (int(info.get("class", 0)) >> 8) & 0x1F  # type: ignore[arg-type]
    if icon.startswith("audio-") or major == 0x04 or "Audio Sink" in info.get("uuids", []):  # type: ignore[operator]
        return "speaker"
    if icon == "phone" or major == 0x02:
        return "phone"
    return "other"


def signal_bars(rssi: Optional[int]) -> int:
    """0-4 bars for the picker. 0 = not heard in this scan."""
    if rssi is None:
        return 0
    return 4 if rssi >= -60 else 3 if rssi >= -70 else 2 if rssi >= -80 else 1


def mac_key(mac: str) -> str:
    return mac.replace(":", "_")


def find_sink(dump: object, mac: str) -> Tuple[Optional[int], Optional[str], bool]:
    """`pw-dump` JSON -> (node id, node name, is default sink) for the speaker's audio sink."""
    sink_id, sink_name, default = None, None, None
    prefix = "bluez_output." + mac_key(mac)
    for obj in dump if isinstance(dump, list) else []:
        if not isinstance(obj, dict):
            continue
        info = obj.get("info") or {}
        if obj.get("type") == "PipeWire:Interface:Node":
            props = info.get("props") or {}
            name = str(props.get("node.name", ""))
            if props.get("media.class") == "Audio/Sink" and name.startswith(prefix):
                sink_id, sink_name = obj.get("id"), name
        elif obj.get("type") == "PipeWire:Interface:Metadata":
            if (obj.get("props") or {}).get("metadata.name") != "default":
                continue
            for entry in obj.get("metadata") or []:
                if isinstance(entry, dict) and entry.get("key") == "default.audio.sink":
                    value = entry.get("value")
                    default = value.get("name") if isinstance(value, dict) else None
    return sink_id, sink_name, sink_name is not None and default == sink_name


def chime_wav(rate: int = 22050) -> bytes:
    """Two soft rising notes, so the test sound needs no sound file on the Pi."""
    frames = bytearray()
    for freq, secs in ((660.0, 0.18), (880.0, 0.32)):
        n = int(rate * secs)
        for i in range(n):
            fade = min(1.0, i / (rate * 0.01), (n - i) / (rate * 0.08))
            frames += struct.pack("<h", int(12000 * fade * math.sin(2 * math.pi * freq * i / rate)))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return buf.getvalue()


# ---------------------------------------------------------------- speaker control


class SpeakerError(Exception):
    """Pairing, connecting or playing failed; the message is shown to the adult."""


class Speaker:
    def __init__(
        self,
        cfg: SpeakerConfig,
        run: Run = run_command,
        spawn: Callable[[float], object] = spawn_scan,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.cfg, self.run, self.spawn, self.sleep = cfg, run, spawn, sleep
        self.lock = threading.Lock()  # one bluetoothctl conversation at a time
        self.last_pair_attempt = float("-inf")

    # chosen speaker: Settings choice (state file) beats the kiosk.conf fallback
    def chosen(self) -> str:
        try:
            with open(self.cfg.state_file, encoding="utf-8") as f:
                mac = normalize_mac(f.read())
            if mac:
                return mac
        except OSError:
            pass
        return self.cfg.mac

    def _remember(self, mac: str) -> None:
        os.makedirs(os.path.dirname(self.cfg.state_file), exist_ok=True)
        with open(self.cfg.state_file, "w", encoding="utf-8") as f:
            f.write(mac + "\n")

    def _info(self, mac: str) -> Dict[str, object]:
        rc, out = self.run(["bluetoothctl", "info", mac])
        return parse_info(out) if rc == 0 else {}

    def _sink(self, mac: str) -> Tuple[Optional[int], Optional[str], bool]:
        rc, out = self.run(["pw-dump"])
        try:
            return find_sink(json.loads(out), mac) if rc == 0 else (None, None, False)
        except ValueError:
            return None, None, False

    def _make_default(self, mac: str) -> bool:
        # The sink shows up a moment after the Bluetooth link does.
        for _ in range(5):
            sink_id, _, is_default = self._sink(mac)
            if is_default:
                return True
            if sink_id is not None:
                return self.run(["wpctl", "set-default", str(sink_id)])[0] == 0
            self.sleep(1)
        return False

    def status(self) -> Dict[str, object]:
        """state: none (no speaker chosen) | not_paired | off (paired, not connected) | connected."""
        with self.lock:
            mac = self.chosen()
            if not mac:
                return {"state": "none", "mac": None, "name": None, "defaultSink": False}
            info = self._info(mac)
            state = "connected" if info.get("connected") else "off" if info.get("paired") else "not_paired"
            default = state == "connected" and self._sink(mac)[2]
            return {
                "state": state,
                "mac": mac,
                "name": info.get("alias") or info.get("name") or None,
                "defaultSink": default,
            }

    def scan(self) -> List[Dict[str, object]]:
        """Named devices heard in a short discovery, speakers first, then by signal."""
        with self.lock:
            proc = self.spawn(self.cfg.scan_seconds)
            try:
                self.sleep(self.cfg.scan_seconds)
                # RSSI is only reported while discovery is still running, so read it now.
                rc, out = self.run(["bluetoothctl", "devices"])
                found = []
                for mac in parse_devices(out) if rc == 0 else []:
                    info = self._info(mac)
                    name = info.get("alias") or info.get("name")
                    if not name or name == mac.replace(":", "-"):
                        continue  # unnamed beacons: nothing a person could pick
                    rssi = info.get("rssi")
                    found.append(
                        {
                            "mac": mac,
                            "name": name,
                            "kind": device_kind(info),
                            "rssi": rssi,
                            "bars": signal_bars(rssi),  # type: ignore[arg-type]
                            "paired": bool(info.get("paired")),
                            "connected": bool(info.get("connected")),
                        }
                    )
            finally:
                proc.terminate()  # type: ignore[attr-defined]
        found.sort(key=lambda d: (d["kind"] != "speaker", -(d["rssi"] if d["rssi"] is not None else -999)))
        return found

    def _connect(self, mac: str, pair: bool) -> None:
        if pair:
            # The speaker must still be discoverable when we pair: scan alongside.
            proc = self.spawn(self.cfg.scan_seconds)
            try:
                self.sleep(3)
                rc, out = self.run(["bluetoothctl", "--timeout", "25", "pair", mac], timeout=30)
            finally:
                proc.terminate()  # type: ignore[attr-defined]
            if rc != 0 or not self._info(mac).get("paired"):
                raise SpeakerError("Could not pair. Is the speaker in pairing mode? (%s)" % out[-200:])
            self.run(["bluetoothctl", "trust", mac])
        rc, out = self.run(["bluetoothctl", "connect", mac], timeout=20)
        if rc != 0 or not self._info(mac).get("connected"):
            raise SpeakerError("Paired, but could not connect. Is the speaker on? (%s)" % out[-200:])

    def use(self, mac: str) -> Dict[str, object]:
        """Pair (if needed), trust, connect, make it the default sink, and remember it."""
        mac = normalize_mac(mac) or ""
        if not mac:
            raise SpeakerError("That is not a Bluetooth address.")
        with self.lock:
            info = self._info(mac)
            if not info.get("connected"):
                self._connect(mac, pair=not info.get("paired"))
            elif not info.get("trusted"):
                self.run(["bluetoothctl", "trust", mac])
            self._remember(mac)
            self._make_default(mac)
        return self.status()

    def test(self) -> None:
        """Plays the chime on the speaker itself, not whatever the default happens to be."""
        with self.lock:
            mac = self.chosen()
            _, sink, _ = self._sink(mac) if mac else (None, None, False)
            if not sink:
                raise SpeakerError("The speaker is not connected.")
            with tempfile.NamedTemporaryFile(suffix=".wav") as f:
                f.write(chime_wav())
                f.flush()
                rc, out = self.run(["pw-play", "--target", sink, f.name], timeout=15)
            if rc != 0:
                raise SpeakerError("Could not play the test sound (%s)" % out[-200:])

    def tick(self, now: float) -> None:
        """Reconnect loop body: keep the chosen speaker connected and the default sink."""
        with self.lock:
            mac = self.chosen()
            if not mac:
                return
            info = self._info(mac)
            if info.get("connected"):
                self._make_default(mac)
                return
            if not info.get("paired"):
                # kiosk.conf named a speaker nobody has paired yet: try now and then.
                if now - self.last_pair_attempt < self.cfg.repair_seconds:
                    return
                self.last_pair_attempt = now
            try:
                self._connect(mac, pair=not info.get("paired"))
                log.info("speaker %s connected", mac)
                self._make_default(mac)
            except SpeakerError:
                pass  # off or out of range; the next tick tries again


# ---------------------------------------------------------------- HTTP API


def read_token(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


def make_handler(speaker: Speaker, token: str):
    class Handler(BaseHTTPRequestHandler):
        server_version = "hub-speaker/1"

        def log_message(self, fmt: str, *args) -> None:  # journald, not stderr noise per request
            log.debug(fmt, *args)

        def _send(self, code: int, body: object) -> None:
            data = json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _authorized(self) -> bool:
            got = self.headers.get("Authorization", "")
            return hmac.compare_digest(got.encode("utf-8"), ("Bearer " + token).encode("utf-8"))

        def _body(self) -> Dict[str, object]:
            length = min(int(self.headers.get("Content-Length") or 0), 1024)
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                return {}
            return body if isinstance(body, dict) else {}

        def _route(self, method: str) -> None:
            if not self._authorized():
                return self._send(401, {"error": "unauthorized"})
            try:
                if method == "GET" and self.path == "/speaker":
                    return self._send(200, speaker.status())
                if method == "POST" and self.path == "/speaker/scan":
                    return self._send(200, {"devices": speaker.scan()})
                if method == "POST" and self.path == "/speaker/use":
                    return self._send(200, speaker.use(str(self._body().get("mac", ""))))
                if method == "POST" and self.path == "/speaker/test":
                    speaker.test()
                    return self._send(200, {"ok": True})
            except SpeakerError as e:
                return self._send(409, {"error": str(e)})
            self._send(404, {"error": "not found"})

        def do_GET(self) -> None:
            self._route("GET")

        def do_POST(self) -> None:
            self._route("POST")

    return Handler


def start(conf: Dict[str, str]) -> Speaker:
    """Starts the reconnect loop, and the API when a token is set, as daemon threads."""
    cfg = speaker_config_from(conf)
    speaker = Speaker(cfg)

    def loop() -> None:
        while True:
            try:
                speaker.tick(time.monotonic())
            except Exception:  # never let the reconnect loop die
                log.exception("speaker reconnect failed")
            time.sleep(cfg.reconnect_seconds)

    threading.Thread(target=loop, name="speaker-reconnect", daemon=True).start()
    token = read_token(cfg.token_file)
    if not token:
        log.info("speaker API off: no token in %s", cfg.token_file)
        return speaker
    try:
        server = ThreadingHTTPServer((cfg.bind, cfg.port), make_handler(speaker, token))
    except OSError as e:
        log.error("speaker API could not listen on %s:%d: %s", cfg.bind, cfg.port, e)
        return speaker
    threading.Thread(target=server.serve_forever, name="speaker-api", daemon=True).start()
    log.info("speaker API on %s:%d", cfg.bind, cfg.port)
    return speaker
