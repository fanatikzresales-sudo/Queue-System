#!/usr/bin/env python3
"""Tests for queue delay alignment math."""

import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from queue_calculator import (
    CENTRAL,
    all_exact_alignment_options,
    build_schedule,
    delay_for_exact_alignment,
    ms_between,
    next_wednesday_target,
    pick_checkpoint_options,
)

CT = CENTRAL


def ct(h: int, m: int, s: int = 0) -> datetime:
    return datetime(2026, 7, 8, h, m, s, tzinfo=CT)  # Wednesday


class TestAlignment(unittest.TestCase):
    def test_delay_for_exact_alignment_three_minutes(self):
        switch_at = ct(7, 57)
        target = ct(8, 0)
        self.assertEqual(delay_for_exact_alignment(switch_at, target, 120), 1500)
        self.assertEqual(delay_for_exact_alignment(switch_at, target, 1), 180_000)

    def test_one_hour_ten_second_interval(self):
        switch_at = ct(7, 0)
        target = ct(8, 0)
        self.assertEqual(delay_for_exact_alignment(switch_at, target, 360), 10_000)

    def test_three_minute_precise_option(self):
        switch_at = ct(7, 57)
        target = ct(8, 0)
        options = pick_checkpoint_options(switch_at, target, 500, 30_000, 10_000)
        precise = next(o for o in options if o.tier == "precise")
        self.assertEqual(precise.delay_ms, 1500)
        self.assertEqual(precise.refreshes_until_target, 120)

    def test_simulation_hits_target(self):
        now = ct(7, 57)
        target = ct(8, 0)
        _, precise, events = build_schedule(now, target, 10_000, 500, 30_000, [3, 2, 1])
        self.assertTrue(events)
        last = events[-1]
        self.assertEqual(ms_between(last.at, target), 0)
        self.assertEqual(last.delay_ms, 1500)

    def test_next_wednesday(self):
        # Thursday July 9, 2026 -> next Wednesday July 15
        thursday = datetime(2026, 7, 9, 10, 0, tzinfo=CT)
        nxt = next_wednesday_target(thursday)
        self.assertEqual(nxt.weekday(), 2)
        self.assertEqual(nxt.hour, 8)

    def test_all_options_divide_evenly(self):
        switch_at = ct(7, 50)
        target = ct(8, 0)
        remaining = ms_between(switch_at, target)
        for opt in all_exact_alignment_options(switch_at, target, 500, 30_000):
            self.assertEqual(remaining % opt.refreshes_until_target, 0)
            self.assertEqual(
                opt.delay_ms * opt.refreshes_until_target,
                remaining,
            )


if __name__ == "__main__":
    unittest.main()
