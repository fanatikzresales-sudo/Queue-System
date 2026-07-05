/**
 * Native drop reminders via Capacitor Local Notifications (Android + iOS).
 */
(function (global) {
  'use strict';

  let LocalNotifications = null;
  let ready = false;
  let permissionGranted = false;

  async function init() {
    if (ready) return permissionGranted;
    ready = true;
    try {
      const cap = global.CapNative && global.CapNative.Capacitor;
      if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) {
        return false;
      }
      LocalNotifications = global.CapNative.LocalNotifications;
      const perm = await LocalNotifications.requestPermissions();
      permissionGranted = perm.display === 'granted';
      return permissionGranted;
    } catch (e) {
      console.warn('Local notifications unavailable:', e);
      return false;
    }
  }

  function notifId(planId, kind) {
    const base = Math.abs(
      String(planId).split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0)
    ) % 100000;
    return base * 10 + kind;
  }

  async function schedulePlanNotifications(planId, name, plan) {
    if (!(await init()) || !LocalNotifications) return false;
    const now = Date.now();
    const notifications = [];

    const startAt = plan.start_ts_ms;
    if (startAt > now + 5000) {
      notifications.push({
        id: notifId(planId, 1),
        title: `${name} — Start your task`,
        body: `Set delay to ${plan.start_delay_label} at ${plan.start_time_display}`,
        schedule: { at: new Date(startAt) },
        sound: 'default',
        smallIcon: 'ic_stat_icon',
        extra: { planId, type: 'start' },
      });
    }

    const dropReminderAt = plan.drop_ts_ms - 5 * 60 * 1000;
    if (dropReminderAt > now + 5000) {
      notifications.push({
        id: notifId(planId, 2),
        title: `⚡ ${name} — Drop in 5 minutes`,
        body: `At ${plan.drop_time_display}, change delay to ${plan.final_delay_label}`,
        schedule: { at: new Date(dropReminderAt) },
        sound: 'default',
        smallIcon: 'ic_stat_icon',
        extra: { planId, type: 'drop_reminder' },
      });
    }

    if (plan.drop_ts_ms > now + 5000) {
      notifications.push({
        id: notifId(planId, 3),
        title: `⚡ ${name} — DROP NOW`,
        body: `Change delay to ${plan.final_delay_label} — queue live at ${plan.queue_time_display}`,
        schedule: { at: new Date(plan.drop_ts_ms) },
        sound: 'default',
        smallIcon: 'ic_stat_icon',
        extra: { planId, type: 'drop_now' },
      });
    }

    if (!notifications.length) return false;
    await LocalNotifications.schedule({ notifications });
    return true;
  }

  async function cancelPlanNotifications(planId) {
    if (!LocalNotifications) return;
    const ids = [notifId(planId, 1), notifId(planId, 2), notifId(planId, 3)];
    try {
      await LocalNotifications.cancel({ notifications: ids.map(id => ({ id })) });
    } catch (_) {}
  }

  global.MobileNotifications = {
    init,
    schedulePlanNotifications,
    cancelPlanNotifications,
    isNative: () => global.CapNative && global.CapNative.Capacitor && global.CapNative.Capacitor.isNativePlatform && global.CapNative.Capacitor.isNativePlatform(),
  };
})(typeof window !== 'undefined' ? window : global);
