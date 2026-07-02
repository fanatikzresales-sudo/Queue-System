const timezoneEl = document.getElementById("timezone");
const startTimeEl = document.getElementById("start_time");
const initialDelayEl = document.getElementById("initial_delay_ms");
const delayPresetEl = document.getElementById("delay_preset");
const demoModeEl = document.getElementById("demo_mode");
const optimizeBtn = document.getElementById("optimize_btn");
const refreshStartersBtn = document.getElementById("refresh_starters_btn");
const starterListEl = document.getElementById("starter_list");
const resultsPanelEl = document.getElementById("results_panel");
const verificationEl = document.getElementById("verification");
const summaryEl = document.getElementById("summary");
const dropTableBody = document.querySelector("#drop_table tbody");
const finalRefreshesEl = document.getElementById("final_refreshes");
const twoStepCardsEl = document.getElementById("two_step_cards");

function payload() {
  return {
    timezone: timezoneEl.value,
    start_time: startTimeEl.value,
    initial_delay_ms: parseInt(initialDelayEl.value, 10),
    demo: demoModeEl.checked,
  };
}

function showError(message) {
  resultsPanelEl.hidden = false;
  verificationEl.className = "verification bad";
  verificationEl.textContent = message;
  summaryEl.innerHTML = "";
  dropTableBody.innerHTML = "";
  finalRefreshesEl.innerHTML = "";
  if (twoStepCardsEl) twoStepCardsEl.innerHTML = "";
}

function formatMs(ms) {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min (${ms.toLocaleString()} ms)`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} sec (${ms.toLocaleString()} ms)`;
  return `${ms} ms`;
}

function renderStarters(options) {
  if (!options.length) {
    starterListEl.innerHTML = '<p class="placeholder">No starter delays fit this window.</p>';
    return;
  }

  starterListEl.innerHTML = options
    .map(
      (o) => `
      <div class="starter-item ${o.aligns_to_queue ? "aligned" : ""}" data-delay="${o.delay_ms}">
        <span class="delay-value">${formatMs(o.delay_ms)}</span>
        <span class="delay-desc">${o.label.split("—")[1]?.trim() || o.label}</span>
      </div>`
    )
    .join("");

  starterListEl.querySelectorAll(".starter-item").forEach((el) => {
    el.addEventListener("click", () => {
      initialDelayEl.value = el.dataset.delay;
    });
  });
}

function renderResults(data) {
  resultsPanelEl.hidden = false;

  verificationEl.className = data.hits_target_exactly ? "verification ok" : "verification bad";
  verificationEl.textContent = data.hits_target_exactly
    ? "Verified — refresh hits queue go-live exactly"
    : "Warning — last refresh may not align exactly";

  const startStep = data.drop_schedule[0];
  const dropStep = data.drop_schedule[1];

  summaryEl.innerHTML = `
    <div><span>Mode</span><span>${data.mode === "demo" ? "Demo test" : "Live (Wednesday 8 PM)"}</span></div>
    <div><span>Timezone</span><span>${data.timezone}</span></div>
    <div><span>Queue goes live</span><span>${data.queue_live}</span></div>
    <div><span>Your start</span><span>${data.start_time}</span></div>
  `;

  if (startStep && dropStep) {
    twoStepCardsEl.innerHTML = `
      <div class="step-card start-card">
        <div class="step-num">1</div>
        <div class="step-body">
          <strong>Start your task</strong>
          <p>At <span class="highlight">${startStep.at.replace(/,.*/, "")}</span> set delay to
          <span class="highlight">${startStep.delay_label}</span></p>
          <small>${startStep.refreshes_until_next} refreshes until the drop</small>
        </div>
      </div>
      <div class="step-card drop-card">
        <div class="step-num">2</div>
        <div class="step-body">
          <strong>Drop once — ${dropStep.minutes_before} before queue</strong>
          <p>At <span class="highlight">${dropStep.at}</span> change delay to
          <span class="highlight">${dropStep.delay_label}</span></p>
          <small>${dropStep.refreshes_until_next} refreshes until queue goes live</small>
        </div>
      </div>
    `;
  }

  dropTableBody.innerHTML = data.drop_schedule
    .map(
      (step, i) => `
      <tr class="${step.is_start ? "start-row" : "drop-row"}">
        <td>${step.is_start ? "Start" : "Drop once"}</td>
        <td>${step.is_start ? "START NOW" : step.at}</td>
        <td>${step.minutes_before} before</td>
        <td>${step.delay_label}</td>
      </tr>`
    )
    .join("");

  finalRefreshesEl.innerHTML = data.final_refreshes
    .map(
      (r) =>
        `<li class="${r.is_queue_live ? "live" : ""}">${r.time}${
          r.is_queue_live ? " ← QUEUE LIVE" : ""
        }</li>`
    )
    .join("");

  if (data.starter_options) {
    renderStarters(data.starter_options);
  }
}

async function fetchStarters() {
  try {
    const res = await fetch("/api/starter-delays", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    renderStarters(data.options);
  } catch (err) {
    starterListEl.innerHTML = `<p class="placeholder">${err.message}</p>`;
  }
}

async function optimize() {
  if (demoModeEl.checked) {
    const params = new URLSearchParams({
      timezone: timezoneEl.value,
      delay: String(parseInt(initialDelayEl.value, 10) || 60000),
    });
    window.location.href = `/demo-live?${params.toString()}`;
    return;
  }

  optimizeBtn.disabled = true;
  optimizeBtn.textContent = "Optimizing…";
  try {
    const res = await fetch("/api/optimize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload()),
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

delayPresetEl.addEventListener("change", () => {
  if (delayPresetEl.value) {
    initialDelayEl.value = delayPresetEl.value;
  }
});

optimizeBtn.addEventListener("click", optimize);
refreshStartersBtn.addEventListener("click", fetchStarters);

demoModeEl.addEventListener("change", () => {
  if (demoModeEl.checked) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    startTimeEl.value = `${hh}:${mm}:${ss}`;
    optimizeBtn.textContent = "Launch Live Demo";
  } else {
    startTimeEl.value = "19:00";
    optimizeBtn.textContent = "Queue Optimize";
  }
  fetchStarters();
});

fetchStarters();
