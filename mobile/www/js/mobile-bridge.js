/**
 * Mobile bridge: local API fetch + native notifications + safe-area tweaks.
 */
(function (global) {
  'use strict';

  const isCapacitor = global.CapNative && global.CapNative.Capacitor &&
    global.CapNative.Capacitor.isNativePlatform &&
    global.CapNative.Capacitor.isNativePlatform();

  document.documentElement.classList.toggle('capacitor-native', isCapacitor);
  document.documentElement.classList.toggle('capacitor-web', !isCapacitor);

  const originalFetch = global.fetch.bind(global);

  function apiPath(url) {
    if (typeof url === 'string') {
      if (url.startsWith('/api/')) return url.split('?')[0];
      try {
        const u = new URL(url, global.location.origin);
        if (u.pathname.startsWith('/api/')) return u.pathname;
      } catch (_) {}
    }
    if (url && url.url) {
      try {
        const u = new URL(url.url, global.location.origin);
        if (u.pathname.startsWith('/api/')) return u.pathname;
      } catch (_) {}
    }
    return null;
  }

  function apiSearch(url) {
    if (typeof url === 'string' && url.includes('?')) return '?' + url.split('?').slice(1).join('?');
    if (url && url.url) {
      try {
        const u = new URL(url.url, global.location.origin);
        return u.search;
      } catch (_) {}
    }
    return '';
  }

  global.fetch = async function mobileFetch(url, opts) {
    const path = apiPath(url);
    if (path && global.QueueAPI) {
      const result = global.QueueAPI.handle(path, apiSearch(url), opts);
      return {
        ok: result.status >= 200 && result.status < 300,
        status: result.status,
        json: async () => result.body,
      };
    }
    return originalFetch(url, opts);
  };

  function showNotifError(msg) {
    try {
      alert(msg);
    } catch (_) {}
  }

  async function refreshNotifBanner() {
    const banner = document.getElementById('notif-permission-banner');
    const statusEl = document.getElementById('npb-status');
    if (!banner || !isCapacitor || !global.MobileNotifications) return;

    const enabled = await global.MobileNotifications.areNotificationsEnabled();
    banner.hidden = false;
    if (statusEl) {
      const ios = global.MobileNotifications.isIOS && global.MobileNotifications.isIOS();
      statusEl.textContent = enabled
        ? (ios
          ? 'Notifications ON. iOS will alert 10 min before start & drop — tap Test alert, then activate a plan.'
          : 'Notifications ON. Alerts fire 10 min before start & drop — use Test alert, then activate a plan.')
        : (ios
          ? 'Notifications OFF. Tap below — iOS will ask to Allow, or open Settings.'
          : 'Notifications OFF. Tap "Open Notification Settings" and turn them on.');
      statusEl.classList.toggle('npb-status-ok', enabled);
    }
  }

  function setupNotifBanner() {
    if (!isCapacitor || !global.MobileNotifications) return;

    const enableBtn = document.getElementById('npb-enable-btn');
    const testBtn = document.getElementById('npb-test-btn');
    const hintEl = document.querySelector('.npb-hint');

    if (hintEl && global.MobileNotifications.isIOS && global.MobileNotifications.isIOS()) {
      hintEl.textContent = 'On iPhone, tap Open Notification Settings or allow when iOS asks.';
    }

    if (enableBtn) {
      enableBtn.addEventListener('click', async () => {
        if (global.MobileNotifications.isIOS && global.MobileNotifications.isIOS()) {
          await global.MobileNotifications.requestPermissionDialog();
        }
        const result = await global.MobileNotifications.openNotificationSettings();
        if (!result.ok) {
          alert(
            global.MobileNotifications.isIOS && global.MobileNotifications.isIOS()
              ? 'Open Settings → FR Queue Optimizer → Notifications → Allow Notifications'
              : 'On LDPlayer, open Settings manually:\n' +
                'Settings → Apps → FR Queue Optimizer → Notifications → Allow'
          );
        } else if (result.fallback === 'app_details') {
          alert('Opened app settings. Tap Notifications and turn them ON.');
        }
        setTimeout(refreshNotifBanner, 1500);
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        const result = await global.MobileNotifications.sendTestNotification();
        if (result.ok) {
          alert(result.message);
        } else if (result.reason === 'permission_denied') {
          alert(
            global.MobileNotifications.isIOS && global.MobileNotifications.isIOS()
              ? 'Notifications are off.\n\nSettings → FR Queue Optimizer → Notifications → Allow Notifications'
              : 'Notifications still off. Use "Open Notification Settings" first.'
          );
        } else {
          alert('Test failed: ' + (result.reason || 'unknown'));
        }
        refreshNotifBanner();
      });
    }

    refreshNotifBanner();
    document.addEventListener('app-resumed', refreshNotifBanner);
  }

  global.fireOSNotification = function fireOSNotification(title, body, urgent) {
    if (global.MobileNotifications && global.MobileNotifications.isNative()) {
      global.MobileNotifications.notifyNow(title, body, urgent);
    } else if ('Notification' in global && Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if ('Notification' in global && Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => {
        if (p === 'granted') new Notification(title, { body });
      });
    }
  };

  const jsPlanTimers = {};

  function patchPlanManager() {
    if (!global.PM || global.PM.__mobilePatched) return;

    const origActivate = global.PM.activate.bind(global.PM);
    const origCancel = global.PM.cancel.bind(global.PM);

    global.PM.activate = function (name, plan) {
      const id = origActivate(name, plan);

      if (global.MobileNotifications && global.MobileNotifications.isNative()) {
        global.MobileNotifications.schedulePlanNotifications(id, name, plan).then(result => {
          if (result.ok) {
            if (global.MobileNotifications.buildJsTimerFallback) {
              jsPlanTimers[id] = global.MobileNotifications.buildJsTimerFallback(id, name, plan);
            }
            const times = (result.times || [])
              .map(t => `• ${t.at} — ${t.title}`)
              .join('\n');
            const exact = result.exactAlarm === false
              ? '\n\nTip: enable "Alarms & reminders" in app settings too.'
              : '';
            const monitorLine = result.monitoring
              ? `Background monitor: ${result.monitoring} alerts (Android/LDPlayer).\n\n`
              : (global.MobileNotifications.isIOS && global.MobileNotifications.isIOS()
                ? 'iOS scheduled alerts are set.\n\n'
                : '');
            showNotifError(
              `Scheduled ${result.scheduled} alerts (${result.method || 'native'}).\n` +
              monitorLine +
              (times || 'Alerts set for your plan times.') +
              (global.MobileNotifications.isIOS && global.MobileNotifications.isIOS()
                ? '\n\nYou can leave the app — iOS will deliver alerts at the scheduled times.' + exact
                : '\n\nLeave LDPlayer running — you should see a small "alerts active" notification at the top.' + exact)
            );
          } else if (result.reason === 'permission_denied') {
            showNotifError(
              'Notifications are blocked.\n\n' +
              'Settings → Apps → FR Queue Optimizer → Notifications → Allow'
            );
          } else {
            showNotifError('Could not schedule reminders: ' + (result.reason || 'unknown error'));
          }
        });
      }

      return id;
    };

    global.PM.cancel = function (id, silent) {
      if (jsPlanTimers[id]) {
        jsPlanTimers[id].forEach(t => clearTimeout(t));
        delete jsPlanTimers[id];
      }
      if (global.MobileNotifications) {
        global.MobileNotifications.cancelPlanNotifications(id);
      }
      return origCancel(id, silent);
    };

    global.PM.__mobilePatched = true;
  }

  global.addEventListener('DOMContentLoaded', () => {
    const banner = document.getElementById('update-banner');
    if (banner && isCapacitor) banner.hidden = true;
    patchPlanManager();
    setupNotifBanner();
  });

  global.addEventListener('load', () => {
    patchPlanManager();
    setupNotifBanner();
    const tryPatch = setInterval(() => {
      patchPlanManager();
      if (global.PM && global.PM.__mobilePatched) clearInterval(tryPatch);
    }, 200);
    setTimeout(() => clearInterval(tryPatch), 15000);
  });
})(typeof window !== 'undefined' ? window : global);
