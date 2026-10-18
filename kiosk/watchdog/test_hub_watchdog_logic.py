"""Unit tests for the watchdog decision logic. Run: python3 -m unittest (in this folder)."""

import unittest

import hub_watchdog_logic as w


class TitleTests(unittest.TestCase):
    def test_error_titles(self):
        for t in ["500", "500 Internal Error", "Internal Error", "502 Bad Gateway", "Service Unavailable"]:
            self.assertTrue(w.is_hub_error_title(t), t)

    def test_normal_titles(self):
        for t in ["Home Hub", "Calendar", "", None, "Chores 500 stars"]:
            self.assertFalse(w.is_hub_error_title(t), t)


class DecideTests(unittest.TestCase):
    def test_healthy_page_resets_state(self):
        a, s = w.decide({"attempts": 3, "next_at": 999}, "Home Hub", True, 10)
        self.assertEqual((a, s), ("wait", {"attempts": 0, "next_at": 0}))

    def test_error_page_hub_down_waits_without_burning_backoff(self):
        a, s = w.decide({}, "500 Internal Error", False, 100)
        self.assertEqual((a, s), ("wait", {"attempts": 0, "next_at": 0}))

    def test_error_page_hub_up_reloads(self):
        a, s = w.decide({}, "500 Internal Error", True, 100)
        self.assertEqual((a, s), ("reload", {"attempts": 1, "next_at": 130}))

    def test_backoff_blocks_immediate_second_reload(self):
        _, s = w.decide({}, "500", True, 100)
        a, _ = w.decide(s, "500", True, 110)
        self.assertEqual(a, "wait")
        a, s2 = w.decide(s, "500", True, 130)
        self.assertEqual((a, s2["next_at"]), ("reload", 190))

    def test_backoff_is_capped(self):
        a, s = w.decide({"attempts": 20, "next_at": 0}, "500", True, 1000)
        self.assertEqual((a, s["next_at"]), ("reload", 1000 + w.MAX_DELAY))

    def test_recovery_clears_backoff(self):
        _, s = w.decide({}, "500", True, 100)
        _, s = w.decide(s, "Home Hub", True, 105)
        a, _ = w.decide(s, "500", True, 106)
        self.assertEqual(a, "reload")


if __name__ == "__main__":
    unittest.main()
