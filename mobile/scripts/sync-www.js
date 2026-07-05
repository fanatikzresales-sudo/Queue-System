#!/usr/bin/env node
/** Copy desktop web assets into www/ for Capacitor. */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const WWW = path.resolve(__dirname, '../www');
const CSS = path.join(WWW, 'css');
const JS = path.join(WWW, 'js');

const STARTER_DELAYS = [120000, 90000, 60000, 45000, 30000, 20000, 15000, 10000, 5000];

function copy(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function delayOptionsHtml() {
  return STARTER_DELAYS.map(d =>
    `<option value="${d}">${d / 1000}s (${d} ms)</option>`
  ).join('\n              ');
}

function timezoneOptionsHtml() {
  const zones = {
    CDT: 'Central (CDT/CST)',
    EST: 'Eastern (EST/EDT)',
    PT: 'Pacific (PT)',
  };
  return Object.entries(zones).map(([k, v]) =>
    `<option value="${k}"${k === 'CDT' ? ' selected' : ''}>${v}</option>`
  ).join('\n          ');
}

function scriptBlock(extra = '') {
  return `
  <script src="js/cap-native.js"></script>
  <script src="js/vendor/luxon.min.js"></script>
  <script src="js/scheduler.js"></script>
  <script src="js/local-api.js"></script>
  <script src="js/notifications.js"></script>
  <script src="js/mobile-bridge.js"></script>
  ${extra}`;
}

function mobileHead(title) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="theme-color" content="#0d1117">
  <title>${title}</title>
  <link rel="stylesheet" href="css/style.css">
  <link rel="stylesheet" href="css/mobile.css">`;
}

// Copy CSS and JS from desktop app
copy(path.join(ROOT, 'static/style.css'), path.join(CSS, 'style.css'));
copy(path.join(ROOT, 'static/demo_live.css'), path.join(CSS, 'demo_live.css'));
copy(path.join(ROOT, 'static/app.js'), path.join(JS, 'app.js'));
copy(path.join(ROOT, 'static/demo_live.js'), path.join(JS, 'demo_live.js'));
copy(
  path.join(ROOT, 'mobile/node_modules/luxon/build/global/luxon.min.js'),
  path.join(JS, 'vendor/luxon.min.js')
);
if (fs.existsSync(path.join(ROOT, 'assets/logo.png'))) {
  copy(path.join(ROOT, 'assets/logo.png'), path.join(WWW, 'img/logo.png'));
}

// index.html
fs.writeFileSync(path.join(WWW, 'index.html'), `${mobileHead('FR Queue Optimizer')}
</head>
<body>
  <div class="page">
    <div id="update-banner" class="update-banner" hidden>
      <span class="ub-text"></span>
      <a id="ub-link" href="#" class="ub-btn"></a>
      <button class="ub-dismiss" id="ub-dismiss" type="button">✕</button>
    </div>

    <div id="notif-permission-banner" class="notif-permission-banner" hidden>
      <div class="npb-inner">
        <strong>Enable drop alerts</strong>
        <p id="npb-status">Notifications are required for start/drop reminders when you leave the app.</p>
        <p class="npb-hint">LDPlayer often skips the &quot;Allow&quot; popup — use the buttons below.</p>
        <div class="npb-btns">
          <button type="button" id="npb-enable-btn" class="primary npb-btn">Open Notification Settings</button>
          <button type="button" id="npb-test-btn" class="npb-btn npb-test">Test alert in 5 sec</button>
        </div>
      </div>
    </div>

    <header class="app-header">
      <img src="img/logo.png" alt="Fanatikz Resales" class="app-logo" width="120" height="120">
      <div class="app-header-text">
        <div class="badge">Walmart · Pokemon Queue</div>
        <h1>FR Queue Optimizer</h1>
        <p class="subtitle">
          Pick how early you start. Get exactly <strong>2 delays</strong>: one to set at the start,
          one to drop before queue live so your refresh hits <strong>8:00 PM</strong> on the dot.
          <a class="live-link" href="demo-live.html">Watch live demo →</a>
        </p>
      </div>
    </header>

    <div class="top-bar panel">
      <label class="field inline">
        <span>Timezone</span>
        <select id="timezone">
          ${timezoneOptionsHtml()}
        </select>
      </label>
      <div class="top-bar-right">
        <label class="checkbox">
          <input type="checkbox" id="demo_mode">
          <span>Demo mode</span>
        </label>
        <a href="demo-live.html" class="btn-demo-live" id="demo_live_link">Launch Live Demo →</a>
      </div>
    </div>

    <section class="panel active-plans-section" id="active-plans-section" hidden>
      <div class="active-plans-header">
        <div>
          <h2>Active Plans <span id="active-plans-count" class="ap-count">0</span></h2>
          <p class="hint">Notifications are scheduled. You'll be alerted before each drop.</p>
        </div>
        <button class="ap-cancel-all-btn" id="cancel-all-btn" type="button">Cancel All</button>
      </div>
      <div id="active-plans-list" class="active-plans-list"></div>
    </section>

    <section class="preset-section">
      <div class="preset-header">
        <div>
          <h2>Common Start Windows</h2>
          <p class="hint" id="queue_live_label">Loading schedules…</p>
          <p class="hint timing-mode-hint" id="timing_mode_hint"></p>
        </div>
        <div class="timing-mode-toggle" role="group" aria-label="Bot delay switch timing">
          <button type="button" class="timing-mode-btn active" data-mode="instant">Instant Switch</button>
          <button type="button" class="timing-mode-btn" data-mode="deferred">Deferred Switch</button>
        </div>
      </div>
      <div id="preset_grid" class="preset-grid">
        <div class="preset-loading">Loading plans…</div>
      </div>
    </section>

    <section class="panel custom-section">
      <h2>Custom Start Time</h2>
      <p class="hint">Set your own date, start time, and delay. Works for any day — great for testing.</p>
      <div class="custom-row">
        <label class="field">
          <span>Date <small>(defaults to next Wednesday)</small></span>
          <div class="date-row">
            <input type="date" id="custom_date">
            <button type="button" id="next_wed_btn" class="btn-next-wed">Next Wednesday</button>
          </div>
        </label>
        <label class="field">
          <span>Queue Time <small id="queue_time_hint">(in your selected timezone)</small></span>
          <input type="time" id="queue_time_override" step="1">
        </label>
        <label class="field">
          <span>Start Time <small id="start_time_hint">(in your selected timezone)</small></span>
          <input type="time" id="start_time" step="1">
        </label>
        <label class="field">
          <span>Starting Delay</span>
          <div class="delay-row">
            <input type="number" id="initial_delay_ms" value="60000" min="250" step="250">
            <select id="delay_preset">
              <option value="">Presets</option>
              ${delayOptionsHtml()}
            </select>
          </div>
        </label>
        <button type="button" id="optimize_btn" class="primary">Queue Optimize</button>
      </div>
    </section>

    <section class="panel results" id="results_panel" hidden>
      <div class="results-header">
        <h2>Your 2-Step Schedule</h2>
        <div id="verification" class="verification"></div>
      </div>
      <div class="summary" id="summary"></div>
      <div id="two_step_cards" class="two-step-cards"></div>
      <h3>Quick Copy</h3>
      <div class="table-wrap">
        <table id="drop_table">
          <thead>
            <tr>
              <th>Step</th>
              <th>At What Time</th>
              <th>Before Queue</th>
              <th>Set Delay To</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <h3>Final Refreshes (last 15)</h3>
      <ul id="final_refreshes" class="refresh-list"></ul>
    </section>
  </div>
${scriptBlock('  <script src="js/app.js"></script>')}
</body>
</html>
`);

// demo-live.html
fs.writeFileSync(path.join(WWW, 'demo-live.html'), `${mobileHead('Live Demo — FR Queue Optimizer')}
  <link rel="stylesheet" href="css/demo_live.css">
</head>
<body>
  <div class="page live-page">
    <header class="app-header">
      <img src="img/logo.png" alt="Fanatikz Resales" class="app-logo" width="88" height="88">
      <div class="app-header-text">
        <div class="badge live-badge">Live Demo Running</div>
        <h1>Queue Optimizer — Live Demo</h1>
        <div id="plan_context" class="plan-context" hidden></div>
        <p class="subtitle">
          Watch a compressed simulation. The same starting delay and single drop
          you'd use on Wednesday — firing in real time right now.
          <a class="live-link" href="index.html">← Back to optimizer</a>
        </p>
      </div>
    </header>

    <section class="panel live-controls">
      <label class="field">
        <span>Timezone</span>
        <select id="timezone">
          ${timezoneOptionsHtml()}
        </select>
      </label>
      <button type="button" id="restart_btn" class="primary">Restart Live Demo</button>
    </section>

    <section class="live-grid">
      <div class="panel live-countdown">
        <div class="countdown-label">Time until queue goes live</div>
        <div id="countdown" class="countdown-value">--:--</div>
        <div id="queue_time" class="queue-time">Queue live at —</div>
        <div class="progress-track">
          <div id="progress_bar" class="progress-bar"></div>
        </div>
        <div id="status_line" class="status-line">Starting demo…</div>
      </div>

      <div class="panel live-current">
        <h2>Current Bot State</h2>
        <div class="state-grid">
          <div class="state-item">
            <span class="state-label">Current delay</span>
            <span id="current_delay" class="state-value">—</span>
          </div>
          <div class="state-item">
            <span class="state-label">Next refresh in</span>
            <span id="next_refresh_in" class="state-value">—</span>
          </div>
          <div class="state-item">
            <span class="state-label">Total refreshes</span>
            <span id="refresh_count" class="state-value">0</span>
          </div>
          <div class="state-item">
            <span class="state-label">Verification</span>
            <span id="verification" class="state-value pending">Waiting…</span>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <h2>Live Event Feed</h2>
      <div id="event_feed" class="event-feed">
        <div class="event placeholder">Demo will begin momentarily…</div>
      </div>
    </section>

    <section class="panel">
      <h2>Scheduled Delay Drops</h2>
      <div class="table-wrap">
        <table id="drop_table">
          <thead>
            <tr>
              <th>When</th>
              <th>Set Delay To</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <h2>All Refreshes</h2>
      <ul id="refresh_timeline" class="refresh-timeline"></ul>
    </section>
  </div>
${scriptBlock('  <script src="js/demo_live.js"></script>')}
</body>
</html>
`);

console.log('Synced www/ assets from desktop app');

// Patch navigation paths for static Capacitor www (no Flask routes)
for (const jsFile of ['app.js', 'demo_live.js']) {
  const p = path.join(JS, jsFile);
  let src = fs.readFileSync(p, 'utf8');
  src = src.replace(/[`'"]\/demo-live/g, (m) => m[0] + 'demo-live.html');
  fs.writeFileSync(p, src);
}
