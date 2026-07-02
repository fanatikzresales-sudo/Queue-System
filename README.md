# Walmart Queue Delay Scheduler

Calculate refresh delays for Walmart Pokemon queue automation so you start with **safe, high delays** (to protect proxies) and **step down at the right times** so a page refresh lands **exactly at 8:00:00 AM Central** when the queue goes live on Wednesdays.

## How it works

Your automation refreshes a SKU page every **N milliseconds**. This tool builds a schedule of when to change that delay:

1. **Start high** — e.g. 60,000 ms (1 minute) when you begin an hour early, so you are not hammering the site.
2. **Drop at checkpoints** — e.g. at 3 minutes before 8:00, switch to 1,500 ms.
3. **Align to 8:00** — each delay is chosen so refreshes land on exact boundaries, with the **final refresh at queue go-live**.

The math ensures `time_remaining % delay == 0` at each phase, so when 8:00 hits, the next refresh cycle catches it precisely.

## Quick start

Requires **Python 3.9+** (uses `zoneinfo` for Central Time).

```bash
# Start automation at 7:00 AM CT this Wednesday
python3 cli.py --start 7:00

# Start from right now until the next Wednesday queue
python3 cli.py

# Custom checkpoints (minutes before 8:00)
python3 cli.py --start 6:30 --milestones 90,60,30,15,5,3,1

# Specific queue date
python3 cli.py --target 2026-07-08 --start 7:00
```

## Example output

Starting at **7:00 AM CT** with queue live at **8:00 AM CT**:

| When | Set delay to |
|------|-------------|
| Start (60 min before) | 60,000 ms |
| 45 min before | 30,000 ms |
| 30 min before | 30,000 ms |
| 15 min before | 20,000 ms |
| 10 min before | 15,000 ms |
| 5 min before | 10,000 ms |
| **3 min before** | **1,500 ms** |
| 2 min before | 1,000 ms |
| 1 min before | 2,000 ms |
| 30 sec before | 1,500 ms |
| … | … |
| 5 sec before | 1,000 ms |

Final refresh: **08:00:00.000 CDT** ✓

## How to use with your automation

1. Run the scheduler before Wednesday with your planned start time.
2. Copy the **QUICK COPY** delay values into your bot config.
3. At each listed clock time, update the delay in your automation tool.
4. The tool verifies the last simulated refresh hits 8:00:00 exactly.

## Assumptions

- Queue goes live at **8:00:00 AM America/Chicago** on **Wednesdays**.
- Changing delay starts a new interval from that moment (next refresh after the new delay).
- Delays use common round values (500, 1000, 1500, 2000, … ms) when possible.

## Tests

```bash
python3 -m unittest test_scheduler.py -v
```

## Files

| File | Purpose |
|------|---------|
| `scheduler.py` | Core delay math and schedule builder |
| `cli.py` | Command-line interface |
| `test_scheduler.py` | Unit tests |
