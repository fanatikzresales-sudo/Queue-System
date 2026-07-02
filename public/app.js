import {
  buildPlan,
  refreshTimeline,
  zonedWallTimeToEpoch,
  nextWednesday,
  formatDuration,
  formatTMinus,
  formatClock,
} from './planner.js';

const QUEUE_TZ = 'America/Chicago';
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const STORAGE_KEY = 'queue-drop-timer-v1';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ------------------------------ default state ----------------------------- */

const DEFAULT_STEPS = [
  { delayMs: 5000, tMinusMs: 10 * 60000 },
  { delayMs: 2000, tMinusMs: 5 * 60000 },
  { delayMs: 1000, tMinusMs: 2 * 60000 },
  { delayMs: 500, tMinusMs: 30000 },
];

let steps = DEFAULT_STEPS.map((s) => ({ ...s }));
let currentPlan = null;
let lastFiredActionIdx = -1;
let sim = { running: false, timer: null, records: [] };

/* --------------------------------- tabs ----------------------------------- */

function activateTab(name) {
  if (!document.getElementById(`tab-${name}`)) return;
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
}
$$('.tab').forEach((btn) =>
  btn.addEventListener('click', () => {
    activateTab(btn.dataset.tab);
    history.replaceState(null, '', `#${btn.dataset.tab}`);
  })
);
if (location.hash) activateTab(location.hash.slice(1));

/* ------------------------------ header clocks ----------------------------- */

function tickClocks() {
  const now = Date.now();
  $('#clock-central').textContent = formatClock(now, QUEUE_TZ, false);
  $('#clock-local').textContent = formatClock(now, LOCAL_TZ, false);
}
setInterval(tickClocks, 200);
tickClocks();

/* ------------------------------ settings I/O ------------------------------ */

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.date) $('#in-date').value = s.date;
    if (s.time) $('#in-time').value = s.time;
    if (s.sku) $('#in-sku').value = s.sku;
    if (s.leadMin) $('#in-lead').value = s.leadMin;
    if (s.initialDelayMs) $('#in-initial').value = s.initialDelayMs;
    if (s.riskPerMin) $('#in-risk').value = s.riskPerMin;
    if (Array.isArray(s.steps) && s.steps.length) steps = s.steps;
  } catch {
    /* corrupted storage — fall back to defaults */
  }
}

function saveSettings() {
  const s = readInputs();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      date: s.date,
      time: s.time,
      sku: s.sku,
      leadMin: s.leadMin,
      initialDelayMs: s.initialDelayMs,
      riskPerMin: s.riskPerMin,
      steps,
    })
  );
}

function readInputs() {
  return {
    date: $('#in-date').value,
    time: $('#in-time').value || '20:00',
    sku: ($('#in-sku').value || 'item').trim().replace(/\s+/g, '-'),
    leadMin: Number($('#in-lead').value) || 30,
    initialDelayMs: Number($('#in-initial').value) || 10000,
    riskPerMin: Number($('#in-risk').value) || 30,
  };
}

/* ------------------------------- step editor ------------------------------ */

function renderSteps() {
  const list = $('#steps-list');
  list.innerHTML = '';
  steps.forEach((step, i) => {
    const row = document.createElement('div');
    row.className = 'step-row';
    const min = Math.floor(step.tMinusMs / 60000);
    const sec = Math.round((step.tMinusMs % 60000) / 1000);
    row.innerHTML = `
      <label>Switch at T-minus
        <div class="suffix-wrap">
          <input type="number" min="0" value="${min}" data-i="${i}" data-k="min" /><span>min</span>
          <input type="number" min="0" max="59" value="${sec}" data-i="${i}" data-k="sec" /><span>sec</span>
        </div>
      </label>
      <label>Drop delay to
        <div class="suffix-wrap">
          <input type="number" min="100" step="100" value="${step.delayMs}" data-i="${i}" data-k="delay" /><span>ms</span>
        </div>
      </label>
      <button class="btn ghost small danger-text" data-remove="${i}" title="Remove step">✕</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll('input').forEach((inp) =>
    inp.addEventListener('input', () => {
      const i = Number(inp.dataset.i);
      const k = inp.dataset.k;
      const v = Number(inp.value) || 0;
      if (k === 'delay') steps[i].delayMs = v;
      else {
        const min = k === 'min' ? v : Math.floor(steps[i].tMinusMs / 60000);
        const sec = k === 'sec' ? v : Math.round((steps[i].tMinusMs % 60000) / 1000);
        steps[i].tMinusMs = min * 60000 + sec * 1000;
      }
      update();
    })
  );
  list.querySelectorAll('[data-remove]').forEach((btn) =>
    btn.addEventListener('click', () => {
      steps.splice(Number(btn.dataset.remove), 1);
      renderSteps();
      update();
    })
  );
}

$('#btn-add-step').addEventListener('click', () => {
  const last = steps[steps.length - 1];
  steps.push({
    delayMs: last ? Math.max(100, Math.round(last.delayMs / 2 / 100) * 100) : 1000,
    tMinusMs: last ? Math.max(5000, Math.round(last.tMinusMs / 2 / 1000) * 1000) : 60000,
  });
  renderSteps();
  update();
});

/* -------------------------------- the plan -------------------------------- */

function computePlan() {
  const s = readInputs();
  if (!s.date) return null;
  const goLiveEpochMs = zonedWallTimeToEpoch(s.date, s.time, QUEUE_TZ);
  return buildPlan({
    goLiveEpochMs,
    leadTimeMs: s.leadMin * 60000,
    initialDelayMs: s.initialDelayMs,
    steps: steps.map((st) => ({ delayMs: st.delayMs, atOffsetMs: st.tMinusMs })),
  });
}

function riskChip(reqPerMin, threshold) {
  if (reqPerMin > threshold * 2) return `<span class="chip hot">${fmtRate(reqPerMin)}/min · HOT</span>`;
  if (reqPerMin > threshold) return `<span class="chip warn">${fmtRate(reqPerMin)}/min · elevated</span>`;
  return `<span class="chip ok">${fmtRate(reqPerMin)}/min · safe</span>`;
}
const fmtRate = (r) => (Number.isInteger(r) ? r : r.toFixed(1));

function bothClocks(epochMs) {
  const ct = formatClock(epochMs, QUEUE_TZ, false);
  const local = formatClock(epochMs, LOCAL_TZ, false);
  return LOCAL_TZ === QUEUE_TZ ? `${ct} CT` : `${ct} CT <span class="hint">(${local} local)</span>`;
}

function renderPlan() {
  const out = $('#plan-output');
  const s = readInputs();
  const plan = currentPlan;

  if (!plan) {
    out.innerHTML = '<h2>Your plan</h2><p class="note">Pick a go-live date to generate the plan.</p>';
    return;
  }
  if (!plan.ok) {
    out.innerHTML =
      '<h2>Your plan</h2>' + plan.errors.map((e) => `<div class="callout err">${e}</div>`).join('');
    return;
  }

  const now = Date.now();
  const maxRate = Math.max(...plan.phases.map((p) => p.requestsPerMinute));
  const rows = plan.phases
    .map((p, i) => {
      const at = plan.goLiveEpochMs - p.startOffsetMs;
      const what =
        i === 0
          ? `<strong>START</strong> automation @ <strong>${p.delayMs.toLocaleString()} ms</strong>`
          : `Drop delay to <strong>${p.delayMs.toLocaleString()} ms</strong>`;
      const snapped =
        p.startOffsetMs !== p.requestedOffsetMs
          ? `<div class="hint">requested ${formatTMinus(p.requestedOffsetMs)}, aligned to ${formatTMinus(p.startOffsetMs)}</div>`
          : '';
      return `<tr>
        <td>${bothClocks(at)}</td>
        <td>${formatTMinus(p.startOffsetMs)}${snapped}</td>
        <td>${what}</td>
        <td>${p.refreshes} refreshes over ${formatDuration(p.startOffsetMs - p.endOffsetMs)}</td>
        <td>${riskChip(p.requestsPerMinute, s.riskPerMin)}</td>
      </tr>`;
    })
    .join('');

  const goliveRow = `<tr class="hit-golive">
      <td>${bothClocks(plan.goLiveEpochMs)}</td>
      <td>T-0</td>
      <td><strong>QUEUE LIVE — a refresh lands at exactly this instant</strong></td>
      <td>offset: 0 ms</td>
      <td><span class="chip ok">on target</span></td>
    </tr>`;

  const warningHtml = plan.warnings.map((w) => `<div class="callout warn">${w}</div>`).join('');
  const pastWarning =
    plan.startEpochMs < now
      ? `<div class="callout err">The computed start time is in the past — pick a later go-live date/time.</div>`
      : '';
  const rateWarning =
    maxRate > s.riskPerMin
      ? `<div class="callout warn">Your fastest phase runs at <strong>${fmtRate(maxRate)} req/min</strong>, above your ${s.riskPerMin} req/min threshold. Keep the hot phases short (they are, by design) or raise the final delay if your proxies are weak.</div>`
      : '';

  out.innerHTML = `
    <h2>Your plan — ${s.sku}</h2>
    ${pastWarning}${warningHtml}
    <div class="stats">
      <div class="stat"><span class="live-label">Press start at exactly</span>
        <span class="val">${formatClock(plan.startEpochMs, QUEUE_TZ, false)} CT</span>
        <span class="sub">${formatTMinus(plan.startOffsetMs)} before go-live</span></div>
      <div class="stat"><span class="live-label">Queue goes live</span>
        <span class="val">${formatClock(plan.goLiveEpochMs, QUEUE_TZ, false)} CT</span>
        <span class="sub">${new Date(plan.goLiveEpochMs).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: QUEUE_TZ })}</span></div>
      <div class="stat"><span class="live-label">Total requests</span>
        <span class="val">${plan.totalRequests}</span>
        <span class="sub">${plan.requestsInLastMinute} in the final minute</span></div>
      <div class="stat"><span class="live-label">Peak rate</span>
        <span class="val">${fmtRate(maxRate)}/min</span>
        <span class="sub">in the final phase only</span></div>
    </div>
    ${rateWarning}
    <div class="table-scroll"><table>
      <thead><tr><th>Clock time</th><th>T-minus</th><th>Action</th><th>Phase detail</th><th>Rate</th></tr></thead>
      <tbody>${rows}${goliveRow}</tbody>
    </table></div>
    <div class="row" style="margin-top:14px">
      <button class="btn primary" id="btn-copy-plan">Copy cheat sheet</button>
      <span class="hint" id="copy-status"></span>
    </div>
    <p class="note">Switch times were auto-aligned so every phase length is an exact multiple of its delay —
    that is what makes the last refresh land at go-live with 0 ms of error.</p>
  `;

  $('#btn-copy-plan').addEventListener('click', async () => {
    await navigator.clipboard.writeText(planAsText(plan, s));
    $('#copy-status').textContent = 'Copied!';
    setTimeout(() => ($('#copy-status').textContent = ''), 2000);
  });
}

function planAsText(plan, s) {
  const lines = [
    `QUEUE DROP PLAN — ${s.sku}`,
    `Go-live: ${formatClock(plan.goLiveEpochMs, QUEUE_TZ, false)} Central on ${new Date(plan.goLiveEpochMs).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: QUEUE_TZ })}`,
    '',
  ];
  plan.phases.forEach((p, i) => {
    const at = formatClock(plan.goLiveEpochMs - p.startOffsetMs, QUEUE_TZ, false);
    const verb = i === 0 ? 'START automation with delay' : 'set delay to';
    lines.push(
      `${at} CT  (${formatTMinus(p.startOffsetMs)})  ${verb} ${p.delayMs} ms   [${p.refreshes} refreshes, ${fmtRate(p.requestsPerMinute)}/min]`
    );
  });
  lines.push(`${formatClock(plan.goLiveEpochMs, QUEUE_TZ, false)} CT  (T-0)      QUEUE LIVE — refresh lands exactly here`);
  lines.push('', `Total requests: ${plan.totalRequests} (${plan.requestsInLastMinute} in the final minute)`);
  return lines.join('\n');
}

/* ------------------------------ live assistant ---------------------------- */

function beep(times = 1) {
  if (!$('#live-sound').checked) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.25 + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.25);
      osc.stop(ctx.currentTime + i * 0.25 + 0.2);
    }
  } catch {
    /* audio blocked until user interacts — fine */
  }
}

function formatCountdown(ms) {
  if (ms <= 0) return 'LIVE';
  if (ms < 10000) return (ms / 1000).toFixed(1) + 's';
  return formatDuration(ms - (ms % 1000));
}

function tickLive() {
  const plan = currentPlan;
  const cd = $('#live-countdown');
  const cur = $('#live-current-delay');
  const next = $('#live-next-change');

  if (!plan || !plan.ok) {
    cd.textContent = '--:--';
    cur.textContent = '—';
    next.textContent = 'configure the planner first';
    return;
  }

  const now = Date.now();
  const untilLive = plan.goLiveEpochMs - now;
  cd.textContent = formatCountdown(untilLive);
  cd.classList.toggle('golive-now', untilLive <= 0);
  $('#live-golive-at').textContent = `${bothClocksPlain(plan.goLiveEpochMs)}`;

  // Which action window are we in?
  let idx = -1;
  for (let i = 0; i < plan.actions.length; i++) {
    if (now >= plan.actions[i].epochMs) idx = i;
  }

  if (idx === -1) {
    cur.textContent = 'not started';
    const a0 = plan.actions[0];
    next.textContent = `START @ ${a0.delayMs.toLocaleString()} ms — ${formatClock(a0.epochMs, QUEUE_TZ, false)} CT (in ${formatCountdown(a0.epochMs - now)})`;
  } else {
    const a = plan.actions[idx];
    cur.textContent = a.type === 'golive' ? `${a.delayMs.toLocaleString()} ms (LIVE!)` : `${a.delayMs.toLocaleString()} ms`;
    const nxt = plan.actions[idx + 1];
    next.textContent = nxt
      ? nxt.type === 'golive'
        ? `QUEUE LIVE in ${formatCountdown(nxt.epochMs - now)}`
        : `→ ${nxt.delayMs.toLocaleString()} ms at ${formatClock(nxt.epochMs, QUEUE_TZ, false)} CT (in ${formatCountdown(nxt.epochMs - now)})`
      : 'done';
  }

  // Beep exactly when we cross into a new action window.
  if (idx > lastFiredActionIdx && lastFiredActionIdx !== -2) {
    if (lastFiredActionIdx >= 0 || idx === 0) beep(plan.actions[idx].type === 'golive' ? 3 : 1);
    lastFiredActionIdx = idx;
  }

  renderLiveActions(plan, idx);
}

function bothClocksPlain(epochMs) {
  const ct = formatClock(epochMs, QUEUE_TZ, false);
  const local = formatClock(epochMs, LOCAL_TZ, false);
  return LOCAL_TZ === QUEUE_TZ ? `${ct} Central` : `${ct} Central / ${local} your time`;
}

let liveActionsCache = '';
function renderLiveActions(plan, currentIdx) {
  const html = plan.actions
    .map((a, i) => {
      const cls = i < currentIdx ? 'past' : i === currentIdx ? 'current' : '';
      const what =
        a.type === 'start'
          ? `<span class="what">START automation @ ${a.delayMs.toLocaleString()} ms</span>`
          : a.type === 'golive'
            ? `<span class="what accent">QUEUE LIVE — refresh lands now</span>`
            : `<span class="what">Set delay to ${a.delayMs.toLocaleString()} ms</span>`;
      return `<div class="action-row ${cls}">
        <span class="mono">${formatClock(a.epochMs, QUEUE_TZ, false)} CT</span>
        <span class="mono">${formatTMinus(a.tMinusMs)}</span>
        ${what}
      </div>`;
    })
    .join('');
  if (html !== liveActionsCache) {
    $('#live-actions').innerHTML = html;
    liveActionsCache = html;
  }
}

setInterval(tickLive, 100);

/* -------------------------------- simulator ------------------------------- */

async function fetchMockConfig() {
  const res = await fetch('/api/config');
  return res.json();
}

async function refreshMockGoliveLabel() {
  try {
    const cfg = await fetchMockConfig();
    $('#sim-golive').textContent = `${formatClock(cfg.goLiveEpochMs, QUEUE_TZ, false)} CT (${formatTMinus(cfg.goLiveEpochMs - Date.now())})`;
  } catch {
    $('#sim-golive').textContent = 'server unreachable';
  }
}

async function setMockGolive(epochMs) {
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goLiveEpochMs: epochMs }),
  });
  await refreshMockGoliveLabel();
  await pollHits();
}

$('#btn-mock-2m').addEventListener('click', () => setMockGolive(Date.now() + 2 * 60000));
$('#btn-mock-5m').addEventListener('click', () => setMockGolive(Date.now() + 5 * 60000));
$('#btn-mock-planner').addEventListener('click', () => {
  if (currentPlan && currentPlan.ok) setMockGolive(currentPlan.goLiveEpochMs);
});
$('#btn-hits-clear').addEventListener('click', async () => {
  await fetch('/api/hits', { method: 'DELETE' });
  $('#sim-verdict').innerHTML = '';
  await pollHits();
});

$('#btn-sim-run').addEventListener('click', runSimulation);
$('#btn-sim-stop').addEventListener('click', stopSimulation);

function setSimStatus(msg) {
  $('#sim-status').textContent = msg;
}

async function runSimulation() {
  if (sim.running) return;
  const s = readInputs();
  const cfg = await fetchMockConfig();
  const now = Date.now();
  const untilLive = cfg.goLiveEpochMs - now;

  if (untilLive < 5000) {
    setSimStatus('Mock go-live is in the past (or <5s away). Use "Set to +2 min" first.');
    return;
  }

  // Compress the user's plan into the time available before the mock go-live.
  const availableLeadMs = untilLive - 1500;
  const plan = buildPlan({
    goLiveEpochMs: cfg.goLiveEpochMs,
    leadTimeMs: availableLeadMs,
    initialDelayMs: s.initialDelayMs,
    steps: steps.map((st) => ({ delayMs: st.delayMs, atOffsetMs: st.tMinusMs })),
    roundInitial: 'floor',
  });
  if (!plan.ok) {
    setSimStatus(plan.errors.join(' '));
    return;
  }

  const timeline = refreshTimeline(plan, 3);
  sim = { running: true, timer: null, records: [], plan };
  $('#btn-sim-run').disabled = true;
  $('#btn-sim-stop').disabled = false;
  $('#sim-verdict').innerHTML = '';
  setSimStatus(`Running: ${timeline.length} refreshes, first at ${formatTMinus(cfg.goLiveEpochMs - timeline[0])}…`);

  let i = 0;
  const fireNext = () => {
    if (!sim.running) return;
    if (i >= timeline.length) return finishSimulation();
    const target = timeline[i];
    sim.timer = setTimeout(async () => {
      if (!sim.running) return;
      const sentAt = Date.now();
      let body = null;
      try {
        const res = await fetch(`/api/queue/${encodeURIComponent(s.sku)}`);
        body = await res.json();
      } catch {
        /* server hiccup — record the attempt anyway */
      }
      sim.records.push({
        intendedOffsetMs: target - sim.plan.goLiveEpochMs,
        actualOffsetMs: sentAt - sim.plan.goLiveEpochMs,
        live: body ? body.live : null,
        position: body ? body.position : null,
      });
      setSimStatus(`Refresh ${i + 1}/${timeline.length} sent at ${formatTMinus(sim.plan.goLiveEpochMs - sentAt)}`);
      i++;
      fireNext();
    }, Math.max(0, target - Date.now()));
  };
  fireNext();
}

function stopSimulation() {
  sim.running = false;
  if (sim.timer) clearTimeout(sim.timer);
  $('#btn-sim-run').disabled = false;
  $('#btn-sim-stop').disabled = true;
  setSimStatus('Stopped.');
}

function finishSimulation() {
  sim.running = false;
  $('#btn-sim-run').disabled = false;
  $('#btn-sim-stop').disabled = true;
  setSimStatus('Done.');

  // The refresh whose *intended* time was exactly go-live is the money shot.
  const target = sim.records.find((r) => r.intendedOffsetMs === 0);
  const firstLive = sim.records.find((r) => r.live);
  if (!target) {
    $('#sim-verdict').innerHTML = '<div class="callout warn">Simulation ended without reaching go-live.</div>';
    return;
  }
  const err = target.actualOffsetMs;
  const ok = Math.abs(err) <= 150;
  $('#sim-verdict').innerHTML = `
    <div class="callout ${ok ? 'ok' : 'warn'}">
      The go-live refresh fired at <strong>${err >= 0 ? '+' : ''}${err} ms</strong> from the queue opening
      (browser timer jitter included).
      ${firstLive && firstLive.position ? ` First live hit got queue position <strong>#${firstLive.position}</strong>.` : ''}
      ${ok ? ' Your delay plan is aligned.' : ' More than 150 ms off — close other tabs or re-run; heavy pages can starve browser timers.'}
    </div>`;
  pollHits();
}

/* -------------------------------- hit log --------------------------------- */

async function pollHits() {
  const tbody = $('#hits-table tbody');
  try {
    const res = await fetch('/api/hits');
    const data = await res.json();
    const hits = data.hits.slice(-200).reverse();
    tbody.innerHTML = hits
      .map((h, i) => {
        const cls = h.live && h.position === 1 ? 'hit-golive' : h.live ? 'hit-late' : '';
        const result = h.live
          ? `QUEUE OPEN — position #${h.position}`
          : 'waiting room (not live yet)';
        return `<tr class="${cls}">
          <td>${hits.length - i}</td>
          <td>${h.sku}</td>
          <td>${formatClock(h.epochMs, QUEUE_TZ)}</td>
          <td>${formatTMinus(-h.offsetMs)} (${h.offsetMs >= 0 ? '+' : ''}${h.offsetMs} ms)</td>
          <td>${result}</td>
        </tr>`;
      })
      .join('');
  } catch {
    /* server not reachable — leave table as-is */
  }
}

setInterval(() => {
  if ($('#tab-simulator').classList.contains('active')) {
    pollHits();
    refreshMockGoliveLabel();
  }
}, 2000);

/* --------------------------------- update --------------------------------- */

function update() {
  currentPlan = computePlan();
  lastFiredActionIdx = -2; // re-sync live assistant without a beep storm
  renderPlan();
  saveSettings();
  const s = readInputs();
  $('#sim-endpoint').textContent = `${location.origin}/api/queue/${s.sku}`;
  // Re-arm the beep tracker at the current position.
  if (currentPlan && currentPlan.ok) {
    const now = Date.now();
    let idx = -1;
    for (let i = 0; i < currentPlan.actions.length; i++) {
      if (now >= currentPlan.actions[i].epochMs) idx = i;
    }
    lastFiredActionIdx = idx;
  }
  liveActionsCache = '';
  tickLive();
}

['#in-date', '#in-time', '#in-sku', '#in-lead', '#in-initial', '#in-risk'].forEach((sel) =>
  $(sel).addEventListener('input', update)
);

/* ---------------------------------- init ---------------------------------- */

loadSettings();
if (!$('#in-date').value) $('#in-date').value = nextWednesday(QUEUE_TZ);
renderSteps();
update();
refreshMockGoliveLabel();
pollHits();
