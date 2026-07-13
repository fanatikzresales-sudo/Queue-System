/**
 * In-process API — mirrors Flask routes for offline mobile use.
 */
(function (global) {
  'use strict';

  const S = () => global.QueueScheduler;
  const DT = () => global.luxon.DateTime;
  const APP_VERSION = '1.3.8';

  function parseTime(value) {
    const parts = String(value || '').trim().split(':');
    if (parts.length < 2 || parts.length > 3) throw new Error('Use HH:MM or HH:MM:SS');
    const hour = parseInt(parts[0], 10);
    const minute = parseInt(parts[1], 10);
    const second = parts.length === 3 ? parseInt(parts[2], 10) : 0;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
      throw new Error('Invalid time');
    }
    return { hour, minute, second };
  }

  function parseOptionalInt(value) {
    if (value === null || value === undefined || value === '') return null;
    return parseInt(value, 10);
  }

  function parseOptionalFloat(value) {
    if (value === null || value === undefined || value === '') return null;
    return parseFloat(value);
  }

  function resolveStart(startTime, target, tzKey, demo) {
    const sched = S();
    const tz = sched.get_timezone(tzKey);
    const { hour, minute, second } = parseTime(startTime);
    const targetLocal = target.setZone(tz);
    let start = targetLocal.set({ hour, minute, second, millisecond: 0 });
    if (start >= targetLocal) {
      if (demo) {
        start = DT().now().setZone(tz).startOf('second');
        if (start >= targetLocal) start = targetLocal.minus({ minutes: 3 });
      } else {
        throw new Error('Start time must be before queue go-live.');
      }
    }
    return start;
  }

  function planToJson(p) {
    return {
      label: p.label,
      description: p.description,
      minutes_early: p.minutes_early,
      start_window_label: p.start_window_label,
      start_delay_ms: p.start_delay_ms,
      start_delay_label: p.start_delay_label,
      start_time_display: p.start_time_display,
      drop_time_display: p.drop_time_display,
      drop_minutes_before: p.drop_minutes_before,
      drop_minutes_label: p.drop_minutes_label,
      final_delay_ms: p.final_delay_ms,
      final_delay_label: p.final_delay_label,
      queue_time_display: p.queue_time_display,
      refreshes_phase1: p.refreshes_phase1,
      refreshes_phase2: p.refreshes_phase2,
      verified: p.verified,
      start_h: p.start_h,
      start_m: p.start_m,
      start_s: p.start_s,
      start_ts_ms: p.start_ts_ms,
      drop_ts_ms: p.drop_ts_ms,
      queue_ts_ms: p.queue_ts_ms,
      timing_mode: p.timing_mode,
      effective_switch_ts_ms: p.effective_switch_ts_ms,
      effective_switch_time_display: p.effective_switch_time_display,
      switch_minutes_before: p.switch_minutes_before,
      preset_category: p.preset_category,
      drop_mode: p.drop_mode,
    };
  }

  function resolveOptimizeTarget(data, tzKey) {
    const sched = S();
    const demo = Boolean(data.demo);
    const customDate = (data.custom_date || '').trim();
    const queueTimeOverride = (data.queue_time_override || '').trim();

    if (demo) {
      return [sched.create_demo_target({ minutes_from_now: 5.0, tz_key: tzKey }), 'demo'];
    }

    if (customDate) {
      const tz = sched.get_timezone(tzKey);
      const dateParsed = DT().fromISO(customDate, { zone: tz });
      if (!dateParsed.isValid) {
        throw new Error('Invalid date. Use YYYY-MM-DD format.');
      }

      let qHour, qMin, qSecond;
      if (queueTimeOverride) {
        const p = parseTime(queueTimeOverride);
        qHour = p.hour;
        qMin = p.minute;
        qSecond = p.second;
      } else {
        const walmartTarget = sched.next_walmart_queue_time({ tz_key: tzKey });
        const qLocal = walmartTarget.setZone(tz);
        qHour = qLocal.hour;
        qMin = qLocal.minute;
        qSecond = qLocal.second;
      }

      const target = dateParsed.set({ hour: qHour, minute: qMin, second: qSecond, millisecond: 0 });
      return [target, 'custom'];
    }

    return [sched.next_walmart_queue_time({ tz_key: tzKey }), 'live'];
  }

  const handlers = {
    '/api/version': () => ({
      status: 200,
      body: {
        current: APP_VERSION,
        latest: APP_VERSION,
        update_available: false,
        download_url: 'https://github.com/fanatikzresales-sudo/Queue-System/releases/latest',
      },
    }),

    '/api/queue-defaults': (params) => {
      const sched = S();
      const tzKey = (params.get('timezone') || 'CDT').toUpperCase();
      if (!sched.TIMEZONES[tzKey]) {
        return { status: 400, body: { error: `Unknown timezone. Choose: ${Object.keys(sched.TIMEZONES).join(', ')}` } };
      }
      const tz = sched.get_timezone(tzKey);
      const target = sched.next_walmart_queue_time({ tz_key: tzKey });
      const targetLocal = target.setZone(tz);
      const startSuggest = targetLocal.minus({ hours: 1 });
      const queueLive =
        targetLocal.toFormat('h:mm a').replace(/^0/, '') +
        ` ${targetLocal.offsetNameShort || targetLocal.toFormat('ZZZ')} — Wednesday ${targetLocal.toFormat('MMMM d, yyyy')}`;
      return {
        status: 200,
        body: {
          timezone: tzKey,
          custom_date: targetLocal.toFormat('yyyy-MM-dd'),
          queue_time: targetLocal.toFormat('HH:mm'),
          start_time: startSuggest.toFormat('HH:mm'),
          queue_live: queueLive,
        },
      };
    },

    '/api/preset-schedules': (params) => {
      const sched = S();
      const tzKey = (params.get('timezone') || 'CDT').toUpperCase();
      if (!sched.TIMEZONES[tzKey]) {
        return { status: 400, body: { error: `Unknown timezone. Choose: ${Object.keys(sched.TIMEZONES).join(', ')}` } };
      }
      let timingMode;
      try {
        timingMode = sched.parse_timing_mode(params.get('timing_mode'));
      } catch (e) {
        return { status: 400, body: { error: e.message } };
      }
      const tz = sched.get_timezone(tzKey);
      const target = sched.next_walmart_queue_time({ tz_key: tzKey });
      const targetLocal = target.setZone(tz);
      const plans = sched.preset_schedules({ target, tz_key: tzKey, timing_mode: timingMode });
      const latePlans = sched.preset_schedules_late_drop({ target, tz_key: tzKey, timing_mode: timingMode });
      const queueLive =
        targetLocal.toFormat('h:mm a').replace(/^0/, '') +
        ` ${targetLocal.offsetNameShort || targetLocal.toFormat('ZZZ')} — Wednesday ${targetLocal.toFormat('MMMM d, yyyy')}`;
      return {
        status: 200,
        body: {
          timing_mode: timingMode,
          queue_live: queueLive,
          queue_ts_ms: target.toMillis(),
          plans: plans.map(planToJson),
          late_drop_plans: latePlans.map(planToJson),
        },
      };
    },

    '/api/demo-live': (params) => {
      const sched = S();
      const tzKey = (params.get('timezone') || 'CDT').toUpperCase();
      if (!sched.TIMEZONES[tzKey]) {
        return { status: 400, body: { error: `Unknown timezone. Choose: ${Object.keys(sched.TIMEZONES).join(', ')}` } };
      }
      let timingMode;
      try {
        timingMode = sched.parse_timing_mode(params.get('timing_mode'));
      } catch (e) {
        return { status: 400, body: { error: e.message } };
      }
      const requestedStart = parseOptionalInt(params.get('start_delay'));
      const requestedFinal = parseOptionalInt(params.get('final_delay'));
      const switchMinutesBefore = parseOptionalFloat(params.get('switch_minutes_before'));
      const presetLabel = (params.get('label') || '').trim();
      const tz = sched.get_timezone(tzKey);
      const now = DT().now().setZone(tz).startOf('second');

      try {
        let schedule, demoDuration, demoStartDelay, demoFinalDelay, fromPreset;
        if (requestedStart && requestedFinal) {
          const result = sched.build_demo_from_preset({
            start_delay_ms: requestedStart,
            final_delay_ms: requestedFinal,
            switch_minutes_before: switchMinutesBefore,
            timing_mode: timingMode,
            tz_key: tzKey,
            now,
          });
          schedule = result.schedule;
          demoDuration = result.demo_duration_minutes;
          demoStartDelay = schedule.steps[0].delay_ms;
          demoFinalDelay = schedule.steps[1].delay_ms;
          fromPreset = true;
        } else {
          demoDuration = sched.LIVE_DEMO_MINUTES;
          const delays = sched.best_delay_for_demo({
            demo_minutes: demoDuration,
            target_final_delay_ms: requestedFinal,
          });
          demoStartDelay = delays[0];
          demoFinalDelay = delays[1];
          const target = sched.create_demo_target({ minutes_from_now: demoDuration, now, tz_key: tzKey });
          schedule = sched.build_schedule({
            target,
            start: now,
            tz_key: tzKey,
            initial_delay_ms: demoStartDelay,
            target_final_delay_ms: requestedFinal || null,
            timing_mode: timingMode,
          });
          fromPreset = false;
        }
        return {
          status: 200,
          body: {
            mode: 'live_demo',
            timing_mode: timingMode,
            demo_duration_minutes: demoDuration,
            initial_delay_ms: demoStartDelay,
            final_delay_ms: demoFinalDelay,
            from_preset: fromPreset,
            preset_label: presetLabel || null,
            ...sched.schedule_to_live_demo(schedule),
          },
        };
      } catch (e) {
        return { status: 400, body: { error: e.message } };
      }
    },

    '/api/optimize': (_params, body) => {
      const sched = S();
      const data = body || {};
      const tzKey = (data.timezone || 'CDT').toUpperCase();
      const startTime = data.start_time || '';
      const initialDelayMs = parseInt(data.initial_delay_ms, 10) || 60000;
      const live = Boolean(data.live);

      let timingMode;
      let dropMode;
      try {
        timingMode = sched.parse_timing_mode(data.timing_mode);
        dropMode = sched.parse_drop_plan_mode(data.drop_mode);
      } catch (e) {
        return { status: 400, body: { error: e.message } };
      }
      if (!sched.TIMEZONES[tzKey]) {
        return { status: 400, body: { error: `Unknown timezone. Choose: ${Object.keys(sched.TIMEZONES).join(', ')}` } };
      }

      let targetFinalDelayMs = parseOptionalInt(data.final_delay_ms);
      const targetFinalRaw = data.target_final_delay_ms;
      if (targetFinalRaw !== null && targetFinalRaw !== undefined && targetFinalRaw !== '' && targetFinalRaw !== 'auto') {
        targetFinalDelayMs = parseInt(targetFinalRaw, 10);
      }
      const switchMinutesBefore = parseOptionalFloat(data.switch_minutes_before);

      try {
        const [target, mode] = resolveOptimizeTarget(data, tzKey);
        const start = resolveStart(startTime, target, tzKey, Boolean(data.demo));
        const schedule = sched.build_schedule({
          target,
          start,
          tz_key: tzKey,
          initial_delay_ms: initialDelayMs,
          timing_mode: timingMode,
          target_final_delay_ms: targetFinalDelayMs,
          switch_minutes_before: switchMinutesBefore,
          drop_mode: dropMode,
        });
        return {
          status: 200,
          body: {
            mode,
            timing_mode: timingMode,
            drop_mode: dropMode,
            target_final_delay_ms: schedule.steps.length > 1 ? schedule.steps[1].delay_ms : null,
            ...sched.schedule_to_dict(schedule),
          },
        };
      } catch (e) {
        return { status: 400, body: { error: e.message } };
      }
    },

    '/api/compatible-starts': (_params, body) => {
      const sched = S();
      const data = body || {};
      const tzKey = (data.timezone || 'CDT').toUpperCase();
      const startTime = data.start_time || '';
      const targetFinalDelayMs = parseInt(data.target_final_delay_ms, 10) || 0;

      let timingMode;
      let dropMode;
      try {
        timingMode = sched.parse_timing_mode(data.timing_mode);
        dropMode = sched.parse_drop_plan_mode(data.drop_mode);
      } catch (e) {
        return { status: 400, body: { error: e.message } };
      }
      if (!sched.TIMEZONES[tzKey]) {
        return { status: 400, body: { error: `Unknown timezone. Choose: ${Object.keys(sched.TIMEZONES).join(', ')}` } };
      }
      if (targetFinalDelayMs <= 0) {
        return { status: 400, body: { error: 'target_final_delay_ms is required.' } };
      }

      try {
        const [target] = resolveOptimizeTarget(data, tzKey);
        const options = sched.find_compatible_custom_starts({
          target,
          tz_key: tzKey,
          target_final_delay_ms: targetFinalDelayMs,
          timing_mode: timingMode,
          drop_mode: dropMode,
        });

        let selected = null;
        if (startTime) {
          try {
            const selectedStart = resolveStart(startTime, target, tzKey, Boolean(data.demo));
            const selLocal = selectedStart.setZone(sched.get_timezone(tzKey));
            for (const opt of options) {
              if (
                opt.start_h === selLocal.hour &&
                opt.start_m === selLocal.minute &&
                opt.start_s === selLocal.second
              ) {
                selected = {
                  start_h: opt.start_h,
                  start_m: opt.start_m,
                  start_s: opt.start_s,
                  start_delay_ms: opt.start_delay_ms,
                  start_time_display: opt.start_time_display,
                  drop_minutes_label: opt.drop_minutes_label,
                  final_delay_label: opt.final_delay_label,
                };
                break;
              }
            }
          } catch {
            selected = null;
          }
        }

        return {
          status: 200,
          body: {
            target_final_delay_ms: targetFinalDelayMs,
            drop_mode: dropMode,
            options,
            selected_match: selected,
          },
        };
      } catch (e) {
        return { status: 400, body: { error: e.message } };
      }
    },
  };

  function handle(pathname, search, opts) {
    const params = new URLSearchParams(search || '');
    let body = null;
    if (opts && opts.body) {
      try {
        body = JSON.parse(opts.body);
      } catch {
        body = null;
      }
    }
    const handler = handlers[pathname];
    if (!handler) return { status: 404, body: { error: 'Not found' } };
    return handler(params, body);
  }

  global.QueueAPI = { handle, APP_VERSION };
})(typeof window !== 'undefined' ? window : global);
