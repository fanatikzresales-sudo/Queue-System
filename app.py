#!/usr/bin/env python3
"""Web UI for Walmart queue delay scheduling."""

from __future__ import annotations

from datetime import datetime, timedelta

from flask import Flask, jsonify, render_template, request

from scheduler import (
    DEFAULT_QUEUE_HOUR,
    LIVE_DEMO_INITIAL_DELAY_MS,
    LIVE_DEMO_MINUTES,
    TIMEZONE_LABELS,
    TIMEZONES,
    build_schedule,
    create_demo_target,
    get_timezone,
    next_walmart_queue_time,
    recommended_start_delays,
    schedule_to_dict,
    schedule_to_live_demo,
)

app = Flask(__name__)


def _parse_time(value: str) -> tuple[int, int, int]:
    parts = value.strip().split(":")
    if len(parts) not in (2, 3):
        raise ValueError("Use HH:MM or HH:MM:SS")
    hour = int(parts[0])
    minute = int(parts[1])
    second = int(parts[2]) if len(parts) == 3 else 0
    if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
        raise ValueError("Invalid time")
    return hour, minute, second


def _resolve_start(start_time: str, target, tz_key: str, demo: bool = False):
    tz = get_timezone(tz_key)
    hour, minute, second = _parse_time(start_time)
    start = target.replace(hour=hour, minute=minute, second=second, microsecond=0)
    if start >= target:
        if demo:
            start = datetime.now(tz).replace(microsecond=0)
            if start >= target:
                start = target - timedelta(minutes=3)
        else:
            raise ValueError("Start time must be before queue go-live (8:00 PM).")
    return start


@app.route("/demo-live")
def demo_live():
    return render_template("demo_live.html", timezones=TIMEZONE_LABELS)


@app.route("/api/demo-live", methods=["GET"])
def demo_live_api():
    tz_key = (request.args.get("timezone") or "CDT").upper()
    if tz_key not in TIMEZONES:
        return jsonify({"error": f"Unknown timezone. Choose: {', '.join(TIMEZONES)}"}), 400

    try:
        initial_delay_ms = int(request.args.get("delay", LIVE_DEMO_INITIAL_DELAY_MS))
    except (TypeError, ValueError):
        initial_delay_ms = LIVE_DEMO_INITIAL_DELAY_MS

    tz = get_timezone(tz_key)
    now = datetime.now(tz).replace(microsecond=0)
    target = create_demo_target(minutes_from_now=LIVE_DEMO_MINUTES, now=now, tz_key=tz_key)
    start = now

    schedule = build_schedule(
        target=target,
        start=start,
        tz_key=tz_key,
        initial_delay_ms=initial_delay_ms,
    )
    return jsonify(
        {
            "mode": "live_demo",
            "demo_duration_minutes": LIVE_DEMO_MINUTES,
            "initial_delay_ms": initial_delay_ms,
            **schedule_to_live_demo(schedule),
        }
    )


@app.route("/")
def index():
    return render_template(
        "index.html",
        timezones=TIMEZONE_LABELS,
        default_tz="CDT",
        default_queue_hour=DEFAULT_QUEUE_HOUR,
        starter_delays=[120000, 90000, 60000, 45000, 30000, 20000, 15000, 10000, 5000],
    )


@app.route("/api/optimize", methods=["POST"])
def optimize():
    data = request.get_json(force=True)
    tz_key = (data.get("timezone") or "CDT").upper()
    demo = bool(data.get("demo", False))
    start_time = data.get("start_time", "")
    initial_delay_ms = int(data.get("initial_delay_ms", 60000))

    if tz_key not in TIMEZONES:
        return jsonify({"error": f"Unknown timezone. Choose: {', '.join(TIMEZONES)}"}), 400

    try:
        if demo:
            target = create_demo_target(minutes_from_now=5.0, tz_key=tz_key)
        else:
            target = next_walmart_queue_time(tz_key=tz_key)

        start = _resolve_start(start_time, target, tz_key, demo=demo)
        schedule = build_schedule(
            target=target,
            start=start,
            tz_key=tz_key,
            initial_delay_ms=initial_delay_ms,
        )
        return jsonify(
            {
                "mode": "demo" if demo else "live",
                **schedule_to_dict(schedule),
            }
        )
    except (ValueError, TypeError) as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/starter-delays", methods=["POST"])
def starter_delays():
    data = request.get_json(force=True)
    tz_key = (data.get("timezone") or "CDT").upper()
    start_time = data.get("start_time", "")
    demo = bool(data.get("demo", False))

    try:
        if demo:
            target = create_demo_target(minutes_from_now=5.0, tz_key=tz_key)
        else:
            target = next_walmart_queue_time(tz_key=tz_key)

        start = _resolve_start(start_time, target, tz_key, demo=demo)
        options = recommended_start_delays(target=target, start=start, tz_key=tz_key)
        return jsonify(
            {
                "options": [
                    {
                        "delay_ms": o.delay_ms,
                        "aligns_to_queue": o.aligns_to_queue,
                        "refreshes_until_queue": o.refreshes_until_queue,
                        "label": o.label,
                    }
                    for o in options
                ]
            }
        )
    except (ValueError, TypeError) as exc:
        return jsonify({"error": str(exc)}), 400


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
