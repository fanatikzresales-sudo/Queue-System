# FR Queue Optimizer — Mobile (Android & iOS)

Companion app for preset plans, custom schedules, live demos, and **native drop reminders** on your phone. Works fully offline — all timing math runs on-device.

Built with [Capacitor](https://capacitorjs.com/) (same UI as the desktop app, scheduler ported to JavaScript).

---

## Share / install (no build required)

**Friends do not need Android Studio or `build-android.bat`.** Give them the APK:

| How | Link |
|-----|------|
| **GitHub Releases** (best) | https://github.com/fanatikzresales-sudo/Queue-System/releases — download `FRQueueOptimizer-Android.apk` |
| **Manual share** | Send the APK file from `android/app/build/outputs/apk/debug/app-debug.apk` (Google Drive, Discord, etc.) |

Install: open the APK on the phone/emulator → allow unknown sources → enable notifications in app settings.

---

## Requirements (builders only)

| Platform | What you need |
|----------|----------------|
| **Android** | [Android Studio](https://developer.android.com/studio) (SDK 34+), **Java JDK 21** |
| **iOS** | Mac with [Xcode 15+](https://developer.apple.com/xcode/) and Apple Developer account (for device/TestFlight) |
| **Both** | Node.js 18+ |

---

## Quick start

```bash
cd mobile
npm install
npm run build          # sync web assets + bundle Capacitor plugins
npx cap add android    # first time only
npx cap add ios        # first time only (Mac)
npm run cap:sync       # copy www → native projects
```

### Android

```bash
npm run cap:android    # opens Android Studio
```

In Android Studio: **Run** on emulator or connected device.

Release build: **Build → Generate Signed Bundle / APK**.

### iOS (Mac only)

```bash
npm run cap:ios        # opens Xcode
```

In Xcode: select your team, pick a device/simulator, **Run**.

For TestFlight/App Store: **Product → Archive**.

---

## Features on mobile

- All preset cards (Instant + Deferred Switch, late-drop presets)
- Custom optimizer with timezone support
- Live demo (exact preset delays)
- **Native notifications** when you activate a plan:
  - Task start reminder
  - Drop in 5 minutes
  - Drop now at exact time
- Works offline (no server required)

---

## Project layout

```
mobile/
  www/              Web UI served inside the native shell
  src/cap-native.js Capacitor plugin bundle (notifications, splash)
  scripts/          Asset sync + scheduler parity tests
  android/          Android Studio project (after cap add android)
  ios/              Xcode project (after cap add ios)
```

After editing desktop `static/` files, run `npm run build` to refresh mobile assets.

---

## Verify scheduler matches desktop

```bash
python3 scripts/export-fixtures.py   # from repo root
cd mobile && npm run verify
```

---

## App ID

- **Bundle ID:** `com.frqueue.optimizer`
- Change in `capacitor.config.json` before publishing if needed.

---

## Notes

- The **bot still runs on your PC** — this app is your planner + alarm clock for drop times.
- iOS requires notification permission on first plan activation.
- Android 13+ prompts for notification permission at runtime.
