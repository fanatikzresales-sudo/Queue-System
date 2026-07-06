# FR Queue Optimizer — iOS & App Store Guide

The iOS app uses the **same code** as Android (Capacitor + shared `www/` assets). All presets, custom schedules, 10-minute start/drop alerts, and offline timing work on iPhone.

**iOS notifications are more reliable than Android emulators** — Apple’s system handles scheduled local notifications natively. No LDPlayer-style workarounds needed.

---

## What’s already shared (Android + iOS)

| Feature | iOS |
|---------|-----|
| Presets & custom schedules | Yes |
| Offline scheduler | Yes |
| 10 min before start alert | Yes |
| 10 min before drop alert | Yes |
| Start / drop / queue-live alerts | Yes |
| Test alert button | Yes |
| Open Notification Settings | Yes (iOS Settings deep link) |
| Fanatikz logo & branding | Yes |

Android-only (not needed on iOS):
- `PlanAlarmPlugin` / foreground monitor (LDPlayer fix)
- Exact alarm permission (Android 12+ only)

---

## Can users download & install like Android APK?

**No.** Apple does not allow public “download an .ipa and install” the way Android allows APK files.

| Method | Users build? | Who can install | Cost |
|--------|--------------|-----------------|------|
| **App Store** | No | Anyone with iPhone | $99/year Apple Developer |
| **TestFlight** | No | Up to 10,000 testers | $99/year (same account) |
| **Ad-hoc** | No | Up to 100 registered devices/year | $99/year |
| Direct .ipa download | N/A | **Not allowed** for public distribution | — |

**For “just download and install” → you must publish on the App Store** (or TestFlight for beta).

---

## What YOU need (one-time setup)

1. **Mac** with **Xcode 15+** (required — iOS apps cannot be built on Windows)
2. **Apple Developer Program** — https://developer.apple.com/programs/  
   - **$99 USD / year**
3. **Apple ID** linked to App Store Connect

*No Mac?* Options: borrow a Mac, use a cloud Mac service (MacStadium, MacinCloud), or hire someone to submit the build.

---

## Build the iOS app (on Mac)

```bash
cd mobile
npm install
npm run sync:www
npm run build:js
npx cap sync ios
npm run cap:ios          # opens Xcode
```

In **Xcode**:
1. Select the **App** target
2. **Signing & Capabilities** → Team = your Apple Developer team
3. Bundle ID: `com.frqueue.optimizer` (or change to one you own)
4. Plug in iPhone or pick a simulator → **Run** (▶) to test

---

## Publish to App Store (users install from App Store)

### Step 1 — App Store Connect listing

1. Go to https://appstoreconnect.apple.com
2. **My Apps** → **+** → **New App**
3. Fill in:
   - **Name:** FR Queue Optimizer
   - **Bundle ID:** match Xcode (`com.frqueue.optimizer`)
   - **SKU:** e.g. `fr-queue-optimizer`
   - **Category:** Utilities or Productivity
4. Add **screenshots** (required sizes for iPhone 6.7" and 6.5")
5. Write **description**, **privacy policy URL** (required), **support URL**

### Step 2 — Archive & upload from Xcode

1. In Xcode: device target = **Any iOS Device (arm64)**
2. **Product → Archive**
3. When done: **Distribute App → App Store Connect → Upload**
4. Wait for processing in App Store Connect (~15–30 min)

### Step 3 — Submit for review

1. App Store Connect → your app → **+ Version**
2. Select the uploaded build
3. Answer export compliance (already set: no encryption in Info.plist)
4. **Submit for Review**

Review usually takes **1–3 days**. Once approved, users search **“FR Queue Optimizer”** in the App Store and install — no building.

---

## TestFlight (beta before App Store)

Same upload as above, but:
1. App Store Connect → **TestFlight** tab
2. Add **internal** testers (your team) or **external** testers (email list or public link)
3. Users install **TestFlight** from App Store, then install your app from the invite link

Good for testing with friends before full App Store launch.

---

## User install instructions (after App Store approval)

```
1. Open App Store on iPhone
2. Search "FR Queue Optimizer"
3. Tap Get / Install
4. Open app → Allow Notifications when asked
5. Tap Test alert → activate a plan
```

---

## Checklist before first submission

- [ ] Test on a real iPhone (not just simulator)
- [ ] Test alert works
- [ ] Activate a custom plan with start ~15 min out — confirm alerts fire
- [ ] App icon & screenshots ready
- [ ] Privacy policy page (can be a simple GitHub page)
- [ ] Support contact (email or Discord)

---

## Summary

| Platform | How users install |
|----------|-------------------|
| **Android** | Download APK from GitHub Releases (or Google Drive) |
| **iPhone** | **App Store only** (or TestFlight for beta) |

You build and submit **once** on a Mac. After approval, every iPhone user installs like any other app — no Node, Xcode, or git for them.
