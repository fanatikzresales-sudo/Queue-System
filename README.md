# Walmart Queue Delay Scheduler

Calculate refresh delays for Walmart Pokemon queue automation so you start with **safe, high delays** (to protect proxies) and **step down at the right times** so a page refresh lands **exactly at 8:00:00 PM** when the queue goes live on Wednesdays.

## Web UI (recommended)

```bash
pip install -r requirements.txt
python3 app.py
```

Open **http://localhost:5000** in your browser.

### Web features

- **Timezone** — Central (CDT), Eastern (EST), or Pacific (PT)
- **Start Time** — when you begin your bot
- **Starting Delay** — the initial refresh interval in milliseconds
- **Recommended Starting Delays** — safe options that align with queue go-live
- **Queue Optimize** — shows exactly when to drop your delay and what to set it to
- **Demo Mode** — test the logic with a fake queue 5 minutes from now

## CLI

```bash
# Start at 7:00 PM with 60s delay (Central Time)
python3 cli.py --start 19:00 --delay 60000 --timezone CDT

# Eastern Time
python3 cli.py --start 19:00 --timezone EST

# Demo mode — verify alignment in 5 minutes
python3 cli.py --demo --delay 30000
```

## How it works

Your automation refreshes a SKU page every **N milliseconds**. This tool builds a schedule of when to change that delay:

1. **Start high** — e.g. 60,000 ms (1 minute) when you begin an hour early.
2. **Drop at checkpoints** — e.g. at 3 minutes before 8:00 PM, switch to 1,500 ms.
3. **Align to 8:00 PM** — each delay is chosen so refreshes land on exact boundaries, with the **final refresh at queue go-live**.

The math ensures `time_remaining % delay == 0` at each phase.

## Example (1 hour early, 60s start delay)

| When | Set delay to |
|------|-------------|
| Start (60 min before) | 60,000 ms |
| 45 min before | 30,000 ms |
| 3 min before | 1,500 ms |
| … | … |
| 5 sec before | 1,000 ms |

Final refresh: **08:00:00.000 PM** ✓

## Demo mode

Enable **Demo mode** in the web UI (or use `--demo` in CLI). The queue is set to go live **5 minutes from now** instead of Wednesday 8 PM. Use your current time as the start, pick a delay, hit **Queue Optimize**, and confirm the last refresh matches the demo queue time exactly.

## Tests

```bash
python3 -m unittest test_scheduler.py -v
```

## Files

| File | Purpose |
|------|---------|
| `scheduler.py` | Core delay math and schedule builder |
| `app.py` | Web UI (Flask) |
| `cli.py` | Command-line interface |
| `templates/index.html` | Web UI layout |
| `static/` | Web UI styles and JavaScript |
| `test_scheduler.py` | Unit tests |
