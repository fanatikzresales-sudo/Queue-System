#!/usr/bin/env python3
"""Export API fixture JSON from Python scheduler for JS parity tests."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from scheduler import (  # noqa: E402
    TimingMode,
    build_demo_from_preset,
    build_schedule,
    next_walmart_queue_time,
    preset_schedules,
    schedule_to_dict,
    schedule_to_live_demo,
)


def _plan_dict(p):
    return {
        "label": p.label,
        "start_delay_ms": p.start_delay_ms,
        "final_delay_ms": p.final_delay_ms,
        "switch_minutes_before": p.switch_minutes_before,
        "drop_ts_ms": p.drop_ts_ms,
        "preset_category": p.preset_category,
    }


def main() -> None:
    fixtures = {}
    for tz in ("CDT", "EST", "PT"):
        for mode in ("instant", "deferred"):
            target = next_walmart_queue_time(tz_key=tz)
            plans = preset_schedules(target=target, tz_key=tz, timing_mode=mode)
            key = f"preset_{tz}_{mode}"
            fixtures[key] = {
                "count": len(plans),
                "plans": [_plan_dict(p) for p in plans],
            }
            if plans:
                p0 = plans[0]
                sched, dur = build_demo_from_preset(
                    start_delay_ms=p0.start_delay_ms,
                    final_delay_ms=p0.final_delay_ms,
                    switch_minutes_before=p0.switch_minutes_before,
                    timing_mode=mode,
                    tz_key=tz,
                )
                fixtures[f"demo_{tz}_{mode}"] = {
                    "duration": dur,
                    "start_delay": sched.steps[0].delay_ms,
                    "final_delay": sched.steps[1].delay_ms,
                    "hits": sched.hits_target_exactly,
                }

    target = next_walmart_queue_time(tz_key="CDT")
    start = target.replace(hour=19, minute=0, second=0, microsecond=0)
    sched = build_schedule(
        target=target,
        start=start,
        tz_key="CDT",
        initial_delay_ms=120_000,
        target_final_delay_ms=3_000,
        timing_mode=TimingMode.INSTANT,
    )
    fixtures["optimize_sample"] = schedule_to_dict(sched)
    fixtures["demo_live_sample"] = schedule_to_live_demo(sched)

    out = Path(__file__).parent / "fixtures.json"
    out.write_text(json.dumps(fixtures, indent=2))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
