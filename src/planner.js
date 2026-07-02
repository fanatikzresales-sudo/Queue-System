'use strict';

const { nextWednesdayGoLive, formatCT, formatTminus } = require('./timeutil');

const MINUTE = 60000;

// A "phase" is a stretch of the run with one refresh delay. It activates at
// `startBeforeMs` before go-live and stays active until the next (inner) phase
// activates. The innermost phase (smallest startBeforeMs) runs up to go-live.
//
// The delay chosen at any instant is the delay of the phase with the smallest
// startBeforeMs that is still >= the current "time before go-live" (offset).
// This mirrors how a real refresh bot behaves: "I'm at T-minus X, which phase
// am I in, wait that phase's delay, refresh."

function sortPhasesAsc(phases) {
  return [...phases].sort((a, b) => a.startBeforeMs - b.startBeforeMs);
}

function delayAtOffset(phasesAsc, offsetMs) {
  // offsetMs = ms remaining before go-live at the moment of a refresh.
  for (const p of phasesAsc) {
    if (p.startBeforeMs >= offsetMs) return p.delayMs;
  }
  return null; // offset is farther out than the farthest phase => not started yet
}

// Forward-simulate the bot: start `leadMs` before go-live, refresh, pick the
// current phase's delay, wait, refresh again, ... until just past go-live.
function simulate(phasesAsc, goLive, leadMs, cap = 100000) {
  const start = goLive - leadMs;
  const fires = [];
  let t = start;
  // Continue a little past go-live so we can see the first refresh after it.
  const stopAfter = goLive + 5 * MINUTE;
  while (fires.length < cap) {
    fires.push(t);
    const offset = goLive - t;
    const d = delayAtOffset(phasesAsc, offset);
    if (d == null || d <= 0) break;
    t += d;
    if (t > stopAfter) {
      fires.push(t);
      break;
    }
  }
  return fires;
}

// Offset (ms before go-live) of the first refresh that enters the innermost
// (final) phase window. Everything up to this point is driven by outer phases,
// so this value does NOT depend on the final delay -- which is exactly why we
// can solve the final delay to land on go-live.
function firstFinalWindowOffset(phasesAsc, goLive, leadMs) {
  const innerWindow = phasesAsc[0].startBeforeMs;
  const start = goLive - leadMs;
  let t = start;
  for (let i = 0; i < 100000; i++) {
    const offset = goLive - t;
    if (offset <= innerWindow) return offset;
    const d = delayAtOffset(phasesAsc, offset);
    if (d == null || d <= 0) return offset;
    t += d;
  }
  return innerWindow;
}

// Solve the final-phase delay so a refresh lands exactly on go-live.
// Given o0 (offset entering the final window), refreshes step o0, o0-d, o0-2d...
// To hit offset 0 we need o0 = n*d. We pick the integer count n whose delay is
// closest to the user's desired final delay while staying within [min,max].
function solveFinalDelay(o0, desiredMs, minMs, maxMs) {
  if (o0 <= 0) return { exactMs: desiredMs, intMs: desiredMs, count: 0, landsExact: true, residualMs: 0 };

  // n must satisfy min <= o0/n <= max  =>  o0/max <= n <= o0/min
  let nLo = Math.max(1, Math.ceil(o0 / maxMs));
  let nHi = Math.max(1, Math.floor(o0 / minMs));
  if (nHi < nLo) nHi = nLo; // window too narrow: fall back to the fastest legal count

  let best = null;
  for (let n = nLo; n <= nHi; n++) {
    const exact = o0 / n;
    const score = Math.abs(exact - desiredMs);
    if (!best || score < best.score) best = { n, exact, score };
  }
  const n = best.n;
  const exactMs = o0 / n;
  const intMs = Math.round(exactMs);
  const residualMs = o0 - intMs * n; // landing error if the bot uses integer ms
  return { exactMs, intMs, count: n, landsExact: residualMs === 0, residualMs };
}

// Requests inside any 60s window, worst case, plus per-phase rate.
function maxRequestsPerMinute(fires) {
  let max = 0;
  for (let i = 0; i < fires.length; i++) {
    let j = i;
    while (j < fires.length && fires[j] - fires[i] < MINUTE) j++;
    max = Math.max(max, j - i);
  }
  return max;
}

function riskLevel(rpm, warn, danger) {
  if (rpm >= danger) return 'danger';
  if (rpm >= warn) return 'caution';
  return 'safe';
}

function buildPlan(cfg = {}) {
  const goLive = cfg.goLiveEpochMs ?? nextWednesdayGoLive();
  const banPerMinWarn = cfg.banPerMinWarn ?? 40;
  const banPerMinDanger = cfg.banPerMinDanger ?? 60;
  const autoAlignFinal = cfg.autoAlignFinal ?? true;
  const finalDelayMinMs = cfg.finalDelayMinMs ?? 500;
  const finalDelayMaxMs = cfg.finalDelayMaxMs ?? 4000;

  let phases = (cfg.phases && cfg.phases.length ? cfg.phases : defaultPhases()).map((p, i) => ({
    label: p.label ?? `Phase ${i + 1}`,
    startBeforeMs: p.startBeforeMs,
    delayMs: p.delayMs,
  }));
  let phasesAsc = sortPhasesAsc(phases);

  const maxStartBefore = phasesAsc[phasesAsc.length - 1].startBeforeMs;
  const leadMs = Math.max(cfg.leadMs ?? maxStartBefore, maxStartBefore);

  // Auto-align: solve the innermost phase delay so a refresh nails go-live.
  let alignment = null;
  if (autoAlignFinal) {
    const o0 = firstFinalWindowOffset(phasesAsc, goLive, leadMs);
    const desired = phasesAsc[0].delayMs;
    const sol = solveFinalDelay(o0, desired, finalDelayMinMs, finalDelayMaxMs);
    alignment = {
      enterFinalOffsetMs: o0,
      requestedFinalDelayMs: desired,
      solvedFinalDelayMs: sol.exactMs,
      practicalFinalDelayMs: sol.intMs,
      refreshesInFinalPhase: sol.count,
      landsExactWithInteger: sol.landsExact,
      landingResidualMs: sol.residualMs,
    };
    // Apply the practical (integer-ms) solved delay to the innermost phase.
    phasesAsc[0] = { ...phasesAsc[0], delayMs: sol.intMs };
    phases = phases.map((p) =>
      p.startBeforeMs === phasesAsc[0].startBeforeMs ? { ...p, delayMs: sol.intMs } : p
    );
  }

  const fires = simulate(phasesAsc, goLive, leadMs);

  // Landing accuracy: the refresh closest to go-live.
  let closest = fires[0];
  for (const f of fires) if (Math.abs(f - goLive) < Math.abs(closest - goLive)) closest = f;
  const landingErrorMs = closest - goLive; // negative = before go-live

  // Per-phase summary + the "drop schedule" the user cares about.
  const phaseSummary = [];
  const dropSchedule = [];
  for (let i = phasesAsc.length - 1; i >= 0; i--) {
    const p = phasesAsc[i];
    const windowStartOffset = p.startBeforeMs;
    const windowEndOffset = i === 0 ? 0 : phasesAsc[i - 1].startBeforeMs;
    const inPhase = fires.filter((f) => {
      const off = goLive - f;
      return off <= windowStartOffset && off > windowEndOffset - 0.0001 && off >= 0;
    });
    const rpm = p.delayMs > 0 ? Math.round((MINUTE / p.delayMs) * 10) / 10 : 0;
    const summary = {
      label: p.label,
      startBeforeMs: windowStartOffset,
      endBeforeMs: windowEndOffset,
      startAtCT: formatCT(goLive - windowStartOffset, { withMs: false }),
      startAtTminus: formatTminus(windowStartOffset),
      delayMs: p.delayMs,
      requestsPerMinute: rpm,
      refreshCount: inPhase.length,
      risk: riskLevel(rpm, banPerMinWarn, banPerMinDanger),
    };
    phaseSummary.push(summary);
    dropSchedule.push({
      atTminus: formatTminus(windowStartOffset),
      atClockCT: formatCT(goLive - windowStartOffset, { withMs: false }),
      setDelayMs: p.delayMs,
      requestsPerMinute: rpm,
      risk: summary.risk,
      note:
        i === 0
          ? 'Final drop — a refresh should land on go-live from here.'
          : `Slow enough to keep the proxy safe until T-${formatTminus(windowEndOffset).slice(2)}.`,
    });
  }

  const worstRpm = maxRequestsPerMinute(fires);

  return {
    goLive: {
      epochMs: goLive,
      ct: formatCT(goLive, { withDate: true, withMs: true }),
    },
    leadMs,
    startAt: {
      epochMs: goLive - leadMs,
      ct: formatCT(goLive - leadMs, { withDate: true }),
      tminus: formatTminus(leadMs),
    },
    phases: phasesAsc.map((p) => ({ ...p })),
    dropSchedule,
    phaseSummary,
    alignment,
    landing: {
      closestRefreshEpochMs: closest,
      closestRefreshCT: formatCT(closest, { withMs: true }),
      errorMs: landingErrorMs,
      errorLabel: describeError(landingErrorMs),
    },
    totals: {
      refreshCount: fires.length,
      worstRequestsPerMinute: worstRpm,
      overallRisk: riskLevel(worstRpm, banPerMinWarn, banPerMinDanger),
    },
    thresholds: { banPerMinWarn, banPerMinDanger, finalDelayMinMs, finalDelayMaxMs },
    fires,
  };
}

function describeError(ms) {
  if (ms === 0) return 'Exact — lands on 8:00:00.000';
  const abs = Math.abs(ms);
  const when = ms < 0 ? 'before' : 'after';
  return `${abs} ms ${when} go-live`;
}

// Sensible default ramp for a "Walmart high" run: slow and safe early, then
// two drops so the last refresh snaps to 8:00:00.
function defaultPhases() {
  return [
    { label: 'Warm-up (safe)', startBeforeMs: 15 * MINUTE, delayMs: 10000 },
    { label: 'Ramp', startBeforeMs: 3 * MINUTE, delayMs: 3000 },
    { label: 'Final sprint', startBeforeMs: 30000, delayMs: 1500 },
  ];
}

// Named presets the UI can offer.
function presets() {
  return {
    conservative: {
      label: 'Conservative (lowest ban risk)',
      leadMs: 20 * MINUTE,
      phases: [
        { label: 'Warm-up (safe)', startBeforeMs: 20 * MINUTE, delayMs: 15000 },
        { label: 'Ramp', startBeforeMs: 5 * MINUTE, delayMs: 5000 },
        { label: 'Final sprint', startBeforeMs: 30000, delayMs: 3000 },
      ],
    },
    balanced: {
      label: 'Balanced (recommended)',
      leadMs: 15 * MINUTE,
      phases: defaultPhases(),
    },
    aggressive: {
      label: 'Aggressive (fastest, higher risk)',
      leadMs: 10 * MINUTE,
      phases: [
        { label: 'Warm-up', startBeforeMs: 10 * MINUTE, delayMs: 6000 },
        { label: 'Ramp', startBeforeMs: 2 * MINUTE, delayMs: 2000 },
        { label: 'Final sprint', startBeforeMs: 20000, delayMs: 1000 },
      ],
    },
  };
}

module.exports = {
  MINUTE,
  buildPlan,
  simulate,
  sortPhasesAsc,
  delayAtOffset,
  firstFinalWindowOffset,
  solveFinalDelay,
  maxRequestsPerMinute,
  defaultPhases,
  presets,
};
