/**
 * Delay planner math.
 *
 * The core idea: your automation refreshes on a fixed cadence. If the queue
 * goes live at time T, the only way a refresh lands at *exactly* T is if the
 * time between every delay change and T is an exact multiple of the delays in
 * between. So we build the schedule backwards from T:
 *
 *   - The final refresh happens at T (offset 0).
 *   - Each phase (a delay value + the window it's active in) must have a
 *     duration that is an exact multiple of its delay. We take the time you
 *     *asked* for ("switch to 1000 ms at T-2:00") and snap it to the nearest
 *     aligned boundary at or before that request (i.e. slightly earlier,
 *     never later), so the refresh grid stays unbroken all the way to T.
 *   - The very first refresh (when you start the automation) is itself a grid
 *     point, which is why the plan tells you the exact second to press start.
 *
 * Everything here is pure and runs both in the browser and in Node (tests,
 * server defaults).
 */

export const MIN_DELAY_MS = 100;

/**
 * Build an aligned refresh plan.
 *
 * @param {object} opts
 * @param {number} opts.goLiveEpochMs  Queue go-live instant (epoch ms).
 * @param {number} opts.leadTimeMs     How long before go-live you want to start refreshing.
 * @param {number} opts.initialDelayMs Delay used from start until the first step-down.
 * @param {Array<{delayMs:number, atOffsetMs:number}>} opts.steps
 *        Step-downs: "switch to delayMs when T-minus atOffsetMs". Order doesn't matter.
 * @param {'ceil'|'floor'} [opts.roundInitial='ceil']
 *        'ceil'  -> start at or before the requested lead time (default, for real plans).
 *        'floor' -> start at or after it (used by the simulator so the start
 *                   never lands in the past).
 * @returns plan object (see bottom of function).
 */
export function buildPlan({ goLiveEpochMs, leadTimeMs, initialDelayMs, steps, roundInitial = 'ceil' }) {
  const errors = [];
  const warnings = [];

  if (!Number.isFinite(goLiveEpochMs)) errors.push('Go-live time is not set or invalid.');
  if (!Number.isFinite(leadTimeMs) || leadTimeMs <= 0) errors.push('Lead time must be greater than zero.');
  if (!Number.isFinite(initialDelayMs) || initialDelayMs < MIN_DELAY_MS) {
    errors.push(`Initial delay must be at least ${MIN_DELAY_MS} ms.`);
  }

  const cleanedSteps = (steps || [])
    .filter((s) => Number.isFinite(s.delayMs) && Number.isFinite(s.atOffsetMs))
    .filter((s) => {
      if (s.delayMs < MIN_DELAY_MS) {
        warnings.push(`Ignored step "${s.delayMs} ms" — below the ${MIN_DELAY_MS} ms minimum.`);
        return false;
      }
      if (s.atOffsetMs <= 0) {
        warnings.push(`Ignored step at T-${s.atOffsetMs} ms — must be before go-live.`);
        return false;
      }
      if (Number.isFinite(leadTimeMs) && s.atOffsetMs >= leadTimeMs) {
        warnings.push(
          `Ignored step "${s.delayMs} ms at T-${formatDuration(s.atOffsetMs)}" — it is at or beyond the lead time.`
        );
        return false;
      }
      return true;
    })
    // Nearest to go-live first: we build phases from the end backwards.
    .sort((a, b) => a.atOffsetMs - b.atOffsetMs);

  if (errors.length) return { ok: false, errors, warnings };

  const phases = []; // will end up ordered start -> go-live
  let boundary = 0; // offset before T where the previous (later) phase begins

  for (const step of cleanedSteps) {
    const span = step.atOffsetMs - boundary;
    if (span <= 0) {
      warnings.push(
        `Ignored step "${step.delayMs} ms at T-${formatDuration(step.atOffsetMs)}" — it overlaps the next step after alignment.`
      );
      continue;
    }
    const intervals = Math.max(1, Math.ceil(span / step.delayMs));
    const startOffsetMs = boundary + intervals * step.delayMs;
    phases.unshift({
      delayMs: step.delayMs,
      requestedOffsetMs: step.atOffsetMs,
      startOffsetMs,
      endOffsetMs: boundary,
      refreshes: intervals,
      requestsPerMinute: 60000 / step.delayMs,
    });
    boundary = startOffsetMs;
  }

  // Initial phase: from automation start until the first step-down (or go-live
  // if there are no steps).
  const span0 = leadTimeMs - boundary;
  let intervals0;
  if (roundInitial === 'floor') {
    intervals0 = Math.max(1, Math.floor(span0 / initialDelayMs));
  } else {
    intervals0 = Math.max(1, Math.ceil(span0 / initialDelayMs));
  }
  const startOffsetMs = boundary + intervals0 * initialDelayMs;
  phases.unshift({
    delayMs: initialDelayMs,
    requestedOffsetMs: leadTimeMs,
    startOffsetMs,
    endOffsetMs: boundary,
    refreshes: intervals0,
    requestsPerMinute: 60000 / initialDelayMs,
  });

  const startEpochMs = goLiveEpochMs - startOffsetMs;

  // Human-facing action list: "start now", "change delay to X", "go live".
  const actions = phases.map((p, i) => ({
    type: i === 0 ? 'start' : 'change',
    epochMs: goLiveEpochMs - p.startOffsetMs,
    tMinusMs: p.startOffsetMs,
    delayMs: p.delayMs,
    refreshes: p.refreshes,
  }));
  actions.push({
    type: 'golive',
    epochMs: goLiveEpochMs,
    tMinusMs: 0,
    delayMs: phases[phases.length - 1].delayMs,
    refreshes: 0,
  });

  // +1 accounts for the very first refresh at automation start.
  const totalRequests = phases.reduce((acc, p) => acc + p.refreshes, 0) + 1;
  const requestsInLastMinute = countRequestsInWindow(phases, 60000);
  const requestsInLastFiveMinutes = countRequestsInWindow(phases, 300000);

  return {
    ok: true,
    errors,
    warnings,
    goLiveEpochMs,
    startEpochMs,
    startOffsetMs,
    phases,
    actions,
    totalRequests,
    requestsInLastMinute,
    requestsInLastFiveMinutes,
  };
}

/** Count refreshes that occur within the final `windowMs` before go-live. */
function countRequestsInWindow(phases, windowMs) {
  let count = 0;
  for (const p of phases) {
    if (p.endOffsetMs >= windowMs) continue;
    const overlapStart = Math.min(p.startOffsetMs, windowMs);
    const overlapSpan = overlapStart - p.endOffsetMs;
    if (overlapSpan <= 0) continue;
    count += Math.floor(overlapSpan / p.delayMs);
  }
  return count;
}

/**
 * Expand a plan into the full list of refresh instants (epoch ms), from the
 * first refresh at start through the go-live refresh, plus `extraAfter`
 * post-live refreshes at the final delay (useful in the simulator to show the
 * queue position you'd get).
 */
export function refreshTimeline(plan, extraAfter = 3) {
  if (!plan.ok) return [];
  const times = [plan.startEpochMs];
  for (const p of plan.phases) {
    const phaseStart = plan.goLiveEpochMs - p.startOffsetMs;
    for (let k = 1; k <= p.refreshes; k++) {
      times.push(phaseStart + k * p.delayMs);
    }
  }
  const lastDelay = plan.phases[plan.phases.length - 1].delayMs;
  for (let k = 1; k <= extraAfter; k++) {
    times.push(plan.goLiveEpochMs + k * lastDelay);
  }
  return times;
}

/* ------------------------------------------------------------------------ *
 * Time zone helpers (no libraries — uses Intl).
 * ------------------------------------------------------------------------ */

/**
 * Convert a wall-clock date+time in a named time zone (e.g. 8:00 PM in
 * America/Chicago) to an epoch-ms instant. Handles DST via Intl.
 */
export function zonedWallTimeToEpoch(dateStr, timeStr, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const parts = timeStr.split(':').map(Number);
  const hh = parts[0] || 0;
  const mm = parts[1] || 0;
  const ss = parts[2] || 0;
  const wallUTC = Date.UTC(y, m - 1, d, hh, mm, ss);
  // Iterate: guess the instant, measure the zone offset at that instant,
  // correct. Two passes are enough except at DST transitions; three is safe.
  let epoch = wallUTC;
  for (let i = 0; i < 3; i++) {
    epoch = wallUTC - tzOffsetMs(epoch, timeZone);
  }
  return epoch;
}

/** Offset (ms) of `timeZone` from UTC at the given instant. CDT -> -18000000. */
export function tzOffsetMs(epochMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return asUTC - epochMs;
}

/** YYYY-MM-DD of the next Wednesday (or today, if today is Wednesday) in `timeZone`. */
export function nextWednesday(timeZone, fromEpochMs = Date.now()) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  for (let i = 0; i < 8; i++) {
    const probe = fromEpochMs + i * 86400000;
    const parts = Object.fromEntries(dtf.formatToParts(new Date(probe)).map((p) => [p.type, p.value]));
    if (parts.weekday === 'Wed') {
      return `${parts.year}-${parts.month}-${parts.day}`;
    }
  }
  return null; // unreachable
}

/* ------------------------------------------------------------------------ *
 * Formatting helpers shared by UI and server.
 * ------------------------------------------------------------------------ */

/** 754321 -> "12:34.3" ; 3723000 -> "1:02:03" */
export function formatDuration(ms) {
  const neg = ms < 0;
  const abs = Math.abs(ms);
  const totalSeconds = Math.floor(abs / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const frac = Math.round((abs % 1000) / 100);
  const core =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  const withFrac = frac > 0 && abs < 600000 ? `${core}.${frac}` : core;
  return neg ? `-${withFrac}` : withFrac;
}

export function formatTMinus(ms) {
  if (ms === 0) return 'T-0';
  return ms > 0 ? `T-${formatDuration(ms)}` : `T+${formatDuration(-ms)}`;
}

/** Clock time with milliseconds in a given zone, e.g. "7:58:30.000 PM". */
export function formatClock(epochMs, timeZone, withMs = true) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  const base = dtf.format(new Date(epochMs));
  if (!withMs) return base;
  const ms = String(Math.floor(epochMs % 1000)).padStart(3, '0');
  // Insert .mmm before the AM/PM marker.
  return base.replace(/(\d+:\d+:\d+)/, `$1.${ms}`);
}
