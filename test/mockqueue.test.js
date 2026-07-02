'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { MockQueue } = require('../src/mockqueue');
const { dryRun } = require('../src/server');
const { MINUTE } = require('../src/planner');

test('refresh before go-live is waiting_room, at/after is queue_open', () => {
  const goLive = Date.now() + 10000;
  const q = new MockQueue({ goLiveEpochMs: goLive });
  assert.strictEqual(q.refresh('p1', goLive - 5000).status, 'waiting_room');
  assert.strictEqual(q.refresh('p1', goLive).status, 'queue_open');
  assert.strictEqual(q.refresh('p1', goLive + 5000).status, 'queue_open');
});

test('hammering too fast triggers a ban', () => {
  const goLive = Date.now();
  const q = new MockQueue({ goLiveEpochMs: goLive, banBurst: 5, banWindowMs: 10000 });
  let banned = false;
  for (let i = 0; i < 10; i++) {
    const r = q.refresh('fast', goLive + i * 100); // 10 requests in 1s
    if (r.banned) banned = true;
  }
  assert.ok(banned, 'expected a ban after a fast burst');
  const rep = q.proxyReport('fast');
  assert.ok(rep.blocked > 0);
});

test('a slow proxy is never banned and makes the queue', () => {
  const goLive = Date.now();
  const q = new MockQueue({ goLiveEpochMs: goLive, banBurst: 25, banWindowMs: 10000 });
  for (let i = 0; i < 20; i++) q.refresh('slow', goLive + i * 10000); // every 10s
  const rep = q.proxyReport('slow');
  assert.strictEqual(rep.blocked, 0);
  assert.ok(rep.madeQueue);
});

test('reset clears proxies and hits', () => {
  const q = new MockQueue({ goLiveEpochMs: Date.now() });
  q.refresh('a', Date.now());
  q.reset();
  assert.strictEqual(q.hits.length, 0);
  assert.strictEqual(q.report().proxies.length, 0);
});

test('dry-run of the balanced plan makes the queue without a ban', () => {
  const { plan, mockReport } = dryRun({ autoAlignFinal: true });
  const p = mockReport.proxies[0];
  assert.ok(p.madeQueue, 'balanced plan should reach queue_open');
  assert.strictEqual(p.blocked, 0, 'balanced plan should not get banned');
  assert.ok(Math.abs(plan.landing.errorMs) <= 5);
});

test('dry-run of an over-aggressive schedule gets banned', () => {
  const { mockReport } = dryRun({
    autoAlignFinal: false,
    phases: [{ label: 'insane', startBeforeMs: 5 * MINUTE, delayMs: 100 }],
    banBurst: 25,
    banWindowMs: 10000,
  });
  const p = mockReport.proxies[0];
  assert.ok(p.blocked > 0, 'a 100ms delay for 5 minutes should get banned');
});
