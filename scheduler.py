"""Core logic for Walmart queue refresh delay scheduling."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable
from zoneinfo import ZoneInfo

DEFAULT_QUEUE_HOUR = 20  # 8:00 PM
DEFAULT_QUEUE_MINUTE = 0
DEFAULT_QUEUE_SECOND = 0

TIMEZONES: dict[str, ZoneInfo] = {
    "CDT": ZoneInfo("America/Chicago"),
    "EST": ZoneInfo("America/New_York"),
    "PT": ZoneInfo("America/Los_Angeles"),
}

TIMEZONE_LABELS: dict[str, str] = {
    "CDT": "Central (CDT/CST)",
    "EST": "Eastern (EST/EDT)",
    "PT": "Pacific (PT)",
}

# Backward-compatible alias.
CENTRAL = TIMEZONES["CDT"]

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

STARTER_DELAY_OPTIONS_MS = [
    120_000,
    90_000,
    60_000,
    45_000,
    30_000,
    20_000,
    15_000,
    10_000,
    5_000,
]

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
    10 / 60,
    5 / 60,
]

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
class StartDelayOption:
    delay_ms: int
    aligns_to_queue: bool
    refreshes_until_queue: int
    label: str


@dataclass(frozen=True)
class Schedule:
    target: datetime
    start: datetime
    steps: list[DelayStep]
    final_refresh_times: list[datetime]
    timezone_key: str = "CDT"

    @property
    def hits_target_exactly(self) -> bool:
        if not self.final_refresh_times:
            return False
        return self.final_refresh_times[-1] == self.target


def get_timezone(key: str) -> ZoneInfo:
    normalized = key.upper()
    if normalized not in TIMEZONES:
        raise ValueError(f"Unknown timezone '{key}'. Choose from: {', '.join(TIMEZONES)}")
    return TIMEZONES[normalized]


def next_walmart_queue_time(
    *,
    now: datetime | None = None,
    tz_key: str = "CDT",
    hour: int = DEFAULT_QUEUE_HOUR,
    minute: int = DEFAULT_QUEUE_MINUTE,
    second: int = DEFAULT_QUEUE_SECOND,
) -> datetime:
    """Return the next Wednesday queue go-live in the selected timezone."""
    tz = get_timezone(tz_key)
    now = _ensure_tz(now or datetime.now(tz), tz)
    candidate = now.replace(hour=hour, minute=minute, second=second, microsecond=0)
    days_ahead = (2 - candidate.weekday()) % 7
    if days_ahead == 0 and candidate <= now:
        days_ahead = 7
    return candidate + timedelta(days=days_ahead)


def create_demo_target(
    *,
    minutes_from_now: float = 5.0,
    now: datetime | None = None,
    tz_key: str = "CDT",
) -> datetime:
    """Build a demo queue time a few minutes from now for testing alignment."""
    tz = get_timezone(tz_key)
    now = _ensure_tz(now or datetime.now(tz), tz)
    seconds = int(minutes_from_now * 60)
    return (now + timedelta(seconds=seconds)).replace(microsecond=0)


def _ensure_tz(dt: datetime, tz: ZoneInfo) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


def _ensure_central(dt: datetime) -> datetime:
    return _ensure_tz(dt, CENTRAL)


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


def recommended_start_delays(
    *,
    target: datetime,
    start: datetime,
    tz_key: str = "CDT",
) -> list[StartDelayOption]:
    """Return starter delays that align refreshes with queue go-live."""
    tz = get_timezone(tz_key)
    target = _ensure_tz(target, tz)
    start = _ensure_tz(start, tz)
    total_ms = int((target - start).total_seconds() * 1000)
    if total_ms <= 0:
        return []

    options: list[StartDelayOption] = []
    for delay in STARTER_DELAY_OPTIONS_MS:
        if delay > total_ms:
            continue
        aligns = total_ms % delay == 0
        refreshes = total_ms // delay if aligns else 0
        if aligns:
            label = f"{format_duration_ms(delay)} — {refreshes} refreshes, hits queue exactly"
        else:
            partial = int((total_ms // delay))
            label = f"{format_duration_ms(delay)} — {partial} refreshes (needs drop schedule)"
        options.append(
            StartDelayOption(
                delay_ms=delay,
                aligns_to_queue=aligns,
                refreshes_until_queue=refreshes if aligns else partial,
                label=label,
            )
        )
    return options


def _filter_milestones(start_minutes_before: float, milestones_min: list[float]) -> list[float]:
    return [m for m in sorted(milestones_min, reverse=True) if 0 < m < start_minutes_before]


def _build_steps_from_boundaries(
    *,
    target: datetime,
    boundary_minutes: list[float],
    max_delay_caps: list[tuple[float, int]],
    min_delay_ms: int,
    first_delay_override: int | None = None,
) -> list[DelayStep]:
    boundary_times = [target - timedelta(minutes=m) for m in boundary_minutes]
    steps: list[DelayStep] = []

    for i in range(len(boundary_times) - 1):
        at = boundary_times[i]
        next_at = boundary_times[i + 1]
        minutes_before = boundary_minutes[i]
        segment_ms = int((next_at - at).total_seconds() * 1000)

        if i == 0 and first_delay_override is not None:
            delay_ms = first_delay_override
            aligned = segment_ms % delay_ms == 0 if delay_ms else False
        else:
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
    return steps


def build_schedule(
    *,
    target: datetime,
    start: datetime | None = None,
    milestones_min: list[float] | None = None,
    max_delay_caps: list[tuple[float, int]] | None = None,
    min_delay_ms: int = 250,
    tz_key: str = "CDT",
    initial_delay_ms: int | None = None,
) -> Schedule:
    tz = get_timezone(tz_key)
    target = _ensure_tz(target, tz)
    start = _ensure_tz(start or datetime.now(tz), tz)
    milestones_min = milestones_min or DEFAULT_MILESTONES_MIN
    max_delay_caps = max_delay_caps or DEFAULT_MAX_DELAY_BY_MINUTES_BEFORE

    start_minutes_before = (target - start).total_seconds() / 60
    if start_minutes_before <= 0:
        raise ValueError("Start time must be before queue go-live.")

    milestones = _filter_milestones(start_minutes_before, milestones_min)
    boundary_minutes = [start_minutes_before] + milestones + [0.0]

    if initial_delay_ms is not None:
        steps = _build_schedule_with_initial_delay(
            target=target,
            start=start,
            initial_delay_ms=initial_delay_ms,
            milestones=milestones,
            start_minutes_before=start_minutes_before,
            max_delay_caps=max_delay_caps,
            min_delay_ms=min_delay_ms,
        )
    else:
        steps = _build_steps_from_boundaries(
            target=target,
            boundary_minutes=boundary_minutes,
            max_delay_caps=max_delay_caps,
            min_delay_ms=min_delay_ms,
        )

    final_refresh_times = _simulate_refreshes(steps, target)
    return Schedule(
        target=target,
        start=start,
        steps=steps,
        final_refresh_times=final_refresh_times,
        timezone_key=tz_key.upper(),
    )


def _build_schedule_with_initial_delay(
    *,
    target: datetime,
    start: datetime,
    initial_delay_ms: int,
    milestones: list[float],
    start_minutes_before: float,
    max_delay_caps: list[tuple[float, int]],
    min_delay_ms: int,
) -> list[DelayStep]:
    """Build schedule forcing the user's chosen starting delay."""
    if initial_delay_ms < min_delay_ms:
        raise ValueError(f"Initial delay must be at least {min_delay_ms} ms.")

    first_boundary_minutes = milestones[0] if milestones else 0.0
    first_boundary_at = target - timedelta(minutes=first_boundary_minutes)
    first_segment_ms = int((first_boundary_at - start).total_seconds() * 1000)

    if first_segment_ms <= 0:
        return _build_steps_from_boundaries(
            target=target,
            boundary_minutes=[start_minutes_before, 0.0],
            max_delay_caps=max_delay_caps,
            min_delay_ms=min_delay_ms,
            first_delay_override=initial_delay_ms,
        )

    aligned_first = first_segment_ms % initial_delay_ms == 0
    transition_at = first_boundary_at

    if not aligned_first:
        t = start + timedelta(milliseconds=initial_delay_ms)
        last_refresh = start
        while t <= first_boundary_at:
            last_refresh = t
            t += timedelta(milliseconds=initial_delay_ms)
        transition_at = last_refresh

    first_minutes_before = (target - start).total_seconds() / 60
    first_step_segment_ms = int((transition_at - start).total_seconds() * 1000)
    first_refreshes = first_step_segment_ms // initial_delay_ms if initial_delay_ms else 0

    steps: list[DelayStep] = [
        DelayStep(
            at=start,
            minutes_before=first_minutes_before,
            delay_ms=initial_delay_ms,
            refreshes_until_next=first_refreshes,
            segment_ms=first_step_segment_ms,
            aligned=first_step_segment_ms % initial_delay_ms == 0 if initial_delay_ms else False,
        )
    ]

    if transition_at >= target:
        return steps

    remaining_minutes_before = (target - transition_at).total_seconds() / 60
    remaining_milestones = _filter_milestones(remaining_minutes_before, milestones)
    boundary_minutes = [remaining_minutes_before] + remaining_milestones + [0.0]
    boundary_times = [target - timedelta(minutes=m) for m in boundary_minutes]

    for i in range(len(boundary_times) - 1):
        at = boundary_times[i]
        if i == 0:
            at = transition_at
        next_at = boundary_times[i + 1]
        minutes_before = (target - at).total_seconds() / 60
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

    return steps


def _simulate_refreshes(steps: list[DelayStep], target: datetime) -> list[datetime]:
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


def schedule_to_dict(schedule: Schedule) -> dict:
    tz = get_timezone(schedule.timezone_key)

    def fmt(dt: datetime) -> str:
        local = dt.astimezone(tz)
        return local.strftime("%I:%M:%S.%f")[:-3] + f" {local.strftime('%p')} {local.tzname()}"

    def fmt_full(dt: datetime) -> str:
        local = dt.astimezone(tz)
        return (
            local.strftime("%A, %B %d, %Y at %I:%M:%S.%f")[:-3]
            + f" {local.strftime('%p')} {local.tzname()}"
        )

    return {
        "timezone": schedule.timezone_key,
        "queue_live": fmt_full(schedule.target),
        "start_time": fmt_full(schedule.start),
        "hits_target_exactly": schedule.hits_target_exactly,
        "starter_options": [
            {
                "delay_ms": o.delay_ms,
                "aligns_to_queue": o.aligns_to_queue,
                "refreshes_until_queue": o.refreshes_until_queue,
                "label": o.label,
            }
            for o in recommended_start_delays(
                target=schedule.target,
                start=schedule.start,
                tz_key=schedule.timezone_key,
            )
        ],
        "drop_schedule": [
            {
                "is_start": i == 0,
                "at": fmt(step.at),
                "minutes_before": format_minutes_before(step.minutes_before),
                "delay_ms": step.delay_ms,
                "delay_label": format_duration_ms(step.delay_ms),
                "refreshes_until_next": step.refreshes_until_next,
                "aligned": step.aligned,
            }
            for i, step in enumerate(schedule.steps)
        ],
        "final_refreshes": [
            {
                "time": fmt(t),
                "is_queue_live": t == schedule.target,
            }
            for t in schedule.final_refresh_times[-15:]
        ],
    }


def schedule_to_live_demo(schedule: Schedule) -> dict:
    """Serialize schedule with millisecond timestamps for live demo playback."""
    base = schedule_to_dict(schedule)
    tz = get_timezone(schedule.timezone_key)

    def ts_ms(dt: datetime) -> int:
        return int(dt.astimezone(tz).timestamp() * 1000)

    base["target_ts"] = ts_ms(schedule.target)
    base["start_ts"] = ts_ms(schedule.start)
    base["server_now_ts"] = ts_ms(datetime.now(tz))
    base["drop_schedule"] = [
        {
            **step,
            "at_ts": ts_ms(schedule.steps[i].at),
        }
        for i, step in enumerate(base["drop_schedule"])
    ]
    base["all_refreshes"] = [
        {
            "time": fmt_refresh(t, tz),
            "ts": ts_ms(t),
            "is_queue_live": t == schedule.target,
        }
        for t in schedule.final_refresh_times
    ]
    return base


def fmt_refresh(dt: datetime, tz: ZoneInfo) -> str:
    local = dt.astimezone(tz)
    return local.strftime("%I:%M:%S.%f")[:-3] + f" {local.strftime('%p')} {local.tzname()}"


# Short milestones for the 3-minute live demo window.
LIVE_DEMO_MINUTES = 3.0
LIVE_DEMO_MILESTONES = [2, 1, 0.5, 0.25, 10 / 60, 5 / 60]
LIVE_DEMO_INITIAL_DELAY_MS = 15_000
