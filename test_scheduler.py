"""Tests for queue delay scheduler."""

import unittest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from scheduler import (
    CENTRAL,
    DropPlanMode,
    TimingMode,
    build_demo_from_preset,
    build_schedule,
    create_demo_target,
    find_aligned_delay,
    find_compatible_custom_starts,
    get_timezone,
    next_walmart_queue_time,
    preset_schedules,
    preset_schedules_late_drop,
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


class TestTimingMode(unittest.TestCase):
    def _target(self) -> datetime:
        return datetime(2026, 7, 8, 20, 0, 0, tzinfo=CT)

    def test_deferred_drop_is_one_cycle_earlier_than_instant(self):
        target = self._target()
        start = target - timedelta(hours=1)
        instant = build_schedule(
            target=target,
            start=start,
            initial_delay_ms=60_000,
            timing_mode=TimingMode.INSTANT,
        )
        deferred = build_schedule(
            target=target,
            start=start,
            initial_delay_ms=60_000,
            timing_mode=TimingMode.DEFERRED,
        )
        instant_drop = schedule_to_dict(instant)["drop_schedule"][1]["at_ts_ms"]
        deferred_drop = schedule_to_dict(deferred)["drop_schedule"][1]["at_ts_ms"]
        self.assertEqual(deferred_drop, instant_drop - 60_000)
        self.assertEqual(
            schedule_to_dict(deferred)["drop_schedule"][1]["effective_switch_ts_ms"],
            instant_drop,
        )

    def test_deferred_and_instant_share_refresh_timeline(self):
        target = self._target()
        start = target - timedelta(hours=1)
        instant = build_schedule(
            target=target,
            start=start,
            initial_delay_ms=60_000,
            timing_mode=TimingMode.INSTANT,
        )
        deferred = build_schedule(
            target=target,
            start=start,
            initial_delay_ms=60_000,
            timing_mode=TimingMode.DEFERRED,
        )
        self.assertEqual(instant.final_refresh_times, deferred.final_refresh_times)

    def test_deferred_still_hits_target_exactly(self):
        target = self._target()
        start = target - timedelta(hours=1)
        schedule = build_schedule(
            target=target,
            start=start,
            initial_delay_ms=60_000,
            timing_mode=TimingMode.DEFERRED,
        )
        self.assertTrue(schedule.hits_target_exactly)
        self.assertEqual(schedule.final_refresh_times[-1], target)

    def test_deferred_drop_command_not_before_start(self):
        target = self._target()
        plans = preset_schedules(target=target, tz_key="CDT", timing_mode=TimingMode.DEFERRED)
        self.assertTrue(plans)
        for plan in plans:
            self.assertGreaterEqual(plan.drop_ts_ms, plan.start_ts_ms)

    def test_preset_deferred_differs_from_instant_drop_time(self):
        target = self._target()
        instant_plans = {p.final_delay_ms: p for p in preset_schedules(target=target, timing_mode=TimingMode.INSTANT)}
        deferred_plans = {p.final_delay_ms: p for p in preset_schedules(target=target, timing_mode=TimingMode.DEFERRED)}
        for final_delay, instant in instant_plans.items():
            deferred = deferred_plans.get(final_delay)
            self.assertIsNotNone(deferred)
            self.assertLess(deferred.drop_ts_ms, instant.drop_ts_ms)
            self.assertEqual(deferred.effective_switch_ts_ms, instant.drop_ts_ms)


class TestDropPlanModes(unittest.TestCase):
    def _target(self) -> datetime:
        return datetime(2026, 7, 8, 20, 0, 0, tzinfo=CT)

    def test_last_min_preset_produces_tight_final_delay(self):
        target = self._target()
        plans = preset_schedules_late_drop(target=target, timing_mode=TimingMode.INSTANT)
        self.assertTrue(plans)
        for plan in plans:
            self.assertLessEqual(plan.final_delay_ms, 3_000)
            self.assertLessEqual(plan.drop_minutes_before, 6.0)
            self.assertEqual(plan.preset_category, "late_drop")
            self.assertEqual(plan.drop_mode, DropPlanMode.LAST_MIN.value)

    def test_custom_optimize_pins_1500_last_min(self):
        target = self._target()
        start = target - timedelta(minutes=45)
        schedule = build_schedule(
            target=target,
            start=start,
            initial_delay_ms=60_000,
            target_final_delay_ms=1_500,
            drop_mode=DropPlanMode.LAST_MIN,
        )
        self.assertTrue(schedule.hits_target_exactly)
        self.assertEqual(schedule.steps[1].delay_ms, 1_500)

    def test_compatible_starts_for_1500(self):
        target = self._target()
        options = find_compatible_custom_starts(
            target=target,
            target_final_delay_ms=1_500,
            drop_mode=DropPlanMode.LAST_MIN,
        )
        self.assertTrue(len(options) >= 1)
        self.assertTrue(all(o.final_delay_ms == 1_500 for o in options))

    def test_long_drop_auto_still_hits_target(self):
        target = self._target()
        start = target - timedelta(hours=1)
        schedule = build_schedule(
            target=target,
            start=start,
            initial_delay_ms=60_000,
            drop_mode=DropPlanMode.LONG_DROP,
        )
        self.assertTrue(schedule.hits_target_exactly)

    def test_preset_with_target_final_delay_matches_card(self):
        target = self._target()
        start = target - timedelta(hours=1)
        preset = preset_schedules(target=target, timing_mode=TimingMode.INSTANT)[0]
        schedule = build_schedule(
            target=target,
            start=start,
            initial_delay_ms=preset.start_delay_ms,
            target_final_delay_ms=preset.final_delay_ms,
            switch_minutes_before=preset.switch_minutes_before,
        )
        self.assertEqual(schedule.steps[1].delay_ms, preset.final_delay_ms)
        self.assertTrue(schedule.hits_target_exactly)

    def test_late_drop_presets_exist(self):
        target = self._target()
        plans = preset_schedules_late_drop(target=target, timing_mode=TimingMode.INSTANT)
        window_plans = [p for p in plans if "min before" in p.label]
        self.assertGreaterEqual(len(window_plans), 4)
        for plan in window_plans:
            self.assertLessEqual(plan.switch_minutes_before, 7)
            self.assertGreaterEqual(plan.switch_minutes_before, 1.5)

    def test_demo_from_preset_uses_exact_delays(self):
        target = self._target()
        preset = preset_schedules(target=target, timing_mode=TimingMode.INSTANT)[0]
        schedule = build_demo_from_preset(
            start_delay_ms=preset.start_delay_ms,
            final_delay_ms=preset.final_delay_ms,
            switch_minutes_before=preset.switch_minutes_before,
            timing_mode=TimingMode.INSTANT,
        )[0]
        self.assertEqual(schedule.steps[1].delay_ms, preset.final_delay_ms)
        self.assertTrue(schedule.hits_target_exactly)


if __name__ == "__main__":
    unittest.main()
