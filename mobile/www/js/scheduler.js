/**
 * Core logic for Walmart queue refresh delay scheduling.
 * Port of scheduler.py — uses global luxon (DateTime) via script tag.
 */
(function (global) {
  'use strict';

  const { DateTime } = global.luxon;

  const DEFAULT_QUEUE_HOUR = 20;
  const DEFAULT_QUEUE_MINUTE = 0;
  const DEFAULT_QUEUE_SECOND = 0;

  const TIMEZONES = {
    CDT: 'America/Chicago',
    EST: 'America/New_York',
    PT: 'America/Los_Angeles',
  };

  const TIMEZONE_LABELS = {
    CDT: 'Central (CDT/CST)',
    EST: 'Eastern (EST/EDT)',
    PT: 'Pacific (PT)',
  };

  const CENTRAL = TIMEZONES.CDT;

  const PREFERRED_DELAYS_MS = [
    120_000, 90_000, 60_000, 45_000, 30_000, 20_000, 15_000, 10_000,
    8_000, 5_000, 3_000, 2_000, 1_500, 1_000, 800, 500, 250,
  ];

  const STARTER_DELAY_OPTIONS_MS = [
    120_000, 90_000, 60_000, 45_000, 30_000, 20_000, 15_000, 10_000, 5_000,
  ];

  const DEFAULT_SWITCH_MINUTES_CANDIDATES = [10, 8, 7, 6, 5, 4, 3, 2];

  const FINAL_DELAY_PREFERENCES = [5_000, 3_000, 2_000, 1_500, 1_000, 800, 500];

  const PRESET_BY_FINAL_DELAY = [
    [5_000, 'Drop to 5,000 ms', 'Most proxy-safe — low hit rate, ideal for long early starts', [120, 90, 60, 45]],
    [3_000, 'Drop to 3,000 ms', 'Great balance — proxy-friendly, very reliable timing', [90, 60, 45, 30]],
    [2_000, 'Drop to 2,000 ms', 'Solid choice — strong refresh rate near queue time', [60, 45, 30]],
    [1_500, 'Drop to 1,500 ms', 'High precision — tight refresh, popular for Pokemon drops', [60, 45, 30]],
    [1_000, 'Drop to 1,000 ms', 'Ultra-precise — maximum accuracy at queue go-live', [45, 30, 60]],
  ];

  const PRESET_BY_DROP_WINDOW = [
    [5, 3_000, 'Drop 5 min before · 3,000 ms', 'Late drop — 5 min before queue, balanced final delay', [60, 45, 30, 20]],
    [5, 2_000, 'Drop 5 min before · 2,000 ms', 'Late drop — 5 min before queue, tighter refresh', [45, 30, 20]],
    [3, 2_000, 'Drop 3 min before · 2,000 ms', 'Very late drop — strong precision near go-live', [45, 30, 20]],
    [3, 1_500, 'Drop 3 min before · 1,500 ms', 'Very late drop — popular for Pokemon-style timing', [30, 45, 20]],
    [2, 1_500, 'Drop 2 min before · 1,500 ms', 'Ultra-late drop — last-minute switch', [30, 20, 45]],
    [2, 1_000, 'Drop 2 min before · 1,000 ms', 'Ultra-late drop — maximum precision at queue live', [30, 20]],
  ];

  const ALL_START_WINDOWS = [
    [120, '2 hours early'],
    [90, '1.5 hours early'],
    [75, '1 hr 15 min early'],
    [60, '1 hour early'],
    [45, '45 min early'],
    [30, '30 min early'],
  ];

  const PRESET_START_DELAY_PREFERENCES = [
    120_000, 90_000, 60_000, 45_000, 30_000, 20_000, 15_000, 10_000, 5_000,
  ];

  const TimingMode = {
    INSTANT: 'instant',
    DEFERRED: 'deferred',
  };

  const LIVE_DEMO_MINUTES = 3.0;
  const LIVE_DEMO_INITIAL_DELAY_MS = 15_000;

  const _DEMO_START_DELAY_CANDIDATES = [
    30_000, 20_000, 15_000, 10_000, 8_000, 5_000, 3_000, 2_000,
  ];

  /** Luxon weekday (Mon=1) → Python weekday (Mon=0). */
  function _pythonWeekday(dt) {
    return dt.weekday - 1;
  }

  function _hasExplicitZone(dt) {
    return dt.zone.type === 'fixed' || dt.zone.type === 'iana';
  }

  function _ensureTz(dt, zone) {
    if (!_hasExplicitZone(dt)) {
      return dt.setZone(zone, { keepLocalTime: true });
    }
    return dt.setZone(zone);
  }

  function _ensureCentral(dt) {
    return _ensureTz(dt, CENTRAL);
  }

  function _diffMs(a, b) {
    return Math.trunc(a.diff(b, 'milliseconds').milliseconds);
  }

  function _tsMs(dt) {
    return Math.trunc(dt.toSeconds() * 1000);
  }

  function get_timezone(key) {
    const normalized = key.toUpperCase();
    if (!(normalized in TIMEZONES)) {
      throw new Error(
        `Unknown timezone '${key}'. Choose from: ${Object.keys(TIMEZONES).join(', ')}`,
      );
    }
    return TIMEZONES[normalized];
  }

  function parse_timing_mode(value) {
    if (!value) {
      return TimingMode.INSTANT;
    }
    const normalized = String(value).trim().toLowerCase();
    for (const mode of Object.values(TimingMode)) {
      if (mode === normalized) {
        return mode;
      }
    }
    throw new Error(`Unknown timing_mode '${value}'. Choose: instant, deferred`);
  }

  function drop_command_at(effectiveSwitch, initialDelayMs, mode) {
    if (mode === TimingMode.INSTANT) {
      return effectiveSwitch;
    }
    return effectiveSwitch.minus({ milliseconds: initialDelayMs });
  }

  function find_aligned_delay(remainingMs, options = {}) {
    const {
      max_delay: maxDelay,
      min_delay: minDelay = 250,
      preferred = PREFERRED_DELAYS_MS,
    } = options;

    if (remainingMs <= 0) {
      return [minDelay, true];
    }

    for (const delay of preferred) {
      if (delay > maxDelay || delay < minDelay) {
        continue;
      }
      if (remainingMs % delay === 0) {
        return [delay, true];
      }
    }

    if (remainingMs >= minDelay) {
      return [remainingMs, false];
    }

    return [minDelay, remainingMs % minDelay === 0];
  }

  function find_final_delay(remainingMs, options = {}) {
    const {
      min_delay: minDelay = 250,
      preferred = FINAL_DELAY_PREFERENCES,
    } = options;

    if (remainingMs <= 0) {
      return [minDelay, true];
    }

    for (const delay of preferred) {
      if (delay < minDelay || delay > remainingMs) {
        continue;
      }
      if (remainingMs % delay === 0) {
        return [delay, true];
      }
    }

    for (const delay of PREFERRED_DELAYS_MS) {
      if (delay < minDelay || delay > remainingMs) {
        continue;
      }
      if (remainingMs % delay === 0) {
        return [delay, true];
      }
    }

    if (remainingMs >= minDelay) {
      return [remainingMs, false];
    }

    return [minDelay, remainingMs % minDelay === 0];
  }

  function _snap_switch_to_start_grid(start, idealSwitch, initialDelayMs) {
    const phase1Ms = _diffMs(idealSwitch, start);
    if (phase1Ms < initialDelayMs) {
      return null;
    }
    const n = Math.floor(phase1Ms / initialDelayMs);
    return start.plus({ milliseconds: n * initialDelayMs });
  }

  function build_two_step_schedule(options = {}) {
    const {
      target,
      start,
      initial_delay_ms: initialDelayMs,
      switch_minutes_before: switchMinutesBefore = null,
      min_delay_ms: minDelayMs = 250,
    } = options;

    if (initialDelayMs < minDelayMs) {
      throw new Error(`Initial delay must be at least ${minDelayMs} ms.`);
    }

    const candidates =
      switchMinutesBefore !== null && switchMinutesBefore !== undefined
        ? [switchMinutesBefore]
        : DEFAULT_SWITCH_MINUTES_CANDIDATES;

    let best = null;

    for (const switchMin of [...candidates].sort((a, b) => b - a)) {
      if (switchMin <= 0) {
        continue;
      }
      const idealSwitch = target.minus({ minutes: switchMin });
      if (idealSwitch <= start) {
        continue;
      }

      const switchAt = _snap_switch_to_start_grid(start, idealSwitch, initialDelayMs);
      if (switchAt === null || switchAt >= target) {
        continue;
      }

      const phase1Ms = _diffMs(switchAt, start);
      const phase2Ms = _diffMs(target, switchAt);
      if (phase2Ms < minDelayMs) {
        continue;
      }

      const [finalDelayMs, finalAligned] = find_final_delay(phase2Ms, { min_delay: minDelayMs });
      if (!finalAligned) {
        continue;
      }

      const phase1Aligned = phase1Ms % initialDelayMs === 0;
      if (!phase1Aligned) {
        continue;
      }

      const actualSwitchMin = phase2Ms / 60_000;
      const refreshesPhase1 = Math.floor(phase1Ms / initialDelayMs);
      const score = actualSwitchMin;
      if (best === null || score > best[3]) {
        best = [switchAt, finalDelayMs, refreshesPhase1, actualSwitchMin, switchMin];
      }
    }

    if (best === null) {
      throw new Error(
        'Could not build a two-step schedule with this start time and delay. ' +
          'Try a different starting delay (see recommended options).',
      );
    }

    const [switchAt, finalDelayMs, refreshesPhase1] = best;
    const phase1Ms = _diffMs(switchAt, start);
    const phase2Ms = _diffMs(target, switchAt);
    const refreshesPhase2 = Math.floor(phase2Ms / finalDelayMs);

    const startMinutesBefore = target.diff(start, 'minutes').minutes;
    const switchMinutesBeforeVal = target.diff(switchAt, 'minutes').minutes;

    return [
      {
        at: start,
        minutes_before: startMinutesBefore,
        delay_ms: initialDelayMs,
        refreshes_until_next: refreshesPhase1,
        segment_ms: phase1Ms,
        aligned: true,
      },
      {
        at: switchAt,
        minutes_before: switchMinutesBeforeVal,
        delay_ms: finalDelayMs,
        refreshes_until_next: refreshesPhase2,
        segment_ms: phase2Ms,
        aligned: true,
      },
    ];
  }

  function _find_two_step_with_final_delay(options = {}) {
    const {
      target,
      start,
      initial_delay_ms: initialDelayMs,
      target_final_delay_ms: targetFinalDelayMs,
      min_delay_ms: minDelayMs = 250,
      switch_candidates: switchCandidates = null,
    } = options;

    const candidates =
      switchCandidates !== null && switchCandidates !== undefined
        ? [...switchCandidates]
        : DEFAULT_SWITCH_MINUTES_CANDIDATES;

    for (const switchMin of candidates) {
      const idealSwitch = target.minus({ minutes: switchMin });
      if (idealSwitch <= start) {
        continue;
      }
      const switchAt = _snap_switch_to_start_grid(start, idealSwitch, initialDelayMs);
      if (switchAt === null || switchAt >= target) {
        continue;
      }

      const phase1Ms = _diffMs(switchAt, start);
      const phase2Ms = _diffMs(target, switchAt);

      if (phase2Ms < targetFinalDelayMs) {
        continue;
      }
      if (phase2Ms % targetFinalDelayMs !== 0) {
        continue;
      }
      if (phase1Ms % initialDelayMs !== 0) {
        continue;
      }

      const refreshesPhase2 = Math.floor(phase2Ms / targetFinalDelayMs);
      const refreshesPhase1 = Math.floor(phase1Ms / initialDelayMs);
      const startMinutesBefore = target.diff(start, 'minutes').minutes;
      const switchMinutesBefore = phase2Ms / 60_000;

      return [
        {
          at: start,
          minutes_before: startMinutesBefore,
          delay_ms: initialDelayMs,
          refreshes_until_next: refreshesPhase1,
          segment_ms: phase1Ms,
          aligned: true,
        },
        {
          at: switchAt,
          minutes_before: switchMinutesBefore,
          delay_ms: targetFinalDelayMs,
          refreshes_until_next: refreshesPhase2,
          segment_ms: phase2Ms,
          aligned: true,
        },
      ];
    }
    return null;
  }

  function _simulate_refreshes(steps, target) {
    if (!steps.length) {
      return [];
    }

    const times = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const end = i + 1 < steps.length ? steps[i + 1].at : target;
      let t = step.at.plus({ milliseconds: step.delay_ms });
      while (t.toMillis() <= end.toMillis() + 1) {
        times.push(t);
        t = t.plus({ milliseconds: step.delay_ms });
      }
    }
    return times;
  }

  function _hitsTargetExactly(schedule) {
    if (!schedule.final_refresh_times.length) {
      return false;
    }
    const last = schedule.final_refresh_times[schedule.final_refresh_times.length - 1];
    return last.toMillis() === schedule.target.toMillis();
  }

  function next_walmart_queue_time(options = {}) {
    const {
      now = null,
      tz_key: tzKey = 'CDT',
      hour = DEFAULT_QUEUE_HOUR,
      minute = DEFAULT_QUEUE_MINUTE,
      second = DEFAULT_QUEUE_SECOND,
    } = options;

    const central = TIMEZONES.CDT;
    const tz = get_timezone(tzKey);

    const nowCentral = _ensureTz(now || DateTime.now().setZone(tz), central);

    let candidate = nowCentral.set({
      hour,
      minute,
      second,
      millisecond: 0,
    });

    const pyWeekday = _pythonWeekday(candidate);
    let daysAhead = (2 - pyWeekday + 7) % 7;
    if (daysAhead === 0 && candidate <= nowCentral) {
      daysAhead = 7;
    }
    return candidate.plus({ days: daysAhead });
  }

  function create_demo_target(options = {}) {
    const {
      minutes_from_now: minutesFromNow = 5.0,
      now = null,
      tz_key: tzKey = 'CDT',
    } = options;

    const tz = get_timezone(tzKey);
    const base = _ensureTz(now || DateTime.now().setZone(tz), tz);
    const seconds = Math.trunc(minutesFromNow * 60);
    return base.plus({ seconds }).set({ millisecond: 0 });
  }

  function format_duration_ms(ms) {
    if (ms >= 60_000) {
      return `${(ms / 60_000).toFixed(1)} min (${ms.toLocaleString('en-US')} ms)`;
    }
    if (ms >= 1_000) {
      return `${(ms / 1_000).toFixed(1)} sec (${ms.toLocaleString('en-US')} ms)`;
    }
    return `${ms} ms`;
  }

  function format_minutes_before(minutes) {
    if (minutes >= 1) {
      if (minutes === Math.trunc(minutes)) {
        return `${Math.trunc(minutes)} min`;
      }
      return `${minutes.toFixed(1)} min`;
    }
    const seconds = minutes * 60;
    if (seconds === Math.trunc(seconds)) {
      return `${Math.trunc(seconds)} sec`;
    }
    return `${seconds.toFixed(1)} sec`;
  }

  function recommended_start_delays(options = {}) {
    const {
      target,
      start,
      tz_key: tzKey = 'CDT',
      switch_minutes_before: switchMinutesBefore = null,
    } = options;

    const tz = get_timezone(tzKey);
    const targetDt = _ensureTz(target, tz);
    const startDt = _ensureTz(start, tz);

    const optionsOut = [];
    for (const delay of STARTER_DELAY_OPTIONS_MS) {
      let steps;
      try {
        steps = build_two_step_schedule({
          target: targetDt,
          start: startDt,
          initial_delay_ms: delay,
          switch_minutes_before: switchMinutesBefore,
        });
      } catch (_err) {
        continue;
      }

      const switchMin = steps[1].minutes_before;
      const finalDelay = steps[1].delay_ms;
      const totalRefreshes =
        (steps[0].refreshes_until_next || 0) + (steps[1].refreshes_until_next || 0);
      const label =
        `${format_duration_ms(delay)} start → drop at ` +
        `${format_minutes_before(switchMin)} before → ` +
        `${format_duration_ms(finalDelay)} until live`;

      optionsOut.push({
        delay_ms: delay,
        aligns_to_queue: true,
        switch_minutes_before: switchMin,
        final_delay_ms: finalDelay,
        refreshes_until_queue: totalRefreshes,
        label,
      });
    }
    return optionsOut;
  }

  function build_schedule(options = {}) {
    const {
      target,
      start = null,
      min_delay_ms: minDelayMs = 250,
      tz_key: tzKey = 'CDT',
      initial_delay_ms: initialDelayMs = null,
      switch_minutes_before: switchMinutesBefore = null,
      target_final_delay_ms: targetFinalDelayMs = null,
      timing_mode: timingModeIn = TimingMode.INSTANT,
    } = options;

    const tz = get_timezone(tzKey);
    const targetDt = _ensureTz(target, tz);
    const startDt = _ensureTz(start || DateTime.now().setZone(tz), tz);

    if (targetDt.diff(startDt, 'seconds').seconds <= 0) {
      throw new Error('Start time must be before queue go-live.');
    }

    let timingMode = timingModeIn;
    if (typeof timingMode === 'string') {
      timingMode = parse_timing_mode(timingMode);
    }

    const delay = initialDelayMs !== null && initialDelayMs !== undefined ? initialDelayMs : 60_000;

    let steps;
    if (targetFinalDelayMs !== null && targetFinalDelayMs !== undefined) {
      const switchCandidates =
        switchMinutesBefore !== null && switchMinutesBefore !== undefined
          ? [switchMinutesBefore]
          : null;
      steps = _find_two_step_with_final_delay({
        target: targetDt,
        start: startDt,
        initial_delay_ms: delay,
        target_final_delay_ms: targetFinalDelayMs,
        min_delay_ms: minDelayMs,
        switch_candidates: switchCandidates,
      });
      if (steps === null) {
        throw new Error(
          'Could not build a schedule with this start time, delay, and target final delay. ' +
            'Try a different starting delay or drop window.',
        );
      }
    } else {
      steps = build_two_step_schedule({
        target: targetDt,
        start: startDt,
        initial_delay_ms: delay,
        switch_minutes_before: switchMinutesBefore,
        min_delay_ms: minDelayMs,
      });
    }

    if (timingMode === TimingMode.DEFERRED) {
      const commandAt = drop_command_at(steps[1].at, delay, timingMode);
      if (commandAt < startDt) {
        throw new Error(
          'Deferred switch would require dropping before task start. ' +
            'Try an earlier start window or use Instant Switch mode.',
        );
      }
    }

    if (timingMode === TimingMode.DEFERRED) {
      const commandAt = drop_command_at(steps[1].at, delay, timingMode);
      if (commandAt < startDt) {
        throw new Error(
          'Deferred switch would require dropping before task start. ' +
            'Try an earlier start window or use Instant Switch mode.',
        );
      }
    }

    const finalRefreshTimes = _simulate_refreshes(steps, targetDt);
    const schedule = {
      target: targetDt,
      start: startDt,
      steps,
      final_refresh_times: finalRefreshTimes,
      timezone_key: tzKey.toUpperCase(),
      timing_mode: timingMode,
    };
    schedule.hits_target_exactly = _hitsTargetExactly(schedule);
    return schedule;
  }

  function _fmtClock(dt, tz) {
    const local = dt.setZone(tz);
    const timePart = local.toFormat('h:mm a');
    const abbr = local.offsetNameShort || local.zoneName;
    return `${timePart} ${abbr}`;
  }

  function _append_preset_plan(plans, options) {
    const {
      target,
      tz,
      timing_mode: timingMode,
      label,
      description,
      best_steps: bestSteps,
      best_window: bestWindow,
      window_labels: windowLabels,
      preset_category: presetCategory,
    } = options;

    const s1 = bestSteps[0];
    const s2 = bestSteps[1];
    const effectiveSwitch = s2.at;
    const commandAt = drop_command_at(effectiveSwitch, s1.delay_ms, timingMode);
    if (commandAt < s1.at) {
      return;
    }

    const dropMinutesBefore = target.diff(commandAt, 'minutes').minutes;
    const switchMinutesBefore = target.diff(effectiveSwitch, 'minutes').minutes;
    const windowLabel = windowLabels[bestWindow] || `${bestWindow} min early`;

    const startLocal = s1.at.setZone(tz);
    plans.push({
      label,
      description,
      minutes_early: bestWindow,
      start_window_label: windowLabel,
      start_delay_ms: s1.delay_ms,
      drop_minutes_before: dropMinutesBefore,
      final_delay_ms: s2.delay_ms,
      verified: true,
      start_time_display: _fmtClock(s1.at, tz),
      drop_time_display: _fmtClock(commandAt, tz),
      queue_time_display: _fmtClock(target, tz),
      start_delay_label: format_duration_ms(s1.delay_ms),
      final_delay_label: format_duration_ms(s2.delay_ms),
      drop_minutes_label: format_minutes_before(dropMinutesBefore),
      refreshes_phase1: s1.refreshes_until_next || 0,
      refreshes_phase2: s2.refreshes_until_next || 0,
      start_h: startLocal.hour,
      start_m: startLocal.minute,
      start_s: startLocal.second,
      start_ts_ms: _tsMs(s1.at),
      drop_ts_ms: _tsMs(commandAt),
      queue_ts_ms: _tsMs(target),
      timing_mode: timingMode,
      effective_switch_ts_ms: _tsMs(effectiveSwitch),
      effective_switch_time_display: _fmtClock(effectiveSwitch, tz),
      switch_minutes_before: switchMinutesBefore,
      preset_category: presetCategory,
    });
  }

  function preset_schedules(options = {}) {
    const {
      target,
      tz_key: tzKey = 'CDT',
      timing_mode: timingModeIn = TimingMode.INSTANT,
    } = options;

    let timingMode = timingModeIn;
    if (typeof timingMode === 'string') {
      timingMode = parse_timing_mode(timingMode);
    }

    const tz = get_timezone(tzKey);
    const targetDt = _ensureTz(target, tz);
    const plans = [];
    const windowLabels = Object.fromEntries(ALL_START_WINDOWS);

    for (const [finalDelayMs, label, description, preferredWindows] of PRESET_BY_FINAL_DELAY) {
      const windowOrder = [
        ...new Set([
          ...preferredWindows,
          ...ALL_START_WINDOWS.map(([w]) => w),
        ]),
      ];

      let bestSteps = null;
      let bestWindow = 0;

      for (const windowMin of windowOrder) {
        const start = targetDt.minus({ minutes: windowMin });
        for (const startDelay of PRESET_START_DELAY_PREFERENCES) {
          if (startDelay >= windowMin * 60 * 1000) {
            continue;
          }
          let steps;
          try {
            steps = _find_two_step_with_final_delay({
              target: targetDt,
              start,
              initial_delay_ms: startDelay,
              target_final_delay_ms: finalDelayMs,
            });
          } catch (_err) {
            continue;
          }
          if (steps !== null) {
            bestSteps = steps;
            bestWindow = windowMin;
            break;
          }
        }
        if (bestSteps !== null) {
          break;
        }
      }

      if (bestSteps === null || bestSteps.length < 2) {
        continue;
      }

      _append_preset_plan(plans, {
        target: targetDt,
        tz,
        timing_mode: timingMode,
        label,
        description,
        best_steps: bestSteps,
        best_window: bestWindow,
        window_labels: windowLabels,
        preset_category: 'standard',
      });
    }

    for (const [switchMin, finalDelayMs, label, description, preferredWindows] of PRESET_BY_DROP_WINDOW) {
      const windowOrder = [
        ...new Set([
          ...preferredWindows,
          ...ALL_START_WINDOWS.map(([w]) => w),
        ]),
      ];

      let bestSteps = null;
      let bestWindow = 0;

      for (const windowMin of windowOrder) {
        const start = targetDt.minus({ minutes: windowMin });
        for (const startDelay of PRESET_START_DELAY_PREFERENCES) {
          if (startDelay >= windowMin * 60 * 1000) {
            continue;
          }
          let steps;
          try {
            steps = _find_two_step_with_final_delay({
              target: targetDt,
              start,
              initial_delay_ms: startDelay,
              target_final_delay_ms: finalDelayMs,
              switch_candidates: [switchMin],
            });
          } catch (_err) {
            continue;
          }
          if (steps !== null) {
            bestSteps = steps;
            bestWindow = windowMin;
            break;
          }
        }
        if (bestSteps !== null) {
          break;
        }
      }

      if (bestSteps === null || bestSteps.length < 2) {
        continue;
      }

      _append_preset_plan(plans, {
        target: targetDt,
        tz,
        timing_mode: timingMode,
        label,
        description,
        best_steps: bestSteps,
        best_window: bestWindow,
        window_labels: windowLabels,
        preset_category: 'late_drop',
      });
    }

    return plans;
  }

  function _drop_step_dict(options) {
    const { step, schedule, fmt, is_start: isStart } = options;

    if (isStart) {
      return {
        is_start: true,
        is_final_drop: false,
        at: fmt(step.at),
        at_ts_ms: _tsMs(step.at),
        minutes_before: format_minutes_before(step.minutes_before),
        delay_ms: step.delay_ms,
        delay_label: format_duration_ms(step.delay_ms),
        refreshes_until_next: step.refreshes_until_next,
        aligned: step.aligned,
      };
    }

    const initialDelayMs = schedule.steps[0].delay_ms;
    const effectiveSwitch = step.at;
    const commandAt = drop_command_at(effectiveSwitch, initialDelayMs, schedule.timing_mode);
    const commandMinutesBefore = schedule.target.diff(commandAt, 'minutes').minutes;
    const entry = {
      is_start: false,
      is_final_drop: true,
      at: fmt(commandAt),
      at_ts_ms: _tsMs(commandAt),
      minutes_before: format_minutes_before(commandMinutesBefore),
      delay_ms: step.delay_ms,
      delay_label: format_duration_ms(step.delay_ms),
      refreshes_until_next: step.refreshes_until_next,
      aligned: step.aligned,
      effective_switch_at: fmt(effectiveSwitch),
      effective_switch_ts_ms: _tsMs(effectiveSwitch),
    };
    if (schedule.timing_mode === TimingMode.DEFERRED) {
      entry.deferred_note =
        `Bot finishes one more ${format_duration_ms(initialDelayMs)} refresh, ` +
        `then final delay active at ${fmt(effectiveSwitch)}`;
    }
    return entry;
  }

  function schedule_to_dict(schedule) {
    const tz = get_timezone(schedule.timezone_key);

    function fmt(dt) {
      const local = dt.setZone(tz);
      const abbr = local.offsetNameShort || local.zoneName;
      return `${local.toFormat('hh:mm:ss.SSS')} ${local.toFormat('a')} ${abbr}`;
    }

    function fmtFull(dt) {
      const local = dt.setZone(tz);
      const abbr = local.offsetNameShort || local.zoneName;
      return `${local.toFormat('cccc, LLLL dd, yyyy')} at ${local.toFormat('hh:mm:ss.SSS')} ${local.toFormat('a')} ${abbr}`;
    }

    return {
      timezone: schedule.timezone_key,
      timing_mode:
        typeof schedule.timing_mode === 'string'
          ? schedule.timing_mode
          : schedule.timing_mode,
      queue_live: fmtFull(schedule.target),
      start_time: fmtFull(schedule.start),
      hits_target_exactly: schedule.hits_target_exactly,
      two_step_only: true,
      starter_options: recommended_start_delays({
        target: schedule.target,
        start: schedule.start,
        tz_key: schedule.timezone_key,
      }),
      drop_schedule: schedule.steps.map((step, i) =>
        _drop_step_dict({
          step,
          schedule,
          fmt,
          is_start: i === 0,
        }),
      ),
      final_refreshes: schedule.final_refresh_times.slice(-15).map((t) => ({
        time: fmt(t),
        is_queue_live: t.toMillis() === schedule.target.toMillis(),
      })),
    };
  }

  function fmt_refresh(dt, tz) {
    const local = dt.setZone(tz);
    const abbr = local.offsetNameShort || local.zoneName;
    return `${local.toFormat('hh:mm:ss.SSS')} ${local.toFormat('a')} ${abbr}`;
  }

  function schedule_to_live_demo(schedule) {
    const base = schedule_to_dict(schedule);
    const tz = get_timezone(schedule.timezone_key);

    function tsMsLocal(dt) {
      return _tsMs(dt.setZone(tz));
    }

    base.target_ts = tsMsLocal(schedule.target);
    base.start_ts = tsMsLocal(schedule.start);
    base.server_now_ts = tsMsLocal(DateTime.now().setZone(tz));
    base.timing_mode =
      typeof schedule.timing_mode === 'string'
        ? schedule.timing_mode
        : schedule.timing_mode;
    base.drop_schedule = base.drop_schedule.map((step) => ({
      ...step,
      at_ts: step.at_ts_ms,
      effective_switch_ts: step.effective_switch_ts_ms ?? step.at_ts_ms,
    }));
    base.all_refreshes = schedule.final_refresh_times.map((t) => ({
      time: fmt_refresh(t, tz),
      ts: tsMsLocal(t),
      is_queue_live: t.toMillis() === schedule.target.toMillis(),
    }));
    return base;
  }

  function best_delay_for_demo(options = {}) {
    const {
      demo_minutes: demoMinutes = LIVE_DEMO_MINUTES,
      target_final_delay_ms: targetFinalDelayMs = null,
    } = options;

    const dummyTarget = DateTime.fromObject(
      { year: 2000, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
      { zone: 'UTC' },
    ).plus({ minutes: demoMinutes });
    const dummyStart = DateTime.fromObject(
      { year: 2000, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
      { zone: 'UTC' },
    );

    for (const startDelay of _DEMO_START_DELAY_CANDIDATES) {
      if (targetFinalDelayMs !== null && targetFinalDelayMs !== undefined) {
        const steps = _find_two_step_with_final_delay({
          target: dummyTarget,
          start: dummyStart,
          initial_delay_ms: startDelay,
          target_final_delay_ms: targetFinalDelayMs,
        });
        if (steps !== null) {
          return [startDelay, targetFinalDelayMs];
        }
      } else {
        try {
          const steps = build_two_step_schedule({
            target: dummyTarget,
            start: dummyStart,
            initial_delay_ms: startDelay,
          });
          return [startDelay, steps[1].delay_ms];
        } catch (_err) {
          continue;
        }
      }
    }

    return [LIVE_DEMO_INITIAL_DELAY_MS, 5_000];
  }

  function _demo_minutes_for_preset(options) {
    const {
      switch_minutes_before: switchMinutesBefore = null,
      final_delay_ms: finalDelayMs,
      start_delay_ms: startDelayMs,
    } = options;

    const switchMin = switchMinutesBefore !== null && switchMinutesBefore !== undefined
      ? switchMinutesBefore
      : 2.0;
    const minPhase2Ms = Math.max(60_000, finalDelayMs * 5);
    const minPhase1Ms = Math.min(startDelayMs, 120_000);
    const totalMs = Math.trunc(switchMin * 60_000) + minPhase2Ms + minPhase1Ms;
    const minutes = totalMs / 60_000;
    return Math.min(Math.max(3.0, minutes), 10.0);
  }

  function build_demo_from_preset(options = {}) {
    const {
      start_delay_ms: startDelayMs,
      final_delay_ms: finalDelayMs,
      switch_minutes_before: switchMinutesBefore = null,
      timing_mode: timingModeIn = TimingMode.INSTANT,
      tz_key: tzKey = 'CDT',
      now = null,
    } = options;

    let timingMode = timingModeIn;
    if (typeof timingMode === 'string') {
      timingMode = parse_timing_mode(timingMode);
    }

    const demoMinutes = _demo_minutes_for_preset({
      switch_minutes_before: switchMinutesBefore,
      final_delay_ms: finalDelayMs,
      start_delay_ms: startDelayMs,
    });

    const tz = get_timezone(tzKey);
    const nowDt = _ensureTz(now || DateTime.now().setZone(tz), tz).set({ millisecond: 0 });
    const target = nowDt.plus({ minutes: demoMinutes });
    const start = nowDt;

    const attempts = [];
    if (switchMinutesBefore !== null && switchMinutesBefore !== undefined) {
      attempts.push([startDelayMs, switchMinutesBefore]);
    }
    attempts.push([startDelayMs, null]);

    let smallerStarts = _DEMO_START_DELAY_CANDIDATES.filter((d) => d <= startDelayMs);
    if (!smallerStarts.includes(startDelayMs)) {
      smallerStarts = [startDelayMs, ...smallerStarts];
    }
    for (const sd of smallerStarts) {
      if (switchMinutesBefore !== null && switchMinutesBefore !== undefined) {
        attempts.push([sd, switchMinutesBefore]);
      }
      attempts.push([sd, null]);
    }

    const seen = new Set();
    for (const [sd, switchMin] of attempts) {
      const key = `${sd}:${switchMin}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      try {
        const schedule = build_schedule({
          target,
          start,
          initial_delay_ms: sd,
          target_final_delay_ms: finalDelayMs,
          switch_minutes_before: switchMin,
          timing_mode: timingMode,
          tz_key: tzKey,
        });
        return [schedule, demoMinutes];
      } catch (_err) {
        continue;
      }
    }

    const [demoStart, demoFinal] = best_delay_for_demo({
      demo_minutes: demoMinutes,
      target_final_delay_ms: finalDelayMs,
    });
    const schedule = build_schedule({
      target,
      start,
      initial_delay_ms: demoStart,
      target_final_delay_ms: demoFinal,
      timing_mode: timingMode,
      tz_key: tzKey,
    });
    return [schedule, demoMinutes];
  }

  global.QueueScheduler = {
    DateTime,
    DEFAULT_QUEUE_HOUR,
    DEFAULT_QUEUE_MINUTE,
    DEFAULT_QUEUE_SECOND,
    TIMEZONES,
    TIMEZONE_LABELS,
    CENTRAL,
    PREFERRED_DELAYS_MS,
    STARTER_DELAY_OPTIONS_MS,
    DEFAULT_SWITCH_MINUTES_CANDIDATES,
    FINAL_DELAY_PREFERENCES,
    PRESET_BY_FINAL_DELAY,
    PRESET_BY_DROP_WINDOW,
    ALL_START_WINDOWS,
    PRESET_START_DELAY_PREFERENCES,
    TimingMode,
    LIVE_DEMO_MINUTES,
    LIVE_DEMO_INITIAL_DELAY_MS,
    get_timezone,
    parse_timing_mode,
    drop_command_at,
    find_aligned_delay,
    find_final_delay,
    next_walmart_queue_time,
    create_demo_target,
    build_two_step_schedule,
    recommended_start_delays,
    build_schedule,
    preset_schedules,
    _find_two_step_with_final_delay,
    schedule_to_dict,
    schedule_to_live_demo,
    fmt_refresh,
    best_delay_for_demo,
    build_demo_from_preset,
    format_duration_ms,
    format_minutes_before,
  };
})(typeof window !== 'undefined' ? window : globalThis);
