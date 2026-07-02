#!/usr/bin/env python3
"""Web UI for Walmart queue delay scheduling."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta

from flask import Flask, jsonify, render_template, request

from scheduler import (
    DEFAULT_QUEUE_HOUR,
    LIVE_DEMO_INITIAL_DELAY_MS,
    LIVE_DEMO_MINUTES,
    TIMEZONE_LABELS,
    TIMEZONES,
    best_delay_for_demo,
    build_schedule,
    create_demo_target,
    get_timezone,
    next_walmart_queue_time,
    preset_schedules,
    recommended_start_delays,
    schedule_to_dict,
    schedule_to_live_demo,
)


def _resource_path(relative: str) -> str:
    """Absolute path — works in dev and inside a PyInstaller bundle."""
    if hasattr(sys, "_MEIPASS"):
        return os.path.join(sys._MEIPASS, relative)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), relative)


app = Flask(
    __name__,
    template_folder=_resource_path("templates"),
    static_folder=_resource_path("static"),
)


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
    # User enters a time in their local timezone, so build start in that tz
    target_local = target.astimezone(tz)
    start = target_local.replace(hour=hour, minute=minute, second=second, microsecond=0)
    if start >= target_local:
        if demo:
            start = datetime.now(tz).replace(microsecond=0)
            if start >= target_local:
                start = target_local - timedelta(minutes=3)
        else:
            raise ValueError("Start time must be before queue go-live.")
    return start


@app.route("/demo-live")
def demo_live():
    return render_template("demo_live.html", timezones=TIMEZONE_LABELS)


@app.route("/api/demo-live", methods=["GET"])
def demo_live_api():
    tz_key = (request.args.get("timezone") or "CDT").upper()
    if tz_key not in TIMEZONES:
        return jsonify({"error": f"Unknown timezone. Choose: {', '.join(TIMEZONES)}"}), 400

    # Accept optional final_delay hint from preset cards
    try:
        requested_final = int(request.args.get("final_delay", 0)) or None
    except (TypeError, ValueError):
        requested_final = None

    # Auto-size the start delay to fit the 3-minute demo window,
    # while trying to preserve the preset's final delay for authenticity.
    demo_start_delay, demo_final_delay = best_delay_for_demo(
        demo_minutes=LIVE_DEMO_MINUTES,
        target_final_delay_ms=requested_final,
    )

    tz = get_timezone(tz_key)
    now = datetime.now(tz).replace(microsecond=0)
    target = create_demo_target(minutes_from_now=LIVE_DEMO_MINUTES, now=now, tz_key=tz_key)
    start = now

    try:
        schedule = build_schedule(
            target=target,
            start=start,
            tz_key=tz_key,
            initial_delay_ms=demo_start_delay,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(
        {
            "mode": "live_demo",
            "demo_duration_minutes": LIVE_DEMO_MINUTES,
            "initial_delay_ms": demo_start_delay,
            "final_delay_ms": demo_final_delay,
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


@app.route("/api/preset-schedules", methods=["GET"])
def preset_schedules_api():
    tz_key = (request.args.get("timezone") or "CDT").upper()
    if tz_key not in TIMEZONES:
        return jsonify({"error": f"Unknown timezone. Choose: {', '.join(TIMEZONES)}"}), 400
    target = next_walmart_queue_time(tz_key=tz_key)
    plans = preset_schedules(target=target, tz_key=tz_key)
    return jsonify(
        {
            "queue_live": target.strftime("%I:%M %p").lstrip("0")
            + f" {target.tzname()} — Wednesday {target.strftime('%B %d')}",
            "plans": [
                {
                    "label": p.label,
                    "description": p.description,
                    "minutes_early": p.minutes_early,
                    "start_window_label": p.start_window_label,
                    "start_delay_ms": p.start_delay_ms,
                    "start_delay_label": p.start_delay_label,
                    "start_time_display": p.start_time_display,
                    "drop_time_display": p.drop_time_display,
                    "drop_minutes_before": p.drop_minutes_before,
                    "drop_minutes_label": p.drop_minutes_label,
                    "final_delay_ms": p.final_delay_ms,
                    "final_delay_label": p.final_delay_label,
                    "queue_time_display": p.queue_time_display,
                    "refreshes_phase1": p.refreshes_phase1,
                    "refreshes_phase2": p.refreshes_phase2,
                    "verified": p.verified,
                    "start_h": p.start_h,
                    "start_m": p.start_m,
                    "start_s": p.start_s,
                    "start_ts_ms": p.start_ts_ms,
                    "drop_ts_ms": p.drop_ts_ms,
                    "queue_ts_ms": p.queue_ts_ms,
                }
                for p in plans
            ],
        }
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
