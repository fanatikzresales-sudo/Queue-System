# Walmart Queue Delay Calculator

A timing tool for Walmart Wednesday Pokemon queue drops. It tells you **what refresh delay (in milliseconds) to set in your automation** and **when to lower it** so your page refresh lands exactly when the queue goes live at **8:00 AM Central Time**.

## Why this exists

Walmart's queue system opens at a fixed time (typically 8:00 AM CT on Wednesdays). If your bot refreshes too fast, your proxy gets banned. If it refreshes at the wrong interval, you miss the exact second the queue opens.

This calculator solves both problems:

1. **Start with a long delay** (e.g. 10,000 ms = 10 seconds) to stay under the radar early.
2. **Step down at specific checkpoints** (45 min, 30 min, 15 min, 10 min, 3 min, etc. before 8:00).
3. **Land exactly on 8:00:00** with math-aligned delays like 1,500 ms in the final minutes.

## Quick start

```bash
python3 queue_calculator.py
```

Uses the current Central time and targets the next Wednesday at 8:00 AM.

### Examples

**Full hour before drop (start at 7:00 AM):**
```bash
python3 queue_calculator.py --now "7:00" --target "8:00" --start-delay 10000
```

**Three minutes before drop (the critical window):**
```bash
python3 queue_calculator.py --now "7:57" --target "8:00" --start-delay 10000
```

Output includes:
```
>> IMMEDIATE: set delay to 1,500 ms now (120 refreshes until 8:00)
...
At 3 min before (07:57:00 AM CT): set delay to 1,500 ms
...
#120  08:00:00 AM CT  delay 1,500ms <-- QUEUE LIVE
```

**Custom starting delay:**
```bash
python3 queue_calculator.py --start-delay 15000 --min-delay 1000 --max-delay 20000
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--now` | Current time | When you start automation (e.g. `"7:30"`) |
| `--target` | Next Wed 8:00 AM CT | Queue go-live time |
| `--start-delay` | `10000` | Initial refresh delay in ms |
| `--min-delay` | `500` | Shortest allowed delay |
| `--max-delay` | `30000` | Longest allowed delay |
| `--checkpoints` | `60,45,30,...,0.25` | Minutes-before values to evaluate |

## How the math works

If you switch to delay `D` at time `T`, refreshes happen at `T + D`, `T + 2D`, `T + 3D`, ...

For an exact hit at 8:00:00:

```
T + (N × D) = 8:00:00
D = time_remaining ÷ N
```

**Example — 3 minutes before (7:57 AM):**
- Time remaining = 180,000 ms
- 120 refreshes × 1,500 ms = 180,000 ms → hits 8:00:00 exactly

The tool shows two tiers at each checkpoint:

- **SAFE** — longer delay, fewer requests (better for proxies)
- **PRECISE** — shorter delay, guaranteed 8:00:00 alignment

## Typical workflow

1. Start automation **30–60 minutes before 8:00** with `--start-delay 10000`.
2. Follow the **PRECISE TIER SCHEDULE** in the output — set each delay at the listed Central time.
3. In the final 3 minutes, drop to **1,500 ms** (or whatever the tool recommends for your start time).
4. Confirm the simulated timeline shows `08:00:00 AM CT <-- QUEUE LIVE`.

## Requirements

- Python 3.9+ (uses built-in `zoneinfo` for Central Time / DST)
