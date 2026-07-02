# Queue Drop Timer

A local clone of the Walmart Wednesday Pokémon queue, plus a **refresh-delay planner** that
tells you exactly which delays to run and exactly when to drop them — so that when the queue
opens at 8:00 Central, one of your refreshes lands at **that exact second**.

No dependencies. Just Node.js (18+).

```bash
node server.js        # or: npm start
# open http://localhost:3000
```

```bash
npm test              # unit tests for the alignment + timezone math
```

## The problem this solves

Your automation refreshes a SKU page on a fixed delay (e.g. `10000` ms = every 10 seconds).
Two things fight each other:

1. **Refresh too fast for too long** → the proxy gets flagged/banned before the drop.
2. **Refresh too slow at the wrong moment** → the queue opens at 8:00:00 but your next
   refresh isn't until 8:00:07, and you join the line 7 seconds behind everyone else.

The fix is a **step-down schedule**: start slow and safe, then drop the delay in stages as
8:00 approaches. But there's a catch — a refresh only lands *exactly* at 8:00:00 if the time
between every delay change and go-live is an **exact multiple** of the delays in between.
Change your delay at a sloppy moment and the whole grid shifts off-target.

This tool does that math for you.

## What's inside

### 1 · Delay Planner

Enter the go-live date/time (Central), how early you want to start, your starting delay, and
your step-downs ("at T-10:00 drop to 5000 ms", "at T-2:00 drop to 1000 ms", ...). You get a
cheat sheet like:

```
7:29:40 PM CT  (T-30:20)  START automation with delay 10000 ms   [122 refreshes, 6/min]
7:50:00 PM CT  (T-10:00)  set delay to 5000 ms                   [60 refreshes, 12/min]
7:55:00 PM CT  (T-5:00)   set delay to 2000 ms                   [90 refreshes, 30/min]
7:58:00 PM CT  (T-2:00)   set delay to 1000 ms                   [90 refreshes, 60/min]
7:59:30 PM CT  (T-0:30)   set delay to 500 ms                    [60 refreshes, 120/min]
8:00:00 PM CT  (T-0)      QUEUE LIVE — refresh lands exactly here
```

The planner **snaps each switch time slightly earlier when needed** so every phase length is
an exact multiple of its delay — that's the alignment guarantee. It also shows total request
counts, requests-per-minute per phase, and flags phases that exceed your proxy risk
threshold.

### 2 · Live Assistant

A real-time dashboard for drop night: a countdown to go-live, the delay you should be running
*right now*, and the next change with its own countdown. It beeps at every change point so
you can keep your eyes on the automation program.

### 3 · Queue Simulator (the Walmart clone)

The server hosts a fake item page:

```
GET http://localhost:3000/api/queue/<sku>
```

- **Before go-live** → responds like a waiting room (`"state": "waiting_room"`).
- **At go-live** → the queue opens and each hit gets a queue **position in arrival order** —
  which is exactly why hitting 8:00:00.000 matters.
- **Every hit is logged with millisecond precision** and its offset from go-live.

Two ways to use it:

- **Virtual bot** — one click runs your exact delay plan (compressed into the next 2–5
  minutes) against the mock queue and reports how many milliseconds off the go-live refresh
  landed, and what queue position it got.
- **Dry-run your real automation** — point your actual program at the mock URL, set the mock
  go-live a few minutes out, and watch the hit log to see *exactly* when your refreshes
  landed relative to the queue opening.

## API reference (mock server)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/queue/<sku>` | Fake item page. Waiting room before go-live; queue position after. |
| `GET` | `/api/config` | Current mock go-live time and server clock. |
| `POST` | `/api/config` | `{ "goLiveEpochMs": 1234567890123 }` — move the mock go-live (clears hits). |
| `GET` | `/api/hits?sku=` | Millisecond-precision log of every hit and its offset from go-live. |
| `DELETE` | `/api/hits` | Clear the hit log and queue positions. |

## How the alignment math works

Working backwards from go-live `T`:

1. The final refresh is pinned at `T` (offset 0).
2. For each phase (nearest to `T` first), the requested switch time is rounded **up** to the
   nearest exact multiple of that phase's delay past the previous boundary. The phase then
   contains a whole number of refresh intervals, so the refresh grid passes through the
   boundary unbroken.
3. The start time itself is a grid point too — which is why the plan tells you the exact
   second to press start.

See `public/planner.js` (pure functions, unit-tested in `test/planner.test.mjs`).

## Notes

- All schedule math is done against **America/Chicago** (queue time), DST-aware, and the UI
  shows both Central and your local time.
- One machine-clock caveat: your PC's clock needs to be NTP-synced (Windows/macOS do this by
  default). If your clock is 2 seconds off, your "perfect" refresh is 2 seconds off.
- Proxy-ban thresholds vary wildly by provider and target. The req/min warnings use a
  threshold you set — they're guidance, not guarantees. The general shape that keeps proxies
  alive is exactly what the planner produces: long slow phases, short fast ones.
