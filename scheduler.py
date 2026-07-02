"""Core logic for Walmart queue refresh delay scheduling."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable
from zoneinfo import ZoneInfo

CENTRAL = ZoneInfo("America/Chicago")

# Common automation delay values (ms), highest to lowest.
PREFERRED_DELAYS_MS = [
    120_000,
    90_000,
    60_000,
    45_000,
    30_000,
    20_000,
    15_000,
    10_000,
    8_000,
    5_000,
    3_000,
    2_000,
    1_500,
    1_000,
    800,
    500,
    250,
]

# Default milestone checkpoints (minutes before queue goes live).
DEFAULT_MILESTONES_MIN = [
    60,
    45,
    30,
    15,
    10,
    5,
    3,
    2,
    1,
    0.5,
    0.25,
    10 / 60,  # 10 seconds
    5 / 60,  # 5 seconds
]

# Max delay allowed at each phase (minutes before target → max delay ms).
DEFAULT_MAX_DELAY_BY_MINUTES_BEFORE = [
    (60, 60_000),
    (30, 30_000),
    (15, 20_000),
    (10, 15_000),
    (5, 10_000),
    (3, 1_500),
    (2, 1_000),
    (1, 2_000),
    (0, 1_500),
]


@dataclass(frozen=True)
class DelayStep:
    """One point in the schedule where the automation delay should change."""

    at: datetime
    minutes_before: float
    delay_ms: int
    refreshes_until_next: int | None
    segment_ms: int
    aligned: bool


@dataclass(frozen=True)
class Schedule:
    target: datetime
    start: datetime
    steps: list[DelayStep]
    final_refresh_times: list[datetime]

    @property
    def hits_target_exactly(self) -> bool:
        if not self.final_refresh_times:
            return False
        return self.final_refresh_times[-1] == self.target


def next_walmart_queue_time(
    *,
    now: datetime | None = None,
    hour: int = 8,
    minute: int = 0,
    second: int = 0,
) -> datetime:
    """Return the next Wednesday queue go-live in Central Time."""
    now = _ensure_central(now or datetime.now(CENTRAL))
    candidate = now.replace(hour=hour, minute=minute, second=second, microsecond=0)
    days_ahead = (2 - candidate.weekday()) % 7  # Wednesday = 2
    if days_ahead == 0 and candidate <= now:
        days_ahead = 7
    return candidate + timedelta(days=days_ahead)


def _ensure_central(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=CENTRAL)
    return dt.astimezone(CENTRAL)


def _max_delay_for_minutes_before(
    minutes_before: float,
    caps: list[tuple[float, int]],
) -> int:
    for threshold, max_delay in caps:
        if minutes_before >= threshold:
            return max_delay
    return caps[-1][1]


def find_aligned_delay(
    remaining_ms: int,
    *,
    max_delay: int,
    min_delay: int = 250,
    preferred: Iterable[int] = PREFERRED_DELAYS_MS,
) -> tuple[int, bool]:
    """
    Pick a delay so remaining_ms is an exact multiple of the delay.

    Returns (delay_ms, aligned). If no preferred value works, returns the
    exact one-shot delay (remaining_ms) with aligned=False.
    """
    if remaining_ms <= 0:
        return min_delay, True

    for delay in preferred:
        if delay > max_delay or delay < min_delay:
            continue
        if remaining_ms % delay == 0:
            return delay, True

    if remaining_ms >= min_delay:
        return remaining_ms, False

    return min_delay, remaining_ms % min_delay == 0


def build_schedule(
    *,
    target: datetime,
    start: datetime | None = None,
    milestones_min: list[float] | None = None,
    max_delay_caps: list[tuple[float, int]] | None = None,
    min_delay_ms: int = 250,
) -> Schedule:
    """
    Build a delay drop schedule from start time until queue go-live.

    Each step sets a delay so refreshes land on exact boundaries through
    the next milestone (or queue live for the final step).
    """
    target = _ensure_central(target)
    start = _ensure_central(start or datetime.now(CENTRAL))
    milestones_min = sorted(milestones_min or DEFAULT_MILESTONES_MIN, reverse=True)
    max_delay_caps = max_delay_caps or DEFAULT_MAX_DELAY_BY_MINUTES_BEFORE

    # Only keep milestones strictly between start and target.
    start_minutes_before = (target - start).total_seconds() / 60
    milestones_min = [m for m in milestones_min if 0 < m < start_minutes_before]
    if not milestones_min:
        milestones_min = [start_minutes_before]

    # Build segment boundaries: start → each milestone → target.
    boundary_minutes = [start_minutes_before] + milestones_min + [0.0]
    boundary_times = [target - timedelta(minutes=m) for m in boundary_minutes]

    steps: list[DelayStep] = []
    for i in range(len(boundary_times) - 1):
        at = boundary_times[i]
        next_at = boundary_times[i + 1]
        minutes_before = boundary_minutes[i]
        segment_ms = int((next_at - at).total_seconds() * 1000)

        max_delay = _max_delay_for_minutes_before(minutes_before, max_delay_caps)
        delay_ms, aligned = find_aligned_delay(
            segment_ms,
            max_delay=max_delay,
            min_delay=min_delay_ms,
        )
        refreshes = segment_ms // delay_ms if delay_ms else None

        steps.append(
            DelayStep(
                at=at,
                minutes_before=minutes_before,
                delay_ms=delay_ms,
                refreshes_until_next=refreshes,
                segment_ms=segment_ms,
                aligned=aligned,
            )
        )

    final_refresh_times = _simulate_refreshes(steps, target)
    return Schedule(
        target=target,
        start=start,
        steps=steps,
        final_refresh_times=final_refresh_times,
    )


def _simulate_refreshes(steps: list[DelayStep], target: datetime) -> list[datetime]:
    """Simulate refresh timestamps through the full schedule."""
    if not steps:
        return []

    times: list[datetime] = []
    for i, step in enumerate(steps):
        end = steps[i + 1].at if i + 1 < len(steps) else target
        t = step.at + timedelta(milliseconds=step.delay_ms)
        while t <= end + timedelta(microseconds=1):
            times.append(t)
            t += timedelta(milliseconds=step.delay_ms)

    return times


def format_duration_ms(ms: int) -> str:
    if ms >= 60_000:
        return f"{ms / 60_000:.1f} min ({ms:,} ms)"
    if ms >= 1_000:
        return f"{ms / 1_000:.1f} sec ({ms:,} ms)"
    return f"{ms} ms"


def format_minutes_before(minutes: float) -> str:
    if minutes >= 1:
        if minutes == int(minutes):
            return f"{int(minutes)} min"
        return f"{minutes:.1f} min"
    seconds = minutes * 60
    if seconds == int(seconds):
        return f"{int(seconds)} sec"
    return f"{seconds:.1f} sec"
