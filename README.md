# Walmart Wednesday Queue — Delay Planner

A timing sandbox for the Walmart Wednesday Pokémon queue that opens at **8:00 AM
Central Time**. It answers the exact question you have when arming a refresh
bot on a SKU:

> "What refresh delays do I set, and at what point before 8:00 do I drop them,
> so that a refresh fires at the *exact* second the queue goes live — without
> hammering fast enough to get the proxy banned?"

It does **not** touch Walmart. It's a planner plus a local mock queue you can
point a real bot at to validate timing.

## What it does

1. **Finds the next go-live** — the next Wednesday at 8:00:00 AM Central
   (DST-correct, no dependencies).
2. **Plans a phase schedule** — you define "phases" (a delay that activates at a
   given time before go-live). Slow/big delays early keep the proxy safe; the
   schedule speeds up as 8:00 approaches.
3. **Auto-aligns the final delay** — it back-solves the last phase's delay so
   that a refresh lands on **8:00:00.000**, instead of a few hundred ms early or
   late. It tells you the practical delay (in ms) to enter and how many
   refreshes happen in that final window.
4. **Flags ban risk** — every phase shows requests/minute and a safe / caution /
   danger rating, plus the worst-case burst for the whole run.
5. **Dry-runs against a mock queue** — replays the whole schedule against a fake
   Walmart queue with ban simulation to confirm you'd (a) make the queue and
   (b) not get banned.

## Run it

```bash
npm start           # serves the dashboard at http://localhost:3000
npm test            # runs the planner + mock-queue test suite
```

Open `http://localhost:3000`, pick a preset (Conservative / Balanced /
Aggressive) or edit the phases, then **Calculate schedule** and **Dry-run vs
mock queue**.

## The core idea (how the "drops" are computed)

At any instant the bot is some amount of time *before* go-live (the "offset").
The active phase is the innermost one whose start-window still contains that
offset, and the bot waits that phase's delay before refreshing again.

Because the outer (slow) phases fully determine when the bot first crosses into
the final window, the offset at that moment is fixed regardless of the final
delay. So we solve:

```
finalDelay = offsetEnteringFinalWindow / n
```

for the integer number of refreshes `n` whose resulting delay is closest to
what you asked for while staying inside your min/max bounds. That makes the last
refresh land on offset `0` — i.e. exactly 8:00:00.

## Example (Balanced preset)

| At (T-minus) | Clock (CT)   | Set delay to | Req/min | Risk    |
| ------------ | ------------ | ------------ | ------- | ------- |
| T-15:00      | 7:45:00 AM   | 10,000 ms    | 6       | safe    |
| T-3:00       | 7:57:00 AM   | 3,000 ms     | 20      | safe    |
| T-0:30       | 7:59:30 AM   | 1,500 ms     | 40      | caution |

Result: closest refresh at **8:00:00.000 CT** — exact.

## API

| Method | Path                                | Purpose                                             |
| ------ | ----------------------------------- | --------------------------------------------------- |
| GET    | `/api/next-golive`                  | Next Wednesday 8:00 AM CT (epoch + label)           |
| GET    | `/api/presets`                      | Built-in phase presets                              |
| GET/POST | `/api/plan`                       | Compute the drop schedule for a config              |
| POST   | `/api/dry-run`                      | Compute plan **and** replay it against a mock queue |
| POST   | `/api/mock/config`                  | Reset the live mock queue (go-live + ban rules)     |
| GET    | `/api/mock/refresh?proxy=ID`        | One refresh (point a real bot here)                 |
| GET    | `/api/mock/report`                  | Per-proxy stats (made queue? banned? req/min)       |
| POST   | `/api/mock/reset`                   | Clear the live mock queue                           |

### Point a real bot at the mock queue

Set your automation's target URL to:

```
GET http://localhost:3000/api/mock/refresh?proxy=YOUR_PROXY_ID
```

Each response tells you `waiting_room`, `queue_open`, or `ban_triggered`, plus
the T-minus of that hit. `GET /api/mock/report` then shows whether each proxy
made the queue and whether it got banned — so you can validate your bot's real
timing behavior end to end.

## Config shape (for `/api/plan` and `/api/dry-run`)

```json
{
  "preset": "balanced",
  "autoAlignFinal": true,
  "finalDelayMinMs": 500,
  "finalDelayMaxMs": 4000,
  "banPerMinWarn": 40,
  "banPerMinDanger": 60,
  "phases": [
    { "label": "Warm-up", "startBeforeMs": 900000, "delayMs": 10000 },
    { "label": "Ramp",    "startBeforeMs": 180000, "delayMs": 3000 },
    { "label": "Final",   "startBeforeMs": 30000,  "delayMs": 1500 }
  ]
}
```

## Notes

- Times are always computed in America/Chicago, including daylight-saving
  transitions, so "8:00 AM Central" is correct year-round.
- This is a modeling/validation tool. Respect the target site's terms of
  service; nothing here bypasses or contacts any real system.
