#!/usr/bin/env node
/** Compare JS scheduler output against Python fixtures. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { DateTime } = require('luxon');

const fixturesPath = path.join(__dirname, 'fixtures.json');
if (!fs.existsSync(fixturesPath)) {
  console.error('Run: python3 mobile/scripts/export-fixtures.py');
  process.exit(1);
}
const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

const luxonSrc = fs.readFileSync(
  path.join(__dirname, '../node_modules/luxon/build/global/luxon.min.js'),
  'utf8'
);
const schedulerSrc = fs.readFileSync(path.join(__dirname, '../www/js/scheduler.js'), 'utf8');

const sandbox = { window: {}, luxon: { DateTime } };
vm.runInNewContext(luxonSrc, sandbox);
sandbox.window.luxon = sandbox.luxon;
vm.runInNewContext(schedulerSrc, sandbox);
const S = sandbox.window.QueueScheduler;

let failed = 0;
for (const [key, data] of Object.entries(fixtures)) {
  if (!key.startsWith('preset_')) continue;
  const parts = key.split('_');
  const tz = parts[1];
  const mode = parts[2];
  const target = S.next_walmart_queue_time({ tz_key: tz });
  const plans = S.preset_schedules({ target, tz_key: tz, timing_mode: mode });
  if (plans.length !== data.count) {
    console.error(`FAIL ${key}: count ${plans.length} !== ${data.count}`);
    failed++;
    continue;
  }
  for (let i = 0; i < Math.min(plans.length, data.plans.length); i++) {
    const a = plans[i];
    const b = data.plans[i];
    if (a.start_delay_ms !== b.start_delay_ms || a.final_delay_ms !== b.final_delay_ms) {
      console.error(`FAIL ${key}[${i}] delays mismatch`);
      failed++;
    }
  }
}
if (failed) {
  console.error(`${failed} parity check(s) failed`);
  process.exit(1);
}
console.log('Scheduler parity OK');
