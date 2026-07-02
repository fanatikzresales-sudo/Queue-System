# Walmart Queue Timer

A React web app that calculates the exact timing and delays for synchronizing an automation tool with Walmart's Wednesday Pokemon card queue (8:00 AM Central Time).

## What It Does

When running an automation that refreshes a Walmart product page at a set interval (e.g., every 1,500ms), you need **one of those refreshes to land exactly at 8:00:00 AM CT** when the queue opens.

This tool calculates:

1. **Alignment times** — The exact moments you can switch to a given delay so that your refresh cycle hits the queue at precisely 8:00:00 AM.
2. **Multi-stage schedules** — A full timeline: start safe/slow (e.g., 10s delay) to avoid proxy bans, then progressively drop to faster delays, switching at calculated alignment points.
3. **Live dashboard** — Real-time display of what delay you should be using RIGHT NOW, countdown to queue, and an alignment indicator.

## The Math

For a delay `D` ms and queue time `Q`, your automation will refresh at times:

```
T, T+D, T+2D, T+3D, ...
```

For a refresh to land **exactly** on `Q`, you need:

```
(Q - T) mod D = 0
```

So valid start times are `Q - D`, `Q - 2D`, `Q - 3D`, etc. The tool filters these to find "nice" times (whole minutes, half-minutes) that are practical to target.

**Example with 1,500ms final delay:**
- `7:57:00 AM` → `(8:00:00 - 7:57:00) = 180,000ms` → `180,000 / 1,500 = 120 cycles` ✓
- Switch to 1,500ms at exactly 7:57:00 AM → refresh #120 fires at exactly 8:00:00.000 AM

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Usage

1. **Queue Time** — Default is 8:00 AM CT (Walmart Pokemon Wednesday).
2. **Start Time** — When you plan to launch the automation (e.g., 7:30 AM).
3. **Delay Stages** — Configure 1–5 stages from slow → fast. Stage 1 runs first (proxy-safe), the last stage must align with the queue.
4. **Recommended Schedule** — Shows exact switch times for each stage.
5. **Alignment Tables** — All valid switch times for each delay, highlighted with recommendations.
6. **Live Dashboard** — Shows current recommended delay, countdown, and alignment status in real-time.

## Tech Stack

- React + Vite
- Tailwind CSS v4
