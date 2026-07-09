#!/usr/bin/env python3
"""Web UI for Walmart queue delay scheduling."""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.request
from datetime import datetime, timedelta

from flask import Flask, jsonify, render_template, request

from version import APP_VERSION, GITHUB_REPO, RELEASES_URL
from scheduler import (
    DEFAULT_QUEUE_HOUR,
    LIVE_DEMO_INITIAL_DELAY_MS,
    LIVE_DEMO_MINUTES,
    TIMEZONE_LABELS,
    TIMEZONES,
    best_delay_for_demo,
    build_demo_from_preset,
    build_schedule,
    create_demo_target,
    find_compatible_custom_starts,
    get_timezone,
    next_walmart_queue_time,
    parse_drop_plan_mode,
    parse_timing_mode,
    preset_schedules,
    preset_schedules_late_drop,
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

# ── Auto-update checker ────────────────────────────────────────────────────────

_update_cache: dict = {"latest": None, "download_url": RELEASES_URL}
_update_lock = threading.Lock()


def _fetch_latest_version() -> None:
    """Background thread: poll GitHub releases API every hour."""
    while True:
        try:
            url = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
            req = urllib.request.Request(
                url, headers={"User-Agent": "FRQueueOptimizer"}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
            with _update_lock:
                _update_cache["latest"] = data.get("tag_name", "").lstrip("v")
                _update_cache["download_url"] = data.get("html_url", RELEASES_URL)
        except Exception:
            pass  # Silently ignore — no internet, rate limit, etc.
        time.sleep(3600)


threading.Thread(target=_fetch_latest_version, daemon=True).start()


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


@app.after_request
def _no_cache(response):
    """Prevent the embedded webview from serving stale JS/CSS after an update."""
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.route("/api/version")
def version_api():
    with _update_lock:
        latest = _update_cache.get("latest")
        download_url = _update_cache.get("download_url", RELEASES_URL)

    update_available = False
    if latest:
        try:
            cur = [int(x) for x in APP_VERSION.split(".")]
            lat = [int(x) for x in latest.split(".")]
            update_available = lat > cur
        except ValueError:
            pass

    return jsonify({
        "current": APP_VERSION,
        "latest": latest,
        "update_available": update_available,
        "download_url": download_url,
    })


@app.route("/demo-live")
def demo_live():
    return render_template("demo_live.html", timezones=TIMEZONE_LABELS, app_version=APP_VERSION)


def _parse_optional_int(value) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def _parse_optional_float(value) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


@app.route("/api/demo-live", methods=["GET"])
def demo_live_api():
    tz_key = (request.args.get("timezone") or "CDT").upper()
    if tz_key not in TIMEZONES:
        return jsonify({"error": f"Unknown timezone. Choose: {', '.join(TIMEZONES)}"}), 400

    try:
        timing_mode = parse_timing_mode(request.args.get("timing_mode"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    requested_start = _parse_optional_int(request.args.get("start_delay"))
    requested_final = _parse_optional_int(request.args.get("final_delay"))
    switch_minutes_before = _parse_optional_float(request.args.get("switch_minutes_before"))
    preset_label = (request.args.get("label") or "").strip()

    tz = get_timezone(tz_key)
    now = datetime.now(tz).replace(microsecond=0)
    target = create_demo_target(minutes_from_now=LIVE_DEMO_MINUTES, now=now, tz_key=tz_key)
    start = now

    try:
        if requested_start and requested_final:
            schedule, demo_duration = build_demo_from_preset(
                start_delay_ms=requested_start,
                final_delay_ms=requested_final,
                switch_minutes_before=switch_minutes_before,
                timing_mode=timing_mode,
                tz_key=tz_key,
                now=now,
            )
            demo_start_delay = schedule.steps[0].delay_ms
            demo_final_delay = schedule.steps[1].delay_ms
            from_preset = True
        else:
            demo_duration = LIVE_DEMO_MINUTES
            demo_start_delay, demo_final_delay = best_delay_for_demo(
                demo_minutes=demo_duration,
                target_final_delay_ms=requested_final,
            )
            schedule = build_schedule(
                target=target,
                start=start,
                tz_key=tz_key,
                initial_delay_ms=demo_start_delay,
                target_final_delay_ms=demo_final_delay if requested_final else None,
                timing_mode=timing_mode,
            )
            from_preset = False
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(
        {
            "mode": "live_demo",
            "timing_mode": timing_mode.value,
            "demo_duration_minutes": demo_duration,
            "initial_delay_ms": demo_start_delay,
            "final_delay_ms": demo_final_delay,
            "from_preset": from_preset,
            "preset_label": preset_label or None,
            **schedule_to_live_demo(schedule),
        }
    )


def _plan_to_json(p):
    return {
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
        "timing_mode": p.timing_mode,
        "effective_switch_ts_ms": p.effective_switch_ts_ms,
        "effective_switch_time_display": p.effective_switch_time_display,
        "switch_minutes_before": p.switch_minutes_before,
        "preset_category": p.preset_category,
        "drop_mode": p.drop_mode,
    }


def _resolve_optimize_target(data, tz_key):
    demo = bool(data.get("demo", False))
    custom_date = (data.get("custom_date") or "").strip()
    queue_time_override = (data.get("queue_time_override") or "").strip()

    if demo:
        return create_demo_target(minutes_from_now=5.0, tz_key=tz_key), "demo"

    if custom_date:
        tz = get_timezone(tz_key)
        central = get_timezone("CDT")
        try:
            date_parsed = datetime.strptime(custom_date, "%Y-%m-%d")
        except ValueError:
            raise ValueError("Invalid date. Use YYYY-MM-DD format.")

        if queue_time_override:
            try:
                parts = queue_time_override.split(":")
                q_hour, q_min = int(parts[0]), int(parts[1])
                q_second = int(parts[2]) if len(parts) > 2 else 0
            except (ValueError, IndexError):
                raise ValueError("Invalid queue time.")
        else:
            q_hour, q_min, q_second = DEFAULT_QUEUE_HOUR, 0, 0

        target = date_parsed.replace(
            hour=q_hour, minute=q_min, second=q_second, microsecond=0, tzinfo=central
        )
        return target, "custom"

    return next_walmart_queue_time(tz_key=tz_key), "live"


@app.route("/")
def index():
    return render_template(
        "index.html",
        timezones=TIMEZONE_LABELS,
        default_tz="CDT",
        default_queue_hour=DEFAULT_QUEUE_HOUR,
        starter_delays=[120000, 90000, 60000, 45000, 30000, 20000, 15000, 10000, 5000],
        app_version=APP_VERSION,
    )


@app.route("/api/queue-defaults", methods=["GET"])
def queue_defaults_api():
    """Return queue/start times in the user's selected timezone."""
    tz_key = (request.args.get("timezone") or "CDT").upper()
    if tz_key not in TIMEZONES:
        return jsonify({"error": f"Unknown timezone. Choose: {', '.join(TIMEZONES)}"}), 400

    tz = get_timezone(tz_key)
    target = next_walmart_queue_time(tz_key=tz_key)
    target_local = target.astimezone(tz)
    start_suggest = target_local - timedelta(hours=1)

    return jsonify(
        {
            "timezone": tz_key,
            "custom_date": target_local.strftime("%Y-%m-%d"),
            "queue_time": target_local.strftime("%H:%M"),
            "start_time": start_suggest.strftime("%H:%M"),
            "queue_live": target_local.strftime("%I:%M %p").lstrip("0")
            + f" {target_local.tzname()} — Wednesday {target_local.strftime('%B %d, %Y')}",
        }
    )


@app.route("/api/preset-schedules", methods=["GET"])
def preset_schedules_api():
    tz_key = (request.args.get("timezone") or "CDT").upper()
    if tz_key not in TIMEZONES:
        return jsonify({"error": f"Unknown timezone. Choose: {', '.join(TIMEZONES)}"}), 400
    try:
        timing_mode = parse_timing_mode(request.args.get("timing_mode"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    tz = get_timezone(tz_key)
    target = next_walmart_queue_time(tz_key=tz_key)
    target_local = target.astimezone(tz)          # convert to display timezone
    plans = preset_schedules(target=target, tz_key=tz_key, timing_mode=timing_mode)
    late_plans = preset_schedules_late_drop(target=target, tz_key=tz_key, timing_mode=timing_mode)
    return jsonify(
        {
            "timing_mode": timing_mode.value,
            "queue_live": target_local.strftime("%I:%M %p").lstrip("0")
            + f" {target_local.tzname()} — Wednesday {target_local.strftime('%B %d, %Y')}",
            "queue_ts_ms": int(target.timestamp() * 1000),
            "plans": [_plan_to_json(p) for p in plans],
            "late_drop_plans": [_plan_to_json(p) for p in late_plans],
        }
    )


@app.route("/api/optimize", methods=["POST"])
def optimize():
    data = request.get_json(force=True)
    tz_key = (data.get("timezone") or "CDT").upper()
    start_time = data.get("start_time", "")
    initial_delay_ms = int(data.get("initial_delay_ms", 60000))
    live = bool(data.get("live", False))

    try:
        timing_mode = parse_timing_mode(data.get("timing_mode"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    try:
        drop_mode = parse_drop_plan_mode(data.get("drop_mode"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if tz_key not in TIMEZONES:
        return jsonify({"error": f"Unknown timezone. Choose: {', '.join(TIMEZONES)}"}), 400

    target_final_raw = data.get("target_final_delay_ms")
    if target_final_raw in (None, "", "auto"):
        target_final_delay_ms = _parse_optional_int(data.get("final_delay_ms"))
    else:
        try:
            target_final_delay_ms = int(target_final_raw)
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid target_final_delay_ms."}), 400

    switch_minutes_before = _parse_optional_float(data.get("switch_minutes_before"))

    try:
        target, mode = _resolve_optimize_target(data, tz_key)
        start = _resolve_start(start_time, target, tz_key, demo=bool(data.get("demo", False)))
        schedule = build_schedule(
            target=target,
            start=start,
            tz_key=tz_key,
            initial_delay_ms=initial_delay_ms,
            timing_mode=timing_mode,
            target_final_delay_ms=target_final_delay_ms,
            switch_minutes_before=switch_minutes_before,
            drop_mode=drop_mode,
        )
        return jsonify({
            "mode": mode,
            "timing_mode": timing_mode.value,
            "drop_mode": drop_mode.value,
            "target_final_delay_ms": schedule.steps[-1].delay_ms if len(schedule.steps) > 1 else None,
            **schedule_to_dict(schedule),
        })
    except (ValueError, TypeError) as exc:
        return jsonify({"error": str(exc)}), 400


@app.route("/api/compatible-starts", methods=["POST"])
def compatible_starts_api():
    data = request.get_json(force=True)
    tz_key = (data.get("timezone") or "CDT").upper()
    start_time = data.get("start_time", "")
    target_final_delay_ms = int(data.get("target_final_delay_ms", 0))

    try:
        timing_mode = parse_timing_mode(data.get("timing_mode"))
        drop_mode = parse_drop_plan_mode(data.get("drop_mode"))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if tz_key not in TIMEZONES:
        return jsonify({"error": f"Unknown timezone. Choose: {', '.join(TIMEZONES)}"}), 400
    if target_final_delay_ms <= 0:
        return jsonify({"error": "target_final_delay_ms is required."}), 400

    try:
        target, _mode = _resolve_optimize_target(data, tz_key)
        options = find_compatible_custom_starts(
            target=target,
            tz_key=tz_key,
            target_final_delay_ms=target_final_delay_ms,
            timing_mode=timing_mode,
            drop_mode=drop_mode,
            switch_minutes_before=_parse_optional_float(data.get("switch_minutes_before")),
        )
        selected = None
        if start_time:
            try:
                selected_start = _resolve_start(
                    start_time, target, tz_key, demo=bool(data.get("demo", False))
                )
                sel_local = selected_start.astimezone(get_timezone(tz_key))
                for opt in options:
                    if (
                        opt.start_h == sel_local.hour
                        and opt.start_m == sel_local.minute
                        and opt.start_s == sel_local.second
                    ):
                        selected = {
                            "start_h": opt.start_h,
                            "start_m": opt.start_m,
                            "start_s": opt.start_s,
                            "start_delay_ms": opt.start_delay_ms,
                            "start_time_display": opt.start_time_display,
                            "drop_minutes_label": opt.drop_minutes_label,
                            "final_delay_label": opt.final_delay_label,
                        }
                        break
            except ValueError:
                selected = None

        return jsonify({
            "target_final_delay_ms": target_final_delay_ms,
            "drop_mode": drop_mode.value,
            "options": [
                {
                    "start_time_display": o.start_time_display,
                    "start_h": o.start_h,
                    "start_m": o.start_m,
                    "start_s": o.start_s,
                    "start_window_label": o.start_window_label,
                    "minutes_early": o.minutes_early,
                    "start_delay_ms": o.start_delay_ms,
                    "start_delay_label": o.start_delay_label,
                    "drop_minutes_label": o.drop_minutes_label,
                    "final_delay_ms": o.final_delay_ms,
                    "final_delay_label": o.final_delay_label,
                    "switch_minutes_before": o.switch_minutes_before,
                    "refreshes_phase1": o.refreshes_phase1,
                    "refreshes_phase2": o.refreshes_phase2,
                }
                for o in options
            ],
            "selected_match": selected,
        })
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
