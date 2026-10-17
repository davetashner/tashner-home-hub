"""Unit tests for the Bluetooth speaker module. Run: python3 -m unittest (in this folder)."""

import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import wave
from http.server import ThreadingHTTPServer

import hub_speaker as s

MAC = "AA:BB:CC:DD:EE:01"
PHONE = "AA:BB:CC:DD:EE:02"
BEACON = "4A:00:00:00:00:01"

INFO_SPEAKER = """Device AA:BB:CC:DD:EE:01 (public)
	Name: Shower Speaker
	Alias: Shower Speaker
	Class: 0x00240414 (2360340)
	Icon: audio-card
	Paired: {paired}
	Trusted: {paired}
	Connected: {connected}
	UUID: Audio Sink                (0000110b-0000-1000-8000-00805f9b34fb)
	RSSI: 0xffffffc4 (-60)
"""
INFO_PHONE = """Device AA:BB:CC:DD:EE:02 (public)
	Name: Test Phone
	Alias: Test Phone
	Class: 0x005a020c (5898764)
	Icon: phone
	Paired: no
	Connected: no
	RSSI: -50
"""
INFO_BEACON = "Device 4A:00:00:00:00:01 (random)\n\tRSSI: 0xffffff9f (-97)\n"


def dump(sink=True, default=True):
    objs = []
    if sink:
        objs.append(
            {
                "id": 77,
                "type": "PipeWire:Interface:Node",
                "info": {"props": {"media.class": "Audio/Sink", "node.name": "bluez_output.AA_BB_CC_DD_EE_01.1"}},
            }
        )
    objs.append(
        {
            "id": 30,
            "type": "PipeWire:Interface:Metadata",
            "props": {"metadata.name": "default"},
            "metadata": [
                {
                    "key": "default.audio.sink",
                    "value": {"name": "bluez_output.AA_BB_CC_DD_EE_01.1" if default else "auto_null"},
                }
            ],
        }
    )
    return json.dumps(objs)


class FakeBt:
    """Just enough of bluetoothctl, pw-dump, wpctl and pw-play."""

    def __init__(self, paired=False, connected=False, pairable=True, reachable=True):
        self.paired, self.connected = paired, connected
        self.pairable, self.reachable = pairable, reachable
        self.default = False
        self.calls = []
        self.scans = 0

    def info(self, mac):
        if mac == MAC:
            yn = lambda b: "yes" if b else "no"  # noqa: E731
            return INFO_SPEAKER.format(paired=yn(self.paired), connected=yn(self.connected))
        return {PHONE: INFO_PHONE, BEACON: INFO_BEACON}.get(mac, "")

    def __call__(self, argv, timeout=10):
        argv = [a for a in argv if a not in ("--timeout", "25")]
        self.calls.append(tuple(argv))
        cmd = argv[0]
        if cmd == "bluetoothctl":
            verb = argv[1]
            if verb == "devices":
                return 0, "Device %s Shower Speaker\nDevice %s Test Phone\nDevice %s 4A-00-00-00-00-01\n" % (
                    MAC,
                    PHONE,
                    BEACON,
                )
            if verb == "info":
                text = self.info(argv[2])
                return (0, text) if text else (1, "not available")
            if verb == "pair":
                self.paired = self.pairable
                return (0, "Pairing successful") if self.pairable else (1, "Failed to pair")
            if verb == "trust":
                return 0, ""
            if verb == "connect":
                self.connected = self.paired and self.reachable
                return (0, "Connection successful") if self.connected else (1, "Failed to connect")
        if cmd == "pw-dump":
            return 0, dump(sink=self.connected, default=self.default)
        if cmd == "wpctl":
            self.default = True
            return 0, ""
        if cmd == "pw-play":
            return 0, ""
        return 127, "unknown"

    def verbs(self):
        return [c[1] if c[0] == "bluetoothctl" else c[0] for c in self.calls]


class FakeProc:
    def __init__(self):
        self.stopped = False

    def terminate(self):
        self.stopped = True


def make(bt=None, mac=""):
    tmp = tempfile.mkdtemp()
    cfg = s.SpeakerConfig(mac=mac, state_file=os.path.join(tmp, "state", "speaker"))
    bt = bt or FakeBt()
    procs = []

    def spawn(_secs):
        procs.append(FakeProc())
        return procs[-1]

    return s.Speaker(cfg, run=bt, spawn=spawn, sleep=lambda _x: None), bt, procs


class ParseTests(unittest.TestCase):
    def test_config(self):
        cfg = s.speaker_config_from({"BT_SPEAKER": "aa-bb-cc-dd-ee-01", "SPEAKER_API_PORT": "9000"})
        self.assertEqual((cfg.mac, cfg.port, cfg.bind), (MAC, 9000, "0.0.0.0"))
        self.assertTrue(cfg.state_file.endswith(os.path.join("hub-kiosk", "speaker")))
        bad = s.speaker_config_from({"BT_SPEAKER": "nope", "SPEAKER_API_PORT": "x"})
        self.assertEqual((bad.mac, bad.port), ("", 8742))

    def test_parse_devices_and_info(self):
        self.assertEqual(s.parse_devices("Device %s x\njunk\nDevice zz y\n" % MAC), [MAC])
        info = s.parse_info(INFO_SPEAKER.format(paired="yes", connected="no"))
        self.assertEqual(info["name"], "Shower Speaker")
        self.assertEqual((info["paired"], info["connected"], info["rssi"]), (True, False, -60))
        self.assertIn("Audio Sink", info["uuids"])
        self.assertEqual(s.parse_info(INFO_PHONE)["rssi"], -50)  # older bluez format
        self.assertEqual(s.parse_info("Class: zz\n").get("class"), None)

    def test_kind(self):
        self.assertEqual(s.device_kind(s.parse_info(INFO_SPEAKER.format(paired="no", connected="no"))), "speaker")
        self.assertEqual(s.device_kind(s.parse_info(INFO_PHONE)), "phone")
        self.assertEqual(s.device_kind({"class": 0x0404}), "speaker")  # class alone
        self.assertEqual(s.device_kind({"uuids": ["Audio Sink"]}), "speaker")
        self.assertEqual(s.device_kind({"icon": "computer"}), "other")

    def test_bars(self):
        self.assertEqual([s.signal_bars(r) for r in (None, -55, -65, -75, -95)], [0, 4, 3, 2, 1])

    def test_find_sink(self):
        self.assertEqual(s.find_sink(json.loads(dump()), MAC), (77, "bluez_output.AA_BB_CC_DD_EE_01.1", True))
        self.assertEqual(s.find_sink(json.loads(dump(default=False)), MAC)[2], False)
        self.assertEqual(s.find_sink(json.loads(dump(sink=False)), MAC), (None, None, False))
        self.assertEqual(s.find_sink({"not": "a list"}, MAC), (None, None, False))

    def test_chime_is_a_wav(self):
        with wave.open(io.BytesIO(s.chime_wav())) as w:
            self.assertEqual((w.getnchannels(), w.getsampwidth()), (1, 2))
            self.assertGreater(w.getnframes(), 1000)


class SpeakerTests(unittest.TestCase):
    def test_status_states(self):
        sp, bt, _ = make()
        self.assertEqual(sp.status()["state"], "none")
        sp, bt, _ = make(FakeBt(), mac=MAC)
        self.assertEqual(sp.status()["state"], "not_paired")
        bt.paired = True
        self.assertEqual(sp.status()["state"], "off")
        bt.connected = True
        st = sp.status()
        self.assertEqual((st["state"], st["name"], st["defaultSink"]), ("connected", "Shower Speaker", False))
        bt.default = True
        self.assertTrue(sp.status()["defaultSink"])

    def test_scan_lists_named_devices_speakers_first(self):
        sp, bt, procs = make()
        devices = sp.scan()
        self.assertEqual([d["mac"] for d in devices], [MAC, PHONE])  # beacon dropped, speaker first
        self.assertEqual((devices[0]["kind"], devices[0]["bars"]), ("speaker", 4))
        self.assertEqual(devices[1]["kind"], "phone")
        self.assertTrue(procs[0].stopped)

    def test_use_pairs_trusts_connects_and_remembers(self):
        sp, bt, procs = make()
        st = sp.use(MAC.lower())
        self.assertEqual((st["state"], st["defaultSink"]), ("connected", True))
        verbs = bt.verbs()
        self.assertLess(verbs.index("pair"), verbs.index("trust"))
        self.assertLess(verbs.index("trust"), verbs.index("connect"))
        self.assertIn("wpctl", verbs)
        self.assertTrue(procs[0].stopped)  # discovery ran alongside pairing
        self.assertEqual(sp.chosen(), MAC)

    def test_use_already_connected_just_trusts_and_defaults(self):
        sp, bt, _ = make(FakeBt(paired=True, connected=True))
        sp.use(MAC)
        self.assertNotIn("pair", bt.verbs())
        self.assertNotIn("connect", bt.verbs())

    def test_use_errors(self):
        sp, _, _ = make()
        with self.assertRaisesRegex(s.SpeakerError, "not a Bluetooth address"):
            sp.use("nope")
        sp, _, _ = make(FakeBt(pairable=False))
        with self.assertRaisesRegex(s.SpeakerError, "pairing mode"):
            sp.use(MAC)
        self.assertEqual(sp.chosen(), "")  # a failed choice is not remembered
        sp, _, _ = make(FakeBt(reachable=False))
        with self.assertRaisesRegex(s.SpeakerError, "could not connect"):
            sp.use(MAC)

    def test_settings_choice_beats_kiosk_conf(self):
        sp, _, _ = make(FakeBt(), mac="AA:BB:CC:DD:EE:99")
        sp.use(MAC)
        self.assertEqual(sp.chosen(), MAC)

    def test_test_sound(self):
        sp, bt, _ = make(FakeBt(paired=True, connected=True), mac=MAC)
        sp.test()
        play = [c for c in bt.calls if c[0] == "pw-play"][0]
        self.assertEqual(play[1:3], ("--target", "bluez_output.AA_BB_CC_DD_EE_01.1"))
        sp, _, _ = make(FakeBt(paired=True), mac=MAC)
        with self.assertRaisesRegex(s.SpeakerError, "not connected"):
            sp.test()

    def test_tick_reconnects_and_sets_default(self):
        sp, bt, _ = make(FakeBt(paired=True), mac=MAC)
        sp.tick(0)
        self.assertTrue(bt.connected and bt.default)
        self.assertNotIn("pair", bt.verbs())

    def test_tick_rate_limits_pairing_a_configured_speaker(self):
        sp, bt, _ = make(FakeBt(pairable=False), mac=MAC)
        sp.tick(1000)
        sp.tick(1010)
        self.assertEqual(bt.verbs().count("pair"), 1)
        sp.tick(1000 + sp.cfg.repair_seconds)
        self.assertEqual(bt.verbs().count("pair"), 2)

    def test_tick_off_speaker_is_quiet(self):
        sp, bt, _ = make(FakeBt(paired=True, reachable=False), mac=MAC)
        sp.tick(0)  # no raise
        self.assertFalse(bt.connected)
        sp, bt, _ = make()
        sp.tick(0)
        self.assertEqual(bt.calls, [])


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.sp, self.bt, _ = make(FakeBt(paired=True, connected=True), mac=MAC)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), s.make_handler(self.sp, "sekrit"))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def call(self, method, path, body=None, token="sekrit"):
        req = urllib.request.Request(
            self.base + path,
            method=method,
            data=json.dumps(body).encode() if body is not None else (b"" if method == "POST" else None),
            headers={"Authorization": "Bearer " + token} if token else {},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as e:
            with e:
                return e.code, json.loads(e.read())

    def test_auth(self):
        self.assertEqual(self.call("GET", "/speaker", token="")[0], 401)
        self.assertEqual(self.call("GET", "/speaker", token="wrong")[0], 401)

    def test_routes(self):
        code, body = self.call("GET", "/speaker")
        self.assertEqual((code, body["state"]), (200, "connected"))
        code, body = self.call("POST", "/speaker/scan")
        self.assertEqual((code, len(body["devices"])), (200, 2))
        code, body = self.call("POST", "/speaker/use", {"mac": MAC})
        self.assertEqual((code, body["state"]), (200, "connected"))
        self.assertEqual(self.call("POST", "/speaker/test"), (200, {"ok": True}))
        self.assertEqual(self.call("GET", "/nope")[0], 404)

    def test_errors_are_409_with_a_message(self):
        code, body = self.call("POST", "/speaker/use", {"mac": "bad"})
        self.assertEqual(code, 409)
        self.assertIn("Bluetooth address", body["error"])
        code, _ = self.call("POST", "/speaker/use", ["not", "an", "object"])
        self.assertEqual(code, 409)


class StartTests(unittest.TestCase):
    def test_api_off_without_token(self):
        tmp = tempfile.mkdtemp()
        sp = s.start({"SPEAKER_API_TOKEN_FILE": os.path.join(tmp, "missing")})
        self.assertIsInstance(sp, s.Speaker)
        self.assertEqual(s.read_token(os.path.join(tmp, "missing")), "")


if __name__ == "__main__":
    unittest.main()
