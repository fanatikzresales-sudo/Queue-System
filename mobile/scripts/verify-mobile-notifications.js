#!/usr/bin/env node
/** Static checks for Capacitor plan-alert wiring (PM must be on window). */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const appSrc = fs.readFileSync(path.join(root, 'static', 'app.js'), 'utf8');
const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'www', 'js', 'mobile-bridge.js'), 'utf8');

let failed = 0;

if (!appSrc.includes('window.PM = PM')) {
  console.error('FAIL: static/app.js must assign window.PM = PM');
  failed++;
}

if (!appSrc.includes('MobileNotifications.isNative')) {
  console.error('FAIL: fireOSNotification must delegate to MobileNotifications on native');
  failed++;
}

if (!bridgeSrc.includes('schedulePlanNotifications')) {
  console.error('FAIL: mobile-bridge must hook schedulePlanNotifications');
  failed++;
}

if (!bridgeSrc.includes('global.PM')) {
  console.error('FAIL: mobile-bridge must read global.PM');
  failed++;
}

if (failed) {
  process.exit(1);
}

console.log('OK: mobile notification wiring checks passed');
