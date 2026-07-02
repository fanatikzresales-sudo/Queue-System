'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  buildPlan,
  simulate,
  sortPhasesAsc,
  delayAtOffset,
  firstFinalWindowOffset,
  solveFinalDelay,
  maxRequestsPerMinute,
  MINUTE,
} = require('../src/planner');
const { nextWednesdayGoLive, chicagoParts } = require('../src/timeutil');

test('nextWednesdayGoLive lands on a Wednesday at 08:00 Central', () => {
  const epoch = nextWednesdayGoLive(Date.parse('2026-07-01T00:00:00Z'));
  const p = chicagoParts(epoch);
  assert.strictEqual(p.weekday, 'Wed');
  assert.strictEqual(p.hour, 8);
  assert.strictEqual(p.minute, 0);
  assert.strictEqual(p.second, 0);
});

test('nextWednesdayGoLive is always in the future', () => {
  const now = Date.now();
  assert.ok(nextWednesdayGoLive(now) > now);
});

test('delayAtOffset picks the innermost phase whose window contains the offset', () => {
  const phases = sortPhasesAsc([
    { startBeforeMs: 15 * MINUTE, delayMs: 10000 },
    { startBeforeMs: 3 * MINUTE, delayMs: 3000 },
    { startBeforeMs: 30000, delayMs: 1500 },
  ]);
  assert.strictEqual(delayAtOffset(phases, 10 * MINUTE), 10000); // in warm-up
  assert.strictEqual(delayAtOffset(phases, 2 * MINUTE), 3000); // in ramp
  assert.strictEqual(delayAtOffset(phases, 10000), 1500); // final sprint
  assert.strictEqual(delayAtOffset(phases, 20 * MINUTE), null); // not started yet
});

test('solveFinalDelay finds an integer count that divides the offset', () => {
  // 30s window, want ~1500ms => n between 30000/4000=8 and 30000/500=60.
  const sol = solveFinalDelay(30000, 1500, 500, 4000);
  assert.ok(sol.count >= 1);
  assert.ok(sol.exactMs >= 500 && sol.exactMs <= 4000);
  // exact solution divides evenly
  assert.ok(Math.abs(sol.exactMs * sol.count - 30000) < 1e-6);
});

test('auto-aligned plan lands a refresh on go-live within a few ms', () => {
  const plan = buildPlan({ autoAlignFinal: true });
  assert.ok(Math.abs(plan.landing.errorMs) <= 5, `landing error was ${plan.landing.errorMs}ms`);
});

test('the closest refresh is at or extremely near the go-live epoch', () => {
  const plan = buildPlan({ autoAlignFinal: true });
  const off = plan.goLive.epochMs - plan.landing.closestRefreshEpochMs;
  assert.ok(Math.abs(off) <= 5);
});

test('early phases are slower (bigger delay) than later phases', () => {
  const plan = buildPlan();
  const delays = plan.phases.map((p) => p.delayMs);
  // phases are sorted ascending by startBeforeMs (innermost first)
  for (let i = 1; i < delays.length; i++) {
    assert.ok(delays[i] >= delays[i - 1], 'inner phases should be as fast or faster');
  }
});

test('drop schedule is ordered from earliest (largest T-minus) to final', () => {
  const plan = buildPlan();
  const startOffsets = plan.phaseSummary.map((s) => s.startBeforeMs);
  for (let i = 1; i < startOffsets.length; i++) {
    assert.ok(startOffsets[i] <= startOffsets[i - 1]);
  }
});

test('simulate produces monotonically increasing refresh times', () => {
  const plan = buildPlan();
  const fires = plan.fires;
  for (let i = 1; i < fires.length; i++) {
    assert.ok(fires[i] > fires[i - 1]);
  }
});

test('maxRequestsPerMinute counts a worst-case burst correctly', () => {
  const base = 1_000_000;
  const fires = [base, base + 1000, base + 2000, base + 70000]; // 3 within a minute
  assert.strictEqual(maxRequestsPerMinute(fires), 3);
});

test('firstFinalWindowOffset is independent of the final phase delay', () => {
  const goLive = nextWednesdayGoLive();
  const mk = (finalDelay) =>
    sortPhasesAsc([
      { startBeforeMs: 15 * MINUTE, delayMs: 10000 },
      { startBeforeMs: 3 * MINUTE, delayMs: 3000 },
      { startBeforeMs: 30000, delayMs: finalDelay },
    ]);
  const a = firstFinalWindowOffset(mk(1500), goLive, 15 * MINUTE);
  const b = firstFinalWindowOffset(mk(900), goLive, 15 * MINUTE);
  assert.strictEqual(a, b);
});

test('a too-fast schedule is flagged as higher risk than a slow one', () => {
  const slow = buildPlan({
    autoAlignFinal: false,
    phases: [{ label: 'x', startBeforeMs: 5 * MINUTE, delayMs: 10000 }],
  });
  const fast = buildPlan({
    autoAlignFinal: false,
    phases: [{ label: 'x', startBeforeMs: 5 * MINUTE, delayMs: 500 }],
  });
  assert.ok(fast.totals.worstRequestsPerMinute > slow.totals.worstRequestsPerMinute);
});
