/**
 * Native drop reminders — works when app is in background or closed (Android + iOS).
 */
(function (global) {
  'use strict';

  const CHANNEL_ALERTS = 'fr_queue_alerts';
  const CHANNEL_URGENT = 'fr_queue_urgent';
  /** Match desktop lead time: alert this many minutes before start / drop command. */
  const REMINDER_MINUTES = 10;
  const REMINDER_MS = REMINDER_MINUTES * 60 * 1000;
  const MIN_FUTURE_MS = 3000;
  const NOTIF_KINDS = [0, 1, 2, 3, 4, 5];

  let channelsReady = false;

  function ln() {
    return global.CapNative && global.CapNative.LocalNotifications;
  }

  function appSettings() {
    return global.CapNative && global.CapNative.AppSettings;
  }

  function planAlarm() {
    return global.CapNative && global.CapNative.PlanAlarm;
  }

  function isNative() {
    return global.CapNative && global.CapNative.Capacitor &&
      global.CapNative.Capacitor.isNativePlatform &&
      global.CapNative.Capacitor.isNativePlatform();
  }

  function platform() {
    if (global.CapNative && global.CapNative.Capacitor && global.CapNative.Capacitor.getPlatform) {
      return global.CapNative.Capacitor.getPlatform();
    }
    return 'web';
  }

  function isAndroid() {
    return platform() === 'android';
  }

  function isIOS() {
    return platform() === 'ios';
  }

  function notifId(planId, kind) {
    const base = Math.abs(
      String(planId).split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
    ) % 100000;
    return base * 10 + kind;
  }

  async function ensureChannels() {
    if (channelsReady || !ln() || isIOS()) return;
    await ln().createChannel({
      id: CHANNEL_ALERTS,
      name: 'Queue Plan Reminders',
      description: 'Start time and drop reminders for your bot plan',
      importance: 5,
      visibility: 1,
      sound: 'default',
      vibration: true,
      lights: true,
    });
    await ln().createChannel({
      id: CHANNEL_URGENT,
      name: 'Drop Now Alerts',
      description: 'Urgent alerts when it is time to change your delay',
      importance: 5,
      visibility: 1,
      sound: 'default',
      vibration: true,
      lights: true,
    });
    channelsReady = true;
  }

  async function areNotificationsEnabled() {
    if (ln()) {
      try {
        const p = await ln().checkPermissions();
        if (p.display === 'granted') return true;
        if (isIOS() && p.display === 'denied') return false;
      } catch (_) {}
    }
    if (appSettings() && typeof appSettings().checkNotificationEnabled === 'function') {
      try {
        const r = await appSettings().checkNotificationEnabled();
        return Boolean(r.enabled);
      } catch (_) {}
    }
    if (!ln()) return false;
    try {
      const p = await ln().checkPermissions();
      return p.display === 'granted';
    } catch (_) {
      return false;
    }
  }

  async function openNotificationSettings() {
    const settings = appSettings();
    if (!settings) {
      return { ok: false, reason: 'plugin_missing' };
    }
    try {
      if (typeof settings.openNotificationSettings === 'function') {
        await settings.openNotificationSettings();
        return { ok: true };
      }
    } catch (err) {
      console.warn('openNotificationSettings failed:', err);
    }
    try {
      if (typeof settings.openAppDetails === 'function') {
        await settings.openAppDetails();
        return { ok: true, fallback: 'app_details' };
      }
    } catch (err) {
      console.warn('openAppDetails failed:', err);
      return { ok: false, reason: err.message || 'open_failed' };
    }
    return { ok: false, reason: 'plugin_missing' };
  }

  async function openExactAlarmSettings() {
    if (isIOS()) {
      return openNotificationSettings().then(r => r.ok);
    }
    if (appSettings() && typeof appSettings().openExactAlarmSettings === 'function') {
      await appSettings().openExactAlarmSettings();
      return true;
    }
    if (isAndroid() && ln() && typeof ln().changeExactNotificationSetting === 'function') {
      await ln().changeExactNotificationSetting();
      return true;
    }
    return false;
  }

  async function hasExactAlarmPermission() {
    if (isIOS()) return true;
    if (!ln() || typeof ln().checkExactNotificationSetting !== 'function') return true;
    try {
      const status = await ln().checkExactNotificationSetting();
      return status.exact_alarm === 'granted';
    } catch (_) {
      return true;
    }
  }

  async function ensureExactAlarmPermission() {
    if (isIOS()) return true;
    if (await hasExactAlarmPermission()) return true;
    const open = confirm(
      'For on-time drop alerts, enable "Alarms & reminders" for FR Queue Optimizer.\n\n' +
      'Tap OK to open that setting, turn it ON, then come back and activate your plan again.'
    );
    if (open) {
      await openExactAlarmSettings();
    }
    return hasExactAlarmPermission();
  }

  /** Request permission — shows system dialog on Android 13+ only. */
  async function requestPermissionDialog() {
    if (!ln()) return false;
    await ensureChannels();
    try {
      const result = await ln().requestPermissions();
      return result.display === 'granted';
    } catch (_) {
      return false;
    }
  }

  /**
   * Full permission flow for mobile:
   * 1. Try system dialog (Android 13+)
   * 2. Open app notification settings (LDPlayer / Android 9–12 — no popup)
   */
  async function ensurePermissions() {
    if (!ln()) return false;
    await ensureChannels();

    if (await areNotificationsEnabled()) {
      return true;
    }

    await requestPermissionDialog();
    if (await areNotificationsEnabled()) {
      return true;
    }

    return false;
  }

  async function ensurePermissionsWithPrompt() {
    if (!ln()) return false;
    await ensureChannels();

    if (isIOS()) {
      const perm = await ln().requestPermissions();
      if (perm.display === 'granted') return true;
      const open = confirm(
        'FR Queue Optimizer needs notification permission.\n\n' +
        'Tap OK to open Settings → Notifications → turn ON Allow Notifications.'
      );
      if (open) await openNotificationSettings();
      const recheck = await ln().checkPermissions();
      return recheck.display === 'granted';
    }

    const enabled = await areNotificationsEnabled();
    if (enabled) return true;

    await requestPermissionDialog();
    if (await areNotificationsEnabled()) return true;

    const open = confirm(
      isIOS()
        ? 'Notifications are OFF for FR Queue Optimizer.\n\n' +
          'Tap OK to open iOS Settings → Notifications → turn Allow Notifications ON.\n\n' +
          'Then come back and tap Test alert.'
        : 'Notifications are OFF for this app.\n\n' +
          'LDPlayer and older Android versions do NOT show an "Allow" popup — ' +
          'you must turn them on manually.\n\n' +
          'Tap OK to open Notification Settings, enable "Allow notifications", ' +
          'then come back and tap "Test alert".'
    );
    if (open) {
      const opened = await openNotificationSettings();
      if (!opened.ok) {
        alert(
          'Could not open settings automatically.\n\n' +
          'On LDPlayer:\n' +
          '1. Open the Settings app\n' +
          '2. Apps → FR Queue Optimizer\n' +
          '3. Notifications → Allow'
        );
      }
    }
    return areNotificationsEnabled();
  }

  function scheduleAt(whenMs) {
    const minLead = isIOS() ? 1000 : 500;
    const at = new Date(Math.max(whenMs, Date.now() + minLead));
    if (isIOS()) {
      return { at };
    }
    return { at, allowWhileIdle: true };
  }

  /** iOS ignores Android channels; sound:'default' breaks iOS (looks for missing file). */
  function forPlatform(notif) {
    const copy = { ...notif };
    if (isIOS()) {
      delete copy.channelId;
      delete copy.smallIcon;
      delete copy.sound;
    }
    return copy;
  }

  function forPlatformList(notifications) {
    return notifications.map(forPlatform);
  }

  function baseNotif(id, title, body, channelId, whenMs, extra) {
    return {
      id,
      title: String(title).slice(0, 64),
      body: String(body).slice(0, 240),
      channelId,
      schedule: scheduleAt(whenMs),
      sound: 'default',
      smallIcon: 'ic_stat_icon',
      autoCancel: true,
      extra,
    };
  }

  function coerceTsMs(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizePlanTimes(plan) {
    return {
      ...plan,
      start_ts_ms: coerceTsMs(plan.start_ts_ms),
      drop_ts_ms: coerceTsMs(plan.drop_ts_ms),
      queue_ts_ms: coerceTsMs(plan.queue_ts_ms),
    };
  }

  function buildPlanNotifications(planId, name, plan, now) {
    const p = normalizePlanTimes(plan);
    const notifications = [];

    notifications.push(baseNotif(
      notifId(planId, 0),
      `${name} — Plan active`,
      `Start at ${p.start_time_display}. Drop reminder ${REMINDER_MINUTES} min before ${p.drop_time_display}.`,
      CHANNEL_ALERTS,
      now + 1500,
      { planId, type: 'confirmed' }
    ));

    const startReminderAt = p.start_ts_ms - REMINDER_MS;
    if (startReminderAt > now + MIN_FUTURE_MS) {
      notifications.push(baseNotif(
        notifId(planId, 1),
        `${name} — Start in ${REMINDER_MINUTES} minutes`,
        `At ${p.start_time_display}, set delay to ${p.start_delay_label}.`,
        CHANNEL_ALERTS,
        startReminderAt,
        { planId, type: 'start_reminder' }
      ));
    }

    if (p.start_ts_ms > now + MIN_FUTURE_MS) {
      notifications.push(baseNotif(
        notifId(planId, 2),
        `${name} — Start your task`,
        `Set delay to ${p.start_delay_label} now (${p.start_time_display}).`,
        CHANNEL_ALERTS,
        p.start_ts_ms,
        { planId, type: 'start_now' }
      ));
    }

    const dropReminderAt = p.drop_ts_ms - REMINDER_MS;
    if (dropReminderAt > now + MIN_FUTURE_MS) {
      notifications.push(baseNotif(
        notifId(planId, 3),
        `⚡ ${name} — Drop in ${REMINDER_MINUTES} minutes`,
        `At ${p.drop_time_display}, change delay to ${p.final_delay_label}.`,
        CHANNEL_URGENT,
        dropReminderAt,
        { planId, type: 'drop_reminder' }
      ));
    } else if (p.drop_ts_ms - now > MIN_FUTURE_MS) {
      notifications.push(baseNotif(
        notifId(planId, 3),
        `⚡ ${name} — Drop in ${REMINDER_MINUTES} minutes`,
        `At ${p.drop_time_display}, change delay to ${p.final_delay_label}.`,
        CHANNEL_URGENT,
        now + 2000,
        { planId, type: 'drop_reminder' }
      ));
    }

    if (p.drop_ts_ms > now + MIN_FUTURE_MS) {
      notifications.push(baseNotif(
        notifId(planId, 4),
        `⚡ ${name} — DROP NOW`,
        `Change delay to ${p.final_delay_label} — queue live at ${p.queue_time_display}.`,
        CHANNEL_URGENT,
        p.drop_ts_ms,
        { planId, type: 'drop_now' }
      ));
    }

    if (p.queue_ts_ms && p.queue_ts_ms > now + MIN_FUTURE_MS) {
      notifications.push(baseNotif(
        notifId(planId, 5),
        `${name} — Queue live`,
        `Queue goes live now at ${p.queue_time_display}.`,
        CHANNEL_ALERTS,
        p.queue_ts_ms,
        { planId, type: 'queue_live' }
      ));
    }

    return notifications;
  }

  function toAlarmPayload(notifications) {
    return notifications.map(n => ({
      id: n.id,
      title: n.title,
      body: n.body,
      channel: n.channelId || CHANNEL_ALERTS,
      atMs: n.schedule.at instanceof Date ? n.schedule.at.getTime() : n.schedule.at,
    }));
  }

  async function scheduleNotifications(notifications) {
    if (!notifications.length) return { method: 'none', count: 0 };

    const alarms = toAlarmPayload(notifications);
    const pa = planAlarm();

    if (pa && typeof pa.scheduleAlarms === 'function') {
      try {
        const result = await pa.scheduleAlarms({ alarms });
        return { method: isIOS() ? 'native_ios' : 'native_alarm', count: result.scheduled || alarms.length };
      } catch (err) {
        console.warn('PlanAlarm.scheduleAlarms failed, trying Capacitor:', err);
      }
    }

    if (!ln()) throw new Error('No notification backend available');

    const payload = forPlatformList(notifications);
    const now = Date.now();

    if (isIOS()) {
      let scheduled = 0;
      const errors = [];
      for (const notif of payload) {
        const atMs = notif.schedule?.at instanceof Date
          ? notif.schedule.at.getTime()
          : new Date(notif.schedule.at).getTime();
        if (!Number.isFinite(atMs) || atMs <= now + 500) continue;
        try {
          await ln().schedule({ notifications: [notif] });
          scheduled++;
        } catch (err) {
          errors.push(err.message || String(err));
          console.warn('iOS schedule failed for', notif.id, err);
        }
      }
      if (scheduled === 0) {
        return { method: 'capacitor_ios', count: 0, errors };
      }
      return { method: 'capacitor_ios', count: scheduled, errors };
    }

    try {
      await ln().schedule({ notifications: payload });
      return { method: 'capacitor', count: payload.length };
    } catch (err) {
      const fallback = payload.map(n => {
        const copy = { ...n };
        delete copy.smallIcon;
        return copy;
      });
      await ln().schedule({ notifications: fallback });
      console.warn('Scheduled fallback after error:', err);
      return { method: 'capacitor_fallback', count: fallback.length };
    }
  }

  async function showNotificationNow(id, title, body, channelId) {
    const pa = planAlarm();
    if (pa && typeof pa.showNow === 'function') {
      try {
        await pa.showNow({ id, title, body, channel: channelId || CHANNEL_ALERTS });
        return true;
      } catch (err) {
        console.warn('PlanAlarm.showNow failed:', err);
      }
    }
    if (!ln()) return false;
    try {
      await ln().schedule({
        notifications: forPlatformList([{
          id,
          title: String(title).slice(0, 64),
          body: String(body).slice(0, 240),
          channelId: channelId || CHANNEL_ALERTS,
          schedule: scheduleAt(Date.now() + 300),
          sound: 'default',
        }]),
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function schedulePlanNotifications(planId, name, plan) {
    if (!isNative() || !ln()) return { ok: false, reason: 'not_native' };

    const allowed = await ensurePermissionsWithPrompt();
    if (!allowed) {
      return { ok: false, reason: 'permission_denied' };
    }

    await ensureExactAlarmPermission();

    const now = Date.now();
    const p = normalizePlanTimes(plan);
    if (!p.start_ts_ms || !p.drop_ts_ms) {
      return {
        ok: false,
        reason: 'missing_times',
        message: 'Plan times are missing. Tap Queue Optimize again, then activate.',
      };
    }

    const notifications = buildPlanNotifications(planId, name, plan, now);
    const futureNotifications = notifications.filter(n => n.extra?.type !== 'confirmed');

    const immediateOk = await showNotificationNow(
      notifId(planId, 0),
      `${name} — Plan active`,
      `Start at ${plan.start_time_display}. Drop reminder ${REMINDER_MINUTES} min before ${plan.drop_time_display}.`,
      CHANNEL_ALERTS
    );

    let scheduleResult = { method: 'none', count: 0, errors: [] };
    try {
      scheduleResult = await scheduleNotifications(
        futureNotifications.length ? futureNotifications : notifications
      );
    } catch (err) {
      console.error('schedulePlanNotifications batch failed', err);
      scheduleResult.errors = [err.message || String(err)];
    }

    if (!immediateOk && scheduleResult.count === 0) {
      const errMsg = (scheduleResult.errors && scheduleResult.errors[0]) ||
        'Could not schedule alerts (times may already be in the past)';
      return { ok: false, reason: 'schedule_failed', message: errMsg };
    }

    const alarmPayload = toAlarmPayload(notifications);

    let monitoring = 0;
    const pa = planAlarm();
    if (isAndroid() && pa && typeof pa.startPlanMonitor === 'function') {
      try {
        const mon = await pa.startPlanMonitor({ alarms: alarmPayload, planName: name });
        monitoring = mon.monitoring || 0;
      } catch (err) {
        console.warn('startPlanMonitor failed:', err);
      }
    }

    const pending = await getPendingCount();
    return {
      ok: true,
      scheduled: scheduleResult.count + (immediateOk ? 1 : 0),
      monitoring,
      method: scheduleResult.method,
      exactAlarm: await hasExactAlarmPermission(),
      pending,
      times: alarmPayload
        .filter(a => a.atMs > now + 500)
        .map(a => ({
          title: a.title,
          at: new Date(a.atMs).toLocaleString(),
        })),
    };
  }

  async function getPendingCount() {
    if (!ln() || typeof ln().getPending !== 'function') return null;
    try {
      const pending = await ln().getPending();
      return (pending.notifications || []).length;
    } catch (_) {
      return null;
    }
  }

  async function sendTestNotification() {
    if (!isNative() || !ln()) return { ok: false, reason: 'not_native' };

    const allowed = await ensurePermissionsWithPrompt();
    if (!allowed) return { ok: false, reason: 'permission_denied' };

    await ensureExactAlarmPermission();

    try {
      await showNotificationNow(
        999000,
        'FR Queue Optimizer — Test',
        'Notifications are working! Another alert follows in 5 seconds.',
        CHANNEL_URGENT
      );
      await scheduleNotifications([{
        id: 999001,
        title: 'FR Queue Optimizer — Test alert',
        body: 'If you see this, scheduled notifications are working!',
        channelId: CHANNEL_URGENT,
        schedule: scheduleAt(Date.now() + 5000),
        sound: 'default',
      }]);
      const pending = await getPendingCount();
      const msg = isIOS()
        ? 'Test sent now + another in 5 seconds.\n\n' +
          'On iPhone: press Home to background the app, or swipe down from the top.\n' +
          'Check Settings → Notifications → FR Queue Optimizer → Allow Notifications, Banners, and Sounds.' +
          (pending != null ? `\n\nPending alerts on device: ${pending}` : '')
        : 'Test alert in 5 seconds — minimize the app or switch apps and wait.';
      return { ok: true, message: msg, pending };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  async function cancelPlanNotifications(planId) {
    const ids = NOTIF_KINDS.map(k => notifId(planId, k));
    const pa = planAlarm();
    if (isAndroid() && pa && typeof pa.stopPlanMonitor === 'function') {
      try {
        await pa.stopPlanMonitor();
      } catch (_) {}
    }
    if (pa && typeof pa.cancelAlarms === 'function') {
      try {
        await pa.cancelAlarms({ ids });
      } catch (_) {}
    }
    if (!ln()) return;
    try {
      await ln().cancel({ notifications: ids.map(id => ({ id })) });
    } catch (_) {}
  }

  async function notifyNow(title, body, urgent) {
    if (!isNative()) return false;
    if (!(await ensurePermissions())) return false;
    return showNotificationNow(
      Math.floor(Math.random() * 800000) + 100000,
      title,
      body,
      urgent ? CHANNEL_URGENT : CHANNEL_ALERTS
    );
  }

  function buildJsTimerFallback(planId, name, plan) {
    const now = Date.now();
    const items = buildPlanNotifications(planId, name, plan, now);
    const timers = [];
    items.forEach(item => {
      const atMs = item.schedule.at.getTime();
      const delay = atMs - Date.now();
      if (delay <= 500) return;
      timers.push(setTimeout(() => {
        showNotificationNow(item.id, item.title, item.body, item.channelId);
      }, delay));
    });
    return timers;
  }

  global.MobileNotifications = {
    REMINDER_MINUTES,
    areNotificationsEnabled,
    hasExactAlarmPermission,
    openNotificationSettings,
    openExactAlarmSettings,
    requestPermissionDialog,
    ensurePermissions,
    ensurePermissionsWithPrompt,
    schedulePlanNotifications,
    cancelPlanNotifications,
    sendTestNotification,
    notifyNow,
    buildJsTimerFallback,
    isNative,
    isAndroid,
    isIOS,
    platform,
  };
})(typeof window !== 'undefined' ? window : global);
