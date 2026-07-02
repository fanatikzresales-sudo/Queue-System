/**
 * Core timing calculation utilities for the Walmart Queue Timing Calculator.
 *
 * Key concept: An automation with delay D ms will refresh at times:
 *   start, start+D, start+2D, start+3D, ...
 *
 * For a refresh to land EXACTLY at queue time Q, we need:
 *   Q = start + N*D  →  (Q - start) % D === 0
 *
 * So given Q and D, valid "switch-to" times are:
 *   T = Q - D, Q - 2D, Q - 3D, ...
 */

/** Greatest Common Divisor */
function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

/** Least Common Multiple */
export function lcm(a, b) {
  return (a / gcd(a, b)) * b;
}

/**
 * Find all alignment times within a search window.
 *
 * An "alignment time" is a moment T where, if you start firing
 * the automation at delay D from time T, one of the refreshes
 * will land exactly on queueMs.
 *
 * @param {number} queueMs      - Queue time as ms since midnight
 * @param {number} delayMs      - Refresh delay in milliseconds
 * @param {number} windowMs     - How far back from queue to search (ms)
 * @returns {AlignmentPoint[]}  - Sorted nearest-first
 */
export function findAlignmentTimes(queueMs, delayMs, windowMs = 10 * 60 * 1000) {
  const results = [];
  const windowStart = queueMs - windowMs;

  // Walk back from queue in steps of delayMs
  let N = 1;
  while (true) {
    const T = queueMs - N * delayMs;
    if (T < windowStart) break;

    const msBeforeQueue = N * delayMs;
    const totalSeconds = msBeforeQueue / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    results.push({
      timeMs: T,
      msBeforeQueue,
      minutes,
      seconds,
      totalSeconds,
      cycles: N,
      isWholeMinute: seconds === 0,
      isHalfMinute: seconds === 30,
      isWholeSecond: Number.isInteger(totalSeconds),
    });

    N++;
  }

  return results;
}

/**
 * Return only "nice" alignment times — whole minutes, or half-minutes,
 * or (fallback) whole seconds — sorted nearest-to-queue first (fewest cycles first).
 */
export function getNiceAlignments(queueMs, delayMs, windowMs = 15 * 60 * 1000) {
  const all = findAlignmentTimes(queueMs, delayMs, windowMs);

  const wholeMinutes = all.filter((a) => a.isWholeMinute);
  if (wholeMinutes.length >= 3) return wholeMinutes;

  const halfMinutes = all.filter((a) => a.isWholeMinute || a.isHalfMinute);
  if (halfMinutes.length >= 3) return halfMinutes;

  const wholeSeconds = all.filter((a) => a.isWholeSecond);
  if (wholeSeconds.length >= 3) return wholeSeconds;

  return all;
}

/**
 * For a given delay, determine the LCM with 60,000ms (1 minute) to understand
 * how often whole-minute alignments occur.
 */
export function minuteAlignInterval(delayMs) {
  return lcm(delayMs, 60000);
}

/**
 * Given stages (ordered first→last) and a queue time, produce a complete schedule.
 *
 * The last stage MUST align with the queue time — we find the best alignment.
 * Earlier stages fill in the time before.
 *
 * @param {number}  queueMs  - Queue time as ms since midnight
 * @param {Stage[]} stages   - [{id, name, delay, color}]
 * @param {number}  startMs  - When user starts the automation (ms since midnight)
 * @returns {ScheduleEntry[]}
 */
export function buildSchedule(queueMs, stages, startMs) {
  if (!stages.length) return [];

  const schedule = [];

  if (stages.length === 1) {
    const s = stages[0];
    const alignments = getNiceAlignments(queueMs, s.delay, queueMs - startMs);
    const best = alignments.find((a) => a.timeMs >= startMs) ?? alignments[0];
    if (!best) return [];
    schedule.push({
      stage: s,
      startMs: best.timeMs,
      endMs: queueMs,
      switchAt: best,
      note: 'Start automation at this time',
    });
    return schedule;
  }

  // Work backwards: last stage first
  const lastStage = stages[stages.length - 1];
  const lastAlignments = getNiceAlignments(queueMs, lastStage.delay, 15 * 60 * 1000);

  // Pick a "good" last-stage start: prefer ≥1 minute before, ≤8 minutes before
  const goodLast = lastAlignments.find(
    (a) => a.msBeforeQueue >= 60 * 1000 && a.msBeforeQueue <= 8 * 60 * 1000
  ) ?? lastAlignments[0];

  if (!goodLast) return [];

  schedule.unshift({
    stage: lastStage,
    startMs: goodLast.timeMs,
    endMs: queueMs,
    switchAt: goodLast,
    note: 'Drop to this delay to hit queue exactly',
  });

  // Fill earlier stages
  let nextStart = goodLast.timeMs;
  for (let i = stages.length - 2; i >= 0; i--) {
    const s = stages[i];
    const stageEnd = nextStart;
    const stageStart = i === 0 ? startMs : null;

    schedule.unshift({
      stage: s,
      startMs: stageStart ?? startMs,
      endMs: stageEnd,
      switchAt: null,
      note:
        i === 0
          ? 'Start here — safe delay to avoid proxy bans'
          : 'Intermediate delay stage',
    });

    nextStart = stageStart ?? startMs;
  }

  return schedule;
}

/**
 * Format ms-since-midnight as "H:MM:SS AM/PM CT"
 */
export function formatTime(ms, showSeconds = true) {
  const totalSeconds = Math.floor(ms / 1000);
  const h24 = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 || 12;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return showSeconds
    ? `${h12}:${mm}:${ss} ${period} CT`
    : `${h12}:${mm} ${period} CT`;
}

/**
 * Format a duration in ms as "Xm Ys" or "Xm" or "Ys"
 */
export function formatDuration(ms) {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/**
 * Convert a Date to ms since midnight in the America/Chicago timezone (CT).
 */
export function dateToCtMs(date) {
  const ctStr = date.toLocaleString('en-US', { timeZone: 'America/Chicago' });
  const ct = new Date(ctStr);
  const midnight = new Date(ct);
  midnight.setHours(0, 0, 0, 0);
  return ct - midnight;
}

/**
 * Get today's queue date/time as a Date object (next Wednesday at queueHour:queueMinute CT).
 * If today IS Wednesday and the queue hasn't happened yet, return today.
 */
export function getNextQueueDate(queueHour = 8, queueMinute = 0) {
  const now = new Date();
  const ctNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const day = ctNow.getDay(); // 0=Sun, 3=Wed
  const daysUntilWed = (3 - day + 7) % 7 || 7;

  const queueDate = new Date(ctNow);
  queueDate.setDate(ctNow.getDate() + daysUntilWed);
  queueDate.setHours(queueHour, queueMinute, 0, 0);

  // If today is Wednesday and queue is in the future, use today
  if (day === 3) {
    const todayQueue = new Date(ctNow);
    todayQueue.setHours(queueHour, queueMinute, 0, 0);
    if (todayQueue > ctNow) return todayQueue;
  }

  return queueDate;
}

/**
 * Check if, right now, the automation is "aligned" — i.e., the next refresh
 * after the current moment will land on the queue time.
 *
 * @param {number} queueMs    - Queue time (ms since midnight, CT)
 * @param {number} nowMs      - Current time (ms since midnight, CT)
 * @param {number} delayMs    - Current delay
 * @param {number} toleranceMs - How close counts as "aligned" (default 50ms)
 */
export function isAligned(queueMs, nowMs, delayMs, toleranceMs = 50) {
  if (nowMs >= queueMs) return false;
  const remaining = queueMs - nowMs;
  const mod = remaining % delayMs;
  return mod <= toleranceMs || mod >= delayMs - toleranceMs;
}

/**
 * How many ms until the next refresh that will land on queueMs.
 */
export function msUntilAlignedRefresh(queueMs, nowMs, delayMs) {
  if (nowMs >= queueMs) return 0;
  const remaining = queueMs - nowMs;
  const cycles = remaining / delayMs;
  const nextCycles = Math.ceil(cycles);
  const alignedStart = queueMs - nextCycles * delayMs;
  if (alignedStart <= nowMs) {
    return 0;
  }
  return alignedStart - nowMs;
}
