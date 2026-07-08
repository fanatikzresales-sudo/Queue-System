// ── DOM refs ──────────────────────────────────────────────────────────────────
const timezoneEl       = document.getElementById("timezone");
const demoModeEl       = document.getElementById("demo_mode");
const startTimeEl      = document.getElementById("start_time");
const customDateEl     = document.getElementById("custom_date");
const queueTimeEl      = document.getElementById("queue_time_override");
const nextWedBtn       = document.getElementById("next_wed_btn");
const initialDelayEl   = document.getElementById("initial_delay_ms");
const delayPresetEl    = document.getElementById("delay_preset");
const optimizeBtn      = document.getElementById("optimize_btn");
const queueLiveLabel   = document.getElementById("queue_live_label");
const presetGridEl     = document.getElementById("preset_grid");
const lateDropGridEl   = document.getElementById("late_drop_grid");
const targetFinalDelayEl = document.getElementById("target_final_delay_ms");
const dropPlanHintEl   = document.getElementById("drop_plan_hint");
const dropPlanBtns     = document.querySelectorAll(".drop-plan-btn");
const compatibleStartsPanel = document.getElementById("compatible_starts_panel");
const compatibleStartsHint  = document.getElementById("compatible_starts_hint");
const compatibleStartsList  = document.getElementById("compatible_starts_list");
const customSectionEl    = document.querySelector(".custom-section");
const resultsPanelEl   = document.getElementById("results_panel");
const verificationEl   = document.getElementById("verification");
const summaryEl        = document.getElementById("summary");
const twoStepCardsEl   = document.getElementById("two_step_cards");
const dropTableBody    = document.querySelector("#drop_table tbody");
const finalRefreshesEl = document.getElementById("final_refreshes");
const activePlansSection = document.getElementById("active-plans-section");
const activePlansList  = document.getElementById("active-plans-list");
const activePlansCount = document.getElementById("active-plans-count");
const cancelAllBtn     = document.getElementById("cancel-all-btn");
const timingModeHintEl = document.getElementById("timing_mode_hint");
const timingModeBtns   = document.querySelectorAll(".timing-mode-btn");

const TIMING_MODE_HINTS = {
  instant: "Drop at the boundary — delay applies immediately.",
  deferred: "Drop one cycle early — bot finishes its last slow refresh first.",
};

const DROP_PLAN_HINTS = {
  last_min: "Last-min: drop 2–5 min before queue with tight final delays (800–3,000 ms).",
  long_drop: "Long drop: drop up to ~10 min before queue with proxy-friendly delays (1,000–5,000 ms).",
};

const FINAL_DELAY_OPTIONS = {
  last_min: [
    { value: "1500", label: "1,500 ms (1.5 sec) — Pokemon-precision" },
    { value: "2000", label: "2,000 ms (2 sec) — high refresh" },
    { value: "3000", label: "3,000 ms (3 sec) — strong near-live" },
    { value: "1000", label: "1,000 ms (1 sec) — ultra-tight" },
    { value: "800", label: "800 ms — maximum speed" },
  ],
  long_drop: [
    { value: "auto", label: "Auto — best fit for your start time" },
    { value: "5000", label: "5,000 ms (5 sec) — most proxy-safe" },
    { value: "3000", label: "3,000 ms (3 sec) — balanced" },
    { value: "2000", label: "2,000 ms (2 sec)" },
    { value: "1500", label: "1,500 ms (1.5 sec)" },
    { value: "1000", label: "1,000 ms (1 sec)" },
  ],
};

let currentTimingMode = "instant";
let currentDropPlan = "last_min";
let selectedFinalDelayMs = 1500;

function pad2(n) { return String(n).padStart(2, "0"); }

function dropStepTitle(p) {
  if (p.timing_mode === "deferred") {
    return `Drop once — bot finishes 1 more slow refresh, then switches`;
  }
  return `Drop once — ${p.drop_minutes_label} before queue`;
}

function dropStepSub(p) {
  if (p.timing_mode === "deferred" && p.effective_switch_time_display) {
    return `${p.refreshes_phase2} refreshes → queue live · final delay active at ${p.effective_switch_time_display}`;
  }
  return `${p.refreshes_phase2} refreshes → queue live`;
}

function formatMs(ms) {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min (${ms.toLocaleString()} ms)`;
  if (ms >= 1000)  return `${(ms / 1000).toFixed(1)} sec (${ms.toLocaleString()} ms)`;
  return `${ms} ms`;
}

function getTimingMode() {
  return currentTimingMode;
}

function setTimingMode(mode) {
  currentTimingMode = mode === "deferred" ? "deferred" : "instant";
  timingModeBtns.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === currentTimingMode);
  });
  if (timingModeHintEl) {
    timingModeHintEl.textContent = TIMING_MODE_HINTS[currentTimingMode];
  }
}

function timingModeLabel(mode) {
  return mode === "deferred" ? "Deferred Switch" : "Instant Switch";
}

function dropPlanLabel(mode) {
  return mode === "last_min" ? "Last-Min Drop" : "Long Drop Delay";
}

function getDropPlanMode() {
  return currentDropPlan;
}

function setDropPlanMode(mode) {
  currentDropPlan = mode === "long_drop" ? "long_drop" : "last_min";
  dropPlanBtns.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.dropPlan === currentDropPlan);
  });
  if (dropPlanHintEl) {
    dropPlanHintEl.textContent = DROP_PLAN_HINTS[currentDropPlan];
  }
  populateTargetFinalDelaySelect();
  loadCompatibleStarts();
}

function populateTargetFinalDelaySelect() {
  if (!targetFinalDelayEl) return;
  const options = FINAL_DELAY_OPTIONS[currentDropPlan] || FINAL_DELAY_OPTIONS.last_min;
  targetFinalDelayEl.innerHTML = options.map(o =>
    `<option value="${o.value}">${o.label}</option>`
  ).join("");
  const preferred = currentDropPlan === "last_min" ? "1500" : "auto";
  targetFinalDelayEl.value = String(selectedFinalDelayMs || preferred);
  if (targetFinalDelayEl.value !== String(selectedFinalDelayMs) &&
      options.some(o => o.value === String(selectedFinalDelayMs))) {
    targetFinalDelayEl.value = String(selectedFinalDelayMs);
  } else if (!options.some(o => o.value === targetFinalDelayEl.value)) {
    targetFinalDelayEl.value = preferred;
  }
}

function getTargetFinalDelayPayload() {
  if (!targetFinalDelayEl) return null;
  const val = targetFinalDelayEl.value;
  return val === "auto" ? null : parseInt(val, 10);
}

dropPlanBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.dropPlan === currentDropPlan) return;
    setDropPlanMode(btn.dataset.dropPlan);
    resultsPanelEl.hidden = true;
  });
});

if (targetFinalDelayEl) {
  targetFinalDelayEl.addEventListener("change", () => {
    const val = targetFinalDelayEl.value;
    selectedFinalDelayMs = val === "auto" ? null : parseInt(val, 10);
    loadCompatibleStarts();
  });
}

timingModeBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.mode === currentTimingMode) return;
    setTimingMode(btn.dataset.mode);
    loadPresets();
    loadCompatibleStarts();
    resultsPanelEl.hidden = true;
  });
});

setTimingMode("instant");

function formatCountdown(ms) {
  if (ms <= 0) return "now";
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

let _nameCounter = 1;
function defaultName() { return `Bot ${_nameCounter++}`; }

// Fire a REAL OS notification (works even when the app is minimized / in background).
// Uses the pywebview Python bridge when running as the desktop app;
// falls back to the browser Notification API when opened in a browser.
function fireOSNotification(title, body) {
  // Desktop app (pywebview) — real OS toast + brings window to front
  if (window.pywebview && window.pywebview.api && window.pywebview.api.notify) {
    try {
      window.pywebview.api.notify(title, body);
      return;
    } catch (_) {}
  }
  // Browser fallback
  try {
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(title, { body });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(p => {
          if (p === "granted") new Notification(title, { body });
        });
      }
    }
  } catch (_) {}
}

// ── Multi-Plan Manager ────────────────────────────────────────────────────────

const PM = (() => {
  const plans = {};   // id -> { name, plan, timers, countdownInterval, popupId }
  const DROP_REMINDER_MINUTES = window.__DROP_REMINDER_MINUTES || 5;

  // ── popup helpers ──────────────────────────────────────────────────────────

  function _popupId(planId) { return `notif-${planId}`; }
  function _dropPopupId(planId) { return `notif-drop-${planId}`; }

  function _makePopup(id, content, urgent = false) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.id = id;
    el.className = "notif-popup" + (urgent ? " notif-urgent" : "");
    el.innerHTML = content;

    // Stack multiple popups
    const offset = Object.keys(plans).length * 8;
    el.style.top = `${1.25 + offset * 0.4}rem`;

    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("notif-visible"));
    el.querySelectorAll(".notif-close").forEach(btn =>
      btn.addEventListener("click", () => {
        el.classList.remove("notif-visible");
        setTimeout(() => el.remove(), 300);
      })
    );
    return el;
  }

  // ── Active plans panel ─────────────────────────────────────────────────────

  function _refreshPanel() {
    const ids = Object.keys(plans);
    activePlansCount.textContent = ids.length;
    activePlansSection.hidden = ids.length === 0;

    activePlansList.innerHTML = ids.map(id => {
      const { name, plan } = plans[id];
      const msUntilStart = plan.start_ts_ms - Date.now();
      const phase = msUntilStart > 0 ? "starting" : (plan.drop_ts_ms - Date.now() > 0 ? "dropping" : "live");
      return `
        <div class="ap-item" data-id="${id}">
          <div class="ap-dot ${phase}"></div>
          <div class="ap-info">
            <div class="ap-name">${name}</div>
            <div class="ap-label">${plan.label}</div>
            <div class="ap-times">${plan.start_time_display} → ${plan.drop_time_display} → ${plan.queue_time_display}</div>
          </div>
          <div class="ap-right">
            <div class="ap-countdown" id="apc-${id}">${_countdownLabel(plan)}</div>
            <button class="ap-cancel-btn" data-id="${id}" type="button">Cancel</button>
          </div>
        </div>
      `;
    }).join("") || "";

    activePlansList.querySelectorAll(".ap-cancel-btn").forEach(btn =>
      btn.addEventListener("click", () => cancel(btn.dataset.id))
    );
  }

  function _countdownLabel(plan) {
    const msUntilStart = plan.start_ts_ms - Date.now();
    const msUntilDrop  = plan.drop_ts_ms  - Date.now();
    if (msUntilStart > 0) return `Start in ${formatCountdown(msUntilStart)}`;
    if (msUntilDrop  > 0) return `Drop in  ${formatCountdown(msUntilDrop)}`;
    return "Queue live";
  }

  function _tickCountdowns() {
    Object.keys(plans).forEach(id => {
      const el = document.getElementById(`apc-${id}`);
      if (el) el.textContent = _countdownLabel(plans[id].plan);
    });
  }

  setInterval(_tickCountdowns, 1000);

  // ── Show start popup ───────────────────────────────────────────────────────

  function _showStartPopup(id, name, plan) {
    const msUntil = plan.start_ts_ms - Date.now();
    let interval;

    const pop = _makePopup(_popupId(id), `
      <div class="notif-header">
        <span class="notif-icon">🎯</span>
        <span class="notif-title">Plan Active</span>
        <button class="notif-close">✕</button>
      </div>
      <div class="notif-plan-name">${name}</div>
      <div class="notif-plan-badge">${plan.label}</div>
      <div class="notif-overview">
        <div class="notif-row">
          <span class="notif-step-dot blue">1</span>
          <div>
            <div class="notif-step-label">Start your task</div>
            <div class="notif-step-time">${plan.start_time_display}</div>
            <div class="notif-step-detail">Set delay to <strong>${plan.start_delay_label}</strong></div>
          </div>
        </div>
        <div class="notif-row">
          <span class="notif-step-dot yellow">2</span>
          <div>
            <div class="notif-step-label">Drop delay once</div>
            <div class="notif-step-time">${plan.drop_time_display}</div>
            <div class="notif-step-detail">Change to <strong>${plan.final_delay_label}</strong></div>
          </div>
        </div>
      </div>
      <div class="notif-countdown-row">
        <span>Time until start:</span>
        <span class="notif-countdown" id="ncd-${id}">${formatCountdown(msUntil)}</span>
      </div>
      <button class="notif-close notif-close-btn">Close</button>
    `);

    interval = setInterval(() => {
      const el = document.getElementById(`ncd-${id}`);
      if (!el) { clearInterval(interval); return; }
      const r = plan.start_ts_ms - Date.now();
      el.textContent = r > 0 ? formatCountdown(r) : "Start now!";
      if (r <= 0) clearInterval(interval);
    }, 1000);

    if (plans[id]) plans[id].countdownInterval = interval;

    // Real OS notification confirming the plan is set
    fireOSNotification(
      `${name} — Plan Active`,
      `Start at ${plan.start_time_display} with ${plan.start_delay_label}. ` +
      `Drop to ${plan.final_delay_label} at ${plan.drop_time_display}.`
    );
  }

  // ── Show drop reminder popup ───────────────────────────────────────────────

  function _showDropPopup(id, name, plan) {
    _makePopup(_dropPopupId(id), `
      <div class="notif-header notif-header-urgent">
        <span class="notif-icon">⚡</span>
        <span class="notif-title">Drop in ${DROP_REMINDER_MINUTES} min — ${name}</span>
        <button class="notif-close">✕</button>
      </div>
      <div class="notif-drop-body">
        <div class="notif-drop-time">At: <strong>${plan.drop_time_display}</strong></div>
        <div class="notif-drop-change">
          Change delay to: <span class="notif-drop-delay">${plan.final_delay_label}</span>
        </div>
        <div class="notif-drop-note">
          Next refresh after drop hits <strong>${plan.queue_time_display}</strong> exactly.
        </div>
      </div>
      <button class="notif-close notif-close-btn notif-got-it">Got It</button>
    `, true);

    // Real OS notification — this is the critical "drop now" alert
    fireOSNotification(
      `⚡ ${name} — Drop in ${DROP_REMINDER_MINUTES} minutes!`,
      `At ${plan.drop_time_display}, change your delay to ${plan.final_delay_label}. ` +
      `Next refresh hits ${plan.queue_time_display} exactly.`
    );
  }

  // ── Activate ───────────────────────────────────────────────────────────────

  function activate(name, plan) {
    const id = `plan-${Date.now()}`;
    const now = Date.now();
    const timers = [];

    const msUntilDropReminder = plan.drop_ts_ms - (DROP_REMINDER_MINUTES * 60 * 1000) - now;

    if (msUntilDropReminder > 0) {
      timers.push(setTimeout(() => _showDropPopup(id, name, plan), msUntilDropReminder));
    } else if (plan.drop_ts_ms - now > 0) {
      // Already inside the 5-min window
      _showDropPopup(id, name, plan);
    }

    // Auto-remove after queue goes live
    const msUntilLive = plan.queue_ts_ms - now;
    if (msUntilLive > 0) {
      timers.push(setTimeout(() => { cancel(id, true); }, msUntilLive + 5000));
    }

    plans[id] = { name, plan, timers, countdownInterval: null };
    _refreshPanel();
    _showStartPopup(id, name, plan);

    return id;
  }

  // ── Cancel ─────────────────────────────────────────────────────────────────

  function cancel(id, silent = false) {
    const entry = plans[id];
    if (!entry) return;

    entry.timers.forEach(clearTimeout);
    if (entry.countdownInterval) clearInterval(entry.countdownInterval);

    [_popupId(id), _dropPopupId(id)].forEach(pid => {
      const el = document.getElementById(pid);
      if (el) { el.classList.remove("notif-visible"); setTimeout(() => el.remove(), 300); }
    });

    delete plans[id];
    _refreshPanel();

    if (!silent) {
      _makePopup(`notif-cancel-${Date.now()}`, `
        <div class="notif-header">
          <span class="notif-icon">🚫</span>
          <span class="notif-title">Plan Cancelled</span>
          <button class="notif-close">✕</button>
        </div>
        <p style="margin:0.5rem 0;color:var(--muted);font-size:0.88rem;">
          <strong>${entry.name}</strong> has been cancelled. All reminders cleared.
        </p>
        <button class="notif-close notif-close-btn">Close</button>
      `);
      setTimeout(() => {
        const el = document.getElementById(`notif-cancel-${Date.now() - 100}`);
        if (el) el.remove();
      }, 4000);
    }
  }

  function cancelAll() {
    [...Object.keys(plans)].forEach(id => cancel(id, true));
    _makePopup("notif-cancel-all", `
      <div class="notif-header">
        <span class="notif-icon">🚫</span>
        <span class="notif-title">All Plans Cancelled</span>
        <button class="notif-close">✕</button>
      </div>
      <p style="margin:0.5rem 0;color:var(--muted);font-size:0.88rem;">
        All active plans and reminders have been cleared.
      </p>
      <button class="notif-close notif-close-btn">Close</button>
    `);
  }

  return { activate, cancel, cancelAll };
})();

cancelAllBtn.addEventListener("click", () => PM.cancelAll());

// ── Name-input overlay (shared for preset cards and custom plan) ──────────────

function showNameInput({ anchorEl, defaultName: defName, onActivate }) {
  // Remove any existing overlays
  document.querySelectorAll(".name-overlay").forEach(e => e.remove());

  const overlay = document.createElement("div");
  overlay.className = "name-overlay";
  overlay.innerHTML = `
    <label class="name-overlay-label">Name this plan <small>(optional)</small></label>
    <div class="name-overlay-row">
      <input class="name-overlay-input" type="text" placeholder="${defName}" maxlength="30">
      <button class="name-overlay-activate" type="button">Activate &amp; Set Alerts</button>
      <button class="name-overlay-cancel" type="button">✕</button>
    </div>
  `;
  anchorEl.appendChild(overlay);
  const input = overlay.querySelector(".name-overlay-input");
  input.focus();

  overlay.querySelector(".name-overlay-activate").addEventListener("click", () => {
    const name = input.value.trim() || defName;
    overlay.remove();
    onActivate(name);
  });
  overlay.querySelector(".name-overlay-cancel").addEventListener("click", () => overlay.remove());
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") overlay.querySelector(".name-overlay-activate").click();
    if (e.key === "Escape") overlay.remove();
  });
}

function presetCardHtml(p, i, extraClass = "") {
  return `
    <div class="preset-card ${extraClass}" data-idx="${i}"
         data-start-h="${p.start_h}" data-start-m="${p.start_m}" data-start-s="${p.start_s}"
         data-delay="${p.start_delay_ms}" data-final-delay="${p.final_delay_ms}"
         data-drop-mode="${p.drop_mode || "long_drop"}"
         data-switch-minutes="${p.switch_minutes_before || ""}">

      <div class="pc-head">
        <div>
          <div class="pc-label">${p.label}</div>
          <div class="pc-desc">${p.description}</div>
        </div>
        <span class="pc-badge ${p.verified ? "ok" : "warn"}">${p.verified ? "✓ Verified" : "Approx"}</span>
      </div>

      <div class="pc-tag-row">
        <span class="pc-tag">Start ${p.start_window_label}</span>
        <span class="pc-tag">Drop ${p.drop_minutes_label} before</span>
        ${p.preset_category === "late_drop" ? '<span class="pc-tag">Late drop</span>' : ""}
      </div>

      <div class="pc-flow">
        <div class="pc-step pc-start">
          <div class="pc-step-num">1</div>
          <div class="pc-step-info">
            <div class="pc-step-title">Start your task</div>
            <div class="pc-time">${p.start_time_display}</div>
            <div class="pc-delay-chip">${p.start_delay_label}</div>
            <div class="pc-sub">${p.refreshes_phase1} refreshes until drop</div>
          </div>
        </div>
        <div class="pc-arrow">↓</div>
        <div class="pc-step pc-drop">
          <div class="pc-step-num">2</div>
          <div class="pc-step-info">
            <div class="pc-step-title pc-drop-title-deferred">${dropStepTitle(p)}</div>
            <div class="pc-time">${p.drop_time_display}</div>
            <div class="pc-delay-chip final">${p.final_delay_label}</div>
            <div class="pc-sub">${dropStepSub(p)}</div>
          </div>
        </div>
        <div class="pc-arrow">↓</div>
        <div class="pc-live">
          <span class="pc-live-dot"></span>
          <span>${p.queue_time_display} — QUEUE LIVE</span>
        </div>
      </div>

      <div class="pc-btn-row">
        <button class="pc-select-btn" type="button">Use This Plan</button>
        <button class="pc-demo-btn"   type="button">▶ Watch Demo</button>
      </div>
    </div>
  `;
}

function applyPresetToCustom(p) {
  startTimeEl.value = `${pad2(p.start_h)}:${pad2(p.start_m)}:${pad2(p.start_s)}`;
  initialDelayEl.value = p.start_delay_ms;
  selectedFinalDelayMs = p.final_delay_ms;
  if (p.drop_mode) setDropPlanMode(p.drop_mode);
  if (targetFinalDelayEl) {
    populateTargetFinalDelaySelect();
    targetFinalDelayEl.value = String(p.final_delay_ms);
  }
  loadCompatibleStarts();
  customSectionEl && customSectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function wirePresetGrid(gridEl, plans) {
  if (!gridEl) return;
  gridEl.querySelectorAll(".preset-card").forEach(card => {
    const idx = parseInt(card.dataset.idx, 10);
    const p = plans[idx];
    if (!p) return;

    card.querySelector(".pc-select-btn").addEventListener("click", e => {
      e.stopPropagation();
      applyPresetToCustom(p);
      document.querySelectorAll(".preset-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      if (!demoModeEl.checked) {
        runOptimize({
          live: true,
          final_delay_ms: p.final_delay_ms,
          switch_minutes_before: p.switch_minutes_before,
        });
      }

      showNameInput({
        anchorEl: card,
        defaultName: defaultName(),
        onActivate: name => PM.activate(name, p),
      });
    });

    card.querySelector(".pc-demo-btn").addEventListener("click", e => {
      e.stopPropagation();
      const params = new URLSearchParams({
        timezone: timezoneEl.value,
        start_delay: String(p.start_delay_ms),
        final_delay: String(p.final_delay_ms),
        switch_minutes_before: String(p.switch_minutes_before),
        label: p.label,
        timing_mode: p.timing_mode || getTimingMode(),
      });
      window.open(`/demo-live?${params.toString()}`, "_blank");
    });

    card.addEventListener("click", e => {
      if (!e.target.closest("button") && !e.target.closest(".name-overlay")) {
        applyPresetToCustom(p);
        document.querySelectorAll(".preset-card").forEach(c => c.classList.remove("selected"));
        card.classList.add("selected");
        if (!demoModeEl.checked) {
          runOptimize({
            live: true,
            final_delay_ms: p.final_delay_ms,
            switch_minutes_before: p.switch_minutes_before,
          });
        }
      }
    });
  });
}

function renderPresets(data) {
  queueLiveLabel.textContent = `Queue goes live: ${data.queue_live}`;
  if (data.timing_mode) setTimingMode(data.timing_mode);

  const longPlans = data.plans || [];
  const latePlans = data.late_drop_plans || [];

  if (!longPlans.length && !latePlans.length) {
    presetGridEl.innerHTML = '<p class="placeholder">No plans available.</p>';
    if (lateDropGridEl) lateDropGridEl.innerHTML = "";
    return;
  }

  presetGridEl.innerHTML = longPlans.length
    ? longPlans.map((p, i) => presetCardHtml(p, i)).join("")
    : '<p class="placeholder">No long-drop plans for this mode.</p>';

  if (lateDropGridEl) {
    lateDropGridEl.innerHTML = latePlans.length
      ? latePlans.map((p, i) => presetCardHtml(p, i, "late-drop-card")).join("")
      : '<p class="placeholder">No last-min plans for this mode.</p>';
  }

  wirePresetGrid(presetGridEl, longPlans);
  wirePresetGrid(lateDropGridEl, latePlans);
}

async function loadCompatibleStarts() {
  if (!compatibleStartsPanel || !compatibleStartsList) return;

  const finalMs = getTargetFinalDelayPayload();
  if (!finalMs) {
    compatibleStartsPanel.hidden = true;
    return;
  }

  try {
    const res = await fetch("/api/compatible-starts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timezone: timezoneEl.value,
        start_time: startTimeEl.value,
        demo: demoModeEl.checked,
        custom_date: customDateEl.value || "",
        queue_time_override: queueTimeEl.value || "",
        timing_mode: getTimingMode(),
        drop_mode: getDropPlanMode(),
        target_final_delay_ms: finalMs,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");

    compatibleStartsPanel.hidden = false;
    compatibleStartsHint.textContent =
      `${data.options.length} start time(s) work with ${formatMs(finalMs)} final delay (${dropPlanLabel(data.drop_mode)}). Tap Use to apply.`;

    if (!data.options.length) {
      compatibleStartsList.innerHTML =
        '<li class="placeholder">No compatible starts — try another final delay or earlier queue date.</li>';
      return;
    }

    const currentStart = startTimeEl.value;
    compatibleStartsList.innerHTML = data.options.map(opt => {
      const optStart = `${pad2(opt.start_h)}:${pad2(opt.start_m)}:${pad2(opt.start_s)}`;
      const isSelected = currentStart === optStart && parseInt(initialDelayEl.value, 10) === opt.start_delay_ms;
      return `
        <li class="${isSelected ? "selected" : ""}">
          <strong>${opt.start_time_display}</strong>
          <span>${opt.start_window_label}</span>
          <span>Start ${opt.start_delay_label}</span>
          <span>Drop ${opt.drop_minutes_label}</span>
          <span>Final ${opt.final_delay_label}</span>
          <button type="button" data-start="${optStart}" data-delay="${opt.start_delay_ms}">Use</button>
        </li>`;
    }).join("");

    compatibleStartsList.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        startTimeEl.value = btn.dataset.start;
        initialDelayEl.value = btn.dataset.delay;
        loadCompatibleStarts();
        if (!demoModeEl.checked) runOptimize();
      });
    });
  } catch (err) {
    compatibleStartsPanel.hidden = false;
    compatibleStartsHint.textContent = err.message;
    compatibleStartsList.innerHTML = "";
  }
}

async function syncCustomTimesToTimezone() {
  try {
    const res = await fetch(`/api/queue-defaults?timezone=${encodeURIComponent(timezoneEl.value)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    customDateEl.value = data.custom_date;
    queueTimeEl.value = data.queue_time;
    startTimeEl.value = data.start_time;
    const hint = document.getElementById("queue_time_hint");
    if (hint) hint.textContent = `(Walmart queue · ${data.timezone})`;
  } catch (_) {
    // Keep existing values if the request fails.
  }
}

async function loadPresets() {
  presetGridEl.innerHTML = '<div class="preset-loading">Computing schedules…</div>';
  if (lateDropGridEl) lateDropGridEl.innerHTML = '<div class="preset-loading">Computing last-min plans…</div>';
  try {
    const params = new URLSearchParams({
      timezone: timezoneEl.value,
      timing_mode: getTimingMode(),
    });
    const res = await fetch(`/api/preset-schedules?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    if (data.timing_mode) setTimingMode(data.timing_mode);
    renderPresets(data);
    schedulePresetsRefresh(data.queue_ts_ms);
  } catch (err) {
    presetGridEl.innerHTML = `<p class="placeholder">${err.message}</p>`;
  }
}

// Auto-refresh preset cards after queue goes live (new Wednesday loads automatically)
let _presetsRefreshTimer = null;
function schedulePresetsRefresh(queueTsMs) {
  if (_presetsRefreshTimer) clearTimeout(_presetsRefreshTimer);
  const msUntilLive = queueTsMs - Date.now();
  if (msUntilLive > 0) {
    // Reload 5 seconds after queue goes live — new Wednesday will be computed
    _presetsRefreshTimer = setTimeout(() => loadPresets(), msUntilLive + 5000);
  }
}

// ── Custom optimizer ──────────────────────────────────────────────────────────

function showError(message) {
  resultsPanelEl.hidden = false;
  verificationEl.className = "verification bad";
  verificationEl.textContent = message;
  summaryEl.innerHTML = "";
  if (twoStepCardsEl) twoStepCardsEl.innerHTML = "";
  dropTableBody.innerHTML = "";
  finalRefreshesEl.innerHTML = "";
}

function renderResults(data) {
  resultsPanelEl.hidden = false;
  resultsPanelEl.scrollIntoView({ behavior: "smooth", block: "start" });

  verificationEl.className = data.hits_target_exactly ? "verification ok" : "verification bad";
  verificationEl.textContent = data.hits_target_exactly
    ? "Verified — refresh hits queue go-live exactly"
    : "Warning — last refresh may not align exactly";

  summaryEl.innerHTML = `
    <div><span>Schedule</span><span>${data.mode === "demo" ? "Demo test" : data.mode === "custom" ? "Custom date" : "Live · Wednesday 8 PM"}</span></div>
    <div><span>Drop plan</span><span>${dropPlanLabel(data.drop_mode || getDropPlanMode())}</span></div>
    <div><span>Final delay</span><span>${data.final_delay_ms ? formatMs(data.final_delay_ms) : "Auto"}</span></div>
    <div><span>Timing</span><span>${timingModeLabel(data.timing_mode || "instant")}</span></div>
    <div><span>Timezone</span><span>${data.timezone}</span></div>
    <div><span>Queue live</span><span>${data.queue_live}</span></div>
    <div><span>Start</span><span>${data.start_time}</span></div>
  `;

  const s1 = data.drop_schedule[0];
  const s2 = data.drop_schedule[1];
  const isDeferred = data.timing_mode === "deferred";

  if (s1 && s2) {
    twoStepCardsEl.innerHTML = `
      <div class="step-card start-card">
        <div class="step-num">1</div>
        <div class="step-body">
          <strong>Start your task</strong>
          <p class="sc-time">START NOW</p>
          <p>Set delay to <span class="highlight">${s1.delay_label}</span></p>
          <small>${s1.refreshes_until_next} refreshes until the drop</small>
        </div>
      </div>
      <div class="step-card drop-card" id="custom-drop-card">
        <div class="step-num">2</div>
        <div class="step-body">
          <strong>Drop delay once</strong>
          <p class="sc-time">${s2.at} &nbsp;·&nbsp; ${s2.minutes_before} before queue</p>
          <p>Change delay to <span class="highlight">${s2.delay_label}</span></p>
          ${isDeferred && s2.effective_switch_at
            ? `<small class="pc-effective-switch">Final delay active at ${s2.effective_switch_at}</small>`
            : ""}
          <small>${s2.refreshes_until_next} refreshes → queue live</small>
          <div class="custom-alert-area" id="custom-alert-area">
            <button class="custom-alert-btn" id="custom-alert-btn" type="button">Use This Custom Plan</button>
          </div>
        </div>
      </div>
    `;

    let alertStep = 0;
    const alertBtn = document.getElementById("custom-alert-btn");
    const alertArea = document.getElementById("custom-alert-area");

    alertBtn.addEventListener("click", () => {
      if (alertStep === 0) {
        alertStep = 1;
        alertBtn.textContent = "Send Live Alerts";
        alertBtn.classList.add("custom-alert-btn-ready");
      } else {
        const customPlan = {
          label: "Custom Plan",
          start_delay_label: s1.delay_label,
          final_delay_label: s2.delay_label,
          start_time_display: s1.at,
          drop_time_display: s2.at,
          queue_time_display: data.queue_live,
          start_ts_ms: s1.at_ts_ms,
          drop_ts_ms: s2.at_ts_ms,
          queue_ts_ms: data.queue_ts_ms || data.drop_schedule.at(-1)?.at_ts_ms || 0,
          timing_mode: data.timing_mode || "instant",
          effective_switch_time_display: s2.effective_switch_at || s2.at,
        };
        showNameInput({
          anchorEl: alertArea,
          defaultName: defaultName(),
          onActivate: name => {
            PM.activate(name, customPlan);
            alertBtn.textContent = "✓ Alerts Active";
            alertBtn.classList.add("custom-alert-btn-active");
            alertBtn.disabled = true;
          },
        });
      }
    });
  }

  dropTableBody.innerHTML = data.drop_schedule.map((step) => `
    <tr class="${step.is_start ? "start-row" : "drop-row"}">
      <td>${step.is_start ? "1 · Start" : "2 · Drop once"}</td>
      <td>${step.is_start ? "START NOW" : step.at}</td>
      <td>${step.minutes_before} before</td>
      <td>${step.delay_label}</td>
    </tr>`).join("");

  finalRefreshesEl.innerHTML = data.final_refreshes.map(r =>
    `<li class="${r.is_queue_live ? "live" : ""}">${r.time}${r.is_queue_live ? " ← QUEUE LIVE" : ""}</li>`
  ).join("");
}

async function runOptimize(opts = {}) {
  optimizeBtn.disabled = true;
  optimizeBtn.textContent = "Optimizing…";
  const useLive = Boolean(opts.live);
  try {
    const payload = {
        timezone: timezoneEl.value,
        start_time: startTimeEl.value,
        initial_delay_ms: parseInt(initialDelayEl.value, 10),
        demo: demoModeEl.checked,
        live: useLive,
        custom_date: useLive ? "" : (customDateEl.value || ""),
        queue_time_override: queueTimeEl.value || "",
        timing_mode: getTimingMode(),
        drop_mode: getDropPlanMode(),
      };
    const targetFinal = opts.final_delay_ms ?? getTargetFinalDelayPayload();
    if (targetFinal) payload.target_final_delay_ms = targetFinal;
    if (opts.switch_minutes_before != null) {
      payload.switch_minutes_before = opts.switch_minutes_before;
    }

    const res = await fetch("/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    renderResults(data);
  } catch (err) {
    showError(err.message);
  } finally {
    optimizeBtn.disabled = false;
    optimizeBtn.textContent = "Queue Optimize";
  }
}

// ── Events ────────────────────────────────────────────────────────────────────

delayPresetEl.addEventListener("change", () => {
  if (delayPresetEl.value) initialDelayEl.value = delayPresetEl.value;
});

timezoneEl.addEventListener("change", () => {
  syncCustomTimesToTimezone();
  loadPresets();
  loadCompatibleStarts();
  resultsPanelEl.hidden = true;
});

[startTimeEl, customDateEl, queueTimeEl, initialDelayEl].forEach(el => {
  if (!el) return;
  el.addEventListener("change", () => loadCompatibleStarts());
});

optimizeBtn.addEventListener("click", () => {
  if (demoModeEl.checked) {
    const params = new URLSearchParams({
      timezone: timezoneEl.value,
      delay: String(parseInt(initialDelayEl.value, 10) || 60000),
      timing_mode: getTimingMode(),
    });
    window.location.href = `/demo-live?${params.toString()}`;
    return;
  }
  runOptimize();
});

demoModeEl.addEventListener("change", () => {
  optimizeBtn.textContent = demoModeEl.checked ? "Launch Live Demo" : "Queue Optimize";
});

// ── Init ──────────────────────────────────────────────────────────────────────

function formatDateLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function nextWednesday() {
  const now = new Date();
  const daysUntilWed = (3 - now.getDay() + 7) % 7 || 7;
  const wed = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilWed);
  return formatDateLocal(wed);
}

customDateEl.value = nextWednesday();

setDropPlanMode("last_min");
populateTargetFinalDelaySelect();

nextWedBtn.addEventListener("click", async () => {
  await syncCustomTimesToTimezone();
  loadCompatibleStarts();
});

syncCustomTimesToTimezone();
loadPresets();
loadCompatibleStarts();

// ── Update checking ─────────────────────────────────────────────────────────
// Desktop app: polls the pywebview bridge; when the new build finishes
// downloading it shows "close & reopen to update".
// Browser: falls back to the /api/version endpoint with a download link.

// The banner is ONLY shown when an update is genuinely ready to apply.
function showUpdateBanner({ version, downloadUrl, canAutoApply }) {
  const banner = document.getElementById("update-banner");
  const link = document.getElementById("ub-link");
  const textEl = banner.querySelector(".ub-text");

  if (canAutoApply) {
    textEl.innerHTML =
      `🔄 Update <strong>v${version}</strong> ready — close the app and it will reopen updated`;
    link.textContent = "Close & Update Now";
    link.href = "#";
    link.onclick = (e) => {
      e.preventDefault();
      try { window.pywebview && window.close(); } catch (_) {}
    };
  } else {
    // Browser fallback: can't auto-apply, offer manual download
    textEl.innerHTML = `🔄 Update <strong>v${version}</strong> available`;
    link.textContent = "Download →";
    link.href = downloadUrl;
    link.target = "_blank";
  }

  banner.hidden = false;
  document.getElementById("ub-dismiss").onclick = () => { banner.hidden = true; };
}

async function checkUpdatesDesktop() {
  // Poll the Python bridge. Only reveal the banner once the new build is
  // fully downloaded (staged), so we never show a half-ready state.
  const poll = async () => {
    try {
      const st = await window.pywebview.api.update_status();
      if (st && st.update_available && st.staged) {
        showUpdateBanner({ version: st.latest, canAutoApply: true });
        return; // ready — stop polling
      }
    } catch (_) {}
    setTimeout(poll, 20000);
  };
  poll();
}

async function checkUpdatesBrowser() {
  try {
    const res = await fetch("/api/version");
    const data = await res.json();
    if (data.update_available) {
      showUpdateBanner({
        version: data.latest,
        downloadUrl: data.download_url,
        canAutoApply: false,
      });
    }
  } catch (_) {}
}

// pywebview injects window.pywebview asynchronously — wait briefly for it
setTimeout(() => {
  if (window.pywebview && window.pywebview.api && window.pywebview.api.update_status) {
    checkUpdatesDesktop();
  } else {
    checkUpdatesBrowser();
  }
}, 1200);
