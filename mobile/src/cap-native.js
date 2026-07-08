import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';

const AppSettings = registerPlugin('AppSettings');
const PlanAlarm = Capacitor.getPlatform() === 'android' ? registerPlugin('PlanAlarm') : null;

window.__DROP_REMINDER_MINUTES = 10;
window.CapNative = { Capacitor, LocalNotifications, App, SplashScreen, AppSettings, PlanAlarm };

async function initNativeNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() === 'android') {
    try {
      const channels = [
        {
          id: 'fr_queue_alerts',
          name: 'Queue Plan Reminders',
          importance: 5,
          visibility: 1,
          sound: 'default',
          vibration: true,
        },
        {
          id: 'fr_queue_urgent',
          name: 'Drop Now Alerts',
          importance: 5,
          visibility: 1,
          sound: 'default',
          vibration: true,
        },
      ];
      for (const ch of channels) {
        await LocalNotifications.createChannel(ch);
      }
      if (typeof LocalNotifications.checkExactNotificationSetting === 'function') {
        const exact = await LocalNotifications.checkExactNotificationSetting();
        if (exact.exact_alarm !== 'granted') {
          console.warn('Exact alarm permission not granted — scheduled alerts may be late');
        }
      }
    } catch (e) {
      console.warn('Notification channel init:', e);
    }
    return;
  }

  if (Capacitor.getPlatform() === 'ios') {
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display === 'prompt') {
        await LocalNotifications.requestPermissions();
      }
    } catch (e) {
      console.warn('iOS notification permission init:', e);
    }
  }
}

if (Capacitor.isNativePlatform()) {
  initNativeNotifications();
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) document.dispatchEvent(new CustomEvent('app-resumed'));
  });
  SplashScreen.hide().catch(() => {});
}
