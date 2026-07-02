#!/usr/bin/env python3
"""CLI for Walmart queue refresh delay scheduling."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta

from scheduler import (
    TIMEZONES,
    Schedule,
    build_schedule,
    create_demo_target,
    format_duration_ms,
    format_minutes_before,
    get_timezone,
    next_walmart_queue_time,
)


def _format_time(dt: datetime) -> str:
    return dt.strftime("%A, %B %d, %Y at %I:%M:%S.%f")[:-3] + f" {dt.strftime('%p')} {dt.tzname()}"


def _format_clock(dt: datetime) -> str:
    return dt.strftime("%I:%M:%S.%f")[:-3] + f" {dt.strftime('%p')} {dt.tzname()}"


def print_schedule(schedule: Schedule) -> None:
    print()
    print("=" * 72)
    print("  WALMART QUEUE DELAY SCHEDULE")
    print("=" * 72)
    print()
    print(f"  Timezone        : {schedule.timezone_key}")
    print(f"  Queue goes live : {_format_time(schedule.target)}")
    print(f"  Start automation: {_format_time(schedule.start)}")
    print(
        f"  Time until live : {format_minutes_before((schedule.target - schedule.start).total_seconds() / 60)}"
    )
    print()

    print("-" * 72)
    print("  WHEN TO CHANGE DELAYS")
    print("-" * 72)
    print()

    for i, step in enumerate(schedule.steps):
        label = "START NOW" if i == 0 else f"AT {_format_clock(step.at)}"
        before = format_minutes_before(step.minutes_before)
        delay = format_duration_ms(step.delay_ms)
        refreshes = step.refreshes_until_next

        if i == len(schedule.steps) - 1:
            next_label = "queue goes live"
        else:
            next_label = format_minutes_before(schedule.steps[i + 1].minutes_before) + " before"

        align_flag = "" if step.aligned else "  [!] exact one-shot delay"
        print(f"  {label}")
        print(f"    {before} before queue  ->  set delay to {delay}{align_flag}")
        print(f"    {refreshes} refresh(es) until next change ({next_label})")
        print()

    print("-" * 72)
    print("  QUICK COPY (delay values only)")
    print("-" * 72)
    print()
    for step in schedule.steps:
        before = format_minutes_before(step.minutes_before)
        print(f"  {before:>8} before  ->  {step.delay_ms:,} ms")
    print()

    print("-" * 72)
    print("  FINAL REFRESHES (last 15)")
    print("-" * 72)
    print()
    preview = schedule.final_refresh_times[-15:]
    for t in preview:
        marker = "  <- QUEUE LIVE" if t == schedule.target else ""
        print(f"  {_format_clock(t)}{marker}")

    print()
    if schedule.hits_target_exactly:
        print("  Verified: a refresh lands exactly when the queue goes live.")
    else:
        last = schedule.final_refresh_times[-1] if schedule.final_refresh_times else None
        if last:
            delta_ms = int((schedule.target - last).total_seconds() * 1000)
            print(
                f"  Warning: last refresh is {abs(delta_ms):,} ms "
                f"{'after' if delta_ms < 0 else 'before'} queue live."
            )
        else:
            print("  Warning: no refreshes simulated.")
    print()


def parse_start(value: str, target: datetime, tz_key: str) -> datetime:
    parts = value.split(":")
    if len(parts) not in (2, 3):
        raise argparse.ArgumentTypeError("Use HH:MM or HH:MM:SS")

    hour = int(parts[0])
    minute = int(parts[1])
    second = int(parts[2]) if len(parts) == 3 else 0
    start = target.replace(hour=hour, minute=minute, second=second, microsecond=0)
    if start >= target:
        raise argparse.ArgumentTypeError("Start time must be before queue go-live (8:00 PM)")
    return start


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Calculate Walmart Pokemon queue refresh delays so your automation "
            "hits 8:00 PM exactly while starting with safe, high delays."
        )
    )
    parser.add_argument(
        "--start",
        metavar="HH:MM",
        help="When you start automation (local to selected timezone). Default: now.",
    )
    parser.add_argument(
        "--timezone",
        choices=list(TIMEZONES.keys()),
        default="CDT",
        help="Timezone for queue and start time (default: CDT).",
    )
    parser.add_argument(
        "--delay",
        type=int,
        metavar="MS",
        help="Starting delay in ms. If omitted, optimizer picks safe values.",
    )
    parser.add_argument(
        "--target",
        metavar="YYYY-MM-DD",
        help="Queue date override (must be a Wednesday). Default: next Wednesday.",
    )
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Demo mode: queue goes live 5 minutes from now (test alignment).",
    )
    parser.add_argument(
        "--min-delay",
        type=int,
        default=250,
        metavar="MS",
        help="Minimum delay in ms (default: 250).",
    )
    parser.add_argument(
        "--milestones",
        metavar="MINUTES",
        help="Comma-separated minutes-before checkpoints (e.g. 60,30,15,5,3,1).",
    )

    args = parser.parse_args()
    tz_key = args.timezone
    tz = get_timezone(tz_key)

    if args.demo:
        target = create_demo_target(tz_key=tz_key)
    else:
        target = next_walmart_queue_time(tz_key=tz_key)
        if args.target:
            parsed = datetime.strptime(args.target, "%Y-%m-%d").replace(tzinfo=tz)
            if parsed.weekday() != 2:
                parser.error("Target date must be a Wednesday.")
            target = parsed.replace(hour=20, minute=0, second=0, microsecond=0)

    if args.start:
        start = parse_start(args.start, target, tz_key)
    else:
        start = datetime.now(tz)
        if start >= target:
            start = target - timedelta(minutes=30)

    milestones = None
    if args.milestones:
        milestones = [float(x.strip()) for x in args.milestones.split(",")]

    schedule = build_schedule(
        target=target,
        start=start,
        milestones_min=milestones,
        min_delay_ms=args.min_delay,
        tz_key=tz_key,
        initial_delay_ms=args.delay,
    )
    print_schedule(schedule)


if __name__ == "__main__":
    main()
