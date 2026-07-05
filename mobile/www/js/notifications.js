/**
 * Native drop reminders — works when app is in background or closed (Android + iOS).
 */
(function (global) {
  'use strict';

  const CHANNEL_ALERTS = 'fr_queue_alerts';
  const CHANNEL_URGENT = 'fr_queue_urgent';

  let LocalNotifications = null;
  let channelsReady = false;

  function ln() {
    return global.CapNative && global.CapNative.LocalNotifications;
  }

  function isNative() {
    return global.CapNative && global.CapNative.Capacitor &&
      global.CapNative.Capacitor.isNativePlatform &&
      global.CapNative.Capacitor.isNativePlatform();
  }

  function notifId(planId, kind) {
    const base = Math.abs(
      String(planId).split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
    ) % 100000;
    return base * 10 + kind;
  }

  async function ensureChannels() {
    if (channelsReady || !ln()) return;
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

  async function ensurePermissions() {
    if (!ln()) return false;

    await ensureChannels();

    let perms = await ln().checkPermissions();
    if (perms.display !== 'granted') {
      perms = await ln().requestPermissions();
    }
    if (perms.display !== 'granted') {
      return false;
    }

    // Android 12+ — exact alarm timing for drop-at-second precision
    if (typeof ln().checkExactNotificationSetting === 'function') {
      try {
        const exact = await ln().checkExactNotificationSetting();
        if (exact.exact_alarm !== 'granted' && typeof ln().changeExactNotificationSetting === 'function') {
          await ln().changeExactNotificationSetting();
        }
      } catch (_) {}
    }

    return true;
  }

  function scheduleAt(whenMs) {
    return {
      at: new Date(whenMs),
      allowWhileIdle: true,
    };
  }

  async function schedulePlanNotifications(planId, name, plan) {
    if (!isNative() || !ln()) return { ok: false, reason: 'not_native' };

    const allowed = await ensurePermissions();
    if (!allowed) {
      return { ok: false, reason: 'permission_denied' };
    }

    const now = Date.now();
    const notifications = [];

    // Immediate confirmation so user knows alerts are armed
    notifications.push({
      id: notifId(planId, 0),
      title: `${name} — Plan active`,
      body: `Drop reminder at ${plan.drop_time_display}. You can leave the app — alerts will still fire.`,
      channelId: CHANNEL_ALERTS,
      schedule: scheduleAt(now + 1500),
      sound: 'default',
      smallIcon: 'ic_stat_icon',
      autoCancel: true,
      extra: { planId, type: 'confirmed' },
    });

    const startAt = plan.start_ts_ms;
    if (startAt > now + 3000) {
      notifications.push({
        id: notifId(planId, 1),
        title: `${name} — Start your task`,
        body: `Set delay to ${plan.start_delay_label} at ${plan.start_time_display}`,
        channelId: CHANNEL_ALERTS,
        schedule: scheduleAt(startAt),
        sound: 'default',
        smallIcon: 'ic_stat_icon',
        extra: { planId, type: 'start' },
      });
    }

    const dropReminderAt = plan.drop_ts_ms - 5 * 60 * 1000;
    if (dropReminderAt > now + 3000) {
      notifications.push({
        id: notifId(planId, 2),
        title: `⚡ ${name} — Drop in 5 minutes`,
        body: `At ${plan.drop_time_display}, change delay to ${plan.final_delay_label}`,
        channelId: CHANNEL_URGENT,
        schedule: scheduleAt(dropReminderAt),
        sound: 'default',
        smallIcon: 'ic_stat_icon',
        extra: { planId, type: 'drop_reminder' },
      });
    }

    if (plan.drop_ts_ms > now + 3000) {
      notifications.push({
        id: notifId(planId, 3),
        title: `⚡ ${name} — DROP NOW`,
        body: `Change delay to ${plan.final_delay_label} — queue live at ${plan.queue_time_display}`,
        channelId: CHANNEL_URGENT,
        schedule: scheduleAt(plan.drop_ts_ms),
        sound: 'default',
        smallIcon: 'ic_stat_icon',
        extra: { planId, type: 'drop_now' },
      });
    }

    if (plan.queue_ts_ms && plan.queue_ts_ms > now + 3000) {
      notifications.push({
        id: notifId(planId, 4),
        title: `${name} — Queue live`,
        body: `Queue goes live now at ${plan.queue_time_display}`,
        channelId: CHANNEL_ALERTS,
        schedule: scheduleAt(plan.queue_ts_ms),
        sound: 'default',
        smallIcon: 'ic_stat_icon',
        extra: { planId, type: 'queue_live' },
      });
    }

    try {
      await ln().schedule({ notifications });
      const pending = await ln().getPending().catch(() => ({ notifications: [] }));
      return { ok: true, scheduled: notifications.length, pending: pending.notifications?.length ?? 0 };
    } catch (err) {
      console.error('schedulePlanNotifications failed', err);
      return { ok: false, reason: err.message || 'schedule_failed' };
    }
  }

  async function cancelPlanNotifications(planId) {
    if (!ln()) return;
    const ids = [0, 1, 2, 3, 4].map(k => ({ id: notifId(planId, k) }));
    try {
      await ln().cancel({ notifications: ids });
    } catch (_) {}
  }

  /** Fire a notification in a few seconds (for in-app popups). */
  async function notifyNow(title, body, urgent) {
    if (!isNative() || !ln()) return false;
    if (!(await ensurePermissions())) return false;
    try {
      await ln().schedule({
        notifications: [{
          id: Math.floor(Math.random() * 800000) + 100000,
          title: String(title).slice(0, 64),
          body: String(body).slice(0, 240),
          channelId: urgent ? CHANNEL_URGENT : CHANNEL_ALERTS,
          schedule: scheduleAt(Date.now() + 500),
          sound: 'default',
          smallIcon: 'ic_stat_icon',
        }],
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  global.MobileNotifications = {
    ensurePermissions,
    schedulePlanNotifications,
    cancelPlanNotifications,
    notifyNow,
    isNative,
  };
})(typeof window !== 'undefined' ? window : global);
