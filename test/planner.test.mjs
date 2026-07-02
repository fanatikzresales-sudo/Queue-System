import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPlan,
  refreshTimeline,
  zonedWallTimeToEpoch,
  tzOffsetMs,
  nextWednesday,
  formatTMinus,
} from '../public/planner.js';

const TZ = 'America/Chicago';
const GO_LIVE = Date.UTC(2026, 6, 9, 1, 0, 0); // 2026-07-08 20:00 CDT

const DEFAULT_OPTS = {
  goLiveEpochMs: GO_LIVE,
  leadTimeMs: 30 * 60000,
  initialDelayMs: 10000,
  steps: [
    { delayMs: 5000, atOffsetMs: 10 * 60000 },
    { delayMs: 2000, atOffsetMs: 5 * 60000 },
    { delayMs: 1000, atOffsetMs: 2 * 60000 },
    { delayMs: 500, atOffsetMs: 30000 },
  ],
};

test('final refresh lands exactly at go-live', () => {
  const plan = buildPlan(DEFAULT_OPTS);
  assert.equal(plan.ok, true);
  const timeline = refreshTimeline(plan, 0);
  assert.equal(timeline[timeline.length - 1], GO_LIVE);
});

test('every gap in the timeline equals the active phase delay', () => {
  const plan = buildPlan(DEFAULT_OPTS);
  const timeline = refreshTimeline(plan, 0);
  for (let i = 1; i < timeline.length; i++) {
    const t = timeline[i];
    const gap = t - timeline[i - 1];
    // Find the phase this refresh belongs to (phase covering (t-1, t]).
    const offset = GO_LIVE - t;
    const phase = plan.phases.find((p) => offset >= p.endOffsetMs && offset < p.startOffsetMs);
    assert.ok(phase, `no phase found for offset ${offset}`);
    assert.equal(gap, phase.delayMs, `gap at index ${i} should equal ${phase.delayMs}`);
  }
});

test('phase boundaries are exact multiples of their delay', () => {
  const plan = buildPlan(DEFAULT_OPTS);
  for (const p of plan.phases) {
    assert.equal((p.startOffsetMs - p.endOffsetMs) % p.delayMs, 0);
  }
});

test('switch times are snapped earlier (never later) than requested', () => {
  const plan = buildPlan({
    ...DEFAULT_OPTS,
    steps: [
      { delayMs: 7000, atOffsetMs: 10 * 60000 }, // 600000 not divisible by 7000
      { delayMs: 900, atOffsetMs: 47000 }, // awkward numbers on purpose
    ],
  });
  assert.equal(plan.ok, true);
  for (const p of plan.phases) {
    assert.ok(
      p.startOffsetMs >= p.requestedOffsetMs,
      `phase ${p.delayMs}ms starts at ${formatTMinus(p.startOffsetMs)}, requested ${formatTMinus(p.requestedOffsetMs)}`
    );
  }
  const timeline = refreshTimeline(plan, 0);
  assert.equal(timeline[timeline.length - 1], GO_LIVE);
});

test('total request count matches the timeline length', () => {
  const plan = buildPlan(DEFAULT_OPTS);
  const timeline = refreshTimeline(plan, 0);
  assert.equal(plan.totalRequests, timeline.length);
});

test('requests in the final minute are counted correctly', () => {
  const plan = buildPlan(DEFAULT_OPTS);
  const timeline = refreshTimeline(plan, 0);
  const inLastMinute = timeline.filter((t) => t > GO_LIVE - 60000 && t <= GO_LIVE).length;
  assert.equal(plan.requestsInLastMinute, inLastMinute);
});

test('steps beyond the lead time are ignored with a warning', () => {
  const plan = buildPlan({
    ...DEFAULT_OPTS,
    leadTimeMs: 90 * 1000, // only 90s of runway
  });
  assert.equal(plan.ok, true);
  // Only the T-30s step fits inside a 90s lead.
  assert.equal(plan.phases.length, 2);
  assert.ok(plan.warnings.length >= 3);
  const timeline = refreshTimeline(plan, 0);
  assert.equal(timeline[timeline.length - 1], GO_LIVE);
});

test('floor rounding keeps the start at or inside the lead time', () => {
  const plan = buildPlan({ ...DEFAULT_OPTS, leadTimeMs: 123456, steps: [], roundInitial: 'floor' });
  assert.ok(plan.startOffsetMs <= 123456);
  assert.equal((GO_LIVE - plan.startEpochMs) % 10000, 0);
});

test('invalid input returns errors instead of a plan', () => {
  const plan = buildPlan({ goLiveEpochMs: NaN, leadTimeMs: -5, initialDelayMs: 10, steps: [] });
  assert.equal(plan.ok, false);
  assert.equal(plan.errors.length, 3);
});

test('zoned wall time: 8 PM Central in July is 1:00 UTC next day (CDT)', () => {
  const epoch = zonedWallTimeToEpoch('2026-07-08', '20:00', TZ);
  assert.equal(epoch, Date.UTC(2026, 6, 9, 1, 0, 0));
});

test('zoned wall time: 8 PM Central in January is 2:00 UTC next day (CST)', () => {
  const epoch = zonedWallTimeToEpoch('2026-01-07', '20:00', TZ);
  assert.equal(epoch, Date.UTC(2026, 0, 8, 2, 0, 0));
});

test('tz offset for Chicago is -5h in summer, -6h in winter', () => {
  assert.equal(tzOffsetMs(Date.UTC(2026, 6, 1), TZ), -5 * 3600000);
  assert.equal(tzOffsetMs(Date.UTC(2026, 0, 1), TZ), -6 * 3600000);
});

test('nextWednesday finds the coming Wednesday', () => {
  // 2026-07-02 is a Thursday -> next Wednesday is 2026-07-08.
  const from = Date.UTC(2026, 6, 2, 12, 0, 0);
  assert.equal(nextWednesday(TZ, from), '2026-07-08');
  // A Wednesday should return itself.
  const wed = Date.UTC(2026, 6, 8, 12, 0, 0);
  assert.equal(nextWednesday(TZ, wed), '2026-07-08');
});
