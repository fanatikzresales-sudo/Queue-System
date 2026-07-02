// ── DOM refs ──────────────────────────────────────────────────────────────────
const timezoneEl     = document.getElementById("timezone");
const demoModeEl     = document.getElementById("demo_mode");
const demoLiveLink   = document.getElementById("demo_live_link");
const startTimeEl    = document.getElementById("start_time");
const initialDelayEl = document.getElementById("initial_delay_ms");
const delayPresetEl  = document.getElementById("delay_preset");
const optimizeBtn    = document.getElementById("optimize_btn");
const queueLiveLabel = document.getElementById("queue_live_label");
const presetGridEl   = document.getElementById("preset_grid");
const resultsPanelEl = document.getElementById("results_panel");
const verificationEl = document.getElementById("verification");
const summaryEl      = document.getElementById("summary");
const twoStepCardsEl = document.getElementById("two_step_cards");
const dropTableBody  = document.querySelector("#drop_table tbody");
const finalRefreshesEl = document.getElementById("final_refreshes");

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMs(ms) {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min (${ms.toLocaleString()} ms)`;
  if (ms >= 1000)  return `${(ms / 1000).toFixed(1)} sec (${ms.toLocaleString()} ms)`;
  return `${ms} ms`;
}

function pad2(n) { return String(n).padStart(2, "0"); }

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

// ── Notification Manager ──────────────────────────────────────────────────────

const NM = (() => {
  let timers = [];
  let activePopups = [];

  function clearAll() {
    timers.forEach(clearTimeout);
    timers = [];
    activePopups.forEach(p => p.remove());
    activePopups = [];
  }

  function _makePopup(id, content) {
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.id = id;
    el.className = "notif-popup";
    el.innerHTML = content;
    document.body.appendChild(el);
    activePopups.push(el);
    requestAnimationFrame(() => el.classList.add("notif-visible"));
    el.querySelector(".notif-close")?.addEventListener("click", () => {
      el.classList.remove("notif-visible");
      setTimeout(() => el.remove(), 300);
    });
    return el;
  }

  function showStartReminder(plan) {
    const msUntil = plan.start_ts_ms - Date.now();
    let countdownInterval;

    const pop = _makePopup("notif-start", `
      <div class="notif-header">
        <span class="notif-icon">🎯</span>
        <span class="notif-title">Plan Active — Reminders Set</span>
        <button class="notif-close">✕</button>
      </div>
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
        <span>Time until you need to start:</span>
        <span class="notif-countdown" id="notif-start-countdown">${formatCountdown(msUntil)}</span>
      </div>
      <button class="notif-close notif-close-btn">Close</button>
    `);

    if (msUntil > 0) {
      countdownInterval = setInterval(() => {
        const el = document.getElementById("notif-start-countdown");
        if (!el) { clearInterval(countdownInterval); return; }
        const remaining = plan.start_ts_ms - Date.now();
        el.textContent = remaining > 0 ? formatCountdown(remaining) : "Start now!";
        if (remaining <= 0) clearInterval(countdownInterval);
      }, 1000);
    }
  }

  function showDropReminder(plan) {
    const pop = _makePopup("notif-drop", `
      <div class="notif-header notif-header-urgent">
        <span class="notif-icon">⚡</span>
        <span class="notif-title">Drop Your Delay in 5 Minutes!</span>
        <button class="notif-close">✕</button>
      </div>
      <div class="notif-drop-body">
        <div class="notif-drop-time">At: <strong>${plan.drop_time_display}</strong></div>
        <div class="notif-drop-change">
          Change delay to:
          <span class="notif-drop-delay">${plan.final_delay_label}</span>
        </div>
        <div class="notif-drop-note">
          The next refresh after this drop hits <strong>${plan.queue_time_display}</strong> exactly.
        </div>
      </div>
      <button class="notif-close notif-close-btn notif-got-it">Got It</button>
    `);
    pop.classList.add("notif-urgent");
  }

  function schedule(plan) {
    clearAll();

    const now = Date.now();
    const msUntilStart = plan.start_ts_ms - now;
    const msUntilDropReminder = plan.drop_ts_ms - (5 * 60 * 1000) - now;

    // Always show the start overview popup immediately
    showStartReminder(plan);

    // Schedule the drop reminder
    if (msUntilDropReminder > 0) {
      timers.push(setTimeout(() => showDropReminder(plan), msUntilDropReminder));
    } else if (plan.drop_ts_ms - now > 0) {
      // Already within 5 min of drop — show immediately
      showDropReminder(plan);
    }

    // Also try native browser notification as a backup
    _tryNativeNotification(plan, msUntilStart, msUntilDropReminder);
  }

  function _tryNativeNotification(plan, msUntilStart, msUntilDropReminder) {
    if (!("Notification" in window)) return;
    Notification.requestPermission().then(perm => {
      if (perm !== "granted") return;
      const startMsg = msUntilStart > 0
        ? `Start in ${formatCountdown(msUntilStart)}: set delay to ${plan.start_delay_label}`
        : `Start now: set delay to ${plan.start_delay_label}`;
      new Notification("Walmart Queue Optimizer", { body: startMsg, tag: "wq-start" });

      if (msUntilDropReminder > 0) {
        timers.push(setTimeout(() => {
          new Notification("⚡ Drop your delay!", {
            body: `At ${plan.drop_time_display} — change to ${plan.final_delay_label}`,
            tag: "wq-drop",
          });
        }, msUntilDropReminder));
      }
    });
  }

  return { schedule, clearAll };
})();

// ── Preset cards ──────────────────────────────────────────────────────────────

function renderPresets(data) {
  queueLiveLabel.textContent = `Queue goes live: ${data.queue_live}`;

  if (!data.plans.length) {
    presetGridEl.innerHTML = '<p class="placeholder">No plans available.</p>';
    return;
  }

  presetGridEl.innerHTML = data.plans.map((p, i) => `
    <div class="preset-card" data-idx="${i}"
         data-start-h="${p.start_h}" data-start-m="${p.start_m}" data-start-s="${p.start_s}"
         data-delay="${p.start_delay_ms}">

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
            <div class="pc-step-title">Drop once — ${p.drop_minutes_label} before queue</div>
            <div class="pc-time">${p.drop_time_display}</div>
            <div class="pc-delay-chip final">${p.final_delay_label}</div>
            <div class="pc-sub">${p.refreshes_phase2} refreshes → queue live</div>
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
        <button class="pc-demo-btn" type="button">▶ Watch Demo</button>
      </div>
    </div>
  `).join("");

  presetGridEl.querySelectorAll(".preset-card").forEach((card) => {
    card.querySelector(".pc-select-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      selectPreset(card, data.plans);
    });
    card.querySelector(".pc-demo-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(card.dataset.idx, 10);
      const p = data.plans[idx];
      const params = new URLSearchParams({
        timezone: timezoneEl.value,
        final_delay: String(p.final_delay_ms),
        label: p.label,
      });
      window.open(`/demo-live?${params.toString()}`, "_blank");
    });
    card.addEventListener("click", (e) => {
      if (!e.target.closest("button")) selectPreset(card, data.plans);
    });
  });
}

function selectPreset(card, plans) {
  const idx = parseInt(card.dataset.idx, 10);
  const p = plans[idx];

  startTimeEl.value = `${pad2(p.start_h)}:${pad2(p.start_m)}:${pad2(p.start_s)}`;
  initialDelayEl.value = p.start_delay_ms;

  presetGridEl.querySelectorAll(".preset-card").forEach((c) => c.classList.remove("selected"));
  card.classList.add("selected");

  if (!demoModeEl.checked) {
    runOptimize();
    NM.schedule(p);
  }
}

async function loadPresets() {
  presetGridEl.innerHTML = '<div class="preset-loading">Computing schedules…</div>';
  try {
    const res = await fetch(`/api/preset-schedules?timezone=${encodeURIComponent(timezoneEl.value)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    renderPresets(data);
  } catch (err) {
    presetGridEl.innerHTML = `<p class="placeholder">${err.message}</p>`;
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
    <div><span>Mode</span><span>${data.mode === "demo" ? "Demo test" : "Live · Wednesday 8 PM"}</span></div>
    <div><span>Timezone</span><span>${data.timezone}</span></div>
    <div><span>Queue live</span><span>${data.queue_live}</span></div>
    <div><span>Start</span><span>${data.start_time}</span></div>
  `;

  const s1 = data.drop_schedule[0];
  const s2 = data.drop_schedule[1];

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
          <small>${s2.refreshes_until_next} refreshes → queue live</small>
        </div>
        <button class="custom-alert-btn" id="custom-alert-btn" type="button">Use This Custom Plan</button>
      </div>
    `;

    // Custom plan alert button: two-tap flow
    const alertBtn = document.getElementById("custom-alert-btn");
    let step = 0;
    alertBtn.addEventListener("click", () => {
      if (step === 0) {
        step = 1;
        alertBtn.textContent = "Send Live Alerts";
        alertBtn.classList.add("custom-alert-btn-ready");
      } else {
        // Build a plan-like object from the custom schedule
        const customPlan = {
          label: "Custom Plan",
          start_delay_label: s1.delay_label,
          final_delay_label: s2.delay_label,
          start_time_display: s1.at,
          drop_time_display: s2.at,
          queue_time_display: data.queue_live,
          start_ts_ms: s1.at_ts_ms,
          drop_ts_ms: s2.at_ts_ms,
          queue_ts_ms: data.drop_schedule[data.drop_schedule.length - 1]?.at_ts_ms || 0,
        };
        NM.schedule(customPlan);
        alertBtn.textContent = "✓ Alerts Active";
        alertBtn.classList.add("custom-alert-btn-active");
        alertBtn.disabled = true;
      }
    });
  }

  dropTableBody.innerHTML = data.drop_schedule.map((step, i) => `
    <tr class="${step.is_start ? "start-row" : "drop-row"}">
      <td>${step.is_start ? "1 · Start" : "2 · Drop once"}</td>
      <td>${step.is_start ? "START NOW" : step.at}</td>
      <td>${step.minutes_before} before</td>
      <td>${step.delay_label}</td>
    </tr>`).join("");

  finalRefreshesEl.innerHTML = data.final_refreshes.map((r) =>
    `<li class="${r.is_queue_live ? "live" : ""}">${r.time}${r.is_queue_live ? " ← QUEUE LIVE" : ""}</li>`
  ).join("");
}

async function runOptimize() {
  optimizeBtn.disabled = true;
  optimizeBtn.textContent = "Optimizing…";
  try {
    const res = await fetch("/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timezone: timezoneEl.value,
        start_time: startTimeEl.value,
        initial_delay_ms: parseInt(initialDelayEl.value, 10),
        demo: demoModeEl.checked,
      }),
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
  loadPresets();
  resultsPanelEl.hidden = true;
  NM.clearAll();
});

optimizeBtn.addEventListener("click", () => {
  if (demoModeEl.checked) {
    const params = new URLSearchParams({
      timezone: timezoneEl.value,
      delay: String(parseInt(initialDelayEl.value, 10) || 60000),
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
loadPresets();
