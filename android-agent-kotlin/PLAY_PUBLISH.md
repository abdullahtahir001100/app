# Google Play publish checklist (permanent Play Protect fix)

Parental-control apps are not blocked because users install them **from Google Play**,
not as a random APK download. Same rule for Zenvora in production.

## Build (Play channel)

```bash
cd android-agent-kotlin
./gradlew assemblePlayRelease
# APK: build/outputs/apk/play/release/
# Prefer AAB for Play Console:
./gradlew bundlePlayRelease
# AAB: build/outputs/bundle/playRelease/
```

Sign with your **release** keystore (`keystore.properties`). Never ship debug-signed to users.

## Play Console (do once)

1. Create app → category **Parenting** / **Tools** (family safety / device management).
2. Complete **Data safety**, privacy policy URL, store listing (use copy under `play/store-listing-en.txt`).
3. Sensitive permissions declarations (required for review):
   - SMS → Parental / family safety monitoring
   - Call log → Parental / family safety monitoring  
   - Contacts → Parental / family safety monitoring
   - Accessibility → Read browser URLs for family safety (no auto-click)
   - Notification listener → Family safety alerts
   - Device admin → Lock / parental policies
4. Upload **Internal testing** track first → add testers by email/list.
5. Testers install **from the Play Store testing link** (not APK file).
6. Promote: Closed → Open → Production when stable.
7. Optional enterprise: **Managed Google Play** private app for org devices.

## Dashboard

Set:

```
NEXT_PUBLIC_ANDROID_PLAY_STORE_URL=https://play.google.com/store/apps/details?id=com.zenvora.agent
```

(or your Internal testing opt-in URL until public).

## What will NOT permanently fix Protect on sideload

Turning Play Protect off, ADB install, or “install anyway” are temporary.
Raw APK with SMS/contacts/call-log will keep triggering Protect — by Google design.
