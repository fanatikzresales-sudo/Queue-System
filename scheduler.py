"""Core logic for Walmart queue refresh delay scheduling."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
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

DEFAULT_SWITCH_MINUTES_CANDIDATES = [10, 8, 7, 6, 5, 4, 3, 2]

# Last-min drop: switch 2–5 min before queue (tight final delays).
LAST_MIN_SWITCH_CANDIDATES = [5, 4, 3, 2]

# Preferred final-phase delays (ms) — picked for the single pre-queue drop.
FINAL_DELAY_PREFERENCES = [5_000, 3_000, 2_000, 1_500, 1_000, 800, 500]

LAST_MIN_FINAL_DELAYS = [3_000, 2_000, 1_500, 1_000, 800]
LONG_DROP_FINAL_DELAYS = [5_000, 3_000, 2_000]


class DropPlanMode(str, Enum):
    """Whether the user wants a late switch (last-min) or earlier long final delay."""

    LAST_MIN = "last_min"
    LONG_DROP = "long_drop"


def parse_drop_plan_mode(value: str | None) -> DropPlanMode:
    if not value:
        return DropPlanMode.LONG_DROP
    normalized = value.strip().lower().replace("-", "_")
    for mode in DropPlanMode:
        if mode.value == normalized:
            return mode
    raise ValueError(f"Unknown drop_mode '{value}'. Choose: last_min, long_drop")


# Long drop presets — drop up to ~10 min before queue, proxy-friendly final delays.
# (final_delay_ms, label, description, preferred_start_windows_min)
PRESET_BY_FINAL_DELAY: list[tuple[int, str, str, list[int]]] = [
    (5_000,  "Long · Drop to 5,000 ms",  "Most proxy-safe — low hit rate, ideal for long early starts", [120, 90, 60, 45]),
    (3_000,  "Long · Drop to 3,000 ms",  "Great balance — proxy-friendly, very reliable timing",        [90, 60, 45, 30]),
    (2_000,  "Long · Drop to 2,000 ms",  "Solid choice — strong refresh rate near queue time",          [60, 45, 30]),
    (1_500,  "Long · Drop to 1,500 ms",  "High precision — tight refresh, popular for Pokemon drops",   [60, 45, 30]),
    (1_000,  "Long · Drop to 1,000 ms",  "Ultra-precise — maximum accuracy at queue go-live",           [45, 30, 60]),
]

# Last-min drop presets — switch 2–5 min before queue with tight final delays.
PRESET_BY_LATE_DROP: list[tuple[int, str, str, list[int]]] = [
    (3_000,  "Last-Min · 3,000 ms",  "Drop 2–5 min before queue — strong near-live refresh",        [45, 60, 30]),
    (2_000,  "Last-Min · 2,000 ms",  "Drop 2–5 min before queue — high refresh rate",               [45, 60, 30]),
    (1_500,  "Last-Min · 1,500 ms",  "Drop 2–5 min before queue — Pokemon-precision timing",        [45, 60, 30]),
    (1_000,  "Last-Min · 1,000 ms",  "Drop 2–5 min before queue — ultra-tight final phase",         [30, 45]),
    (800,    "Last-Min · 800 ms",    "Drop 2–5 min before queue — maximum final-phase speed",       [30, 45]),
]

# Late-drop presets — fixed switch window (minutes before queue).
# (switch_minutes, final_delay_ms, label, description, preferred_start_windows_min)
PRESET_BY_DROP_WINDOW: list[tuple[int, int, str, str, list[int]]] = [
    (5, 3_000, "Drop 5 min before · 3,000 ms", "Late drop — 5 min before queue, balanced final delay", [60, 45, 30, 20]),
    (5, 2_000, "Drop 5 min before · 2,000 ms", "Late drop — 5 min before queue, tighter refresh", [45, 30, 20]),
    (3, 2_000, "Drop 3 min before · 2,000 ms", "Very late drop — strong precision near go-live", [45, 30, 20]),
    (3, 1_500, "Drop 3 min before · 1,500 ms", "Very late drop — popular for Pokemon-style timing", [30, 45, 20]),
    (2, 1_500, "Drop 2 min before · 1,500 ms", "Ultra-late drop — last-minute switch", [30, 20, 45]),
    (2, 1_000, "Drop 2 min before · 1,000 ms", "Ultra-late drop — maximum precision at queue live", [30, 20]),
]

# All start windows to search (minutes before queue, label).
ALL_START_WINDOWS: list[tuple[int, str]] = [
    (120, "2 hours early"),
    (90,  "1.5 hours early"),
    (75,  "1 hr 15 min early"),
    (60,  "1 hour early"),
    (45,  "45 min early"),
    (30,  "30 min early"),
]

# Preferred starting delays to try per preset, largest first.
PRESET_START_DELAY_PREFERENCES = [120_000, 90_000, 60_000, 45_000, 30_000, 20_000, 15_000, 10_000, 5_000]


class TimingMode(str, Enum):
    """How the automation bot applies a delay change after the user drops."""

    INSTANT = "instant"    # New delay applies immediately at the drop boundary
    DEFERRED = "deferred"  # Bot finishes one more start-delay cycle first


def parse_timing_mode(value: str | None) -> TimingMode:
    """Parse API/UI timing mode; defaults to instant."""
    if not value:
        return TimingMode.INSTANT
    normalized = value.strip().lower()
    for mode in TimingMode:
        if mode.value == normalized:
            return mode
    raise ValueError(f"Unknown timing_mode '{value}'. Choose: instant, deferred")


def drop_command_at(
    effective_switch: datetime,
    initial_delay_ms: int,
    mode: TimingMode,
) -> datetime:
    """When the user should change delay (may be earlier than effective switch)."""
    if mode == TimingMode.INSTANT:
        return effective_switch
    return effective_switch - timedelta(milliseconds=initial_delay_ms)


@dataclass(frozen=True)
class PresetPlan:
    """A fully resolved 2-step plan organized by target final delay."""
    label: str
    description: str
    minutes_early: float
    start_window_label: str
    start_delay_ms: int
    drop_minutes_before: float
    final_delay_ms: int
    verified: bool
    start_time_display: str
    drop_time_display: str
    queue_time_display: str
    start_delay_label: str
    final_delay_label: str
    drop_minutes_label: str
    refreshes_phase1: int
    refreshes_phase2: int
    start_h: int
    start_m: int
    start_s: int
    start_ts_ms: int   # Unix timestamp ms for task start
    drop_ts_ms: int    # Unix timestamp ms for user drop command
    queue_ts_ms: int   # Unix timestamp ms for queue go-live
    timing_mode: str = TimingMode.INSTANT.value
    effective_switch_ts_ms: int = 0  # When final delay actually applies
    effective_switch_time_display: str = ""
    switch_minutes_before: float = 0  # Minutes before queue when final delay phase begins
    preset_category: str = "standard"  # "standard" | "long_drop" | "late_drop"
    drop_mode: str = DropPlanMode.LONG_DROP.value


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
class CompatibleStartOption:
    """A start time + starting delay that achieves a target final drop delay."""

    start_time_display: str
    start_h: int
    start_m: int
    start_s: int
    start_window_label: str
    minutes_early: float
    start_delay_ms: int
    start_delay_label: str
    drop_minutes_before: float
    drop_minutes_label: str
    final_delay_ms: int
    final_delay_label: str
    switch_minutes_before: float
    refreshes_phase1: int
    refreshes_phase2: int


@dataclass(frozen=True)
class StartDelayOption:
    delay_ms: int
    aligns_to_queue: bool
    switch_minutes_before: float | None
    final_delay_ms: int | None
    refreshes_until_queue: int
    label: str


@dataclass(frozen=True)
class Schedule:
    target: datetime
    start: datetime
    steps: list[DelayStep]
    final_refresh_times: list[datetime]
    timezone_key: str = "CDT"
    timing_mode: TimingMode = TimingMode.INSTANT

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
    """
    Return the next Wednesday Walmart queue go-live.

    The event ALWAYS fires at `hour` o'clock **Central Time** (Walmart's timezone),
    regardless of `tz_key`.  The returned datetime is in Central Time so that
    arithmetic is consistent; display code converts to the user's tz.
    """
    central = TIMEZONES["CDT"]  # America/Chicago — the authoritative timezone
    tz = get_timezone(tz_key)

    # Anchor "now" in Central so weekday and hour comparisons are correct.
    now_central = _ensure_tz(now or datetime.now(tz), central)

    candidate = now_central.replace(
        hour=hour, minute=minute, second=second, microsecond=0
    )
    days_ahead = (2 - candidate.weekday()) % 7   # Wednesday = 2
    if days_ahead == 0 and candidate <= now_central:
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


def find_final_delay(
    remaining_ms: int,
    *,
    min_delay: int = 250,
    preferred: Iterable[int] = FINAL_DELAY_PREFERENCES,
) -> tuple[int, bool]:
    """Pick a final-phase delay so remaining time hits queue go-live exactly."""
    if remaining_ms <= 0:
        return min_delay, True

    for delay in preferred:
        if delay < min_delay or delay > remaining_ms:
            continue
        if remaining_ms % delay == 0:
            return delay, True

    for delay in PREFERRED_DELAYS_MS:
        if delay < min_delay or delay > remaining_ms:
            continue
        if remaining_ms % delay == 0:
            return delay, True

    if remaining_ms >= min_delay:
        return remaining_ms, False

    return min_delay, remaining_ms % min_delay == 0


def _snap_switch_to_start_grid(start: datetime, ideal_switch: datetime, initial_delay_ms: int) -> datetime | None:
    """Move switch time to the last start-delay refresh on or before ideal_switch."""
    phase1_ms = int((ideal_switch - start).total_seconds() * 1000)
    if phase1_ms < initial_delay_ms:
        return None
    n = phase1_ms // initial_delay_ms
    return start + timedelta(milliseconds=n * initial_delay_ms)


def build_two_step_schedule(
    *,
    target: datetime,
    start: datetime,
    initial_delay_ms: int,
    switch_minutes_before: float | None = None,
    min_delay_ms: int = 250,
) -> list[DelayStep]:
    """
    Build exactly two delay steps:
      1. Starting delay from task start until one switch point
      2. Final delay from switch point until queue go-live (exact refresh)
    """
    if initial_delay_ms < min_delay_ms:
        raise ValueError(f"Initial delay must be at least {min_delay_ms} ms.")

    candidates = (
        [switch_minutes_before]
        if switch_minutes_before is not None
        else DEFAULT_SWITCH_MINUTES_CANDIDATES
    )

    best: tuple[datetime, int, int, float, float] | None = None

    for switch_min in sorted(candidates, reverse=True):
        if switch_min <= 0:
            continue
        ideal_switch = target - timedelta(minutes=switch_min)
        if ideal_switch <= start:
            continue

        switch_at = _snap_switch_to_start_grid(start, ideal_switch, initial_delay_ms)
        if switch_at is None or switch_at >= target:
            continue

        phase1_ms = int((switch_at - start).total_seconds() * 1000)
        phase2_ms = int((target - switch_at).total_seconds() * 1000)
        if phase2_ms < min_delay_ms:
            continue

        final_delay_ms, final_aligned = find_final_delay(phase2_ms, min_delay=min_delay_ms)
        if not final_aligned:
            continue

        phase1_aligned = phase1_ms % initial_delay_ms == 0
        if not phase1_aligned:
            continue

        actual_switch_min = phase2_ms / 60_000
        refreshes_phase1 = phase1_ms // initial_delay_ms
        score = actual_switch_min
        if best is None or score > best[3]:
            best = (switch_at, final_delay_ms, refreshes_phase1, actual_switch_min, switch_min)

    if best is None:
        raise ValueError(
            "Could not build a two-step schedule with this start time and delay. "
            "Try a different starting delay (see recommended options)."
        )

    switch_at, final_delay_ms, refreshes_phase1, actual_switch_min, _ = best
    phase1_ms = int((switch_at - start).total_seconds() * 1000)
    phase2_ms = int((target - switch_at).total_seconds() * 1000)
    refreshes_phase2 = phase2_ms // final_delay_ms

    start_minutes_before = (target - start).total_seconds() / 60
    switch_minutes_before_val = (target - switch_at).total_seconds() / 60

    return [
        DelayStep(
            at=start,
            minutes_before=start_minutes_before,
            delay_ms=initial_delay_ms,
            refreshes_until_next=refreshes_phase1,
            segment_ms=phase1_ms,
            aligned=True,
        ),
        DelayStep(
            at=switch_at,
            minutes_before=switch_minutes_before_val,
            delay_ms=final_delay_ms,
            refreshes_until_next=refreshes_phase2,
            segment_ms=phase2_ms,
            aligned=True,
        ),
    ]


def recommended_start_delays(
    *,
    target: datetime,
    start: datetime,
    tz_key: str = "CDT",
    switch_minutes_before: float | None = None,
) -> list[StartDelayOption]:
    """Return starting delays that work with a single pre-queue drop."""
    tz = get_timezone(tz_key)
    target = _ensure_tz(target, tz)
    start = _ensure_tz(start, tz)

    options: list[StartDelayOption] = []
    for delay in STARTER_DELAY_OPTIONS_MS:
        try:
            steps = build_two_step_schedule(
                target=target,
                start=start,
                initial_delay_ms=delay,
                switch_minutes_before=switch_minutes_before,
            )
        except ValueError:
            continue

        switch_min = steps[1].minutes_before
        final_delay = steps[1].delay_ms
        total_refreshes = (steps[0].refreshes_until_next or 0) + (steps[1].refreshes_until_next or 0)
        label = (
            f"{format_duration_ms(delay)} start → drop at "
            f"{format_minutes_before(switch_min)} before → "
            f"{format_duration_ms(final_delay)} until live"
        )
        options.append(
            StartDelayOption(
                delay_ms=delay,
                aligns_to_queue=True,
                switch_minutes_before=switch_min,
                final_delay_ms=final_delay,
                refreshes_until_queue=total_refreshes,
                label=label,
            )
        )
    return options


def build_schedule(
    *,
    target: datetime,
    start: datetime | None = None,
    min_delay_ms: int = 250,
    tz_key: str = "CDT",
    initial_delay_ms: int | None = None,
    switch_minutes_before: float | None = None,
    target_final_delay_ms: int | None = None,
    timing_mode: TimingMode | str = TimingMode.INSTANT,
    drop_mode: DropPlanMode | str = DropPlanMode.LONG_DROP,
    **_kwargs,
) -> Schedule:
    """Build a simple two-delay schedule: start delay + one drop before queue live."""
    tz = get_timezone(tz_key)
    target = _ensure_tz(target, tz)
    start = _ensure_tz(start or datetime.now(tz), tz)

    if (target - start).total_seconds() <= 0:
        raise ValueError("Start time must be before queue go-live.")

    if isinstance(timing_mode, str):
        timing_mode = parse_timing_mode(timing_mode)
    if isinstance(drop_mode, str):
        drop_mode = parse_drop_plan_mode(drop_mode)

    delay = initial_delay_ms if initial_delay_ms is not None else 60_000

    steps: list[DelayStep] | None = None

    if target_final_delay_ms is not None:
        if switch_minutes_before is not None:
            switch_candidates: list[float] | None = [switch_minutes_before]
        elif drop_mode == DropPlanMode.LAST_MIN:
            switch_candidates = LAST_MIN_SWITCH_CANDIDATES
        else:
            switch_candidates = None
        steps = _find_two_step_with_final_delay(
            target=target,
            start=start,
            initial_delay_ms=delay,
            target_final_delay_ms=target_final_delay_ms,
            min_delay_ms=min_delay_ms,
            switch_candidates=switch_candidates,
        )
        if steps is None:
            raise ValueError(
                f"Could not build a schedule with final delay {target_final_delay_ms} ms "
                f"for this start time and starting delay. "
                f"Try a different start time, starting delay, or drop plan mode."
            )
    elif drop_mode == DropPlanMode.LAST_MIN:
        switch_candidates = LAST_MIN_SWITCH_CANDIDATES
        for final_ms in LAST_MIN_FINAL_DELAYS:
            steps = _find_two_step_with_final_delay(
                target=target,
                start=start,
                initial_delay_ms=delay,
                target_final_delay_ms=final_ms,
                min_delay_ms=min_delay_ms,
                switch_candidates=switch_candidates,
            )
            if steps is not None:
                break
        if steps is None:
            raise ValueError(
                "Could not build a last-min drop schedule with this start time and delay. "
                "Try an earlier start or a different starting delay."
            )
    else:
        steps = build_two_step_schedule(
            target=target,
            start=start,
            initial_delay_ms=delay,
            switch_minutes_before=switch_minutes_before,
            min_delay_ms=min_delay_ms,
        )

    if timing_mode == TimingMode.DEFERRED:
        command_at = drop_command_at(steps[1].at, delay, timing_mode)
        if command_at < start:
            raise ValueError(
                "Deferred switch would require dropping before task start. "
                "Try an earlier start window or use Instant Switch mode."
            )

    final_refresh_times = _simulate_refreshes(steps, target)
    return Schedule(
        target=target,
        start=start,
        steps=steps,
        final_refresh_times=final_refresh_times,
        timezone_key=tz_key.upper(),
        timing_mode=timing_mode,
    )


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


def _append_preset_plan(
    plans: list[PresetPlan],
    *,
    target: datetime,
    tz: ZoneInfo,
    timing_mode: TimingMode,
    label: str,
    description: str,
    best_steps: list[DelayStep],
    best_window: int,
    window_labels: dict[int, str],
    preset_category: str,
    drop_mode: DropPlanMode = DropPlanMode.LONG_DROP,
) -> None:
    def _fmt_clock(dt: datetime) -> str:
        local = dt.astimezone(tz)
        return local.strftime("%I:%M %p").lstrip("0") + f" {local.tzname()}"

    s1, s2 = best_steps[0], best_steps[1]
    effective_switch = s2.at
    command_at = drop_command_at(effective_switch, s1.delay_ms, timing_mode)
    if command_at < s1.at:
        return

    drop_minutes_before = (target - command_at).total_seconds() / 60
    switch_minutes_before = (target - effective_switch).total_seconds() / 60
    window_label = window_labels.get(best_window, f"{best_window} min early")
    plans.append(
        PresetPlan(
            label=label,
            description=description,
            minutes_early=best_window,
            start_window_label=window_label,
            start_delay_ms=s1.delay_ms,
            drop_minutes_before=drop_minutes_before,
            final_delay_ms=s2.delay_ms,
            verified=True,
            start_time_display=_fmt_clock(s1.at),
            drop_time_display=_fmt_clock(command_at),
            queue_time_display=_fmt_clock(target),
            start_delay_label=format_duration_ms(s1.delay_ms),
            final_delay_label=format_duration_ms(s2.delay_ms),
            drop_minutes_label=format_minutes_before(drop_minutes_before),
            refreshes_phase1=s1.refreshes_until_next or 0,
            refreshes_phase2=s2.refreshes_until_next or 0,
            start_h=s1.at.astimezone(tz).hour,
            start_m=s1.at.astimezone(tz).minute,
            start_s=s1.at.astimezone(tz).second,
            start_ts_ms=int(s1.at.timestamp() * 1000),
            drop_ts_ms=int(command_at.timestamp() * 1000),
            queue_ts_ms=int(target.timestamp() * 1000),
            timing_mode=timing_mode.value,
            effective_switch_ts_ms=int(effective_switch.timestamp() * 1000),
            effective_switch_time_display=_fmt_clock(effective_switch),
            switch_minutes_before=switch_minutes_before,
            preset_category=preset_category,
            drop_mode=drop_mode.value,
        )
    )


def preset_schedules(
    *,
    target: datetime,
    tz_key: str = "CDT",
    timing_mode: TimingMode | str = TimingMode.INSTANT,
) -> list[PresetPlan]:
    """Compute long-drop preset plans (drop up to ~10 min before queue)."""
    return _preset_plans_for_definitions(
        target=target,
        tz_key=tz_key,
        timing_mode=timing_mode,
        preset_definitions=PRESET_BY_FINAL_DELAY,
        switch_candidates=DEFAULT_SWITCH_MINUTES_CANDIDATES,
        preset_category="long_drop",
        drop_mode=DropPlanMode.LONG_DROP,
    )


def preset_schedules_late_drop(
    *,
    target: datetime,
    tz_key: str = "CDT",
    timing_mode: TimingMode | str = TimingMode.INSTANT,
) -> list[PresetPlan]:
    """Compute last-min drop presets (switch 2–5 min before queue)."""
    if isinstance(timing_mode, str):
        timing_mode = parse_timing_mode(timing_mode)

    tz = get_timezone(tz_key)
    target = _ensure_tz(target, tz)
    plans = _preset_plans_for_definitions(
        target=target,
        tz_key=tz_key,
        timing_mode=timing_mode,
        preset_definitions=PRESET_BY_LATE_DROP,
        switch_candidates=LAST_MIN_SWITCH_CANDIDATES,
        preset_category="late_drop",
        drop_mode=DropPlanMode.LAST_MIN,
    )

    window_labels = {w: lbl for w, lbl in ALL_START_WINDOWS}
    for switch_min, final_delay_ms, label, description, preferred_windows in PRESET_BY_DROP_WINDOW:
        window_order = list(dict.fromkeys(
            preferred_windows + [w for w, _ in ALL_START_WINDOWS]
        ))

        best_steps: list[DelayStep] | None = None
        best_window: int = 0

        for window_min in window_order:
            start = target - timedelta(minutes=window_min)
            for start_delay in PRESET_START_DELAY_PREFERENCES:
                if start_delay >= window_min * 60 * 1000:
                    continue
                steps = _find_two_step_with_final_delay(
                    target=target,
                    start=start,
                    initial_delay_ms=start_delay,
                    target_final_delay_ms=final_delay_ms,
                    switch_candidates=[switch_min],
                )
                if steps is not None:
                    best_steps = steps
                    best_window = window_min
                    break
            if best_steps is not None:
                break

        if best_steps is None or len(best_steps) < 2:
            continue

        _append_preset_plan(
            plans,
            target=target,
            tz=tz,
            timing_mode=timing_mode,
            label=label,
            description=description,
            best_steps=best_steps,
            best_window=best_window,
            window_labels=window_labels,
            preset_category="late_drop",
            drop_mode=DropPlanMode.LAST_MIN,
        )

    return plans


def _preset_plans_for_definitions(
    *,
    target: datetime,
    tz_key: str,
    timing_mode: TimingMode | str,
    preset_definitions: list[tuple[int, str, str, list[int]]],
    switch_candidates: list[int],
    preset_category: str,
    drop_mode: DropPlanMode,
) -> list[PresetPlan]:
    """
    For each desired final drop delay, searches across start windows and
    starting delays to find the plan with:
      1. Latest possible switch (drop as late as possible)
      2. Largest safe starting delay (most proxy-friendly)
    """
    if isinstance(timing_mode, str):
        timing_mode = parse_timing_mode(timing_mode)

    tz = get_timezone(tz_key)
    target = _ensure_tz(target, tz)
    plans: list[PresetPlan] = []
    window_labels = {w: lbl for w, lbl in ALL_START_WINDOWS}

    for final_delay_ms, label, description, preferred_windows in preset_definitions:
        # Build a prioritised list of start windows: preferred ones first, rest after.
        window_order = list(dict.fromkeys(
            preferred_windows + [w for w, _ in ALL_START_WINDOWS]
        ))

        best_steps: list[DelayStep] | None = None
        best_window: int = 0

        for window_min in window_order:
            start = target - timedelta(minutes=window_min)
            for start_delay in PRESET_START_DELAY_PREFERENCES:
                if start_delay >= window_min * 60 * 1000:
                    continue
                try:
                    steps = _find_two_step_with_final_delay(
                        target=target,
                        start=start,
                        initial_delay_ms=start_delay,
                        target_final_delay_ms=final_delay_ms,
                        switch_candidates=switch_candidates,
                    )
                except ValueError:
                    continue
                if steps is not None:
                    best_steps = steps
                    best_window = window_min
                    break
            if best_steps is not None:
                break

        if best_steps is None or len(best_steps) < 2:
            continue

        _append_preset_plan(
            plans,
            target=target,
            tz=tz,
            timing_mode=timing_mode,
            label=label,
            description=description,
            best_steps=best_steps,
            best_window=best_window,
            window_labels=window_labels,
            preset_category=preset_category,
            drop_mode=drop_mode,
        )

    return plans


def find_compatible_custom_starts(
    *,
    target: datetime,
    tz_key: str = "CDT",
    target_final_delay_ms: int,
    timing_mode: TimingMode | str = TimingMode.INSTANT,
    drop_mode: DropPlanMode | str = DropPlanMode.LAST_MIN,
) -> list[CompatibleStartOption]:
    """
    List start windows and starting delays that achieve an exact target final delay.
    Used when a preset is selected or the user picks a last-min final delay.
    """
    if isinstance(timing_mode, str):
        timing_mode = parse_timing_mode(timing_mode)
    if isinstance(drop_mode, str):
        drop_mode = parse_drop_plan_mode(drop_mode)

    tz = get_timezone(tz_key)
    target = _ensure_tz(target, tz)
    switch_candidates = (
        LAST_MIN_SWITCH_CANDIDATES
        if drop_mode == DropPlanMode.LAST_MIN
        else DEFAULT_SWITCH_MINUTES_CANDIDATES
    )
    window_labels = {w: lbl for w, lbl in ALL_START_WINDOWS}
    options: list[CompatibleStartOption] = []
    seen: set[tuple[int, int, int]] = set()

    for window_min, window_label in ALL_START_WINDOWS:
        start = target - timedelta(minutes=window_min)
        for start_delay in PRESET_START_DELAY_PREFERENCES:
            if start_delay >= window_min * 60 * 1000:
                continue
            steps = _find_two_step_with_final_delay(
                target=target,
                start=start,
                initial_delay_ms=start_delay,
                target_final_delay_ms=target_final_delay_ms,
                switch_candidates=switch_candidates,
            )
            if steps is None or len(steps) < 2:
                continue

            s1, s2 = steps[0], steps[1]
            if s2.delay_ms != target_final_delay_ms:
                continue

            command_at = drop_command_at(s2.at, s1.delay_ms, timing_mode)
            if command_at < s1.at:
                continue

            key = (
                s1.at.astimezone(tz).hour,
                s1.at.astimezone(tz).minute,
                s1.delay_ms,
            )
            if key in seen:
                continue
            seen.add(key)

            local_start = s1.at.astimezone(tz)
            drop_minutes_before = (target - command_at).total_seconds() / 60
            switch_minutes_before = s2.minutes_before

            options.append(
                CompatibleStartOption(
                    start_time_display=local_start.strftime("%I:%M %p").lstrip("0")
                    + f" {local_start.tzname()}",
                    start_h=local_start.hour,
                    start_m=local_start.minute,
                    start_s=local_start.second,
                    start_window_label=window_label,
                    minutes_early=window_min,
                    start_delay_ms=s1.delay_ms,
                    start_delay_label=format_duration_ms(s1.delay_ms),
                    drop_minutes_before=drop_minutes_before,
                    drop_minutes_label=format_minutes_before(drop_minutes_before),
                    final_delay_ms=s2.delay_ms,
                    final_delay_label=format_duration_ms(s2.delay_ms),
                    switch_minutes_before=switch_minutes_before,
                    refreshes_phase1=s1.refreshes_until_next or 0,
                    refreshes_phase2=s2.refreshes_until_next or 0,
                )
            )

    options.sort(key=lambda o: (-o.minutes_early, -o.start_delay_ms))
    return options


def _find_two_step_with_final_delay(
    *,
    target: datetime,
    start: datetime,
    initial_delay_ms: int,
    target_final_delay_ms: int,
    min_delay_ms: int = 250,
    switch_candidates: Iterable[float] | None = None,
) -> list[DelayStep] | None:
    """
    Build a two-step schedule where the second step uses exactly target_final_delay_ms.
    Searches switch windows from latest to earliest unless overridden.
    Returns None if no exact alignment is found.
    """
    candidates = (
        list(switch_candidates)
        if switch_candidates is not None
        else DEFAULT_SWITCH_MINUTES_CANDIDATES
    )
    for switch_min in candidates:
        ideal_switch = target - timedelta(minutes=switch_min)
        if ideal_switch <= start:
            continue
        switch_at = _snap_switch_to_start_grid(start, ideal_switch, initial_delay_ms)
        if switch_at is None or switch_at >= target:
            continue

        phase1_ms = int((switch_at - start).total_seconds() * 1000)
        phase2_ms = int((target - switch_at).total_seconds() * 1000)

        if phase2_ms < target_final_delay_ms:
            continue
        if phase2_ms % target_final_delay_ms != 0:
            continue
        if phase1_ms % initial_delay_ms != 0:
            continue

        refreshes_phase2 = phase2_ms // target_final_delay_ms
        refreshes_phase1 = phase1_ms // initial_delay_ms
        start_minutes_before = (target - start).total_seconds() / 60
        switch_minutes_before = phase2_ms / 60_000

        return [
            DelayStep(
                at=start,
                minutes_before=start_minutes_before,
                delay_ms=initial_delay_ms,
                refreshes_until_next=refreshes_phase1,
                segment_ms=phase1_ms,
                aligned=True,
            ),
            DelayStep(
                at=switch_at,
                minutes_before=switch_minutes_before,
                delay_ms=target_final_delay_ms,
                refreshes_until_next=refreshes_phase2,
                segment_ms=phase2_ms,
                aligned=True,
            ),
        ]
    return None


def _drop_step_dict(
    *,
    step: DelayStep,
    schedule: Schedule,
    fmt: callable,
    is_start: bool,
) -> dict:
    if is_start:
        return {
            "is_start": True,
            "is_final_drop": False,
            "at": fmt(step.at),
            "at_ts_ms": int(step.at.timestamp() * 1000),
            "minutes_before": format_minutes_before(step.minutes_before),
            "delay_ms": step.delay_ms,
            "delay_label": format_duration_ms(step.delay_ms),
            "refreshes_until_next": step.refreshes_until_next,
            "aligned": step.aligned,
        }

    initial_delay_ms = schedule.steps[0].delay_ms
    effective_switch = step.at
    command_at = drop_command_at(effective_switch, initial_delay_ms, schedule.timing_mode)
    command_minutes_before = (schedule.target - command_at).total_seconds() / 60
    entry = {
        "is_start": False,
        "is_final_drop": True,
        "at": fmt(command_at),
        "at_ts_ms": int(command_at.timestamp() * 1000),
        "minutes_before": format_minutes_before(command_minutes_before),
        "delay_ms": step.delay_ms,
        "delay_label": format_duration_ms(step.delay_ms),
        "refreshes_until_next": step.refreshes_until_next,
        "aligned": step.aligned,
        "effective_switch_at": fmt(effective_switch),
        "effective_switch_ts_ms": int(effective_switch.timestamp() * 1000),
    }
    if schedule.timing_mode == TimingMode.DEFERRED:
        entry["deferred_note"] = (
            f"Bot finishes one more {format_duration_ms(initial_delay_ms)} refresh, "
            f"then final delay active at {fmt(effective_switch)}"
        )
    return entry


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
        "timing_mode": schedule.timing_mode.value,
        "queue_live": fmt_full(schedule.target),
        "start_time": fmt_full(schedule.start),
        "hits_target_exactly": schedule.hits_target_exactly,
        "two_step_only": True,
        "starter_options": [
            {
                "delay_ms": o.delay_ms,
                "aligns_to_queue": o.aligns_to_queue,
                "switch_minutes_before": o.switch_minutes_before,
                "final_delay_ms": o.final_delay_ms,
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
            _drop_step_dict(
                step=step,
                schedule=schedule,
                fmt=fmt,
                is_start=i == 0,
            )
            for i, step in enumerate(schedule.steps)
        ],
        "final_refreshes": [
            {
                "time": fmt(t),
                "is_queue_live": t == schedule.target,
            }
            for t in schedule.final_refresh_times[-15:]
        ],
        "queue_ts_ms": int(schedule.target.timestamp() * 1000),
        "final_delay_ms": schedule.steps[-1].delay_ms if len(schedule.steps) > 1 else None,
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
    base["timing_mode"] = schedule.timing_mode.value
    base["drop_schedule"] = [
        {
            **step,
            "at_ts": step["at_ts_ms"],
            "effective_switch_ts": step.get("effective_switch_ts_ms", step["at_ts_ms"]),
        }
        for step in base["drop_schedule"]
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


# Live demo uses the same two-step logic (start delay + one final drop).
LIVE_DEMO_MINUTES = 3.0
LIVE_DEMO_INITIAL_DELAY_MS = 15_000

# Candidate starting delays tried (largest-first) when auto-sizing for demo window.
_DEMO_START_DELAY_CANDIDATES = [30_000, 20_000, 15_000, 10_000, 8_000, 5_000, 3_000, 2_000]


def best_delay_for_demo(
    *,
    demo_minutes: float = LIVE_DEMO_MINUTES,
    target_final_delay_ms: int | None = None,
) -> tuple[int, int | None]:
    """
    Return (start_delay_ms, final_delay_ms) that fit cleanly inside the demo window.
    Tries to honour target_final_delay_ms when supplied (e.g. from a preset card).
    Falls back gracefully if no exact match exists.
    """
    from datetime import timezone as _tz

    dummy_target = datetime(2000, 1, 1, 0, 0, 0, tzinfo=_tz.utc) + timedelta(minutes=demo_minutes)
    dummy_start  = datetime(2000, 1, 1, 0, 0, 0, tzinfo=_tz.utc)

    for start_delay in _DEMO_START_DELAY_CANDIDATES:
        if target_final_delay_ms is not None:
            steps = _find_two_step_with_final_delay(
                target=dummy_target,
                start=dummy_start,
                initial_delay_ms=start_delay,
                target_final_delay_ms=target_final_delay_ms,
            )
            if steps is not None:
                return start_delay, target_final_delay_ms
        else:
            try:
                steps = build_two_step_schedule(
                    target=dummy_target,
                    start=dummy_start,
                    initial_delay_ms=start_delay,
                )
                return start_delay, steps[1].delay_ms
            except ValueError:
                continue

    # Last resort — default values known to work
    return LIVE_DEMO_INITIAL_DELAY_MS, 5_000


def _demo_minutes_for_preset(
    *,
    switch_minutes_before: float | None,
    final_delay_ms: int,
    start_delay_ms: int,
) -> float:
    """Pick a demo window long enough to mirror the preset's drop timing."""
    switch_min = switch_minutes_before if switch_minutes_before is not None else 2.0
    # Room for phase 2: at least ~1 minute or five final-delay ticks, whichever is larger.
    min_phase2_ms = max(60_000, final_delay_ms * 5)
    # Room for phase 1: at least one start-delay tick.
    min_phase1_ms = min(start_delay_ms, 120_000)
    total_ms = int(switch_min * 60_000) + min_phase2_ms + min_phase1_ms
    minutes = total_ms / 60_000
    return min(max(3.0, minutes), 10.0)


def build_demo_from_preset(
    *,
    start_delay_ms: int,
    final_delay_ms: int,
    switch_minutes_before: float | None = None,
    timing_mode: TimingMode | str = TimingMode.INSTANT,
    tz_key: str = "CDT",
    now: datetime | None = None,
) -> tuple[Schedule, float]:
    """
    Build a live-demo schedule that mirrors a preset card:
    same start delay, final delay, drop window, and timing mode when possible.
    Returns (schedule, demo_duration_minutes).
    """
    if isinstance(timing_mode, str):
        timing_mode = parse_timing_mode(timing_mode)

    demo_minutes = _demo_minutes_for_preset(
        switch_minutes_before=switch_minutes_before,
        final_delay_ms=final_delay_ms,
        start_delay_ms=start_delay_ms,
    )

    tz = get_timezone(tz_key)
    now = _ensure_tz(now or datetime.now(tz), tz).replace(microsecond=0)
    target = now + timedelta(minutes=demo_minutes)
    start = now

    attempts: list[tuple[int, float | None]] = []
    if switch_minutes_before is not None:
        attempts.append((start_delay_ms, switch_minutes_before))
    attempts.append((start_delay_ms, None))

    smaller_starts = [d for d in _DEMO_START_DELAY_CANDIDATES if d <= start_delay_ms]
    if start_delay_ms not in smaller_starts:
        smaller_starts.insert(0, start_delay_ms)
    for sd in smaller_starts:
        if switch_minutes_before is not None:
            attempts.append((sd, switch_minutes_before))
        attempts.append((sd, None))

    seen: set[tuple[int, float | None]] = set()
    for sd, switch_min in attempts:
        key = (sd, switch_min)
        if key in seen:
            continue
        seen.add(key)
        try:
            schedule = build_schedule(
                target=target,
                start=start,
                initial_delay_ms=sd,
                target_final_delay_ms=final_delay_ms,
                switch_minutes_before=switch_min,
                timing_mode=timing_mode,
                tz_key=tz_key,
            )
            return schedule, demo_minutes
        except ValueError:
            continue

    demo_start, demo_final = best_delay_for_demo(
        demo_minutes=demo_minutes,
        target_final_delay_ms=final_delay_ms,
    )
    schedule = build_schedule(
        target=target,
        start=start,
        initial_delay_ms=demo_start,
        target_final_delay_ms=demo_final,
        timing_mode=timing_mode,
        tz_key=tz_key,
    )
    return schedule, demo_minutes
