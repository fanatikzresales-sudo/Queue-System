import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from queue_delay_planner import build_phase_plan, parse_phase_spec


def _dt(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=ZoneInfo("America/Chicago"))


class QueueDelayPlannerTests(unittest.TestCase):
    def test_three_minutes_at_1500ms_aligns_exactly(self) -> None:
        target = _dt("2026-07-08 08:00:00")
        phases = parse_phase_spec("3:1500")
        plan = build_phase_plan(phases=phases, target_dt=target, rounding="nearest")[0]
        self.assertEqual(plan.aligned_drop.strftime("%H:%M:%S"), "07:57:00")
        self.assertEqual(plan.refreshes_to_queue, 120)
        self.assertEqual(plan.offset_ms, 0)

    def test_nearest_rounding_moves_threshold_by_expected_offset(self) -> None:
        target = _dt("2026-07-08 08:00:00")
        phases = parse_phase_spec("20:7000")
        plan = build_phase_plan(phases=phases, target_dt=target, rounding="nearest")[0]
        # 20 minutes = 1,200,000 ms. 1,200,000 / 7,000 ~= 171.43 -> nearest is 171 ticks.
        # aligned window = 1,197,000 ms, so drop occurs 3,000 ms after ideal.
        self.assertEqual(plan.refreshes_to_queue, 171)
        self.assertEqual(plan.offset_ms, 3000)


if __name__ == "__main__":
    unittest.main()
