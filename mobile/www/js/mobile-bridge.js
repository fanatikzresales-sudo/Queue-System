/**
 * Mobile bridge: local API fetch + native notifications + safe-area tweaks.
 */
(function (global) {
  'use strict';

  const isCapacitor = global.CapNative && global.CapNative.Capacitor && global.CapNative.Capacitor.isNativePlatform && global.CapNative.Capacitor.isNativePlatform();
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

  const _fireOSNotification = global.fireOSNotification;
  global.fireOSNotification = function fireOSNotification(title, body) {
    if (global.CapNative && global.CapNative.LocalNotifications && global.MobileNotifications && global.MobileNotifications.isNative()) {
      global.CapNative.LocalNotifications.schedule({
        notifications: [{
          id: Math.floor(Math.random() * 900000) + 100000,
          title: String(title).slice(0, 64),
          body: String(body).slice(0, 240),
          schedule: { at: new Date(Date.now() + 500) },
          sound: 'default',
        }],
      }).catch(() => {});
    }
    if (_fireOSNotification) _fireOSNotification(title, body);
    else if ('Notification' in global && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  };

  global.addEventListener('DOMContentLoaded', () => {
    if (global.MobileNotifications) global.MobileNotifications.init();
    const banner = document.getElementById('update-banner');
    if (banner && isCapacitor) banner.hidden = true;
  });

  // Patch plan manager to schedule native notifications when available
  global.addEventListener('load', () => {
    const tryPatch = setInterval(() => {
      if (!global.PM || global.PM.__mobilePatched) return;
      const origActivate = global.PM.activate.bind(global.PM);
      const origCancel = global.PM.cancel.bind(global.PM);
      global.PM.activate = function (name, plan) {
        const id = origActivate(name, plan);
        if (global.MobileNotifications) {
          global.MobileNotifications.schedulePlanNotifications(id, name, plan);
        }
        return id;
      };
      global.PM.cancel = function (id, silent) {
        if (global.MobileNotifications) global.MobileNotifications.cancelPlanNotifications(id);
        return origCancel(id, silent);
      };
      global.PM.__mobilePatched = true;
      clearInterval(tryPatch);
    }, 200);
    setTimeout(() => clearInterval(tryPatch), 10000);
  });
})(typeof window !== 'undefined' ? window : global);
