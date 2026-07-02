'use strict';

const MIN = 60000;
let goLiveEpochMs = null;
let currentPhases = [];

const $ = (id) => document.getElementById(id);

const PRESET_PHASES = {
  balanced: [
    { label: 'Warm-up (safe)', min: 15, delayMs: 10000 },
    { label: 'Ramp', min: 3, delayMs: 3000 },
    { label: 'Final sprint', min: 0.5, delayMs: 1500 },
  ],
  conservative: [
    { label: 'Warm-up (safe)', min: 20, delayMs: 15000 },
    { label: 'Ramp', min: 5, delayMs: 5000 },
    { label: 'Final sprint', min: 0.5, delayMs: 3000 },
  ],
  aggressive: [
    { label: 'Warm-up', min: 10, delayMs: 6000 },
    { label: 'Ramp', min: 2, delayMs: 2000 },
    { label: 'Final sprint', min: 0.33, delayMs: 1000 },
  ],
};

function renderPhaseRows(phases) {
  const tbody = $('phaseRows');
  tbody.innerHTML = '';
  phases.forEach((p, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input data-i="${i}" data-k="label" value="${p.label}" /></td>
      <td><input data-i="${i}" data-k="min" type="number" step="0.1" min="0" value="${p.min}" /></td>
      <td><input data-i="${i}" data-k="delayMs" type="number" step="100" min="1" value="${p.delayMs}" /></td>
      <td><button class="rm" data-rm="${i}">remove</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('input').forEach((inp) => {
    inp.addEventListener('change', (e) => {
      const i = +e.target.dataset.i;
      const k = e.target.dataset.k;
      currentPhases[i][k] = k === 'label' ? e.target.value : Number(e.target.value);
      $('preset').value = 'custom';
    });
  });
  tbody.querySelectorAll('.rm').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      currentPhases.splice(+e.target.dataset.rm, 1);
      renderPhaseRows(currentPhases);
      $('preset').value = 'custom';
    });
  });
}

function loadPreset(name) {
  if (name === 'custom') return;
  currentPhases = PRESET_PHASES[name].map((p) => ({ ...p }));
  renderPhaseRows(currentPhases);
}

function buildConfig() {
  return {
    autoAlignFinal: $('autoAlign').value === 'true',
    finalDelayMinMs: Number($('finalMin').value),
    finalDelayMaxMs: Number($('finalMax').value),
    banPerMinWarn: Number($('warn').value),
    banPerMinDanger: Number($('danger').value),
    phases: currentPhases.map((p) => ({
      label: p.label,
      startBeforeMs: Math.round(p.min * MIN),
      delayMs: Number(p.delayMs),
    })),
  };
}

function pill(risk) {
  return `<span class="pill ${risk}">${risk}</span>`;
}

async function calculate() {
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildConfig()),
  });
  const plan = await res.json();
  goLiveEpochMs = plan.goLive.epochMs;
  renderPlan(plan);
}

function renderPlan(plan) {
  $('results').classList.remove('hidden');

  const err = plan.landing.errorMs;
  const good = Math.abs(err) <= 250;
  const land = $('landing');
  land.className = 'landing ' + (good ? 'good' : 'warn');
  land.innerHTML = `
    <div class="big">${good ? '🎯 Lands on go-live' : '⚠ Close, but not exact'}</div>
    <div>Closest refresh: <b>${plan.landing.closestRefreshCT}</b></div>
    <div>Landing accuracy: <b>${plan.landing.errorLabel}</b></div>
    <div>Start the bot at <b>${plan.startAt.ct}</b> (${plan.startAt.tminus}).</div>`;

  if (plan.alignment) {
    const a = plan.alignment;
    $('alignment').innerHTML =
      `Auto-align solved the final phase to <b>${a.practicalFinalDelayMs} ms</b> ` +
      `(you asked for ~${a.requestedFinalDelayMs} ms). It fires <b>${a.refreshesInFinalPhase}</b> ` +
      `refresh(es) in the final window and ${a.landsExactWithInteger ? 'lands exactly on 8:00:00.000' : `lands within ${a.landingResidualMs} ms`}.`;
  } else {
    $('alignment').textContent = '';
  }

  $('scheduleRows').innerHTML = plan.dropSchedule
    .map(
      (d) => `<tr>
        <td>${d.atTminus}</td>
        <td>${d.atClockCT}</td>
        <td>${d.setDelayMs.toLocaleString()} ms</td>
        <td>${d.requestsPerMinute}</td>
        <td>${pill(d.risk)}</td>
        <td>${d.note}</td>
      </tr>`
    )
    .join('');

  $('totals').innerHTML = `Total refreshes: <b>${plan.totals.refreshCount}</b> · ` +
    `Worst burst: <b>${plan.totals.worstRequestsPerMinute} req/min</b> · ` +
    `Overall risk: ${pill(plan.totals.overallRisk)}`;
}

async function dryRun() {
  const res = await fetch('/api/dry-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildConfig()),
  });
  const data = await res.json();
  goLiveEpochMs = data.plan.goLive.epochMs;
  renderPlan(data.plan);

  $('dryResults').classList.remove('hidden');
  const p = data.mockReport.proxies[0] || {};
  $('dryReport').innerHTML = `
    <div class="kv">
      <div class="box"><div class="k">Made the queue?</div><div class="v">${p.madeQueue ? 'Yes ✅' : 'No ❌'}</div></div>
      <div class="box"><div class="k">First queue hit</div><div class="v" style="font-size:14px">${p.madeQueueAtCT || '—'}</div></div>
      <div class="box"><div class="k">Total requests</div><div class="v">${p.totalRequests ?? 0}</div></div>
      <div class="box"><div class="k">Blocked/banned</div><div class="v">${p.blocked ?? 0}</div></div>
      <div class="box"><div class="k">Ever banned?</div><div class="v">${p.blocked > 0 ? 'Yes ⚠' : 'No ✅'}</div></div>
    </div>
    <h3>Last refreshes</h3>
    <table><thead><tr><th>Clock (CT)</th><th>T-minus</th><th>Status</th></tr></thead>
    <tbody>${data.sampleHits.map((h) => `<tr><td>${h.ct}</td><td>${h.tminus}</td><td>${h.status}</td></tr>`).join('')}</tbody></table>`;
}

async function initGoLive() {
  const res = await fetch('/api/next-golive');
  const data = await res.json();
  goLiveEpochMs = data.epochMs;
  $('goLiveClock').textContent = data.ct;
  $('mockUrl').textContent = window.location.origin;
}

function tickCountdown() {
  if (!goLiveEpochMs) return;
  const diff = goLiveEpochMs - Date.now();
  const el = $('countdown');
  if (diff <= 0) {
    el.textContent = 'LIVE / passed';
    return;
  }
  const s = Math.floor(diff / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  el.textContent = `T-${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

async function mockRefresh() {
  const res = await fetch('/api/mock/refresh?proxy=dashboard-test');
  const data = await res.json();
  $('mockOut').innerHTML = `<pre class="endpoint">${JSON.stringify(data, null, 2)}</pre>`;
}
async function mockReport() {
  const res = await fetch('/api/mock/report');
  const data = await res.json();
  $('mockOut').innerHTML = `<pre class="endpoint">${JSON.stringify(data, null, 2)}</pre>`;
}
async function mockReset() {
  await fetch('/api/mock/reset', { method: 'POST' });
  $('mockOut').innerHTML = `<pre class="endpoint">mock reset ✅</pre>`;
}

function addPhase() {
  currentPhases.push({ label: 'New phase', min: 1, delayMs: 2000 });
  renderPhaseRows(currentPhases);
  $('preset').value = 'custom';
}

$('preset').addEventListener('change', (e) => loadPreset(e.target.value));
$('addPhase').addEventListener('click', addPhase);
$('calc').addEventListener('click', calculate);
$('dryRun').addEventListener('click', dryRun);
$('mockRefresh').addEventListener('click', mockRefresh);
$('mockReport').addEventListener('click', mockReport);
$('mockReset').addEventListener('click', mockReset);

loadPreset('balanced');
initGoLive();
setInterval(tickCountdown, 250);
