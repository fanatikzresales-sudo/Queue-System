const timezoneEl = document.getElementById("timezone");
const restartBtn = document.getElementById("restart_btn");
const countdownEl = document.getElementById("countdown");
const queueTimeEl = document.getElementById("queue_time");
const progressBarEl = document.getElementById("progress_bar");
const statusLineEl = document.getElementById("status_line");
const currentDelayEl = document.getElementById("current_delay");
const nextRefreshInEl = document.getElementById("next_refresh_in");
const refreshCountEl = document.getElementById("refresh_count");
const verificationEl = document.getElementById("verification");
const eventFeedEl = document.getElementById("event_feed");
const dropTableBody = document.querySelector("#drop_table tbody");
const refreshTimelineEl = document.getElementById("refresh_timeline");

const urlParams = new URLSearchParams(window.location.search);

let demo = null;
let tickTimer = null;
let clockOffset = 0;
let firedRefreshIdx = new Set();
let firedDropIdx = new Set();
let refreshTotal = 0;

function nowTs() {
  return Date.now() + clockOffset;
}

function formatMs(ms) {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min (${ms.toLocaleString()} ms)`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} sec (${ms.toLocaleString()} ms)`;
  return `${ms} ms`;
}

function formatCountdown(ms) {
  if (ms <= 0) return "00:00";
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatClockFromTs(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function addEvent(type, message, ts) {
  const el = document.createElement("div");
  el.className = `event ${type}`;
  el.innerHTML = `<time>${formatClockFromTs(ts)}</time>${message}`;
  eventFeedEl.prepend(el);
  const placeholder = eventFeedEl.querySelector(".placeholder");
  if (placeholder) placeholder.remove();
}

function getCurrentStep(atTs) {
  if (!demo) return null;
  let current = demo.drop_schedule[0];
  for (const step of demo.drop_schedule) {
    if (step.at_ts <= atTs) current = step;
    else break;
  }
  return current;
}

function getNextRefreshTs(atTs) {
  if (!demo) return null;
  const upcoming = demo.all_refreshes.filter((r) => r.ts > atTs);
  return upcoming.length ? upcoming[0].ts : null;
}

function tick() {
  if (!demo) return;
  const ts = nowTs();

  demo.drop_schedule.forEach((step, idx) => {
    if (!firedDropIdx.has(idx) && ts >= step.at_ts) {
      firedDropIdx.add(idx);
      const row = dropTableBody.rows[idx];
      if (row) {
        row.classList.add("drop-done");
        row.cells[2].textContent = idx === 0 ? "Started" : "Dropped";
      }
      if (idx === 0) {
        addEvent("drop", `Bot started with delay <strong>${formatMs(step.delay_ms)}</strong>`, step.at_ts);
      } else {
        addEvent("drop", `Delay dropped to <strong>${formatMs(step.delay_ms)}</strong>`, step.at_ts);
      }
    }
  });

  demo.all_refreshes.forEach((refresh, idx) => {
    if (!firedRefreshIdx.has(idx) && ts >= refresh.ts) {
      firedRefreshIdx.add(idx);
      refreshTotal += 1;
      refreshCountEl.textContent = String(refreshTotal);

      const li = refreshTimelineEl.children[idx];
      if (li) li.classList.add("fired");

      if (refresh.is_queue_live) {
        li?.classList.add("queue-live");
        addEvent("queue-live", "QUEUE LIVE — refresh fired exactly on time!", refresh.ts);
        countdownEl.textContent = "LIVE!";
        countdownEl.className = "countdown-value live-now";
        statusLineEl.textContent = "Queue is live. Demo complete.";
        verificationEl.textContent = demo.hits_target_exactly ? "Exact hit ✓" : "Missed ✗";
        verificationEl.className = demo.hits_target_exactly ? "state-value ok" : "state-value bad";
        clearInterval(tickTimer);
      } else {
        const step = getCurrentStep(refresh.ts);
        addEvent(
          "refresh",
          `Page refreshed <span style="color:var(--muted)">(delay: ${formatMs(step?.delay_ms || 0)})</span>`,
          refresh.ts
        );
      }
    }
  });

  const remaining = demo.target_ts - ts;
  const elapsed = ts - demo.start_ts;
  const total = demo.target_ts - demo.start_ts;
  const pct = total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 100;
  progressBarEl.style.width = `${pct}%`;

  if (remaining > 0) {
    countdownEl.textContent = formatCountdown(remaining);
    countdownEl.className = remaining <= 30000 ? "countdown-value urgent" : "countdown-value";
    statusLineEl.textContent = `Simulation running — ${Math.ceil(remaining / 1000)}s until queue goes live`;
  }

  const currentStep = getCurrentStep(ts);
  if (currentStep) {
    currentDelayEl.textContent = formatMs(currentStep.delay_ms);
    const nextRefreshTs = getNextRefreshTs(ts);
    if (nextRefreshTs && remaining > 0) {
      nextRefreshInEl.textContent = `${Math.max(0, (nextRefreshTs - ts) / 1000).toFixed(1)}s`;
    } else if (remaining <= 0) {
      nextRefreshInEl.textContent = "—";
    }
  }

  dropTableBody.querySelectorAll("tr").forEach((r) => r.classList.remove("drop-active"));
  const nextDropIdx = demo.drop_schedule.findIndex((s, idx) => !firedDropIdx.has(idx) && s.at_ts > ts);
  if (nextDropIdx >= 0 && remaining > 0) {
    dropTableBody.rows[nextDropIdx]?.classList.add("drop-active");
  }
}

function renderStatic(data) {
  queueTimeEl.textContent = `Queue goes live at ${data.queue_live}`;
  verificationEl.textContent = data.hits_target_exactly ? "Scheduled ✓" : "May miss";
  verificationEl.className = data.hits_target_exactly ? "state-value ok" : "state-value bad";

  dropTableBody.innerHTML = data.drop_schedule
    .map(
      (step) => `
      <tr>
        <td>${step.is_start ? "START NOW" : step.at}</td>
        <td>${step.delay_label}</td>
        <td>Pending</td>
      </tr>`
    )
    .join("");

  refreshTimelineEl.innerHTML = data.all_refreshes
    .map(
      (r) =>
        `<li class="${r.is_queue_live ? "queue-live" : ""}">${r.time}${r.is_queue_live ? " ← LIVE" : ""}</li>`
    )
    .join("");
}

function applyUrlParams() {
  const tz = urlParams.get("timezone");
  const delay = urlParams.get("delay");
  const label = urlParams.get("label");

  if (tz && timezoneEl.querySelector(`option[value="${tz}"]`)) {
    timezoneEl.value = tz;
  }

  // Show which plan is being demoed
  const ctxEl = document.getElementById("plan_context");
  if (ctxEl) {
    if (label) {
      const delayLabel = delay
        ? (+delay >= 60000
          ? `${(+delay / 60000).toFixed(1)} min (${(+delay).toLocaleString()} ms)`
          : `${(+delay / 1000).toFixed(1)} sec (${(+delay).toLocaleString()} ms)`)
        : "";
      ctxEl.innerHTML =
        `Testing plan: <strong>${label}</strong>` +
        (delayLabel ? ` &nbsp;·&nbsp; Starting delay: <strong>${delayLabel}</strong>` : "");
      ctxEl.hidden = false;
    } else {
      ctxEl.hidden = true;
    }
  }

  return { tz, delay };
}

async function startDemo() {
  if (tickTimer) clearInterval(tickTimer);
  firedRefreshIdx = new Set();
  firedDropIdx = new Set();
  refreshTotal = 0;
  refreshCountEl.textContent = "0";
  eventFeedEl.innerHTML = '<div class="event placeholder">Loading demo schedule…</div>';
  countdownEl.textContent = "--:--";
  countdownEl.className = "countdown-value";
  progressBarEl.style.width = "0%";
  statusLineEl.textContent = "Fetching schedule from server…";
  currentDelayEl.textContent = "—";
  nextRefreshInEl.textContent = "—";
  verificationEl.textContent = "Waiting…";
  verificationEl.className = "state-value pending";

  const { delay } = applyUrlParams();
  const params = new URLSearchParams({ timezone: timezoneEl.value });
  if (delay) params.set("delay", delay);

  try {
    const res = await fetch(`/api/demo-live?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load demo");

    demo = data;
    clockOffset = data.server_now_ts - Date.now();

    renderStatic(data);

    addEvent(
      "drop",
      `Live demo started — queue goes live in <strong>${data.demo_duration_minutes} minutes</strong>`,
      nowTs()
    );
    addEvent(
      "refresh",
      `Starting delay: <strong>${formatMs(data.drop_schedule[0].delay_ms)}</strong> — watch refreshes fire below`,
      nowTs()
    );

    tickTimer = setInterval(tick, 100);
    tick();
  } catch (err) {
    eventFeedEl.innerHTML = `<div class="event placeholder">${err.message}</div>`;
    statusLineEl.textContent = "Demo failed to start.";
  }
}

restartBtn.addEventListener("click", startDemo);
timezoneEl.addEventListener("change", startDemo);

applyUrlParams();
startDemo();
