# Walmart Queue Delay Scheduler

**Two delays only** — one when you start your task, one drop before queue live. Simple for your team, accurate to the second at **8:00 PM**.

## How it works

1. **Start delay** — set when you begin (1 hr before, 1.5 hrs before, etc.)
2. **One drop** — change delay once at the exact time shown (e.g. 10 min before queue)
3. **Queue live** — final refresh hits **8:00:00 PM** exactly

No more switching 3–4 times in the final minutes.

## Web UI

```bash
pip install -r requirements.txt
python3 app.py
```

Open **http://localhost:5000**

- Enter **start time** and **starting delay**
- Click **Queue Optimize**
- Get exactly **2 steps**: when to start, when to drop once, and what delays to use

**Live demo:** http://localhost:5000/demo-live

## Example (start 1 hour early)

| Step | When | Delay |
|------|------|-------|
| **1. Start** | 7:00 PM (60 min before) | 60,000 ms |
| **2. Drop once** | 7:50 PM (10 min before) | 5,000 ms |

Final refresh: **8:00:00 PM** ✓

## CLI

```bash
python3 cli.py --start 19:00 --delay 60000 --timezone CDT
python3 cli.py --start 18:30 --delay 60000   # 1.5 hours early
```

## Tests

```bash
python3 -m unittest test_scheduler.py -v
```
