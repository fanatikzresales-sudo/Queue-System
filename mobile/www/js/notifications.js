/**
 * Native drop reminders — works when app is in background or closed (Android + iOS).
 */
(function (global) {
  'use strict';

  const CHANNEL_ALERTS = 'fr_queue_alerts';
  const CHANNEL_URGENT = 'fr_queue_urgent';

  let channelsReady = false;

  function ln() {
    return global.CapNative && global.CapNative.LocalNotifications;
  }

  function appSettings() {
    return global.CapNative && global.CapNative.AppSettings;
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

  async function areNotificationsEnabled() {
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
    if (appSettings() && typeof appSettings().openNotificationSettings === 'function') {
      await appSettings().openNotificationSettings();
      return true;
    }
    return false;
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
    const enabled = await areNotificationsEnabled();
    if (enabled) return true;

    await requestPermissionDialog();
    if (await areNotificationsEnabled()) return true;

    const open = confirm(
      'Notifications are OFF for this app.\n\n' +
      'LDPlayer and older Android versions do NOT show an "Allow" popup — ' +
      'you must turn them on manually.\n\n' +
      'Tap OK to open Notification Settings, enable "Allow notifications", ' +
      'then come back and tap "Test alert".'
    );
    if (open) {
      await openNotificationSettings();
    }
    return areNotificationsEnabled();
  }

  function scheduleAt(whenMs) {
    return { at: new Date(whenMs), allowWhileIdle: true };
  }

  async function schedulePlanNotifications(planId, name, plan) {
    if (!isNative() || !ln()) return { ok: false, reason: 'not_native' };

    const allowed = await ensurePermissionsWithPrompt();
    if (!allowed) {
      return { ok: false, reason: 'permission_denied' };
    }

    const now = Date.now();
    const notifications = [];

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

    if (plan.start_ts_ms > now + 3000) {
      notifications.push({
        id: notifId(planId, 1),
        title: `${name} — Start your task`,
        body: `Set delay to ${plan.start_delay_label} at ${plan.start_time_display}`,
        channelId: CHANNEL_ALERTS,
        schedule: scheduleAt(plan.start_ts_ms),
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
      return { ok: true, scheduled: notifications.length };
    } catch (err) {
      console.error('schedulePlanNotifications failed', err);
      return { ok: false, reason: err.message || 'schedule_failed' };
    }
  }

  async function sendTestNotification() {
    if (!isNative() || !ln()) return { ok: false, reason: 'not_native' };

    const allowed = await ensurePermissionsWithPrompt();
    if (!allowed) return { ok: false, reason: 'permission_denied' };

    try {
      await ln().schedule({
        notifications: [{
          id: 999001,
          title: 'FR Queue Optimizer — Test alert',
          body: 'If you see this, background notifications are working!',
          channelId: CHANNEL_URGENT,
          schedule: scheduleAt(Date.now() + 5000),
          sound: 'default',
          smallIcon: 'ic_stat_icon',
        }],
      });
      return { ok: true, message: 'Test alert in 5 seconds — switch to another app now.' };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  async function cancelPlanNotifications(planId) {
    if (!ln()) return;
    const ids = [0, 1, 2, 3, 4].map(k => ({ id: notifId(planId, k) }));
    try {
      await ln().cancel({ notifications: ids });
    } catch (_) {}
  }

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
    areNotificationsEnabled,
    openNotificationSettings,
    requestPermissionDialog,
    ensurePermissions,
    ensurePermissionsWithPrompt,
    schedulePlanNotifications,
    cancelPlanNotifications,
    sendTestNotification,
    notifyNow,
    isNative,
  };
})(typeof window !== 'undefined' ? window : global);
