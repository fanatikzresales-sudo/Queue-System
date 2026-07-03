# Walmart Queue Optimizer

Two delays only — one when you start, one drop before queue live — so your whole team hits **8:00 PM Wednesday** exactly.

---

## Download & Run (No coding needed)

### Windows
1. **Download** `WalmartQueueOptimizer.exe` from the [Releases page](../../releases)
2. **Double-click** it
3. Your browser opens automatically at `http://127.0.0.1:5000`
4. Close the window to stop

### Mac
1. **Download** `WalmartQueueOptimizer.app.zip` from the [Releases page](../../releases)
2. **Unzip** and drag `WalmartQueueOptimizer.app` to your Applications folder
3. **Right-click → Open** the first time (to bypass Gatekeeper)
4. Your browser opens automatically
5. Quit from the menu bar or close the terminal

> **First time on Mac?** macOS may say "unidentified developer." Right-click the app → Open → Open anyway.

---

## How it works

Your automation refreshes a Walmart SKU page every N milliseconds. The optimizer gives you exactly **two delays**:

| Step | Action |
|------|--------|
| **1. Start your task** | Set delay to the starting value shown |
| **2. Drop once** | At the exact clock time shown, change to the final delay |
| **Queue live** | Next refresh hits **8:00:00 PM** exactly ✓ |

---

## Preset Plans (main page)

The app pre-computes the best plan for each common final delay:

| Plan | Start | Start Delay | Drop at | Final Delay |
|------|-------|-------------|---------|-------------|
| Drop to 5,000 ms | 6:00 PM (2 hrs early) | 2 min | 7:50 PM | **5,000 ms** |
| Drop to 3,000 ms | 6:30 PM (1.5 hrs early) | 2 min | 7:50 PM | **3,000 ms** |
| Drop to 2,000 ms | 7:00 PM (1 hr early) | 2 min | 7:50 PM | **2,000 ms** |
| Drop to 1,500 ms | 7:00 PM (1 hr early) | 2 min | 7:50 PM | **1,500 ms** |
| Drop to 1,000 ms | 7:15 PM (45 min early) | 2 min | 7:49 PM | **1,000 ms** |

Click **▶ Watch Demo** on any card to run a live 3-minute simulation and verify it lands on queue time exactly.

---

## Build from source

### Requirements
- Python 3.9+
- `pip install -r requirements.txt`

### Run directly (no build needed)
```bash
python3 main.py
```

### Build Windows .exe (run on Windows)
```bat
build_windows.bat
```
Output: `dist\WalmartQueueOptimizer.exe`

### Build Mac .app (run on Mac)
```bash
bash build_mac.sh
```
Output: `dist/WalmartQueueOptimizer.app`

### CLI (advanced)
```bash
python3 cli.py --start 19:00 --delay 60000 --timezone CDT
python3 cli.py --demo --delay 30000
```

---

## Files

| File | Purpose |
|------|---------|
| `main.py` | Desktop launcher (starts server + opens browser) |
| `app.py` | Flask web server |
| `scheduler.py` | Core delay math |
| `templates/` | Web UI pages |
| `static/` | CSS + JavaScript |
| `walmart_queue.spec` | PyInstaller build config |
| `build_windows.bat` | Windows build script |
| `build_mac.sh` | macOS build script |
| `cli.py` | Command-line interface |
| `test_scheduler.py` | Unit tests |

---

## Tests

```bash
python3 -m unittest test_scheduler.py -v
```
