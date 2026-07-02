const timezoneEl   = document.getElementById("timezone");
const demoModeEl   = document.getElementById("demo_mode");
const demoLiveLink = document.getElementById("demo_live_link");
const startTimeEl  = document.getElementById("start_time");
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatMs(ms) {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min (${ms.toLocaleString()} ms)`;
  if (ms >= 1000)  return `${(ms / 1000).toFixed(1)} sec (${ms.toLocaleString()} ms)`;
  return `${ms} ms`;
}

function pad2(n) { return String(n).padStart(2, "0"); }

// ── Preset cards ─────────────────────────────────────────────────────────────

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
        <span class="pc-label">${p.label}</span>
        <span class="pc-badge ${p.verified ? "ok" : "warn"}">${p.verified ? "✓ Verified" : "Approx"}</span>
      </div>

      <div class="pc-flow">
        <!-- Step 1 -->
        <div class="pc-step pc-start">
          <div class="pc-step-num">1</div>
          <div class="pc-step-info">
            <div class="pc-step-title">Start your task</div>
            <div class="pc-time">${p.start_time_display}</div>
            <div class="pc-delay-chip">${p.start_delay_label}</div>
            <div class="pc-sub">${p.refreshes_phase1} refreshes until drop</div>
          </div>
        </div>

        <div class="pc-arrow">↓ run until drop time</div>

        <!-- Step 2 -->
        <div class="pc-step pc-drop">
          <div class="pc-step-num">2</div>
          <div class="pc-step-info">
            <div class="pc-step-title">Drop delay once — ${p.drop_minutes_label} before</div>
            <div class="pc-time">${p.drop_time_display}</div>
            <div class="pc-delay-chip final">${p.final_delay_label}</div>
            <div class="pc-sub">${p.refreshes_phase2} refreshes until queue live</div>
          </div>
        </div>

        <div class="pc-arrow">↓</div>

        <!-- Queue live -->
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
        delay: String(p.start_delay_ms),
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

  // Populate custom inputs with the plan values
  const h = pad2(card.dataset.startH || p.start_h);
  const m = pad2(card.dataset.startM || p.start_m);
  const s = pad2(card.dataset.startS || p.start_s);
  startTimeEl.value = `${h}:${m}:${s}`;
  initialDelayEl.value = p.start_delay_ms;

  // Highlight selected card
  presetGridEl.querySelectorAll(".preset-card").forEach((c) => c.classList.remove("selected"));
  card.classList.add("selected");

  // Run optimize automatically
  if (!demoModeEl.checked) runOptimize();
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
      <div class="step-card drop-card">
        <div class="step-num">2</div>
        <div class="step-body">
          <strong>Drop delay once</strong>
          <p class="sc-time">${s2.at} &nbsp;·&nbsp; ${s2.minutes_before} before queue</p>
          <p>Change delay to <span class="highlight">${s2.delay_label}</span></p>
          <small>${s2.refreshes_until_next} refreshes → queue live</small>
        </div>
      </div>
    `;
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
  // Only change the button label — never overwrite the user's start time
  if (demoModeEl.checked) {
    optimizeBtn.textContent = "Launch Live Demo";
  } else {
    optimizeBtn.textContent = "Queue Optimize";
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadPresets();
