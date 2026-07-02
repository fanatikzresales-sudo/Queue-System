#!/usr/bin/env python3
"""Queue delay planner for time-aligned polling strategies.

This script does not automate purchases or browser actions.
It helps plan delay transitions so refresh intervals can align
with a target queue-open timestamp.
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo


PROFILE_PRESETS: dict[str, str] = {
    "conservative": "60:10000,20:7000,10:4000,3:1500",
    "balanced": "60:8000,20:5000,10:3000,3:1200",
    "aggressive": "60:6000,20:3500,10:2000,3:900",
}


@dataclass(frozen=True)
class Phase:
    minutes_before: int
    delay_ms: int


@dataclass(frozen=True)
class PhasePlan:
    phase: Phase
    ideal_drop: datetime
    aligned_drop: datetime
    offset_ms: int
    refreshes_to_queue: int


def parse_time_of_day(value: str) -> tuple[int, int, int]:
    pieces = value.split(":")
    if len(pieces) not in {2, 3}:
        raise ValueError("Use HH:MM or HH:MM:SS format.")
    hour = int(pieces[0])
    minute = int(pieces[1])
    second = int(pieces[2]) if len(pieces) == 3 else 0
    if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
        raise ValueError("Time is out of range.")
    return hour, minute, second


def parse_datetime(date_text: str, time_text: str, tz_name: str) -> datetime:
    year, month, day = [int(part) for part in date_text.split("-")]
    hour, minute, second = parse_time_of_day(time_text)
    return datetime(year, month, day, hour, minute, second, tzinfo=ZoneInfo(tz_name))


def parse_phase_spec(spec: str) -> list[Phase]:
    phases: list[Phase] = []
    for raw_item in spec.split(","):
        item = raw_item.strip()
        if not item:
            continue
        try:
            minutes_before_text, delay_text = item.split(":")
            minutes_before = int(minutes_before_text)
            delay_ms = int(delay_text)
        except ValueError as exc:
            raise ValueError(
                f"Invalid phase '{item}'. Expected format '<minutes_before>:<delay_ms>'."
            ) from exc
        if minutes_before <= 0 or delay_ms <= 0:
            raise ValueError(f"Invalid phase '{item}'. Values must be positive integers.")
        phases.append(Phase(minutes_before=minutes_before, delay_ms=delay_ms))

    if not phases:
        raise ValueError("No valid phases were provided.")

    deduped: dict[int, Phase] = {}
    for phase in phases:
        deduped[phase.minutes_before] = phase
    return sorted(deduped.values(), key=lambda phase: phase.minutes_before, reverse=True)


def _ticks_for_window(remaining_ms: int, delay_ms: int, rounding: str) -> int:
    ratio = remaining_ms / delay_ms
    if rounding == "floor":
        return max(1, math.floor(ratio))
    if rounding == "ceil":
        return max(1, math.ceil(ratio))
    return max(1, int(round(ratio)))


def build_phase_plan(phases: list[Phase], target_dt: datetime, rounding: str) -> list[PhasePlan]:
    plans: list[PhasePlan] = []
    for phase in phases:
        remaining_ms = phase.minutes_before * 60 * 1000
        ideal_drop = target_dt - timedelta(milliseconds=remaining_ms)
        ticks = _ticks_for_window(remaining_ms=remaining_ms, delay_ms=phase.delay_ms, rounding=rounding)
        aligned_remaining_ms = ticks * phase.delay_ms
        aligned_drop = target_dt - timedelta(milliseconds=aligned_remaining_ms)
        offset_ms = int((aligned_drop - ideal_drop).total_seconds() * 1000)
        plans.append(
            PhasePlan(
                phase=phase,
                ideal_drop=ideal_drop,
                aligned_drop=aligned_drop,
                offset_ms=offset_ms,
                refreshes_to_queue=ticks,
            )
        )
    return plans


def delay_for_time(plans: list[PhasePlan], current_dt: datetime) -> int:
    timeline = sorted(plans, key=lambda plan: plan.aligned_drop)
    active_delay = timeline[0].phase.delay_ms
    for plan in timeline:
        if current_dt >= plan.aligned_drop:
            active_delay = plan.phase.delay_ms
        else:
            break
    return active_delay


def format_offset_ms(value: int) -> str:
    if value == 0:
        return "on-time"
    sign = "+" if value > 0 else "-"
    return f"{sign}{abs(value)}ms"


def print_report(
    plans: list[PhasePlan],
    target_dt: datetime,
    start_dt: datetime,
    profile_name: str,
    phase_spec: str,
) -> None:
    active_delay = delay_for_time(plans=plans, current_dt=start_dt)
    timeline = sorted(plans, key=lambda plan: plan.aligned_drop)

    print(f"Queue opens : {target_dt.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print(f"Start time  : {start_dt.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print(f"Profile     : {profile_name}")
    print(f"Phase spec  : {phase_spec}")
    print()
    print(f"Recommended delay at start: {active_delay} ms")
    print()
    print("Delay drop plan (aligned to queue-open):")
    print("minutes_before | delay_ms | ideal_drop           | aligned_drop         | offset | ticks_to_open")
    print("-" * 102)

    for plan in sorted(plans, key=lambda item: item.phase.minutes_before, reverse=True):
        print(
            f"{plan.phase.minutes_before:14d} | "
            f"{plan.phase.delay_ms:8d} | "
            f"{plan.ideal_drop.strftime('%H:%M:%S'):>19} | "
            f"{plan.aligned_drop.strftime('%H:%M:%S'):>19} | "
            f"{format_offset_ms(plan.offset_ms):>6} | "
            f"{plan.refreshes_to_queue:12d}"
        )

    upcoming = [plan for plan in timeline if plan.aligned_drop >= start_dt]
    if upcoming:
        print()
        print("Upcoming delay changes from start time:")
        for plan in upcoming:
            minutes_left = int((target_dt - plan.aligned_drop).total_seconds() // 60)
            seconds_left = int((target_dt - plan.aligned_drop).total_seconds() % 60)
            print(
                f"- At {plan.aligned_drop.strftime('%H:%M:%S')} "
                f"(T-{minutes_left:02d}:{seconds_left:02d}), set delay to {plan.phase.delay_ms} ms"
            )


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Plan delay transitions that align page refresh timing with a queue-open timestamp."
    )
    parser.add_argument(
        "--timezone",
        default="America/Chicago",
        help="IANA timezone name (default: America/Chicago).",
    )
    parser.add_argument(
        "--queue-date",
        required=True,
        help="Queue date in YYYY-MM-DD format.",
    )
    parser.add_argument(
        "--queue-time",
        default="08:00:00",
        help="Queue time in HH:MM[:SS] (default: 08:00:00).",
    )
    parser.add_argument(
        "--start-date",
        help="Start date in YYYY-MM-DD format (default: queue date).",
    )
    parser.add_argument(
        "--start-time",
        required=True,
        help="Start time in HH:MM[:SS].",
    )
    parser.add_argument(
        "--profile",
        choices=sorted(PROFILE_PRESETS.keys()),
        default="conservative",
        help="Delay profile preset (default: conservative).",
    )
    parser.add_argument(
        "--phases",
        help="Custom phase list '<minutes_before>:<delay_ms>,...'. Overrides --profile.",
    )
    parser.add_argument(
        "--rounding",
        choices=["nearest", "floor", "ceil"],
        default="nearest",
        help="How to align each phase threshold to delay ticks (default: nearest).",
    )
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    phase_spec = args.phases or PROFILE_PRESETS[args.profile]
    phases = parse_phase_spec(phase_spec)

    target_dt = parse_datetime(date_text=args.queue_date, time_text=args.queue_time, tz_name=args.timezone)
    start_date = args.start_date or args.queue_date
    start_dt = parse_datetime(date_text=start_date, time_text=args.start_time, tz_name=args.timezone)

    if start_dt >= target_dt:
        parser.error("Start datetime must be earlier than queue datetime.")

    plans = build_phase_plan(phases=phases, target_dt=target_dt, rounding=args.rounding)
    print_report(
        plans=plans,
        target_dt=target_dt,
        start_dt=start_dt,
        profile_name=args.profile if not args.phases else "custom",
        phase_spec=phase_spec,
    )


if __name__ == "__main__":
    main()
