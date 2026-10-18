# App update + rate-the-app: plan

Date: 2026-10-19. Scope: `apps/rider-mobile` (`com.ocar.rider`), `apps/driver-mobile` (`com.ocar.driver`), `api/`, `apps/admin`, `packages/mobile-shared`.
Status: **plan only, nothing implemented.** Claims marked **(verify)** could not be confirmed from a primary source during research.

---

## 1. Executive summary

The owner wants the Play Store / App Store update behaviour: a prompt, a download with progress, a "Restart" step, a hard "please install" screen when the app is too old, and a rate-the-app prompt.

**Recommendation (one line each):**

| # | Decision | Choice |
|---|---|---|
| 1 | Who decides "soft" vs "hard" | **Our server.** Small public endpoint plus `system_config` rows that admins already edit (with audit log) on the System config page. Play's `inAppUpdatePriority` is not used (set once per release, API only, cannot be changed afterwards). |
| 2 | Android download / restart mechanics | **Google Play In-App Updates** (`com.google.android.play:app-update:2.1.0`) through a **small local Expo module** (~150 lines of Kotlin). The ready-made `expo-in-app-updates` restarts the app by itself as soon as the download finishes, which could kill a driver's live ride, so it is rejected. |
| 3 | iOS | No silent update API exists. Server policy plus a sheet or full screen that opens the App Store (`itms-apps://`). iOS stays a later phase because `eas.json` has no iOS config. |
| 4 | Backstop for clients that ignore the prompt | **HTTP 426 `UPGRADE_REQUIRED`**, only on the three "start new work" routes (`POST /rides/sessions/online`, `/sessions/resume`, `POST /rides`), only when the request carries `X-App-Version`. It never fires mid-ride, by the same rule `canBook` / `canTakeWork` already follow. |
| 5 | OTA JS updates (expo-updates / EAS Update) | **Not now.** It does not deliver what the owner described: the Play flow already gives "download, then restart". It adds a second release channel to a payments and ride-safety app that has no mobile CI, and it cannot ship native changes (PayU, Navigation SDK, Firebase). Revisit later as an optional phase. |
| 6 | Rate the app | **`expo-store-review`** (native Play In-App Review / StoreKit). Triggered at one natural pause per app, after objective success signals, capped locally. Plus a "Rate Ocar" row in Profile that opens the store page. No "Do you like Ocar?" pre-question (Play forbids it; Apple 5.6.1 forbids custom prompts). |

**The legacy-build fact that shapes the rollout:** the apps are **not on Play yet** (`docs/PLAY_STORE_LISTING.md` still holds the "first release" notes; `docs/PLAY_STORE_READINESS_2026-10-13.md` verdict: not ready). Only sideloaded demo APKs exist in the wild (`demo-builds/ocar-rider-demo-1.0.0-2026-10-18.apk`). The cheapest correct plan is to **put the update gate in the first store build**, so no store user is ever unreachable. The demo APKs cannot be updated by Play: they are not Play-installed, and they are almost certainly signed with a different key than Play App Signing **(verify)**. Their holders must uninstall them and install from Play. A server change cannot fix that, and this plan does not try.

---

## 2. Current-state audit

Re-verified with `git grep` on 2026-10-19: no `expo-updates`, `expo-store-review`, in-app-update library, `X-App-Version`, `UPGRADE_REQUIRED`, min-version or force-update code anywhere in `apps/*-mobile`, `packages`, `api/src`.

| Area | Finding | File |
|---|---|---|
| App identity | Both apps `version: "1.0.0"`, `android.versionCode: 1`, Expo 57.0.22, RN 0.86.3, New Architecture (mandatory since SDK 55). | `apps/{driver,rider}-mobile/app.json`, `package.json` |
| EAS | `appVersionSource: "local"`, production = `app-bundle`, `submit.production: {}`, **no iOS config**, no `autoIncrement`. Driver profiles set `EXPO_PUBLIC_PAYU_ENV`. | `apps/*/eas.json` |
| Mobile CI | None. `.github/workflows/` covers API/web/infra only. Mobile builds are run by hand (local or EAS). | `.github/workflows/*`, `.claude/skills/deploy-ops/SKILL.md` |
| Release signing | `withReleaseSigning` config plugin; Play App Signing planned. | `packages/mobile-shared/plugins/withReleaseSigning.js`, `docs/PLAY_CONSOLE_NOTES.md` |
| Target SDK | 36, min SDK 24 (APK badging). Meets Play's Aug 31 2026 deadline. | `docs/PLAY_STORE_READINESS_2026-10-13.md` §"Target SDK" |
| Root layout (gate hook point) | Both apps: `src/app/_layout.tsx` renders `<Stack/>` and `SplashOverlay` once auth state is hydrated and fonts are loaded. Driver also mounts `RideRequestOverlay` there. An `<UpdateGate/>` sibling mounts here. | `apps/driver-mobile/src/app/_layout.tsx`, `apps/rider-mobile/src/app/_layout.tsx` |
| API client | Shared `createApiClient` (axios) with refresh-on-401 and `AUTH_SESSION_REPLACED` handling. No version headers, no 426 handling. Each app builds it in `src/services/api/index.ts`. | `packages/mobile-shared/src/api/client.ts` |
| Error copy | `MAINTENANCE_MODE` message exists. No `UPGRADE_REQUIRED`. | `packages/mobile-shared/src/api/errorMessages.ts` |
| Driver "busy" state | `useDriverSessionStore`: `isOnline`, `activeRide` (re-derived from the server on start). This is the "never interrupt" predicate. | `apps/driver-mobile/src/store/useDriverSessionStore.ts` |
| Rider "busy" state | No active-ride store. Live ride screen is `src/app/ride/[id]/index.tsx`, so the busy check is the route (`usePathname().startsWith('/ride/')`). | `apps/rider-mobile/src/app/ride/[id]/` |
| Existing route guards | `canBook` / `canTakeWork` gate only the routes that **start** work; the comment says this is so they never strand a passenger mid-trip. The 426 gate follows the same rule. | `api/src/modules/rides/rides.routes.ts:26-36` |
| `system_config` | Key/value text, cached reads (`getConfigValue`, 30 s TTL, invalidated on write). Super-admin PATCH with type check, bounds/allowed-values, optimistic concurrency (409 `CONFIG_CHANGED`) and `recordAuditLog`. The admin UI groups keys by `META`. There is an `is_public` column with no reader. | `api/src/lib/system-config.ts`, `api/src/lib/system-config-bounds.ts`, `api/src/modules/admin/system-config.routes.ts`, `apps/admin/lib/system-config-model.ts` |
| Kill-switch precedent | `mobile_payments_enabled` (migration 115) is read in `payu-sdk.ts`. Same pattern for the update switch. | `api/src/db/migrations/115_mobile_payments_switch.sql` |
| Latest migration | **115** at audit time (shipped as **118** after 116-117 landed on main). | `api/src/db/migrations/` |
| Middleware precedent | `maintenanceCheck` fails open on Redis error; vitest unit test with fake req/res. | `api/src/middleware/maintenance.middleware{,.test}.ts` |
| Trip rating (rider) | `RatingSection` on the trip summary: stars, tags, `submitRating`, then `onRated`. This is the natural pause for the review prompt. | `apps/rider-mobile/src/features/trip-summary/RatingSection.tsx`, `TripSummary.tsx:240` |
| Profile menus | Rider has a `MENU` array (Notifications, Saved places, Safety, Payment, Help). Driver has hand-written rows with `Linking.openURL`. | `apps/rider-mobile/src/app/(tabs)/profile.tsx:20-26`, `apps/driver-mobile/src/app/(tabs)/profile.tsx:295-306` |
| i18n | None. English only. | — |
| Persistence available | `@react-native-async-storage/async-storage` 2.2.0, `expo-secure-store`, `hybridStorage`. | both `package.json`, `packages/mobile-shared/src/storage/` |
| Version read | `expo-constants` is already a dependency: `Constants.expoConfig.version` and `.android.versionCode`. No `expo-application` is needed while there is no OTA. | — |

---

## 3. Research findings

Confidence: **H** = official doc fetched today; **M** = official but indirect, or secondary source; **V** = needs verification.

### a. Google Play In-App Updates

| Fact | Source | Conf. |
|---|---|---|
| Two modes. **Flexible**: background download, user keeps using the app, app must call `completeUpdate()` (Play does **not** restart a flexible update by itself; Google recommends asking the user first, for example with a "RESTART" snackbar). **Immediate**: full-screen Play UI, Play installs and restarts. | [In-app updates overview](https://developer.android.com/guide/playcore/in-app-updates) (updated 2026-01-30), [Kotlin guide](https://developer.android.com/guide/playcore/in-app-updates/kotlin-java) (updated 2026-10-16) | H |
| Library: `com.google.android.play:app-update:2.1.0` (+ `-ktx`). The old monolithic `play-core` is replaced by per-feature libraries. Android 5.0+ (API 21), phones/tablets/ChromeOS only, not with `.obb`. | same | H (version); M (play-core deprecation story: monolithic `play-core` is incompatible with target SDK 34+, from memory) |
| **Priority** 0–5, set **only** through the Play Developer API (`edits.tracks.releases[].inAppUpdatePriority`) at rollout time, **cannot be changed later**, and not supported for internal app sharing. | Kotlin guide; [test guide](https://developer.android.com/guide/playcore/in-app-updates/test) | H |
| `clientVersionStalenessDays()` = days since Play on the device learned of the update (nullable). | Kotlin guide | H |
| Each `AppUpdateInfo` can start one flow. To resume a stalled immediate update, check `DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS` in `onResume` and restart the flow. Check for a DOWNLOADED-but-not-installed flexible update at every entry point, or it keeps using storage. | Kotlin guide | H |
| Works only for accounts that own the app (downloaded from Play at least once), with the same app ID and signing key. **Sideloaded APKs get no in-app update.** | Test guide | H |
| Users outside a staged rollout see no update through the API **(V)**. That is the expected behaviour, but no page fetched today states it. Consequence: never set `min_supported` above a version that is at 100 % rollout. | — | V |
| Testing: **internal app sharing** (install build A from its link, upload a higher-versionCode build B, open B's link but don't install, then open the app). | Test guide | H |
| Delta / compressed patches are applied by Play to store updates, which matters for metered data **(V: Play "app updates use delta patching" is long-standing knowledge, not re-fetched)**. | — | V |

**RN / Expo library options (checked on npm and unpkg 2026-10-19):**

| Option | Health | Fit | Verdict |
|---|---|---|---|
| `expo-in-app-updates` 0.12.0 (MIT, published 2026-06-07; Expo Module; app-update 2.1.0) | Active | **Calls `appUpdateManager.completeUpdate()` automatically on `DOWNLOADED`** (restarts the app with no user consent, mid-ride possible). Redirects to the store on FAILED. No byte-progress events. | Rejected (could be forked) |
| `sp-react-native-in-app-updates` 2.0.0 (published 2026-07-10; README claims TurboModule support on Android) | Active-ish, 62 open issues | Has progress (`bytesDownloaded`), manual `installUpdate()`, iOS via iTunes lookup. Needs `react-native-device-info` or a Babel-alias shim; Java/bridge-era code. | Acceptable fallback |
| **Local Expo module** (`packages/expo-play-update`, Kotlin, app-update 2.1.0) | We own it | Exactly the API we need (info, start flexible/immediate, complete, state events with bytes). New Architecture native via Expo Modules API. iOS is a no-op stub. | **Recommended** |
| Plain store link only (`market://`) | — | No in-app download or progress; does not meet the request. | Fallback inside every flow |

### b. iOS

| Fact | Source | Conf. |
|---|---|---|
| No API to download or install an app update from inside the app. Only options: link to the App Store (`itms-apps://apps.apple.com/app/id<ID>`) or present `SKStoreProductViewController`. | Platform knowledge | M |
| iTunes Lookup `https://itunes.apple.com/lookup?bundleId=com.ocar.rider&country=in` returns the live store version. It is CDN-cached and can lag a release by hours **(V)**. | — | V |
| Phased release (7 days, automatic updates only); any user can update manually at any time. So a server-driven prompt is safe during a phased release. | App Store Connect help (from memory) | M |
| No App Review guideline forbids a minimum-version screen. 2.5.1 asks apps to stay up to date; 4.2 warns that apps that stop working can be removed. A "please update" screen is common and accepted **(V: accepted in practice, not a written rule)**. | [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (last updated 2026-10-16) | M |
| **2.3.10**: no names, icons or imagery of other mobile platforms. iOS copy must not say "Google Play". | same | H |
| **2.5.2**: apps may not download or execute code that "introduces or changes features or functionality". The interpreted-code allowance OTA relies on is in the Apple Developer Program License Agreement (often cited as §3.3.1(B) / 3.3.2), **not** in the Review Guidelines. "3.3.2" does not exist in the current Review Guidelines text. | same | H (2.5.2 text); V (DPLA clause number) |

### c. OTA (expo-updates / EAS Update)

| Fact | Source | Conf. |
|---|---|---|
| `runtimeVersion` policy: `appVersion` (= `version`) or `fingerprint` (hash of native code/config, safer for native-heavy apps like the driver app). Channels map to build profiles. `checkAutomatically`: `ON_LOAD` (default), `ON_ERROR_RECOVERY`, `WIFI_ONLY`, `NEVER`. `useUpdates()` exposes `isUpdateAvailable`/`isUpdatePending`; `fetchUpdateAsync()` then `reloadAsync()`. | [expo-updates docs](https://docs.expo.dev/versions/latest/sdk/updates), [runtime versions](https://docs.expo.dev/eas-update/runtime-versions) (Context7) | H |
| Cannot change native code or dependencies, permissions or the SDK version. Rollback = republish an older update. Percentage rollouts exist. | [EAS Update FAQ](https://docs.expo.dev/eas-update/faq/) | H |
| Pricing: free 1,000 MAU / 100 GiB; Starter 3,000 MAU; Production 50,000 MAU; overage $0.005/MAU. | [expo.dev/pricing](https://expo.dev/pricing) | H |
| Play Device and Network Abuse: no downloading **executable** code (dex/JAR/.so) from outside Play; code run in a VM or interpreter is exempt, but must not enable policy violations; "may not modify, replace, or update itself using any method other than Google Play's update mechanism". OTA JS is widely treated as falling under the interpreter exemption. EAS ships **Hermes bytecode**, and how that classifies is not addressed in anything fetched **(V)**. | [Device and Network Abuse](https://support.google.com/googleplay/android-developer/answer/9888379) | M / V |
| Code signing for updates exists (paid plans) **(V: plan tier)**. | — | V |

**Assessment for Ocar:** the blast radius of a bad OTA is every running client at the next launch. That includes drivers mid-shift on a relaunch, which `relaunchRouting.ts` handles, and an OTA that breaks it strands a ride. A bad store release is limited by staged rollout and can be halted. Today every meaningful change also touches API contracts that are already versioned by deploy. Defer OTA (Phase 6, optional). If it is adopted later: `fingerprint` runtime, `checkAutomatically: NEVER`, check and fetch only while the app is not busy, apply only on a cold start (never call `reloadAsync()` while busy), separate `preview`/`production` channels, 10 % rollout first.

### d. Server-driven version policy (design rationale)

- The server decides `action ∈ {none, soft, hard}` from the client's version, so the client has no compare logic to get wrong. Semver is compared numerically on `MAJOR.MINOR.PATCH` (no pre-release tags; reject them on admin save).
- **Fail open:** network error, timeout (5 s) or 5xx means no prompt. A hard block must never come from the client failing to reach us.
- **Never interrupt:** the client defers any hard screen while busy (driver online or on a ride; rider on `/ride/*`). The 426 backstop exists only on routes that start new work.
- **Legacy builds:** a request without `X-App-Version` is never gated, so web portals, the demo APKs and any old build keep working until a person reinstalls. That is the honest limit: a binary without a handler cannot be force-updated. Blocking header-less requests would also block the web apps. The only real fix is to ship the gate in the first store build (§8, Phase 2).
- **Interaction with `mobile_payments_enabled`:** independent. If a PayU SDK-side change ever forces an upgrade, raise `min_supported` for `driver/android`; the payments switch stays the instant kill. No coupling code.

### e. UX guidance

| Rule | Source | Conf. |
|---|---|---|
| Flexible = non-blocking; tell the user when the download is done and let them choose when to restart (snackbar "An update has just been downloaded. RESTART"). | Kotlin guide | H |
| Immediate is reserved for updates "critical to core functionality". | Overview | H |
| Material: snackbars for brief, low-priority messages with at most one action; dialogs for interruptions that need a decision. So: soft = bottom sheet, downloaded = snackbar-style bar, hard = full screen **(M, from Material guidance, not re-fetched)**. | m3.material.io | M |
| One surface at a time, and never during OTP entry, payment, SOS or an active trip. Snooze 72 h after "Not now"; after 3 snoozes, or 14 days stale, the soft sheet shows on every cold start but stays dismissable. | Product judgement | — |
| Cheap Android, metered data: show the download size when Play reports it (`totalBytesToDownload`); never auto-start a flexible download; Play's own delta patching keeps size down. | — | M |

### f. Rate the app

| Fact | Source | Conf. |
|---|---|---|
| Play: trigger after the user has experienced enough of the app; **don't ask any questions before or while presenting** ("Do you like the app?", "Would you rate 5 stars"); don't modify or overlay the card; **no call-to-action button** that triggers the API (quota can silently suppress it, so use a store link instead). Quota is opaque ("less than a month" between calls may not show). | [In-app review](https://developer.android.com/guide/playcore/in-app-review) (updated 2026-01-30) | H |
| Testing: internal **test track** = full flow, quota not enforced; internal **app sharing** = submit button disabled; `FakeReviewManager` for unit tests. | [Test in-app review](https://developer.android.com/guide/playcore/in-app-review/test) | H |
| Apple **5.6.1**: "Use the provided API to prompt users to review your app … we will disallow custom review prompts." **3.2.2(x)**: must not force rating/review to access functionality. **5.6.3**: manipulating reviews not permitted. | [Guidelines](https://developer.apple.com/app-store/review/guidelines/) | H |
| Apple shows the system prompt at most **3 times per 365 days**; the system may suppress it; don't call it from a button; write-review deep link `…/id<ID>?action=write-review`. | [Requesting App Store reviews](https://developer.apple.com/documentation/storekit/requesting-app-store-reviews) (page body did not load) | M |
| Play prohibits incentivised ratings (money, goods or the equivalent for a rating). | [Android Developers Blog 2017](https://android-developers.googleblog.com/2017/06/google-plays-policy-on-incentivized.html) (live policy page not fetched) | M |
| `expo-store-review`: `isAvailableAsync()` (iOS false on TestFlight), `hasAction()`, `requestReview()`, `storeUrl()` reads `ios.appStoreUrl` / `android.playStoreUrl` from app config. SDK 57 line = `~57.0.3`. | [expo-store-review](https://docs.expo.dev/versions/latest/sdk/storereview) (Context7), npm | H |

**Review-gating risk:** sending only happy users to the store is the pattern both stores frown on. The trip-rating stars rate the **driver**, a real feature, not a pre-question about the app. Even so, the default eligibility below uses only **objective** success signals (ride completed, no cancel, no dispute, no SOS). Using "rider gave ≥ 4 stars" as an extra filter is listed as an owner decision, flagged as a grey area.

### g. Store requirements touching this work

| Item | Detail | Conf. |
|---|---|---|
| Target API | Phone/tablet: API 36 required for new apps and updates from **Aug 31 2026**; extension to **Nov 1 2026**. The apps target 36 already. | [Target API](https://support.google.com/googleplay/android-developer/answer/11926878) H |
| Release tracks | Internal → closed → production, with staged rollout % and **halt rollout**. A personal developer account created after 13 Nov 2023 needs a 12-tester / 14-day closed test before production (`docs/PLAY_STORE_READINESS_2026-10-13.md`). | H (from repo doc) |
| Signing | Play App Signing + upload key (`withReleaseSigning`). In-app update testing needs the same signing key as Play. | H |
| versionCode | Must strictly increase per upload. Today it is hand-set (`appVersionSource: local`). | H |
| Data safety | The app version sent in a header and logged server-side is probably not "user data" on its own; if Play treats it as such it falls under "App info and performance" **(V)**. If prompt analytics are tied to a user ID, declare "App activity → App interactions". Plan: log only in server request logs and keep no new client analytics SDK. | V |
| Play update priority in CI | `eas submit` does not appear to expose `inAppUpdatePriority` **(V)**. Not needed, because the server decides (§4). | V |
| iOS | `eas.json` has no iOS build/submit config. Needs an Apple Developer account, the App Store numeric ID (for `ios.appStoreUrl` and links), TestFlight, optional phased release, privacy manifest (AsyncStorage uses UserDefaults → `NSPrivacyAccessedAPICategoryUserDefaults`; Expo modules ship their own manifests **(V)**). `requestReview` does nothing on TestFlight. | M |

---

## 4. Decision table

| Decision | Options | Pick | Why / risk |
|---|---|---|---|
| **D1 OTA** | (a) none (b) expo-updates on launch (c) expo-updates, manual, idle-only | **(a) now, (c) optional later** | The owner's flow is met by Play flexible updates. OTA doubles the release surface for a payments + safety app with no mobile CI, and native modules limit it anyway. Risk of (a): JS-only hotfixes wait for Play review (hours to ~1 day). |
| **D2 Android in-app update** | expo-in-app-updates / sp-react-native-in-app-updates / local module / link only | **Local Expo module** | expo-in-app-updates auto-restarts on download (ride-safety bug). sp-… is a viable fallback but needs a device-info shim. The local module is ~150 lines against a stable Google API. Risk: we maintain Kotlin; mitigated by its small size and app-update 2.x being stable. |
| **D3 Soft/hard source** | Play priority / staleness only / **server policy** | **Server policy**, Play staleness only for snooze escalation | Priority is immutable and API-only; the server is admin-editable, audited, and works for iOS too. |
| **D4 Policy storage** | new `app_version_policy` table / one JSON `system_config` row / **flat `system_config` rows** | **Flat rows** (§6) | Reuses admin UI, audit log, concurrency check, cache and invalidation. A new table would need its own admin CRUD. A JSON row is easy to break by hand. Risk: 9 rows of config noise; grouped under one "App updates" heading. |
| **D5 Version identity** | semver string / versionCode | **semver `version`** (admin-friendly); `X-App-Build` sent for logs only | One rule across both platforms. Discipline: bump `version` on every store release (§7.5). |
| **D6 Backstop** | 426 on every request / **426 on start-work routes** / none | **Start-work routes only** | Every-request 426 could break a live ride or an SOS. The start-work set mirrors `canBook`/`canTakeWork`. |
| **D7 iOS strategy** | iTunes lookup compare / **server policy + App Store link** | **Server policy + link**; add iTunes lookup only if prompts reach users before the release is live | Admins raise `recommended` only after the release is live, so lookup adds nothing yet. |
| **D8 Rate prompt** | custom "Enjoying Ocar?" / **native API at a natural pause** | **Native API**, objective eligibility, Profile store link | Policy (Play guide, Apple 5.6.1). |
| **D9 Prompt state** | server `last_prompted` / **AsyncStorage** | **AsyncStorage** | OS quotas cap abuse anyway. A server column only helps across reinstalls. Add it if analytics need it. |

---

## 5. Target UX spec

### 5.1 Precedence (never stack popups)

`hard block` > `restart-to-finish bar` > `soft sheet` > `rate prompt`. At most one is visible. No soft sheet and no rate prompt in the same session (in-memory flag).

**Busy (all prompts deferred, hard block too):**
- Driver: `isOnline || activeRide != null` (`useDriverSessionStore`), or a PayU payment sheet is open.
- Rider: `pathname.startsWith('/ride/')`, or the booking fare / payment step is open (`/booking/fare`).
- Both apps: OTP input focused (login), SOS flow open.

When busy flips to false, the gate re-evaluates (subscribe to the store / pathname).

### 5.2 Policy check state machine (both platforms)

```
            launch / AppState→active (throttle 30 min)
                          │
                 GET /app/version-policy  ──timeout/err──► NONE (fail-open)
                          │
          ┌───────────────┼────────────────┐
        none            soft              hard
          │               │                 │
        (idle)   snoozed or busy? ─yes─► wait   busy? ─yes─► wait (re-check on idle)
                          │no               │no
                 Android: Play info         ▼
                 available&&flexible?   HARD SCREEN (§5.5)
                   │yes        │no(staged/sideload)
              SOFT SHEET     skip (don't advertise an update the store won't give)
                 iOS: SOFT SHEET (App Store link)
```

### 5.3 Android flexible flow

```
SOFT SHEET ─"Update"──► startUpdate(FLEXIBLE) ──Play consent dialog──┐
     │"Not now"→ snooze 72h                       user cancels → snooze 72h
     ▼                                                              │accept
   (idle)                     DOWNLOADING (pill: progress %, size)◄─┘
                                       │ DOWNLOADED
                          busy? ─yes─► hold; show bar when idle
                                       │no
                       RESTART BAR "Update ready" [Restart]
                                       │ tap
                               completeUpdate() → Play installs + relaunches
On every cold start/resume: installStatus==DOWNLOADED → show RESTART BAR (Play guidance).
FAILED → toast "Update didn't finish. Try again later." → snooze 24h.
```

### 5.4 Android immediate flow (hard)

```
HARD SCREEN ─"Update now"──► Play info: immediateAllowed? ─yes─► startUpdate(IMMEDIATE) (Play full screen)
                                   │no / error / sideloaded          │ cancelled → back on HARD SCREEN
                                   ▼                                 │ success → Play restarts app
                         Linking.openURL(market://details?id=…)  (fallback https://play.google.com/store/apps/details?id=…)
onResume: updateAvailability==DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS → resume IMMEDIATE.
```

### 5.5 Wireframes and copy (English; §10 Q3 for Odia/Hindi)

**Soft-update sheet (bottom sheet, dismissable, swipe down = Not now)**
```
┌──────────────────────────────────────┐
│  ⬆  A new version of Ocar is ready   │
│                                      │
│  Update for the latest fixes and     │
│  improvements.                       │
│  Download size: 8 MB      (Android)  │
│                                      │
│  [        Update        ]            │
│           Not now                    │
└──────────────────────────────────────┘
```
- Title: `A new version of Ocar is ready`
- Body: `Update for the latest fixes and improvements.` (Download size line only when Play reports `totalBytes`.)
- Primary: Android `Update`; iOS `Open App Store`. Secondary: `Not now`.

**Downloading pill (top, non-blocking, no buttons)**
```
┌─────────────────────────────┐
│ Downloading update… 42%  ▓▓▓░░ │
└─────────────────────────────┘
```
- `Downloading update… {pct}%` (if total bytes unknown: `Downloading update…`)
- Screen-reader announcement at 0 %, 50 % and done only (no per-percent spam).

**Restart-to-finish bar (bottom, persistent until tapped or relaunch)**
```
┌──────────────────────────────────────┐
│ Update ready.                [Restart] │
└──────────────────────────────────────┘
```
- `Update ready. Restart to finish.` Action `Restart`.
- Driver: never shown while online or on a ride. Rider: hidden on `/ride/*`.

**Hard-block full screen (no back, no dismiss; Android back button = exit app)**
```
┌──────────────────────────────────────┐
│                                      │
│           [Ocar logo mark]           │
│                                      │
│     Please update Ocar to continue   │
│                                      │
│  This version is no longer supported.│
│  Update to keep booking rides.       │  ← rider
│  Update to keep taking rides.        │  ← driver
│                                      │
│  [          Update now          ]    │
│        Contact support               │
└──────────────────────────────────────┘
```
- Title `Please update Ocar to continue`. Body per app as above. Primary Android `Update now`, iOS `Open App Store`. Secondary `Contact support` (existing support mailto).
- Offline on this screen: keep it (the server already said hard), and show `You're offline. Connect to the internet to update.` under the button.

**iOS variants:** identical layouts. Buttons say `Open App Store`. No mention of Google Play anywhere in the iOS build (2.3.10); shared copy says "Update" with no store name.

**OTA toast (only if Phase 6 is adopted):** `Ocar was updated. Restart now to apply.` [Restart] | applied silently at the next cold start if ignored.

**426 from the server (start-work action):** the interceptor opens the hard screen at once. Fallback message (`errorMessages.ts`): `Please update Ocar to continue.`

**Accessibility:** focus moves to the sheet or screen title on open; buttons ≥ 48 dp; text uses existing `typography` tokens (scales with font size); the pill and bar use `accessibilityLiveRegion="polite"`; no colour-only meaning.

### 5.6 Rate-prompt eligibility (pure function, unit-tested)

| Rule | Rider | Driver |
|---|---|---|
| Moment | 1.5 s after `RatingSection` `onRated` on the trip summary (or on summary close if not rated) | When the driver goes **offline** after ≥ 1 completed ride that session |
| Lifetime completed rides | ≥ 3 | ≥ 10 |
| Days since first launch | ≥ 7 | ≥ 14 |
| This ride / session | completed, not cancelled, no dispute, no SOS | no SOS / dispute that session |
| Since last prompt | ≥ 120 days (iOS: Apple also caps at 3/yr) | ≥ 120 days |
| Lifetime prompts (local) | ≤ 3 | ≤ 3 |
| Never | if an update surface was shown this session; while busy | while online or on a ride |
| Optional (owner, §10 Q5) | rider gave the driver ≥ 4 stars (grey area) | — |

Then: `if (await StoreReview.isAvailableAsync() && await StoreReview.hasAction()) StoreReview.requestReview()`, and record `lastPromptAt` whatever the outcome (the result is unknowable by design).

**Profile row (manual, any time):** label `Rate Ocar`, sub `Tell others what you think`. Android `market://details?id=<pkg>` (fallback https URL); iOS `itms-apps://apps.apple.com/app/id<ID>?action=write-review`. It **never** calls `requestReview()` (Play forbids a button that triggers it).

---

## 6. Backend spec

### 6.1 Migration `118_app_update_policy.sql`

The values are text versions; `0.0.0` means "never prompt or block". Insert with `ON CONFLICT (key) DO NOTHING` (migration 115 pattern) and `is_public = true` (these values are served unauthenticated). Never `UPDATE` in a migration.

| key | default | meaning |
|---|---|---|
| `app_update_enabled` | `'true'` | Kill switch. `false` → endpoint always returns `none` and the 426 gate is off (≤ 30 s, invalidated at once on admin save) |
| `app_update_rider_android_min` | `0.0.0` | below → hard |
| `app_update_rider_android_recommended` | `0.0.0` | below → soft |
| `app_update_driver_android_min` / `_recommended` | `0.0.0` | |
| `app_update_rider_ios_min` / `_recommended` | `0.0.0` | seeded now, unused until iOS ships |
| `app_update_driver_ios_min` / `_recommended` | `0.0.0` | |
Skipped on purpose: `app_update_message` (custom hard-screen text) and per-app release notes. The copy is fixed, and Play / App Store "What's new" carries the notes. `validateConfigValue` also rejects empty `string` values, so an "empty = none" row would need a sentinel. Add these rows when someone asks.

`system-config-bounds.ts`: add `app_update_enabled: ['true','false']` to `ALLOWED_VALUES`, and a 4-line `PATTERNS` check (`/^\d{1,3}\.\d{1,3}\.\d{1,3}$/`) for keys matching `^app_update_.*_(min|recommended)$`, returning `value must look like 1.2.3`.

`apps/admin/lib/system-config-model.ts`: new group `{ id: 'app', title: 'App updates', blurb: 'Ask or require riders and drivers to update their app.' }` with META entries. `*_min` is marked `critical: true`, help: `Anyone below this version must update before booking (rider) or going online (driver). Only raise it to a version that is 100% rolled out on the store.`

### 6.2 Endpoint

`GET /api/v1/app/version-policy?app=rider|driver&platform=android|ios&version=1.2.0` (public, no auth, under `generalLimiter`; zod-validated; 422 on bad input).

```json
200 OK
Cache-Control: public, max-age=300
{
  "action": "soft",
  "min_supported": "1.1.0",
  "recommended": "1.3.0",
  "store_url": "https://play.google.com/store/apps/details?id=com.ocar.rider"
}
```
- `action` = `hard` if `version < min`, else `soft` if `version < recommended`, else `none`. Kill switch off → `none`.
- `store_url` comes from a constant map (package IDs; the iOS URL needs the App Store ID, null until it exists). Not configurable.
- **Skipped:** `latest` (Play / App Store already know it), `rollout` flags (Play staged rollout does this), `message` (fixed copy). Add one when there is a real need.

Files: `api/src/modules/app-version/app-version.routes.ts` (route + the pure `compareVersions` / `decideAction` helpers in the same file or a sibling `app-version.policy.ts`) and `app-version.policy.test.ts`. Mount `apiRouter.use('/app', appVersionRouter)` in `app.ts`.

### 6.3 426 gate

`requireSupportedApp: RequestHandler` in the same module:
1. Read `X-App-Name`, `X-App-Platform`, `X-App-Version`. If any is missing or invalid → `next()` (web portals, legacy builds).
2. `app_update_enabled !== 'true'` → `next()`.
3. `decideAction(...) === 'hard'` → `426 { error: 'Please update Ocar to continue', code: 'UPGRADE_REQUIRED', store_url }`. Add `UPGRADE_REQUIRED` to `AppErrors` (httpStatus 426).
4. Any error reading config → `next()` (fail open, like `maintenanceCheck`).

Applied **only** to: `POST /rides/sessions/online`, `POST /rides/sessions/resume`, `POST /rides` (booking), placed after `canTakeWork` / `canBook`. **Not** on `/:id/accept`: a driver already online on an old build finishes the shift and is gated at the next go-online. **Not** on auth, so the user can still log in and see the hard screen instead of a broken login.

Socket.io handshakes are not gated (in-ride channel).

### 6.4 Observability

Add `app_version`, `app_platform`, `app_name` (from the headers) to the pino-http custom props, so Loki can answer "what share of drivers are on ≥ 1.3.0" before anyone raises `min`. No new Prometheus label (keeps cardinality flat). Log `upgrade_required` at info when the gate fires.

### 6.5 Tests (vitest, `maintenance.middleware.test.ts` style)

- `compareVersions`: equal, patch/minor/major ordering, `1.10.0 > 1.9.0`, invalid input.
- `decideAction`: none/soft/hard; kill switch off → none; `recommended < min` handled.
- Route: 422 on bad `app`/`platform`/`version`; 200 body shape; `Cache-Control` set.
- `requireSupportedApp`: no headers → next; old version → 426 body; switch off → next; config throws → next.
- `system-config-bounds`: version pattern accepts `1.2.3`, rejects `1.2`, `v1.2.3`, `1.2.3-beta`.
- Admin model test: new keys land in group `app`.

---

## 7. Mobile implementation spec

### 7.1 Shared code (`packages/mobile-shared/src/update/`)

| File | Contents |
|---|---|
| `appInfo.ts` | `getAppInfo(app)` → `{ name, platform: Platform.OS, version: Constants.expoConfig.version, build: String(android.versionCode ?? ios.buildNumber) }` |
| `useAppUpdate.ts` | The §5.2–5.4 state machine: policy fetch (5 s timeout, fail-open), AppState throttle, snooze state in AsyncStorage `ocar_update_state` `{ snoozedUntil, snoozeCount }`, busy deferral, Play module calls (Android only). Pure reducer exported for tests. |
| `UpdateGate.tsx` | Renders the sheet, pill, bar or hard screen from the hook state (uses existing `Button`, `SlideModal`, tokens). Props `{ app, isBusy, logoSource, supportEmail }`. |
| `storeLinks.ts` | `openStorePage(pkg, iosId?, {writeReview})` with market:// → https fallback. |
| `reviewPrompt.ts` | `isEligibleForReview(state, facts)` (pure) + `maybeRequestReview(facts)` + AsyncStorage `ocar_review_state` `{ firstOpenAt, lastPromptAt, promptCount }`. |
| `*.test.ts` | Reducer transitions, eligibility table, store-link fallback. |

Add `expo-store-review ~57.0.3` to mobile-shared (and to each app so autolinking picks it up). No `expo-application`, no `expo-updates`.

### 7.2 API client

`createApiClient` gets an optional `appInfo` and `onUpgradeRequired`:
- request interceptor sets `X-App-Name`, `X-App-Platform`, `X-App-Version`, `X-App-Build`;
- response interceptor: `code === 'UPGRADE_REQUIRED'` → `onUpgradeRequired()` then reject.
- `errorMessages.ts`: add `UPGRADE_REQUIRED: 'Please update Ocar to continue.'`.

The token-refresh axios call in `createTokenRefresher` can stay header-less (auth is never gated).

### 7.3 Native module `packages/expo-play-update` (Android only)

`expo-module.config.json` (platforms: android), `android/build.gradle` → `implementation "com.google.android.play:app-update:2.1.0"`, Kotlin `ExpoPlayUpdateModule`:

| JS API | Native |
|---|---|
| `getInfo(): Promise<{ available, flexibleAllowed, immediateAllowed, stalenessDays, installStatus, inProgress, totalBytes }>` | `appUpdateInfo` task; errors (not from Play, no Play Store) resolve `{ available:false }` |
| `start(type: 'flexible'\|'immediate'): Promise<'ok'\|'canceled'\|'failed'>` | `startUpdateFlowForResult` with `AppUpdateOptions`, result via `OnActivityResult` |
| `complete(): Promise<void>` | `completeUpdate()`; **only ever called from JS on the user's Restart tap** |
| event `onState { status, bytesDownloaded, totalBytes }` | `InstallStateUpdatedListener`; unregister in `OnDestroy` |

JS stub for iOS/web returns `{ available:false }`. Add as a workspace dependency of both apps; it is autolinked (pnpm workspace + Expo autolinking; check with `npx expo-modules-autolinking resolve` **(V)**). ProGuard: the Play libraries ship consumer rules **(V)**; add a `-keep` if R8 strips the listener.

### 7.4 Per-app changes

| App | File | Change |
|---|---|---|
| both | `src/services/api/index.ts` | pass `appInfo: getAppInfo('rider'|'driver')`, `onUpgradeRequired: () => useUpdateStore.forceHard()` (small zustand slice inside `useAppUpdate`) |
| both | `src/app/_layout.tsx` | mount `<UpdateGate app=… isBusy={…} logoSource={logoMarkImage}/>` after `<Stack/>`, before `SplashOverlay` |
| driver | `_layout.tsx` | `isBusy = useDriverSessionStore(s => s.isOnline \|\| s.activeRide != null)` |
| rider | `_layout.tsx` | `isBusy = usePathname().startsWith('/ride/') \|\| pathname === '/booking/fare'` |
| rider | `features/trip-summary/TripSummary.tsx` | call `maybeRequestReview({...})` from `onRated` (after refresh), facts from the ride (status completed, no dispute or SOS flags, lifetime rides from the profile stats already fetched) |
| driver | go-offline handler (`features/go-online/*`) | `maybeRequestReview` after a successful offline with ≥ 1 completed ride in the session |
| both | `(tabs)/profile.tsx` | `Rate Ocar` row → `openStorePage(..., { writeReview: true })` |
| both | `app.json` | `android.playStoreUrl`, later `ios.appStoreUrl`; `expo-store-review` needs no plugin **(V)** |
| both | `eas.json` | `"appVersionSource": "remote"` + `"autoIncrement": true` on `production` (EAS owns versionCode, so it never collides). Keep `version` hand-bumped. |

### 7.5 Version discipline

- `version` (semver) is bumped in `app.json` for **every** store release: patch for fixes, minor for features. The server policy compares only this, so two store builds with the same `version` are indistinguishable to the gate.
- `versionCode` is auto-incremented by EAS (remote). Record `version → versionCode` in the release notes.
- The first Play production upload must be the first build containing `UpdateGate` (Phase 2). Suggested `1.1.0` so it is clearly distinct from the `1.0.0` demo APKs.

---

## 8. Phased rollout

| Phase | Ships | Acceptance criteria | Test plan |
|---|---|---|---|
| **0. Prereqs** (owner + 0.25 d) | Play Console apps exist with an internal testing track; App Store ID if iOS is in scope | Internal track can install both apps from Play | — |
| **1. Backend** | Migration 118, bounds pattern, endpoint, 426 gate on 3 routes, pino props, admin group | All seeded at `0.0.0`, so production behaviour is unchanged; admin can edit with audit rows | §6.5 vitest; `pnpm migrate` on Docker PG; `curl` the endpoint; `npx tsc --noEmit`; admin page shows the "App updates" group |
| **2. Gate in the first store build** (must precede any reliance) | Headers, `UpdateGate` soft and hard (store link only, no Play module yet), 426 handling, Profile "Rate Ocar" row, version `1.1.0` | Dev build against local API: set `rider_android_min=9.0.0` → hard screen on launch; driver online → no hard screen until offline; then go-online returns 426 → hard screen; API down → no prompt; kill switch false → nothing within 30 s | Dev build (`eas build --profile development` or `expo run:android`) with `EXPO_PUBLIC_API_URL` → local API; edit rows in local admin; jest tests for the reducer |
| **3. Play in-app updates** | `expo-play-update` module; flexible sheet + pill + restart bar; immediate flow on hard; resume on `onResume` | Internal app sharing: build A (1.1.0) installed, build B (1.1.1) uploaded; `recommended=1.1.1` → sheet → download pill → restart bar → relaunch on B. `min=1.1.1` → immediate Play screen; cancel → back on hard screen; kill the app mid-immediate → resumes. Sideloaded APK → falls back to the store link | Internal app sharing per [test guide](https://developer.android.com/guide/playcore/in-app-updates/test) (same signing key, account owns the app); one physical low-end device on mobile data |
| **4. Rate prompt** | `expo-store-review`, eligibility + both triggers | Eligibility unit tests cover every row of §5.6; on the internal **test track** (quota not enforced) the native card appears after the qualifying ride; never while busy; not after an update surface in the same session | Internal test track (not app sharing: submit is disabled there); FakeReviewManager not needed (JS-level tests) |
| **5. iOS** (owner decision) | eas.json iOS profiles, `ios.appStoreUrl`, App Store links, privacy-manifest check, TestFlight | Same as Phase 2 acceptance on a TestFlight build (review prompt does nothing on TestFlight, by design) | TestFlight + a sandbox App Store version bump |
| **6. OTA (optional)** | expo-updates, `fingerprint`, `NEVER` + idle-only manual check, cold-start apply | A bad update can be rolled back by republishing; never reloads while busy | Preview channel first, 10 % rollout |

**Ordering constraints**
1. Phase 2 must be in the **first** Play production release. Any build without it is unreachable except by the user reinstalling.
2. Phase 1 can deploy before Phase 2 (defaults are inert). Phase 2 clients fail open if the endpoint is missing, so the order is flexible, but deploy 1 first.
3. Never raise `*_min` before that version is at 100 % on Play (and live on the App Store for iOS).
4. Demo APK holders (1.0.0 sideloaded): announce "uninstall the demo, install from Play". They see no prompt, since they have no gate, and a Play install over them will likely fail on a signature mismatch **(V)**.

---

## 9. Release / ops runbook

**Raise the soft prompt** (each release): release N reaches 100 % on Play → super-admin sets `app_update_<app>_android_recommended = N` on System config → users on < N see the sheet (snooze 72 h).

**Raise the hard minimum** (rare, e.g. a breaking API or a security fix):
1. N at 100 % for ≥ 7 days with soft prompt on.
2. Check adoption in Loki: count of distinct `user_id`/`driver_id` by `app_version` over 7 days (§6.4). Proceed when the share below N is small or acceptable.
3. Drivers: send an admin broadcast (existing `/admin/notifications` broadcasts) 24 h ahead: "Update Ocar Driver from Play Store before your next shift."
4. Set `*_min = N` off-peak. Drivers already online keep working; they hit the gate at their next go-online or app open while idle.
5. Watch `upgrade_required` log lines and support email for 24 h.

**Kill switch:** `app_update_enabled = false` stops every prompt and 426 within 30 s (cache invalidated on save). Use it if the gate misfires (for example a wrong `min` typed, or a store outage where the update isn't downloadable).

**Bad release N:** halt the rollout in Play Console; set `recommended` back to N-1 (stops nudging people onto N). Users already on N cannot downgrade, so fix forward with N+1. Never point `min` at a halted release.

**Comms templates:** driver push/SMS text above; rider: none needed (soft sheet suffices) unless `min` rises.

---

## 10. Open questions for the owner

1. **Play status:** ✅ ANSWERED 2026-10-19: **organisation account**, so the 12-tester / 14-day closed test does not apply; internal track → production directly (an organisation account still needs D-U-N-S verification, already done at account creation). **Still open:** date of the first production upload. Phase 2 must be in it.
2. **iOS:** ✅ ANSWERED 2026-10-19: **iOS is in scope**. Phase 5 is committed, not optional. **Still open:** timing, and whether the Apple Developer account and App Store IDs exist (needed for Phase 0 and Phase 5). Since the first store build must carry the gate on both platforms (ordering constraint 1), iOS work (eas.json iOS profiles, `ios.appStoreUrl`) should be pulled forward to just after Phase 2 so the first App Store build also ships the gate.
3. **Languages:** English only (as the apps are today), or Odia / Hindi for update and rate copy? Adding them means introducing i18n to both apps first.
4. **OTA:** do you want JS-only hotfixes without store review (Phase 6), accepting the extra risk on a payments and ride-safety app?
5. **Rate-prompt filter:** prompt riders only after they gave the driver ≥ 4 stars (more 5-star reviews, but a review-gating grey area), or on objective success alone (recommended)?

---

## 11. Effort estimate (one developer, days)

| Phase | Days |
|---|---|
| 0 Prereqs (code side) | 0.25 |
| 1 Backend + admin + tests | 1.5 |
| 2 Shared gate, headers, 426, Profile row, both apps | 2.5 |
| 3 Play in-app update module + flexible/immediate UX + internal-sharing test | 2.5 |
| 4 Rate prompt + eligibility tests + test-track check | 1.5 |
| 5 iOS (code only; Apple account and review lead time extra) | 1.5 |
| 6 OTA (optional) | 2–3 |
| **Total, Phases 1–4 (Android)** | **≈ 8** |

---

### Sources (fetched 2026-10-19 unless noted)
- Play in-app updates: https://developer.android.com/guide/playcore/in-app-updates · https://developer.android.com/guide/playcore/in-app-updates/kotlin-java · https://developer.android.com/guide/playcore/in-app-updates/test
- Play in-app review: https://developer.android.com/guide/playcore/in-app-review · https://developer.android.com/guide/playcore/in-app-review/test
- Play target API: https://support.google.com/googleplay/android-developer/answer/11926878
- Play Device and Network Abuse: https://support.google.com/googleplay/android-developer/answer/9888379 (via search summary)
- Play incentivised ratings (2017 blog): https://android-developers.googleblog.com/2017/06/google-plays-policy-on-incentivized.html
- Apple App Review Guidelines (updated 2026-10-16): https://developer.apple.com/app-store/review/guidelines/
- Apple review requests: https://developer.apple.com/documentation/storekit/requesting-app-store-reviews (body not retrieved; facts from memory, marked M)
- expo-updates / runtime versions / store-review (Context7 `/websites/expo_dev`): https://docs.expo.dev/versions/latest/sdk/updates · https://docs.expo.dev/eas-update/runtime-versions · https://docs.expo.dev/versions/latest/sdk/storereview
- EAS Update FAQ: https://docs.expo.dev/eas-update/faq/ · Pricing: https://expo.dev/pricing
- Libraries (npm/unpkg): expo-in-app-updates 0.12.0 (`ExpoInAppUpdatesModule.kt`: `completeUpdate()` inside the DOWNLOADED listener), sp-react-native-in-app-updates 2.0.0 / https://github.com/SudoPlz/sp-react-native-in-app-updates, expo-store-review 57.0.3, expo-updates 57.0.26
