# Queue-System

Delay planning utility for queue-open timing simulation.

## What this does

`queue_delay_planner.py` helps you plan **when to change refresh delay values** so your polling cadence is aligned with a target queue-open time (for example, `08:00:00` Central).

It is a timing calculator only. It does not perform browser automation.

## Quick start

```bash
python queue_delay_planner.py \
  --queue-date 2026-07-08 \
  --queue-time 08:00:00 \
  --start-time 07:20:00 \
  --timezone America/Chicago \
  --profile conservative
```

## Example output fields

- `Recommended delay at start`: delay to use when you begin.
- `Delay drop plan`: each row shows:
  - `minutes_before`: the intended threshold before queue-open
  - `ideal_drop`: exact clock time for that threshold
  - `aligned_drop`: adjusted clock time that aligns to whole delay ticks
  - `offset`: difference between ideal and aligned drop time
  - `ticks_to_open`: number of refresh intervals from aligned drop to open
- `Upcoming delay changes`: exact moments to switch delay values.

## Built-in profiles

- `conservative`: `60:10000,20:7000,10:4000,3:1500`
- `balanced`: `60:8000,20:5000,10:3000,3:1200`
- `aggressive`: `60:6000,20:3500,10:2000,3:900`

Format is `<minutes_before>:<delay_ms>`.

You can override with a custom phase list:

```bash
python queue_delay_planner.py \
  --queue-date 2026-07-08 \
  --start-time 07:15:00 \
  --phases "90:12000,30:7000,8:2500,3:1500,1:800"
```

## Notes

- No delay strategy can guarantee avoiding rate limits or blocks.
- Start with conservative intervals and adjust slowly based on observed behavior.
