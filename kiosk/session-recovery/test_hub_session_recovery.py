"""Unit tests for the session recovery decision logic. Run: python3 -m unittest (in this folder)."""

import unittest

import hub_session_recovery as r

KIOSK = [("kiosk", "seat0")]
GREETER = [("lightdm", "seat0")]
G = 120.0


class ParseTests(unittest.TestCase):
    def test_parse_sessions(self):
        text = "  c1 110 lightdm seat0 810 greeter tty7 no -\n  3 1000 dave seat0 1234 user tty1 no -\n  5 0 root - 99 user - no -\n"
        self.assertEqual(r.parse_sessions(text), [("lightdm", "seat0"), ("dave", "seat0"), ("root", "-")])
        self.assertEqual(r.parse_sessions(""), [])

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
        a, s = r.decide({"missing_since": 0}, GREETER + [("dave", "seat0")], True, 9999, G)
        self.assertEqual((a, s), ("skip-other-user", {"missing_since": None}))

    def test_remote_session_without_a_seat_does_not_block(self):
        self.assertEqual(r.decide({"missing_since": 0}, GREETER + [("dave", "-")], True, 9999, G)[0], "restart")

    def test_lightdm_down_never_restarts(self):
        self.assertEqual(r.decide({"missing_since": 0}, [], False, 9999, G), ("skip-no-lightdm", {"missing_since": None}))

    def test_disabled_with_zero_minutes(self):
        self.assertEqual(r.decide({"missing_since": 0}, [], True, 9999, 0)[0], "off")

    def test_stale_state_from_the_future_restarts_the_clock(self):
        self.assertEqual(r.decide({"missing_since": 5000}, GREETER, True, 100, G), ("wait", {"missing_since": 100}))


if __name__ == "__main__":
    unittest.main()
