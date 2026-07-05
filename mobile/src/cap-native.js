import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { SplashScreen } from '@capacitor/splash-screen';

window.CapNative = { Capacitor, LocalNotifications, App, SplashScreen };

if (Capacitor.isNativePlatform()) {
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) document.dispatchEvent(new CustomEvent('app-resumed'));
  });
  SplashScreen.hide().catch(() => {});
}
