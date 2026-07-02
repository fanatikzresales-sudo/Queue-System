"""Tests for queue delay scheduler."""

import unittest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from scheduler import (
    CENTRAL,
    build_schedule,
    create_demo_target,
    find_aligned_delay,
    get_timezone,
    next_walmart_queue_time,
    recommended_start_delays,
    schedule_to_dict,
)

CT = CENTRAL


class TestAlignedDelay(unittest.TestCase):
    def test_three_minutes_1500ms(self):
        delay, aligned = find_aligned_delay(180_000, max_delay=1_500)
        self.assertEqual(delay, 1_500)
        self.assertTrue(aligned)

    def test_prefers_highest_safe_delay(self):
        delay, _ = find_aligned_delay(60_000, max_delay=30_000)
        self.assertEqual(delay, 30_000)


class TestNextQueueTime(unittest.TestCase):
    def test_finds_next_wednesday_at_8pm(self):
        now = datetime(2026, 7, 2, 12, 0, tzinfo=CT)
        target = next_walmart_queue_time(now=now)
        self.assertEqual(target.weekday(), 2)
        self.assertEqual(target.hour, 20)
        self.assertEqual(target.date(), datetime(2026, 7, 8).date())

    def test_timezone_est(self):
        est = get_timezone("EST")
        now = datetime(2026, 7, 2, 12, 0, tzinfo=est)
        target = next_walmart_queue_time(now=now, tz_key="EST")
        # Target is always in Central Time (8 PM CDT = 9 PM EDT)
        self.assertEqual(target.weekday(), 2)  # Wednesday
        # Same absolute moment as CDT
        target_cdt = next_walmart_queue_time(now=now.astimezone(CENTRAL), tz_key="CDT")
        self.assertEqual(
            target.astimezone(ZoneInfo("UTC")),
            target_cdt.astimezone(ZoneInfo("UTC")),
        )

    def test_all_timezones_same_utc_moment(self):
        """All timezones must resolve to the same real-world queue time."""
        from zoneinfo import ZoneInfo as Z
        now_central = datetime(2026, 7, 2, 12, 0, tzinfo=CENTRAL)
        targets = {tz: next_walmart_queue_time(now=now_central, tz_key=tz)
                   for tz in ["CDT", "EST", "PT"]}
        utc_times = {tz: t.astimezone(Z("UTC")) for tz, t in targets.items()}
        self.assertEqual(utc_times["CDT"], utc_times["EST"])
        self.assertEqual(utc_times["CDT"], utc_times["PT"])


class TestSchedule(unittest.TestCase):
    def _target(self) -> datetime:
        return datetime(2026, 7, 8, 20, 0, 0, tzinfo=CT)

    def test_only_two_delay_steps(self):
        target = self._target()
        start = target - timedelta(hours=1)
        schedule = build_schedule(target=target, start=start, initial_delay_ms=60_000)
        self.assertEqual(len(schedule.steps), 2)

    def test_hits_eight_pm_exactly_from_one_hour_early(self):
        target = self._target()
        start = target - timedelta(hours=1)
        schedule = build_schedule(target=target, start=start, initial_delay_ms=60_000)
        self.assertTrue(schedule.hits_target_exactly)
        self.assertEqual(schedule.final_refresh_times[-1], target)

    def test_one_hour_thirty_start(self):
        target = self._target()
        start = target - timedelta(minutes=90)
        schedule = build_schedule(target=target, start=start, initial_delay_ms=60_000)
        self.assertEqual(len(schedule.steps), 2)
        self.assertTrue(schedule.hits_target_exactly)

    def test_works_when_starting_three_minutes_early(self):
        target = self._target()
        start = target - timedelta(minutes=3)
        schedule = build_schedule(target=target, start=start, initial_delay_ms=1_500)
        self.assertTrue(schedule.hits_target_exactly)
        self.assertLessEqual(len(schedule.steps), 2)

    def test_recommended_start_delays(self):
        target = self._target()
        start = target - timedelta(hours=1)
        options = recommended_start_delays(target=target, start=start)
        self.assertTrue(any(o.delay_ms == 60_000 for o in options))

    def test_demo_target(self):
        now = datetime(2026, 7, 2, 14, 0, 0, tzinfo=CT)
        target = create_demo_target(minutes_from_now=5, now=now)
        self.assertEqual(target, datetime(2026, 7, 2, 14, 5, 0, tzinfo=CT))

    def test_schedule_to_dict(self):
        target = self._target()
        start = target - timedelta(hours=1)
        schedule = build_schedule(target=target, start=start, initial_delay_ms=30_000)
        data = schedule_to_dict(schedule)
        self.assertIn("drop_schedule", data)
        self.assertEqual(len(data["drop_schedule"]), 2)
        self.assertTrue(data["hits_target_exactly"])


if __name__ == "__main__":
    unittest.main()
