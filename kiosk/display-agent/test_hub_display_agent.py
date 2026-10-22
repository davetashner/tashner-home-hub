"""Unit tests for the display agent decision logic. Run: python3 -m unittest (in this folder)."""

import errno
import selectors
import socket
import struct
import threading
import unittest

import hub_display_agent as h

WLR_ON = 'HDMI-A-1 "ViewSonic (HDMI-A-1)"\n  Enabled: yes\n  Modes:\n    2560x1440 px\n'
WLR_OFF = 'HDMI-A-1 "ViewSonic (HDMI-A-1)"\n  Enabled: no\n'


class FakeRun:
    def __init__(self, listing=WLR_ON, fail=()):
        self.calls, self.listing, self.fail = [], listing, set(fail)
        self.cec_timeouts = []

    def __call__(self, argv, input_text=None, timeout=None):
        argv = tuple(argv)
        self.calls.append((argv, input_text))
        if argv[0] == "cec-ctl" and timeout is not None:
            self.cec_timeouts.append(timeout)
        if argv[0] in self.fail or (argv[0], argv[-1]) in self.fail:
            return 1, "boom"
        if argv == ("wlr-randr",):
            return 0, self.listing
        return 0, ""

    def commands(self):
        return [c[0] for c in self.calls if c[0] != ("wlr-randr",)]


class FakeHub:
    def __init__(self, power="on", reason="schedule"):
        self.state = {"power": power, "reason": reason}
        self.down = False
        self.wakes = 0

    def get_power(self):
        if self.down:
            raise h.HubError("down")
        return dict(self.state)

    def post_wake(self):
        if self.down:
            raise h.HubError("down")
        self.wakes += 1
        self.state = {"power": "on", "reason": "wake"}
        return dict(self.state)


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def make(listing=WLR_ON, hub=None, cfg=None, fail=()):
    run = FakeRun(listing, fail)
    cfg = cfg or h.Config(output="HDMI-A-1")
    clock = Clock()
    hub = hub or FakeHub()
    return h.Agent(cfg, h.Screen(cfg, run), hub, clock), run, hub, clock


class ParseTests(unittest.TestCase):
    def test_conf_ignores_comments_and_quotes(self):
        conf = h.parse_conf('# c\nHUB_URL="http://x:1"  # tail\nOUTPUT=HDMI-A-2\nEMPTY=""\nbad line\n')
        self.assertEqual(conf, {"HUB_URL": "http://x:1", "OUTPUT": "HDMI-A-2", "EMPTY": ""})

    def test_config_defaults_and_overrides(self):
        cfg = h.config_from({"HUB_URL": "http://x:1/", "POWER_POLL_SECONDS": "0.1", "CEC_BACKEND": "cec-ctl"})
        self.assertEqual(cfg.hub_url, "http://x:1")
        self.assertEqual(cfg.poll_seconds, 0.5)  # clamped
        self.assertEqual(cfg.cec_backend, "cec-ctl")

    def test_parse_outputs(self):
        self.assertEqual(h.parse_outputs(WLR_OFF), [("HDMI-A-1", False)])
        two = WLR_ON + 'HDMI-A-2 "x"\n  Enabled: no\n'
        self.assertEqual(h.parse_outputs(two), [("HDMI-A-1", True), ("HDMI-A-2", False)])


class ScreenTests(unittest.TestCase):
    def test_off_and_on_commands(self):
        a, run, _, _ = make()
        a.screen.set_power(False)
        a.screen.set_power(True)
        self.assertEqual(
            run.commands(),
            [("wlr-randr", "--output", "HDMI-A-1", "--off"), ("wlr-randr", "--output", "HDMI-A-1", "--on")],
        )

    def test_autodetects_when_output_unset_or_unknown(self):
        for configured in ("", "HDMI-A-9"):
            cfg = h.Config(output=configured)
            run = FakeRun(WLR_ON)
            h.Screen(cfg, run).set_power(False)
            self.assertEqual(run.commands(), [("wlr-randr", "--output", "HDMI-A-1", "--off")])

    def test_cec_fallback_ctl(self):
        cfg = h.Config(output="HDMI-A-1", cec_backend="cec-ctl")
        run = FakeRun(fail=[("wlr-randr", "--off")])
        self.assertTrue(h.Screen(cfg, run).set_power(False))
        self.assertEqual(run.commands()[-1], ("cec-ctl", "-d", "/dev/cec0", "--to", "0", "--standby"))

    def test_cec_fallback_client_uses_stdin(self):
        cfg = h.Config(output="HDMI-A-1", cec_backend="cec-client")
        run = FakeRun(fail=[("wlr-randr", "--on")])
        self.assertTrue(h.Screen(cfg, run).set_power(True))
        self.assertEqual(run.calls[-1], (("cec-client", "-s", "-d", "1"), "on 0\n"))

    def test_failure_without_cec(self):
        cfg = h.Config(output="HDMI-A-1")
        self.assertFalse(h.Screen(cfg, FakeRun(fail=["wlr-randr"])).set_power(False))

    def test_cec_not_tried_when_wlr_works(self):
        cfg = h.Config(output="HDMI-A-1", cec_backend="cec-ctl")
        run = FakeRun()
        h.Screen(cfg, run).set_power(False)
        self.assertEqual(len(run.commands()), 1)


WLR_NOOP = 'NOOP-1 "Unknown (NOOP-1)"\n  Enabled: yes\n'
WLR_BOTH = WLR_NOOP + WLR_ON


class PlaceholderOutputTests(unittest.TestCase):
    """hub-2ik: wlroots NOOP-*/HEADLESS-* outputs exist when no display is attached; never toggle them."""

    def test_is_placeholder(self):
        for n in ("NOOP-1", "HEADLESS-2", "noop-1"):
            self.assertTrue(h.is_placeholder_output(n), n)
        for n in ("HDMI-A-1", "DSI-1", "Virtual-1"):
            self.assertFalse(h.is_placeholder_output(n), n)

    def test_only_placeholder_skips_wlr_randr_and_logs_once(self):
        for listing in (WLR_NOOP, 'HEADLESS-1 "x"\n  Enabled: yes\n'):
            run = FakeRun(listing)
            s = h.Screen(h.Config(output="HDMI-A-1"), run)
            with self.assertLogs(h.log, "WARNING") as cm:
                self.assertFalse(s.set_power(True))
                self.assertFalse(s.set_power(False))
            self.assertEqual(run.commands(), [])
            self.assertEqual(len([m for m in cm.output if "placeholder" in m]), 1)

    def test_only_placeholder_falls_back_to_cec(self):
        cfg = h.Config(output="HDMI-A-1", cec_backend="cec-ctl")
        run = FakeRun(WLR_NOOP)
        self.assertTrue(h.Screen(cfg, run).set_power(True))
        self.assertEqual(run.commands(), [("cec-ctl", "-d", "/dev/cec0", "--to", "0", "--image-view-on")])

    def test_real_output_wins_over_placeholder(self):
        for configured in ("", "HDMI-A-1", "NOOP-1"):
            run = FakeRun(WLR_BOTH)
            h.Screen(h.Config(output=configured), run).set_power(False)
            self.assertEqual(run.commands(), [("wlr-randr", "--output", "HDMI-A-1", "--off")], configured)

    def test_probe_ignores_placeholders(self):
        cfg = h.Config(output="HDMI-A-1")
        self.assertIsNone(h.Screen(cfg, FakeRun(WLR_NOOP)).probe())
        self.assertIs(h.Screen(cfg, FakeRun(WLR_BOTH)).probe(), True)
        self.assertIs(h.Screen(cfg, FakeRun(WLR_NOOP + WLR_OFF)).probe(), False)

    def test_resumes_when_a_real_output_appears(self):
        s = h.Screen(h.Config(output="HDMI-A-1"), FakeRun(WLR_NOOP))
        self.assertFalse(s.set_power(True))
        s.run = FakeRun(WLR_ON)
        self.assertTrue(s.set_power(True))
        self.assertEqual(s.run.commands(), [("wlr-randr", "--output", "HDMI-A-1", "--on")])


class SyncScreen(h.Screen):
    """Runs the background CEC wake inline so tests are deterministic."""

    def _cec_async(self, on):
        t = threading.Thread(target=self._cec_send, args=(on,))
        t.start()
        t.join()
        return t


CTL = "/dev/cec0"
STANDBY = ("cec-ctl", "-d", CTL, "--to", "0", "--standby")
IMAGE_ON = ("cec-ctl", "-d", CTL, "--to", "0", "--image-view-on")
ACTIVE = ("cec-ctl", "-d", CTL, "--active-source")


def also(backend="cec-ctl", fail=(), **kw):
    cfg = h.Config(output="HDMI-A-1", cec_backend=backend, cec_mode="also", **kw)
    run = FakeRun(fail=fail)
    return SyncScreen(cfg, run), run


class CecAlsoTests(unittest.TestCase):
    def test_config_parsing(self):
        self.assertEqual(h.config_from({}).cec_mode, "fallback")
        self.assertEqual(h.config_from({"CEC_MODE": "also"}).cec_mode, "also")
        self.assertEqual(h.config_from({"CEC_MODE": "bogus"}).cec_mode, "fallback")
        self.assertEqual(h.config_from({"CEC_TIMEOUT_SECONDS": "0"}).cec_timeout_seconds, 1.0)

    def test_off_blanks_hdmi_then_standby(self):
        s, run = also()
        self.assertTrue(s.set_power(False))
        self.assertEqual(run.commands(), [("wlr-randr", "--output", "HDMI-A-1", "--off"), STANDBY])

    def test_on_sends_power_on_and_active_source_and_hdmi_on(self):
        s, run = also()
        self.assertTrue(s.set_power(True))
        cmds = run.commands()
        self.assertEqual(cmds[0], IMAGE_ON)  # CEC started first, HDMI not held up behind it
        self.assertEqual(cmds[1], ACTIVE)
        self.assertEqual(cmds[2], ("wlr-randr", "--output", "HDMI-A-1", "--on"))

    def test_only_on_transitions(self):
        s, run = also()
        s.set_power(False)
        s.set_power(False)
        self.assertEqual(run.commands().count(STANDBY), 1)
        s.set_power(True)
        s.set_power(True)
        self.assertEqual(run.commands().count(IMAGE_ON), 1)

    def test_cec_failure_never_breaks_power(self):
        s, run = also(fail=["cec-ctl"])
        self.assertTrue(s.set_power(False))
        self.assertTrue(s.set_power(True))
        self.assertIsNone(s.cec_state)  # failed sends are retried on the next transition

    def test_cec_exception_is_contained(self):
        s, run = also()
        orig = s.run

        def boom(argv, input_text=None, timeout=None):
            if argv[0] == "cec-ctl":
                raise RuntimeError("bus gone")
            return orig(argv, input_text, timeout)

        s.run = boom
        self.assertTrue(s.set_power(False))

    def test_timeout_passed_to_cec_only_in_also_mode(self):
        s, run = also(cec_timeout_seconds=3.0)
        s.set_power(False)
        self.assertEqual(run.cec_timeouts, [3.0])
        cfg = h.Config(output="HDMI-A-1", cec_backend="cec-ctl")
        run2 = FakeRun(fail=[("wlr-randr", "--off")])
        h.Screen(cfg, run2).set_power(False)
        self.assertEqual(run2.cec_timeouts, [])

    def test_wlr_failure_uses_cec_without_double_standby(self):
        s, run = also(fail=[("wlr-randr", "--off")])
        self.assertTrue(s.set_power(False))
        self.assertEqual(run.commands().count(STANDBY), 1)

    def test_wlr_failure_on_wake_counts_cec_result(self):
        s, run = also(fail=[("wlr-randr", "--on")])
        self.assertTrue(s.set_power(True))
        s2, _ = also(fail=[("wlr-randr", "--on"), "cec-ctl"])
        self.assertFalse(s2.set_power(True))

    def test_cec_client_commands(self):
        s, run = also("cec-client")
        s.set_power(False)
        s.set_power(True)
        cc = [c for c in run.calls if c[0][0] == "cec-client"]
        self.assertEqual(cc[0], (("cec-client", "-s", "-d", "1"), "standby 0\n"))
        self.assertEqual(cc[1], (("cec-client", "-s", "-d", "1"), "on 0\nas\n"))

    def test_fallback_mode_unchanged(self):
        cfg = h.Config(output="HDMI-A-1", cec_backend="cec-ctl")  # cec_mode defaults to fallback
        run = FakeRun()
        h.Screen(cfg, run).set_power(False)
        h.Screen(cfg, run).set_power(True)
        self.assertEqual(len(run.commands()), 2)

    def test_wake_does_not_wait_for_a_slow_cec(self):
        started, release = threading.Event(), threading.Event()
        cfg = h.Config(output="HDMI-A-1", cec_backend="cec-ctl", cec_mode="also")
        inner = FakeRun()

        def run(argv, input_text=None, timeout=None):
            if argv[0] == "cec-ctl":
                started.set()
                release.wait(5)
            return inner(argv, input_text, timeout)

        s = h.Screen(cfg, run)
        self.assertTrue(s.set_power(True))  # returns while the cec-ctl call is still blocked
        self.assertTrue(started.wait(2))
        self.assertIn(("wlr-randr", "--output", "HDMI-A-1", "--on"), inner.commands())
        self.assertFalse(release.is_set())
        release.set()

    def test_agent_sends_cec_once_per_transition(self):
        cfg = h.Config(output="HDMI-A-1", cec_backend="cec-ctl", cec_mode="also")
        run = FakeRun()
        hub, clock = FakeHub(power="off"), Clock()
        a = h.Agent(cfg, SyncScreen(cfg, run), hub, clock)
        for _ in range(3):
            a.poll()
        hub.state = {"power": "on", "reason": "schedule"}
        for _ in range(3):
            a.poll()
        self.assertEqual(run.commands().count(STANDBY), 1)
        self.assertEqual(run.commands().count(IMAGE_ON), 1)


class AgentTests(unittest.TestCase):
    def test_follows_hub_power_and_does_not_repeat_commands(self):
        a, run, hub, _ = make()
        hub.state = {"power": "off", "reason": "sleep-now"}
        a.poll()
        a.poll()
        self.assertEqual(len(run.commands()), 1)
        hub.state = {"power": "on", "reason": "schedule"}
        a.poll()
        self.assertEqual(run.commands()[-1][-1], "--on")
        self.assertEqual(len(run.commands()), 2)

    def test_start_state_is_probed(self):
        a, run, hub, _ = make(listing=WLR_OFF)
        self.assertIs(a.lit, False)
        hub.state = {"power": "off", "reason": "schedule"}
        a.poll()
        self.assertEqual(run.commands(), [])

    def test_failed_switch_is_retried_next_poll(self):
        a, run, hub, _ = make(fail=[("wlr-randr", "--off")])
        hub.state = {"power": "off", "reason": "sleep-now"}
        a.poll()
        a.poll()
        self.assertEqual(len(run.commands()), 2)
        self.assertIs(a.lit, True)

    def test_hub_down_keeps_screen_and_backs_off(self):
        a, run, hub, _ = make()
        hub.down = True
        waits = [a.poll() for _ in range(10)]
        self.assertEqual(run.commands(), [])
        self.assertEqual(waits[0], 2.0)
        self.assertEqual(waits[-1], 30.0)
        self.assertEqual(waits, sorted(waits))
        hub.down = False
        self.assertEqual(a.poll(), 1.0)

    def test_touch_while_off_wakes_first_then_tells_hub(self):
        a, run, hub, _ = make(listing=WLR_OFF)
        hub.state = {"power": "off", "reason": "schedule"}
        a.poll()
        a.touch()
        self.assertEqual(run.commands()[-1][-1], "--on")
        self.assertEqual(hub.wakes, 1)
        self.assertIs(a.lit, True)
        a.poll()  # hub now says on (reason wake)
        self.assertIs(a.lit, True)

    def test_night_resleep_follows_hub(self):
        a, run, hub, _ = make(listing=WLR_OFF)
        a.touch()
        hub.state = {"power": "off", "reason": "schedule"}  # hub's re-sleep timeout elapsed
        a.poll()
        self.assertEqual(run.commands()[-1][-1], "--off")
        self.assertIs(a.lit, False)

    def test_touch_when_hub_down_holds_screen_on(self):
        a, run, hub, clock = make(listing=WLR_OFF)
        hub.down = True
        a.touch()
        self.assertIs(a.lit, True)
        hub.down = False
        hub.state = {"power": "off", "reason": "schedule"}
        a.poll()
        self.assertIs(a.lit, True)  # still within the hold
        clock.t += a.cfg.offline_hold_seconds + 1
        a.poll()
        self.assertIs(a.lit, False)

    def test_touch_while_on_restarts_timeout_only_at_night_and_throttled(self):
        a, _, hub, clock = make(listing=WLR_OFF)
        a.touch()  # woke; reason "wake"
        self.assertEqual(hub.wakes, 1)
        a.touch()
        self.assertEqual(hub.wakes, 1)  # throttled
        clock.t += a.cfg.wake_repost_seconds
        a.touch()
        self.assertEqual(hub.wakes, 2)

    def test_touch_while_on_by_day_makes_no_calls(self):
        a, run, hub, _ = make()
        a.poll()
        a.touch()
        self.assertEqual(hub.wakes, 0)
        self.assertEqual(run.commands(), [])


class TouchParseTests(unittest.TestCase):
    @staticmethod
    def ev(etype, code, value):
        return struct.pack(h.EVENT_FORMAT, 0, 0, etype, code, value)

    def test_btn_touch_down(self):
        self.assertTrue(h.parse_touch_down(self.ev(h.EV_KEY, h.BTN_TOUCH, 1)))

    def test_btn_touch_up_is_not_a_touch(self):
        self.assertFalse(h.parse_touch_down(self.ev(h.EV_KEY, h.BTN_TOUCH, 0)))

    def test_multitouch_tracking_id(self):
        self.assertTrue(h.parse_touch_down(self.ev(h.EV_ABS, h.ABS_MT_TRACKING_ID, 7)))
        self.assertFalse(h.parse_touch_down(self.ev(h.EV_ABS, h.ABS_MT_TRACKING_ID, -1)))

    def test_moves_and_partial_events_ignored(self):
        move = self.ev(h.EV_ABS, h.ABS_MT_POSITION_X, 100)
        self.assertFalse(h.parse_touch_down(move + move[:5]))
        self.assertFalse(h.parse_touch_down(b""))

    def test_burst_with_touch_down_in_middle(self):
        buf = self.ev(0, 0, 0) + self.ev(h.EV_KEY, h.BTN_TOUCH, 1) + self.ev(0, 0, 0)
        self.assertTrue(h.parse_touch_down(buf))

    def test_capability_detection(self):
        def mask(*bits, size=96):
            m = bytearray(size)
            for b in bits:
                m[b // 8] |= 1 << (b % 8)
            return bytes(m)

        self.assertTrue(h.is_touch_device(mask(h.ABS_MT_POSITION_X, size=8), mask()))
        self.assertTrue(h.is_touch_device(mask(h.ABS_X, size=8), mask(h.BTN_TOUCH)))
        self.assertFalse(h.is_touch_device(mask(h.ABS_X, size=8), mask()))  # e.g. a joystick
        self.assertFalse(h.is_touch_device(mask(size=8), mask(h.BTN_TOUCH)))


class GrabTests(unittest.TestCase):
    def test_agent_wants_grab_only_while_off_or_waking(self):
        agent, _, _, _ = make(listing=WLR_OFF)
        self.assertTrue(agent.wants_grab())
        agent.touch()
        self.assertTrue(agent.lit)
        self.assertTrue(agent.wants_grab())  # screen on, but the wake finger is still down
        agent.touch_ended()
        self.assertFalse(agent.wants_grab())

    def test_no_grab_when_on_or_unknown(self):
        agent, _, _, _ = make(listing=WLR_ON)
        self.assertFalse(agent.wants_grab())
        agent.lit = None
        self.assertFalse(agent.wants_grab())

    def test_touch_while_on_does_not_grab(self):
        agent, _, _, _ = make(listing=WLR_ON)
        agent.touch()
        self.assertFalse(agent.wants_grab())

    def test_touch_state_follows_btn_touch_and_tracking_id(self):
        ev = TouchParseTests.ev
        self.assertTrue(h.touch_state(ev(h.EV_KEY, h.BTN_TOUCH, 1), False))
        self.assertFalse(h.touch_state(ev(h.EV_KEY, h.BTN_TOUCH, 0), True))
        self.assertFalse(h.touch_state(ev(h.EV_ABS, h.ABS_MT_TRACKING_ID, -1), True))
        self.assertTrue(h.touch_state(ev(h.EV_ABS, h.ABS_MT_TRACKING_ID, 3), False))
        self.assertTrue(h.touch_state(ev(h.EV_ABS, h.ABS_MT_POSITION_X, 5), True))

    def _watcher(self, calls):
        w = h.TouchWatcher("", ioctl=lambda fd, req, arg: calls.append((fd, req, arg)))
        a, b = socket.socketpair()
        self.addCleanup(a.close)
        self.addCleanup(b.close)
        w.sel.register(a.fileno(), selectors.EVENT_READ, "/dev/input/event0")
        w.down[a.fileno()] = False
        return w, a.fileno()

    def test_eviocgrab_request_number(self):
        self.assertEqual(h.EVIOCGRAB, 0x40044590)

    def test_grab_and_release_use_eviocgrab(self):
        calls = []
        w, fd = self._watcher(calls)
        w.set_grab(True)
        w.set_grab(True)  # idempotent
        w.set_grab(False)
        self.assertEqual(calls, [(fd, h.EVIOCGRAB, 1), (fd, h.EVIOCGRAB, 0)])

    def test_grab_waits_for_finger_up(self):
        calls = []
        w, fd = self._watcher(calls)
        w.down[fd] = True
        w.set_grab(True)
        self.assertEqual(calls, [])
        w.down[fd] = False
        w.set_grab(True)
        self.assertEqual(calls, [(fd, h.EVIOCGRAB, 1)])

    def test_failed_ioctl_does_not_raise(self):
        def boom(fd, req, arg):
            raise OSError(errno.EBUSY, "busy")

        w = h.TouchWatcher("", ioctl=boom)
        a, b = socket.socketpair()
        self.addCleanup(a.close)
        self.addCleanup(b.close)
        w.sel.register(a.fileno(), selectors.EVENT_READ, "x")
        w.set_grab(True)
        self.assertTrue(w.grabbed)


class MouseWakeTests(unittest.TestCase):
    ev = staticmethod(TouchParseTests.ev)
    EV_REL, REL_X = 0x02, 0x00

    def test_input_mouse_enables_it(self):
        self.assertTrue(h.config_from({"INPUT": "mouse"}).mouse)
        self.assertFalse(h.config_from({"INPUT": "touch"}).mouse)
        self.assertFalse(h.config_from({}).mouse)

    def test_press_wakes_but_movement_and_repeat_do_not(self):
        self.assertTrue(h.parse_key_press(self.ev(h.EV_KEY, h.BTN_LEFT, 1)))
        self.assertTrue(h.parse_key_press(self.ev(h.EV_KEY, h.KEY_SPACE, 1)))
        self.assertFalse(h.parse_key_press(self.ev(self.EV_REL, self.REL_X, 5)))
        self.assertFalse(h.parse_key_press(self.ev(h.EV_KEY, h.BTN_LEFT, 0)))
        self.assertFalse(h.parse_key_press(self.ev(h.EV_KEY, h.KEY_A, 2)))  # auto-repeat

    def test_keys_held(self):
        down = h.keys_held(self.ev(h.EV_KEY, h.BTN_LEFT, 1) + self.ev(h.EV_KEY, h.KEY_A, 1), frozenset())
        self.assertEqual(down, {h.BTN_LEFT, h.KEY_A})
        self.assertEqual(h.keys_held(self.ev(h.EV_KEY, h.KEY_A, 0), down), {h.BTN_LEFT})
        self.assertEqual(h.keys_held(self.ev(self.EV_REL, self.REL_X, 1), down), down)

    def test_wake_devices(self):
        def mask(*bits, size=96):
            m = bytearray(size)
            for b in bits:
                m[b // 8] |= 1 << (b % 8)
            return bytes(m)

        no_abs = mask(size=8)
        mouse, keyboard = mask(h.BTN_LEFT), mask(h.KEY_A, h.KEY_Z, h.KEY_SPACE)
        self.assertTrue(h.is_wake_device(no_abs, mouse, True))
        self.assertTrue(h.is_wake_device(no_abs, keyboard, True))
        self.assertFalse(h.is_wake_device(no_abs, mouse, False))  # touch mode: touch only
        self.assertFalse(h.is_wake_device(no_abs, mask(116), True))  # KEY_POWER: power button
        self.assertFalse(h.is_wake_device(no_abs, mask(1, 28, 103), True))  # CEC remote keys
        self.assertTrue(h.is_wake_device(mask(h.ABS_MT_POSITION_X, size=8), mask(), True))

    def _watcher(self, mouse=True):
        w = h.TouchWatcher("", ioctl=lambda fd, req, arg: None, mouse=mouse)
        w.last_scan = float("inf")  # no rescans of the real /dev/input
        a, b = socket.socketpair()
        self.addCleanup(a.close)
        self.addCleanup(b.close)
        w.sel.register(a.fileno(), selectors.EVENT_READ, "/dev/input/event9")
        w.down[a.fileno()] = False
        w.keys[a.fileno()] = frozenset()
        return w, b

    def test_click_wakes_and_holds_the_grab_until_release(self):
        w, b = self._watcher()
        b.send(self.ev(self.EV_REL, self.REL_X, 3))
        self.assertFalse(w.wait(0.2))  # a bumped mouse
        b.send(self.ev(h.EV_KEY, h.BTN_LEFT, 1))
        self.assertTrue(w.wait(0.2))
        self.assertTrue(w.touching)  # Agent.waking holds the grab until this clears
        b.send(self.ev(h.EV_KEY, h.BTN_LEFT, 0))
        self.assertFalse(w.wait(0.2))
        self.assertFalse(w.touching)

    def test_touch_mode_ignores_clicks(self):
        w, b = self._watcher(mouse=False)
        b.send(self.ev(h.EV_KEY, h.BTN_LEFT, 1))
        self.assertFalse(w.wait(0.2))
        self.assertFalse(w.touching)


class HubClientTests(unittest.TestCase):
    def test_wake_is_a_json_post(self):
        """SvelteKit rejects form-encoded cross-site POSTs with 403, so the body must be JSON."""
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

        seen = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                seen.append((self.path, self.headers.get("Content-Type")))
                self.rfile.read(int(self.headers.get("Content-Length") or 0))
                ok = self.headers.get("Content-Type") == "application/json"
                body = b'{"power": "on", "reason": "wake"}' if ok else b"Cross-site POST"
                self.send_response(200 if ok else 403)
                self.end_headers()
                self.wfile.write(body)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        hub = h.HubClient("http://127.0.0.1:%d/" % server.server_address[1])
        self.assertEqual(hub.post_wake()["power"], "on")
        self.assertEqual(seen, [("/api/display/wake", "application/json")])


if __name__ == "__main__":
    unittest.main()
