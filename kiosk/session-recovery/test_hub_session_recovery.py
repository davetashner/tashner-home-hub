"""Unit tests for the session recovery decision logic. Run: python3 -m unittest (in this folder)."""

import unittest

import hub_session_recovery as r

KIOSK = [("kiosk", "seat0", "wayland")]
GREETER = [("lightdm", "seat0", "x11")]
DAVE_TTY1 = ("dave", "seat0", "tty")
G = 120.0


class ParseTests(unittest.TestCase):
    def test_parse_session_ids(self):
        text = "    195 1001 kiosk seat0 96767 user - no -\n    205 1000 dave - 97889 user - no -\n      3 1000 dave seat0 1084 user tty1 yes 4 days ago\n"
        self.assertEqual(r.parse_session_ids(text), ["195", "205", "3"])
        self.assertEqual(r.parse_session_ids(""), [])

    def test_parse_session(self):
        self.assertEqual(r.parse_session("Name=kiosk\nSeat=seat0\nType=wayland\nClass=user\n"), ("kiosk", "seat0", "wayland"))
        self.assertEqual(r.parse_session("Name=dave\nSeat=\nType=tty\nClass=user\n"), ("dave", "-", "tty"))
        self.assertIsNone(r.parse_session("Name=lightdm\nSeat=seat0\nType=wayland\nClass=greeter\n"))
        self.assertIsNone(r.parse_session(""))

    def test_grace_from_conf(self):
        self.assertEqual(r.grace_from_conf({}), 120)
        self.assertEqual(r.grace_from_conf({"SESSION_RECOVERY_MINUTES": "5"}), 300)
        self.assertEqual(r.grace_from_conf({"SESSION_RECOVERY_MINUTES": "0"}), 0)
        self.assertEqual(r.grace_from_conf({"SESSION_RECOVERY_MINUTES": "x"}), 120)


class DecideTests(unittest.TestCase):
    def test_kiosk_session_present_is_ok_and_clears_the_clock(self):
        self.assertEqual(r.decide({"missing_since": 5}, KIOSK, True, 100, G), ("ok", {"missing_since": None}))

    def test_first_sighting_starts_the_clock(self):
        self.assertEqual(r.decide(None, GREETER, True, 100, G), ("wait", {"missing_since": 100}))

    def test_waits_until_the_grace_period(self):
        self.assertEqual(r.decide({"missing_since": 100}, GREETER, True, 219, G), ("wait", {"missing_since": 100}))

    def test_restarts_after_the_grace_period_then_resets_the_clock(self):
        self.assertEqual(r.decide({"missing_since": 100}, GREETER, True, 220, G), ("restart", {"missing_since": 220}))

    def test_no_sessions_at_all_also_restarts(self):
        self.assertEqual(r.decide({"missing_since": 0}, [], True, 500, G)[0], "restart")

    def test_other_user_on_seat0_is_left_alone(self):
        a, s = r.decide({"missing_since": 0}, GREETER + [("dave", "seat0", "wayland")], True, 9999, G)
        self.assertEqual((a, s), ("skip-other-user", {"missing_since": None}))

    def test_text_console_login_on_seat0_does_not_block_recovery(self):
        # Pi, 2026-10-21: kiosk session gone, dave on tty1 for 4 days and over ssh.
        pi = [DAVE_TTY1, ("dave", "-", "tty")]
        self.assertEqual(r.decide({"missing_since": 0}, pi, True, 9999, G), ("restart", {"missing_since": 9999}))

    def test_kiosk_session_without_a_compositor_is_not_running(self):
        self.assertEqual(r.decide({"missing_since": 0}, [("kiosk", "seat0", "tty")], True, 9999, G)[0], "restart")

    def test_remote_session_without_a_seat_does_not_block(self):
        self.assertEqual(r.decide({"missing_since": 0}, GREETER + [("dave", "-", "wayland")], True, 9999, G)[0], "restart")

    def test_lightdm_down_never_restarts(self):
        self.assertEqual(r.decide({"missing_since": 0}, [], False, 9999, G), ("skip-no-lightdm", {"missing_since": None}))

    def test_disabled_with_zero_minutes(self):
        self.assertEqual(r.decide({"missing_since": 0}, [], True, 9999, 0)[0], "off")

    def test_stale_state_from_the_future_restarts_the_clock(self):
        self.assertEqual(r.decide({"missing_since": 5000}, GREETER, True, 100, G), ("wait", {"missing_since": 100}))


if __name__ == "__main__":
    unittest.main()
