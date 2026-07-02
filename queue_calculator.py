#!/usr/bin/env python3
"""
Walmart Wednesday Pokemon queue delay calculator.

Computes refresh delays (milliseconds) so automation hits the queue go-live
time exactly — typically 8:00 AM US Central — while using longer delays early
to reduce proxy ban risk.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

CENTRAL = ZoneInfo("America/Chicago")

# Sensible defaults for Walmart Wednesday drops
DEFAULT_TARGET_HOUR = 8
DEFAULT_TARGET_MINUTE = 0
DEFAULT_TARGET_SECOND = 0
DEFAULT_START_DELAY_MS = 10_000
DEFAULT_MIN_DELAY_MS = 500
DEFAULT_MAX_DELAY_MS = 30_000

# Standard "minutes before" checkpoints used in the schedule
DEFAULT_CHECKPOINTS_MIN = [
    60, 45, 30, 20, 15, 10, 7, 5, 4, 3, 2, 1, 0.5, 0.25,
]


@dataclass(frozen=True)
class RefreshEvent:
    at: datetime
    delay_ms: int
    refresh_number: int


@dataclass(frozen=True)
class DelayTransition:
    """When to change delay and what to set it to."""

    switch_at: datetime
    minutes_before: float
    delay_ms: int
    refreshes_until_target: int
    tier: str
    notes: str


# Common automation delay presets (ms)
COMMON_DELAYS = [1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000]


def next_wednesday_target(
    now: datetime,
    hour: int = DEFAULT_TARGET_HOUR,
    minute: int = DEFAULT_TARGET_MINUTE,
    second: int = DEFAULT_TARGET_SECOND,
) -> datetime:
    """Next Wednesday at the given Central time (today if still upcoming)."""
    if now.tzinfo is None:
        now = now.replace(tzinfo=CENTRAL)
    else:
        now = now.astimezone(CENTRAL)

    # Wednesday = weekday 2
    days_ahead = (2 - now.weekday()) % 7
    candidate = now.replace(
        hour=hour, minute=minute, second=second, microsecond=0
    ) + timedelta(days=days_ahead)

    if candidate <= now:
        candidate += timedelta(days=7)
    return candidate


def ms_between(start: datetime, end: datetime) -> int:
    return int((end - start).total_seconds() * 1000)


def format_time(dt: datetime) -> str:
    return dt.astimezone(CENTRAL).strftime("%I:%M:%S %p CT")


def format_minutes_before(minutes: float) -> str:
    if minutes >= 1:
        if minutes == int(minutes):
            return f"{int(minutes)} min"
        return f"{minutes:.1f} min"
    seconds = int(minutes * 60)
    return f"{seconds} sec"


def delay_for_exact_alignment(
    switch_at: datetime,
    target: datetime,
    refreshes_until_target: int,
) -> int | None:
    """Delay (ms) so the Nth refresh after switch_at lands exactly on target."""
    if refreshes_until_target < 1:
        return None
    remaining_ms = ms_between(switch_at, target)
    if remaining_ms <= 0:
        return None
    if remaining_ms % refreshes_until_target != 0:
        # Still valid; we use integer division and note sub-ms drift
        pass
    return remaining_ms // refreshes_until_target


def all_exact_alignment_options(
    switch_at: datetime,
    target: datetime,
    min_delay_ms: int,
    max_delay_ms: int,
    max_refreshes: int = 500,
) -> list[DelayTransition]:
    """All delay values that land a refresh exactly on target."""
    remaining_ms = ms_between(switch_at, target)
    if remaining_ms <= 0:
        return []

    candidates: list[DelayTransition] = []
    minutes_before = (target - switch_at).total_seconds() / 60
    upper_n = min(max_refreshes, remaining_ms // max(min_delay_ms, 1))

    for n in range(1, upper_n + 1):
        if remaining_ms % n != 0:
            continue
        delay = remaining_ms // n
        if delay < min_delay_ms or delay > max_delay_ms:
            continue
        candidates.append(
            DelayTransition(
                switch_at=switch_at,
                minutes_before=minutes_before,
                delay_ms=delay,
                refreshes_until_target=n,
                tier="",
                notes=f"{n} refresh{'es' if n != 1 else ''} until go-live",
            )
        )
    return candidates


def pick_checkpoint_options(
    switch_at: datetime,
    target: datetime,
    min_delay_ms: int,
    max_delay_ms: int,
    max_allowed_delay_ms: int,
) -> list[DelayTransition]:
    """
    Return conservative + precise delay options for a checkpoint.
    Delays never exceed max_allowed_delay_ms (monotonic ramp-down).
    """
    options = all_exact_alignment_options(
        switch_at, target, min_delay_ms, min(max_delay_ms, max_allowed_delay_ms)
    )
    if not options:
        return []

    common_hits = [o for o in options if o.delay_ms in COMMON_DELAYS]
    if not common_hits:
        common_hits = options

    # Conservative: longest delay (fewest refreshes) among common presets
    conservative = max(common_hits, key=lambda o: o.delay_ms)
    conservative = DelayTransition(
        switch_at=conservative.switch_at,
        minutes_before=conservative.minutes_before,
        delay_ms=conservative.delay_ms,
        refreshes_until_target=conservative.refreshes_until_target,
        tier="safe",
        notes=f"{conservative.notes} — fewer requests, lower ban risk",
    )

    # Precise: prefer 1500ms when it aligns, else shortest common delay
    precise_candidates = [o for o in common_hits if o.delay_ms <= 5000]
    if not precise_candidates:
        precise_candidates = sorted(common_hits, key=lambda o: o.delay_ms)[:3]

    precise_pick = min(
        precise_candidates,
        key=lambda o: (0 if o.delay_ms == 1500 else 1, o.delay_ms),
    )
    precise = DelayTransition(
        switch_at=precise_pick.switch_at,
        minutes_before=precise_pick.minutes_before,
        delay_ms=precise_pick.delay_ms,
        refreshes_until_target=precise_pick.refreshes_until_target,
        tier="precise",
        notes=f"{precise_pick.notes} — hits 8:00 on the nose",
    )

    result = [conservative]
    if precise.delay_ms != conservative.delay_ms:
        result.append(precise)
    return result


def simulate_from_now(
    start: datetime,
    target: datetime,
    initial_delay_ms: int,
    transitions: list[DelayTransition],
) -> list[RefreshEvent]:
    """Simulate refresh timeline from start through target."""
    events: list[RefreshEvent] = []
    current = start
    delay = initial_delay_ms
    transition_idx = 0
    refresh_num = 0

    # Sort transitions chronologically
    sorted_transitions = sorted(transitions, key=lambda t: t.switch_at)

    while current < target + timedelta(milliseconds=delay):
        next_refresh = current + timedelta(milliseconds=delay)

        # Apply any transitions that occur before this refresh
        while (
            transition_idx < len(sorted_transitions)
            and sorted_transitions[transition_idx].switch_at <= next_refresh
        ):
            tr = sorted_transitions[transition_idx]
            delay = tr.delay_ms
            transition_idx += 1
            # Recompute next refresh from transition point with new delay
            current = tr.switch_at
            next_refresh = current + timedelta(milliseconds=delay)

        if next_refresh > target + timedelta(seconds=2):
            break

        refresh_num += 1
        events.append(RefreshEvent(at=next_refresh, delay_ms=delay, refresh_number=refresh_num))
        current = next_refresh

        if next_refresh >= target:
            break

    return events


def build_schedule(
    now: datetime,
    target: datetime,
    start_delay_ms: int,
    min_delay_ms: int,
    max_delay_ms: int,
    checkpoints_min: list[float],
) -> tuple[list[DelayTransition], list[DelayTransition], list[RefreshEvent]]:
    """
    Build checkpoint options and simulate using the 'precise' tier transitions.
    Returns (all_checkpoint_options, precise_transitions_for_sim, events).
    """
    all_options: list[DelayTransition] = []
    precise_transitions: list[DelayTransition] = []
    current_max_delay = start_delay_ms

    for minutes in sorted(checkpoints_min, reverse=True):
        switch_at = target - timedelta(minutes=minutes)
        if switch_at < now:
            continue

        options = pick_checkpoint_options(
            switch_at, target, min_delay_ms, max_delay_ms, current_max_delay
        )
        if not options:
            continue

        all_options.extend(options)

        # Use precise tier for simulation; fall back to safe
        pick = next((o for o in options if o.tier == "precise"), options[0])
        if not precise_transitions or pick.delay_ms != precise_transitions[-1].delay_ms:
            precise_transitions.append(pick)
            current_max_delay = pick.delay_ms

    events = simulate_from_now(now, target, start_delay_ms, precise_transitions)
    return all_options, precise_transitions, events


def find_initial_delay_alignment(
    now: datetime,
    target: datetime,
    start_delay_ms: int,
) -> dict:
    """Analyze whether starting delay keeps you on-cycle for the target."""
    remaining_ms = ms_between(now, target)
    refreshes_if_unchanged = remaining_ms // start_delay_ms
    remainder_ms = remaining_ms % start_delay_ms
    next_refresh_at = now + timedelta(milliseconds=start_delay_ms)

    # What delay would make the next refresh land exactly on target?
    exact_single = remaining_ms if remaining_ms > 0 else None

    # What delay would make refresh N land on target?
    aligned_options = []
    for n in range(1, min(20, refreshes_if_unchanged + 5)):
        d = delay_for_exact_alignment(now, target, n)
        if d and 500 <= d <= 30_000:
            aligned_options.append((n, d))

    return {
        "remaining_ms": remaining_ms,
        "remaining_minutes": remaining_ms / 60_000,
        "refreshes_at_start_delay": refreshes_if_unchanged,
        "ms_after_target_if_unchanged": remainder_ms,
        "next_refresh_at": next_refresh_at,
        "exact_single_refresh_delay": exact_single,
        "aligned_options": aligned_options[:8],
    }


def print_report(
    now: datetime,
    target: datetime,
    start_delay_ms: int,
    min_delay_ms: int,
    max_delay_ms: int,
    checkpoint_options: list[DelayTransition],
    precise_transitions: list[DelayTransition],
    events: list[RefreshEvent],
    initial_analysis: dict,
) -> None:
    remaining = target - now
    hours, rem = divmod(int(remaining.total_seconds()), 3600)
    minutes, seconds = divmod(rem, 60)

    print()
    print("=" * 72)
    print("  WALMART QUEUE DELAY CALCULATOR")
    print("=" * 72)
    print()
    print(f"  Current time:     {format_time(now)}")
    print(f"  Queue go-live:    {format_time(target)}")
    print(f"  Time remaining:   {hours}h {minutes}m {seconds}s")
    print(f"  Starting delay:   {start_delay_ms:,} ms ({start_delay_ms / 1000:.1f}s)")
    print()

    print("-" * 72)
    print("  INITIAL DELAY ANALYSIS")
    print("-" * 72)
    print()
    ia = initial_analysis
    print(f"  At {start_delay_ms:,}ms unchanged, you get ~{ia['refreshes_at_start_delay']} refreshes")
    print(f"  before go-live, ending {ia['ms_after_target_if_unchanged']:,}ms after target.")
    print(f"  Next refresh (if started now): {format_time(ia['next_refresh_at'])}")
    print()

    if ia["aligned_options"]:
        print("  If you start NOW with a recalculated delay (exact hit options):")
        for n, d in ia["aligned_options"]:
            hit_at = now + timedelta(milliseconds=n * d)
            print(f"    {d:,} ms x {n} refreshes -> hits {format_time(hit_at)}")
        print()

    print("-" * 72)
    print("  RECOMMENDED DELAY TRANSITIONS")
    print("  (switch your automation delay at each checkpoint)")
    print("-" * 72)
    print()
    print(
        f"  {'Before':<10} {'Switch at (CT)':<22} {'Tier':<9} {'Delay':<12} "
        f"{'Refreshes':<10} Notes"
    )
    print(f"  {'-' * 9} {'-' * 21} {'-' * 8} {'-' * 11} {'-' * 9} {'-' * 20}")

    print(
        f"  {'START':<10} {format_time(now) + ' (NOW)':<22} {'—':<9} "
        f"{start_delay_ms:>6,} ms  {'—':<10} Run until first checkpoint"
    )

    # If we're already inside the final window, show immediate switch recommendation
    remaining_min = (target - now).total_seconds() / 60
    if remaining_min <= 5:
        immediate = pick_checkpoint_options(
            now, target, min_delay_ms, max_delay_ms, start_delay_ms
        )
        for opt in immediate:
            if opt.tier == "precise":
                print()
                print(
                    f"  >> IMMEDIATE: set delay to {opt.delay_ms:,} ms now "
                    f"({opt.refreshes_until_target} refreshes until 8:00)"
                )
                break

    # Show both SAFE and PRECISE options; skip duplicate delays at later checkpoints
    printed: set[tuple[float, str]] = set()
    last_safe_delay: int | None = None
    last_precise_delay: int | None = None

    for tr in sorted(checkpoint_options, key=lambda t: (t.minutes_before, t.tier), reverse=True):
        key = (tr.minutes_before, tr.tier)
        if key in printed:
            continue
        if tr.tier == "safe" and tr.delay_ms == last_safe_delay:
            continue
        if tr.tier == "precise" and tr.delay_ms == last_precise_delay:
            continue
        printed.add(key)
        if tr.tier == "safe":
            last_safe_delay = tr.delay_ms
        else:
            last_precise_delay = tr.delay_ms

        before = format_minutes_before(tr.minutes_before)
        tier_label = "SAFE" if tr.tier == "safe" else "PRECISE"
        switch_label = format_time(tr.switch_at)
        if tr.switch_at == now:
            switch_label += " (NOW)"
        print(
            f"  {before:<10} {switch_label:<22} {tier_label:<9} "
            f"{tr.delay_ms:>6,} ms  {tr.refreshes_until_target:<10} {tr.notes}"
        )

    print()
    print("  SAFE    = longer delay, fewer page loads (proxy-friendly)")
    print("  PRECISE = shorter delay, lands exactly on 8:00:00")
    print()

    print("-" * 72)
    print("  PRECISE TIER SCHEDULE (copy into automation)")
    print("-" * 72)
    print()
    for tr in sorted(precise_transitions, key=lambda t: t.minutes_before, reverse=True):
        before = format_minutes_before(tr.minutes_before)
        print(
            f"  At {before} before ({format_time(tr.switch_at)}): "
            f"set delay to {tr.delay_ms:,} ms"
        )

    print()
    print("-" * 72)
    print("  SIMULATED REFRESH TIMELINE (last 15 before go-live)")
    print("-" * 72)
    print()

    near_target = [e for e in events if e.at <= target + timedelta(seconds=1)]
    display = near_target[-15:] if len(near_target) > 15 else near_target

    for ev in display:
        delta_ms = ms_between(ev.at, target)
        if abs(delta_ms) <= 50:
            marker = " <-- QUEUE LIVE"
        elif ev.at < target:
            marker = f" ({abs(delta_ms):,}ms early)"
        else:
            marker = f" ({delta_ms:,}ms late)"
        print(
            f"  #{ev.refresh_number:>3}  {format_time(ev.at)}  "
            f"delay {ev.delay_ms:,}ms{marker}"
        )

    if events:
        last = events[-1]
        drift = ms_between(last.at, target)
        print()
        if abs(drift) <= 50:
            print(f"  Result: Final refresh hits go-live within {abs(drift)}ms.")
        else:
            print(f"  Result: Final refresh is {abs(drift):,}ms {'late' if drift > 0 else 'early'}.")

    print()
    print("-" * 72)
    print("  QUICK COPY — automation delay values (ms)")
    print("-" * 72)
    print()
    values = [start_delay_ms] + [
        tr.delay_ms
        for tr in sorted(precise_transitions, key=lambda t: t.minutes_before, reverse=True)
    ]
    print("  " + " -> ".join(f"{v:,}" for v in values))
    print()
    print("=" * 72)
    print()


def parse_time_arg(value: str, base_date: datetime) -> datetime:
    """Parse HH:MM or HH:MM:SS into a Central datetime on base_date's day."""
    parts = value.strip().split(":")
    if len(parts) not in (2, 3):
        raise argparse.ArgumentTypeError(f"Invalid time: {value!r} (use HH:MM or HH:MM:SS)")
    hour, minute = int(parts[0]), int(parts[1])
    second = int(parts[2]) if len(parts) == 3 else 0
    return base_date.replace(hour=hour, minute=minute, second=second, microsecond=0)


def parse_datetime_arg(value: str) -> datetime:
    """Parse ISO-like datetime or time-only string."""
    value = value.strip()
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=CENTRAL)
        return dt.astimezone(CENTRAL)
    except ValueError:
        pass
    now = datetime.now(CENTRAL)
    return parse_time_arg(value, now)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Calculate Walmart queue refresh delays so automation hits go-live "
            "exactly at 8:00 AM Central (or a custom time)."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python queue_calculator.py
  python queue_calculator.py --start-delay 10000
  python queue_calculator.py --now "7:30" --target "8:00"
  python queue_calculator.py --target "8:00:00" --min-delay 1000 --max-delay 15000
        """,
    )
    parser.add_argument(
        "--now",
        type=parse_datetime_arg,
        default=None,
        help='Current/start time (default: now). e.g. "7:45:00" or full ISO datetime',
    )
    parser.add_argument(
        "--target",
        type=parse_datetime_arg,
        default=None,
        help='Queue go-live time (default: next Wed 8:00 AM CT). e.g. "8:00"',
    )
    parser.add_argument(
        "--start-delay",
        type=int,
        default=DEFAULT_START_DELAY_MS,
        metavar="MS",
        help=f"Initial refresh delay in ms (default: {DEFAULT_START_DELAY_MS})",
    )
    parser.add_argument(
        "--min-delay",
        type=int,
        default=DEFAULT_MIN_DELAY_MS,
        metavar="MS",
        help=f"Minimum allowed delay in ms (default: {DEFAULT_MIN_DELAY_MS})",
    )
    parser.add_argument(
        "--max-delay",
        type=int,
        default=DEFAULT_MAX_DELAY_MS,
        metavar="MS",
        help=f"Maximum allowed delay in ms (default: {DEFAULT_MAX_DELAY_MS})",
    )
    parser.add_argument(
        "--checkpoints",
        type=str,
        default=None,
        help='Comma-separated minutes-before values (default: "60,45,30,...,0.25")',
    )

    args = parser.parse_args(argv)

    now = args.now or datetime.now(CENTRAL)
    if now.tzinfo is None:
        now = now.replace(tzinfo=CENTRAL)
    else:
        now = now.astimezone(CENTRAL)

    if args.target:
        target = args.target
        if args.target.hour == now.hour and args.target.date() == now.date():
            pass
        elif args.target.year == now.year and args.target.month == now.month and args.target.day == now.day:
            pass
        else:
            # If only time was given, use today's date or next Wednesday logic
            if args.target.date() == now.date():
                target = args.target
            else:
                target = args.target.replace(
                    year=now.year, month=now.month, day=now.day
                )
                if target <= now:
                    target = next_wednesday_target(now)
                    target = target.replace(
                        hour=args.target.hour,
                        minute=args.target.minute,
                        second=args.target.second,
                        microsecond=0,
                    )
    else:
        target = next_wednesday_target(now)

    if target <= now:
        print("Error: target time must be in the future.", file=sys.stderr)
        return 1

    checkpoints = DEFAULT_CHECKPOINTS_MIN
    if args.checkpoints:
        checkpoints = [float(x.strip()) for x in args.checkpoints.split(",")]

    initial = find_initial_delay_alignment(now, target, args.start_delay)
    checkpoint_options, precise_transitions, events = build_schedule(
        now,
        target,
        args.start_delay,
        args.min_delay,
        args.max_delay,
        checkpoints,
    )

    print_report(
        now, target, args.start_delay, args.min_delay, args.max_delay,
        checkpoint_options, precise_transitions, events, initial,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
