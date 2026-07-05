import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';

const AppSettings = registerPlugin('AppSettings');

window.CapNative = { Capacitor, LocalNotifications, App, SplashScreen, AppSettings };

async function initNativeNotifications() {
  if (!Capacitor.isNativePlatform()) return;
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
  } catch (e) {
    console.warn('Notification channel init:', e);
  }
}

if (Capacitor.isNativePlatform()) {
  initNativeNotifications();
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) document.dispatchEvent(new CustomEvent('app-resumed'));
  });
  SplashScreen.hide().catch(() => {});
}
