# React Native + Expo Mobile — Android-First Build Spec (Rider & Driver Apps)

**Supersedes for execution purposes:** `2026-09-14-react-native-expo-mobile-mvp.md` (kept as historical record; this doc carries forward its scope decisions and refines architecture, folder structure, and sequencing).

**Window:** 15 days, solo build, **Android-only completion target.** iOS is written in parallel by default (RN is cross-platform, most code is shared), but iOS-specific testing, native store polish, and submission are explicitly Phase 2, after day 15 — not inside this window.

**Stack:** Expo SDK 55+ (New Architecture is mandatory, not optional, as of SDK 55 — RN 0.83), custom development builds (not Expo Go — background location, Firebase messaging, and maps all need native modules Expo Go can't load), TypeScript, two new apps + one shared package inside the existing pnpm + Turborepo monorepo.

**Build strategy (local-first):** all day-to-day builds run locally via `npx expo run:android` against the Android SDK/JDK/emulator installed on this machine — no EAS account, login, or cloud queue needed through day 10. This is strictly faster for iteration (no upload/queue wait) and has no monthly build quota. EAS is brought in twice: a `preview`-profile dry run on days 11-12 to de-risk the pipeline itself (added during the full-plan review — see Section 4), then the real `production`-profile AAB on day 15 for the Play Console internal testing track upload — see Section 4's EAS build profiles and the day-by-day below.

---

## 1. Scope recap (Android-only reframe)

Same feature boundaries as the 2026-09-14 draft. What changes is what "done" means at day 15: **fully working and installable on Android via Play Console internal testing**, not "both platforms working."

**P0 — must ship on Android by day 15:**
- Rider app: OTP auth, point-to-point booking (pickup/drop via `/geo`), live driver tracking, ride lifecycle through cash payment, ride history.
- Driver app: OTP auth, online/offline + background location, incoming ride-request handling (socket + push), accept → arrived → start-OTP → in-progress → end-OTP → cash collection, trip history/earnings summary.
- Push notifications (FCM) for ride-request alerts and status updates, on Android, in foreground/background/killed states.

**P1 — stretch, cut first if behind (Android only):**
- Outstation: round-trip toggle, `GET /rides/return-cab-available`, `POST /rides/:id/start-return`.
- Rentals: package-tier selection via `GET /pricing/rental-packages/:categoryId`.
- Multi-stop (`POST /rides/:id/stops`, `PATCH /rides/:id/stops/:sequence`).

**Explicitly out of the 15-day window (unchanged):**
- Razorpay in-app payment (cash-only; backend already supports it, pure UI later).
- Driver onboarding/document upload (stays on the existing web driver app).
- In-app chat UI (`chat:message`/`chat:read` already exist server-side).
- Admin-facing anything.

**Explicitly deferred to Phase 2 (iOS), not part of the 15-day gate:**
- Physical iOS device testing.
- Apple Developer Program enrollment and its lead time.
- iOS background-location "Always" permission flow and its App Store review scrutiny.
- TestFlight distribution.
- App Store submission/review.

**Day 9 checkpoint (shifted from day 8 during the full-plan review — a Day 5 background-location spike was inserted, per Section 7's outside-voice finding, pushing driver booking from Days 8-10 to Days 9-10):** if Android P0 isn't functionally complete by day 9, P1 does not start — days 11-12 get reabsorbed into P0 hardening instead.

**Day 15 checkpoint (new, hard gate):** Android build installable from Play Console internal testing, full P0 flow walked end-to-end on a physical Android device, no P0 regression bugs open. This is the exit criterion for the 15-day window regardless of iOS state.

---

## 2. Monorepo & folder structure

Research finding that changes the 2026-09-14 draft: Expo's own SDK 55 guidance (updated Jan 2026) moved the default app code location from root `/app` to `/src/app`, specifically to separate application logic from config files (`app.json`, `eas.json`, etc. staying at the package root). Both mobile apps should follow this from day 1.

```
apps/
  rider-mobile/
    app.json
    eas.json
    babel.config.js
    metro.config.js
    tsconfig.json
    src/
      app/                          # expo-router file-based routes ONLY — screens compose from features/
        _layout.tsx                 # root stack, auth guard, providers (theme, query client, socket)
        index.tsx                   # splash/redirect based on auth state
        (auth)/
          _layout.tsx
          phone.tsx
          otp.tsx
        (tabs)/
          _layout.tsx
          home.tsx                  # map + book CTA
          trips.tsx                 # ride history list
          profile.tsx
        booking/
          select-destination.tsx
          select-ride.tsx
          searching.tsx
        ride/
          [id]/
            index.tsx               # live tracking screen
            otp.tsx
            rate.tsx
      features/                     # domain logic + screen-level components, no routing
        auth/
          components/
          hooks/                    # useOtpRequest, useOtpVerify
        booking/
          components/               # FareCard, CategoryPicker, StopList
          hooks/                    # useFareEstimate, useCreateRide
        ride-tracking/
          components/               # DriverMarker, EtaBanner, RideStatusSheet
          hooks/                    # useRideSocket, useDriverLocation
        ride-history/
          components/
          hooks/
      services/                     # side-effecting singletons, imported by features/hooks, not by routes directly
        api/                        # thin app-specific wrappers around packages/mobile-shared's typed client
        socket/                     # ride-room join/leave wiring specific to rider flows
        location/                   # foreground-only for rider (map recenter), no background mode needed
        notifications/              # FCM registration + foreground/background handler + deep-link resolver
        # No services/storage/ -- updated 2026-09-16: storage wiring (hybridStorage,
        # createSecurePersistStorage) lives directly in store/useAuthStore.ts, which already
        # owns its own persist key namespacing. A separate re-export layer had no job to do.
      store/                        # zustand stores — mirrors apps/driver's proven pattern (useAuthStore, useRideStore)
      theme/                        # tokens ported from DESIGN.md, re-exported from packages/mobile-shared/theme
      components/                   # generic, ride-agnostic UI primitives not already in the shared package
      utils/

  driver-mobile/
    (same top-level shape as rider-mobile)
    src/
      app/
        _layout.tsx
        (auth)/...
        (tabs)/
          _layout.tsx
          home.tsx                  # online/offline toggle, earnings summary
          earnings.tsx
          profile.tsx
        active-ride/
          incoming.tsx              # incoming request full-screen alert
          navigate-to-pickup.tsx
          start-otp.tsx
          in-progress.tsx
          end-otp.tsx
          collect-cash.tsx
      features/
        auth/
        go-online/                  # online/offline toggle, background-location permission flow
        ride-requests/              # incoming request countdown, accept/reject
        active-ride/                # navigate/start/in-progress/end/cash-collect
        earnings/
      services/
        api/
        socket/                     # ride:request, ride:request:ack, location:update emit wiring
        location/                   # foreground AND background modes — the highest-risk module, see Section 3
        notifications/
        storage/
      store/
      theme/
      components/
      utils/

packages/
  mobile-shared/
    package.json                    # name: "@ocar/mobile-shared", workspace:* dependency in both apps
    src/
      api/
        client.ts                   # axios instance factory + refresh-token interceptor
        errorMessages.ts            # mapOtpErrorCode() and future error-code -> copy maps
        jwt.ts                      # tokenExpiresSoon()
        types.ts                    # shared response/request types
        # No per-domain typed wrapper modules (auth.ts/rides.ts/geo.ts/pricing.ts/vehicles.ts) --
        # updated 2026-09-16: decided against these during the full-plan review. Screens/hooks call
        # api.post('/api/v1/...')/api.get(...) inline with the full path, matching apps/driver's own
        # web convention exactly (verified: Login.tsx has no auth.ts wrapper either).
      socket/
        createSocket.ts             # io() factory with the same auth/reconnect contract as apps/driver's socket.ts
      storage/
        secureStorage.ts            # expo-secure-store wrapper — see Section 3 for the 2048-byte caveat
      theme/
        tokens.ts                   # colors (#4F46E5 indigo family), spacing, typography — ported from DESIGN.md
      ui/                           # cross-app primitives: Button, Input, Card, Skeleton, ErrorState, EmptyState
      utils/
        currency.ts
        distance.ts
```

**Reasoning per top-level folder:**
- `app/` holds only route files (expo-router reads the folder tree to build navigation). Keeping it route-only prevents the common anti-pattern of screens accumulating business logic that then can't be reused or tested outside the router.
- `features/<domain>/` groups everything a vertical slice needs (its own components + hooks) so a feature can be understood, changed, or removed without hunting across `components/`, `hooks/`, `api/` folders scattered by type.
- `services/` is for singletons with a lifecycle (socket connection, location watch, notification listeners, storage) — things that exist independently of any one screen and need explicit start/stop semantics, as opposed to `features/*/hooks` which are screen-scoped.
- `store/` mirrors the exact pattern already proven in `apps/driver/src/store` (zustand + persist, e.g. `useRideStore.ts`'s `partialize` pattern for surviving app restarts) — no need to invent a different state approach for the mobile apps.
- `packages/mobile-shared` holds only what is byte-for-byte identical between rider and driver: API client, socket factory, secure storage, theme tokens, generic UI. Ride-specific socket event handling (`ride:request` on driver vs `ride:status_update` on rider) stays in each app's own `services/socket/`, not shared — forcing that into the shared package would create a false abstraction across two different event contracts.

**Monorepo wiring notes:**
- `packages/mobile-shared` is a plain TypeScript workspace package (no build step needed — Metro can resolve and transpile workspace TS source directly via `metro.config.js`'s `watchFolders` + `resolver.nodeModulesPaths`, the standard pnpm-monorepo Metro pattern). No separate `tsc` build/publish cycle inside the 15 days.
- Both apps' `metro.config.js` must extend the monorepo root (`getDefaultConfig(__dirname)` then add `watchFolders: [monorepoRoot]` and dedupe `resolver.nodeModulesPaths`) — this is the standard pnpm+Expo+Turborepo pattern; skipping it is the most common cause of "module not found" errors for workspace packages in Expo monorepos.
- Turborepo pipeline: add `dev`, `android`, and `typecheck` tasks for both new apps to `turbo.json`, matching the existing per-app task shape already used for `apps/admin`/`apps/user`/`apps/driver`.
- **Root `.npmrc`: `node-linker=hoisted` + `shamefully-hoist=true` (issue 1C, investigated during the full-plan review).** Repo-wide, not scoped to the mobile workspace — pnpm has no per-package `.npmrc` scoping for a root-level `pnpm install`, so this affects `api/` and all three existing web apps too. **Confirmed still required, not legacy**: removed it and did a clean reinstall + rebuild as a test — `react-native-worklets`' native Android build failed with `CreateProcess error=2, file not found` trying to resolve `prefab_command.bat` through pnpm's symlinked `.pnpm` virtual store, a distinct pnpm-symlink/native-autolinking incompatibility, separate from the original Windows 260-char path-length issue that moving the repo to `C:\ocar` already fixed. Restored the setting; rebuild succeeded again. Regression risk is low (hoisting can only add resolvable modules, never remove one that currently works) but worth revisiting if a phantom-dependency bug ever appears in `api/` or the web apps.

---

## 3. Service layer design

**Ownership rule (binding for both apps):** side-effecting services (socket, location, notifications) are owned by a top-level provider mounted once in `app/_layout.tsx`, which subscribes to the relevant zustand store and starts/stops the service in response to store state changes — screens never call `connect()`/`disconnect()` directly. This mirrors why `apps/driver/src/lib/socket.ts` centralizes reconnect/refresh logic in one module rather than per-screen: it prevents duplicate connections when a user navigates back and forth between screens, and it makes "did we tear this down correctly on logout" a single code path to audit instead of N screens.

Concretely, for the driver app: a `RideLifecycleProvider` (or the `_layout.tsx` root component) watches `useRideStore().activeRide` and `useSessionStore().isOnline`, and:
- starts the socket connection and joins `driver:{driverId}` when the driver goes online,
- starts background location tracking when `isOnline` flips true, stops it when false,
- joins `ride:{id}` when `activeRide` is set, leaves it when cleared.

This is a direct port of the proven concept in `apps/driver/src/lib/socket.ts` and `useRideStore.ts` — the mobile spec does not reinvent this, it re-expresses the same lifecycle ownership in a provider because RN has no route-level `App.tsx` singleton the way the Vite app does.

### 3.1 API client (`packages/mobile-shared/src/api/client.ts`)
- Axios instance, `baseURL` from `process.env.EXPO_PUBLIC_API_URL` — Expo inlines `EXPO_PUBLIC_*` vars at build time via its babel plugin, no `expo-constants` indirection needed (updated 2026-09-16: simpler than the originally-planned `expo-constants`/EAS-build-profile approach, and already verified working). Each app's `.env.example` documents the Android-emulator default (`http://10.0.2.2:3000`, the emulator's host-loopback alias).
- **Physical-device networking (outside-voice finding, added during the full-plan review):** `10.0.2.2` only resolves inside the Android emulator — Day 15's physical-device testing requirement needs `EXPO_PUBLIC_API_URL` pointed at the dev machine's LAN IP instead (e.g. `http://192.168.x.x:3000`), with the phone on the same Wi-Fi network. Two easy-to-miss blockers the first time: confirm the API server binds `0.0.0.0` (not just `localhost`), and confirm the dev machine's firewall allows inbound traffic on the API port from the phone's IP.
- Request interceptor attaches `Authorization: Bearer <accessToken>` from secure storage.
- Response interceptor: on 401, single in-flight refresh (same `refreshInProgress` boolean guard pattern already used in `apps/driver/src/lib/socket.ts`) against `POST /auth/refresh`, retries the original request once, and on refresh failure clears auth and routes to `(auth)/phone`.
- Never logs `error.message` from API responses in any UI-facing surface, matching the project-wide rule of codes/safe messages only.

### 3.2 Socket service (`services/socket/` per app, factory from `packages/mobile-shared/src/socket/createSocket.ts`)
- `transports: ['websocket']` only, matching the backend's no-sticky-session ALB setup (already established in the 2026-09-14 draft and confirmed correct — no change).
- `auth: { token }` on connect; token refreshed and re-applied via the same `connect_error` → refresh → reconnect pattern as `apps/driver/src/lib/socket.ts`, ported as-is.
- **Room membership is tracked in app state, not assumed from the socket.** On every `connect` event (including reconnects), the provider re-emits `join:ride` for the current `activeRide.id` if one exists, and re-registers the driver/user private room. This is the standard mitigation for the well-documented socket.io-client behavior where a dropped connection loses all room membership silently — the fix is always "the client re-joins after reconnect," never relying on the library to remember.
- Android backgrounding note: the OS can suspend network activity for a backgrounded app, so the socket should be treated as advisory, not authoritative — the app must reconcile ride state via a `GET /rides/:id` fetch on `AppState` transitioning back to `active`, not assume the socket delivered every event while backgrounded.

### 3.3 Location service (`services/location/`, driver app only needs background mode)
- Rider app: foreground-only (`Location.watchPositionAsync` with `Accuracy.Balanced`), used purely for map recenter and pickup-pin placement. No background permission requested at all — requesting it without a corresponding feature is exactly what Play Store's background-location policy review flags.
- Driver app: two explicit modes exposed as `startForegroundTracking()` / `startBackgroundTracking()` / `stop()`:
  - Foreground mode while browsing screens with the app open (matches ~3s cadence already used by the web driver app in `useDriverLocation.ts`/`ride-api.ts`'s location POST).
  - Background mode (`Location.startLocationUpdatesAsync` with `TaskManager`) only while `isOnline === true`, emitting both the socket `location:update` event and falling back to the `POST /sessions/location` HTTP path exactly as the existing web driver app does — no new server contract needed.
  - `stop()` is called the instant the driver goes offline or logs out — background location must never run without an active online/ride reason, both for battery and for Play Store policy compliance.

### 3.4 Notifications service (`services/notifications/`)

**Updated 2026-09-16 after Days 3-4's `/plan-eng-review`** — the original design below (FCM via `react-native-firebase` directly) was superseded once `google-services.json` turned out to still be unavailable at Days 3-4. The actual, reviewed, and implemented design:

- `registerPushNotifications(apiClient, channelConfig)` / `unregisterPushNotifications(apiClient, token)` in `packages/mobile-shared/src/notifications/registerPushNotifications.ts` — takes an **injected** `getFcmToken: () => Promise<string | null>` callback rather than importing `@react-native-firebase/messaging` directly, because that package isn't installed yet (its Android Gradle build requires `google-services.json`, still not available). Each app's `services/notifications/index.ts` currently passes a stub returning `null`, marked `// TODO(fcm)`; swapping in a real `() => messaging().getToken()` once the config file lands is a one-line change, nothing else in the module changes.
- Android notification channels are created via `expo-notifications`' `Notifications.setNotificationChannelAsync()` — no Notifee dependency. Driver gets a `default` channel plus a high-importance `ride_requests` channel; rider gets `default` only.
- Permission is requested via `expo-notifications`' `requestPermissionsAsync()` (covers the Android 13+ `POST_NOTIFICATIONS` runtime permission, which RNFirebase does not manage itself). The grant/deny outcome is stored on `useAuthStore` as `pushPermissionGranted` for later phases to act on (see 7.1's permission-denial finding).
- **Still to build once FCM is real** (Days 9-10 / 13-14 per the day-by-day): `messaging().onMessage()` foreground listener, `messaging().setBackgroundMessageHandler()`, `onNotificationOpenedApp()`/`getInitialNotification()` deep-linking into `ride/[id]`, and the data-only-message pattern for the driver's full-screen incoming-request UI. These are unaffected by the stub — they're new code once messaging is installed, not a rework of what Days 3-4 built.

### 3.5 Secure storage service (`packages/mobile-shared/src/storage/secureStorage.ts`)
- `expo-secure-store`, Keystore-backed on Android. Confirmed 2026 caveat: values are capped around 2048 bytes and newer SDKs throw (not just warn) past that limit — store only `accessToken`, `refreshToken`, and a small user/driver identity blob (id, phone, role) here. Anything larger (full profile objects, ride history cache) goes in AsyncStorage or the zustand `persist` middleware's default storage, never SecureStore.
- One key namespace per app (`ocar_rider_auth` / `ocar_driver_auth`), matching the existing web apps' naming convention (`ocar_user_token`, `ocar_driver_auth`).

---

## 4. Android-specific technical requirements (priority work for the 15 days)

**Permissions (`app.json` / config plugin, driver app):**
```json
{
  "android": {
    "permissions": [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_LOCATION",
      "POST_NOTIFICATIONS"
    ]
  }
}
```
Rider app only needs `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION` — no background permission, per Section 3.3.

**`expo-location` config plugin (driver app `app.json`):**
```json
[
  "expo-location",
  {
    "locationAlwaysAndWhenInUsePermission": "Ocar needs your location in the background to match you with nearby ride requests and track active trips.",
    "isAndroidForegroundServiceEnabled": true,
    "isAndroidBackgroundLocationEnabled": true,
    "foregroundService": {
      "notificationTitle": "Ocar is tracking your location",
      "notificationBody": "Required while you're online to receive ride requests.",
      "notificationColor": "#4F46E5"
    }
  }
]
```

**Play Store policy — real submission risk, must be handled inside the 15 days, not after:**
- **Prominent in-app disclosure is mandatory before requesting background location**, shown in normal app flow (not buried in a settings screen), stating what data is collected and why. Build this as a dedicated screen in `features/go-online/` shown the first time a driver attempts to go online, before the OS permission dialog fires.
- Google's review requires background location to be tied to a core, undeniable feature — ride matching while backgrounded is a defensible justification, but the disclosure copy and the Play Console "Data safety" form must say so explicitly and consistently.
- Google Play review for apps requesting background location historically requires a **short demonstration video** showing the disclosure dialog and the feature in use, submitted through Play Console's App Content section — budget time for this in the release-prep days, it is not optional paperwork.
- Do not request `ACCESS_BACKGROUND_LOCATION` in the rider app at all — there is no feature that justifies it, and doing so risks the whole app being flagged.

**Battery optimization guidance for testers:** Android's Doze/App Standby can throttle background location on some OEMs (Xiaomi/Oppo/Vivo especially) even with a foreground service running. Document (in the internal test invite, not shippable UI) that testers should disable battery optimization for the driver app during the pilot, and treat this as a known Android fragmentation risk to watch for during days 14-15 device testing, not a bug to chase in-app.

**Local vs EAS builds — when each is used:**
- **Days 1-10: local builds only.** `npx expo prebuild --platform android` generates the native `android/` project once (regenerate after any config-plugin/native-dependency change), then `npx expo run:android` builds via local Gradle + JDK 17 and installs straight onto the connected device/emulator via `adb`. No account, no login, no upload wait, no monthly quota — this is the fast inner loop for days 1-10, including the day 5 background-location spike and driver FCM work in days 9-10.
- **Days 11-12: one EAS dry-run build (outside-voice finding, added during the full-plan review).** `eas build --profile preview --platform android` (internal-distribution APK, no production signing) during the existing P1/stretch window — this is the first `eas login` and the first time the config-plugin resolution and cloud build queue run under EAS instead of local Gradle. De-risks the pipeline itself days before it's load-bearing, so anything that surfaces here gets fixed with real slack still available, not discovered for the first time on day 15.
- **Day 15: the production EAS build.** `eas build --profile production --platform android` produces the signed AAB required for Play Console upload — EAS's managed keystore signing is the one piece worth using its cloud service for (self-managing a release keystore locally is possible but not worth the setup time inside this window). By this point the pipeline itself is already proven from the day 11-12 dry run; day 15 only has to prove the production signing config specifically.
- `eas.json` still defines all three profiles for optionality (`development` dev-client, `preview` internal-distribution APK, `production` AAB) — `development` cloud builds remain a fallback only (e.g. if local Gradle breaks and there's no time to debug it), not the default path.

**Play Console internal testing track:**
- Fastest structured distribution option Google offers — up to 100 testers via email list, no external review wait the way TestFlight's external tier has.
- Real caveat found in research: the app must already have a Play Console listing created (even in draft) before an internal test can be attached — this is a one-time setup task, not a per-build wait, so create the Play Console app listing and internal testing track shell on day 1-2 alongside Firebase config, not on day 14.
- No meaningful "Apple-style" review lead time for internal testing specifically — realistic lead time is Play Console account/listing setup (hours, one-time) plus normal build upload time, which is why "Android first" is a sound sequencing bet: nothing in the Android distribution path has an external multi-day review gate the way iOS TestFlight external testing or App Store review does.

---

## 5. iOS — parallel but deferred

**What "written in parallel automatically" means in practice:** because `features/`, `services/` (aside from `location/`'s platform-specific calls), `store/`, `theme/`, and nearly all screens in `app/` are pure RN/JS with no Android-specific API calls, an `npx expo run:ios` build will compile and largely work the moment the Android build works — expo-router, zustand, the API client, and the socket service do not need platform branches. The iOS-specific surface area is narrow and known in advance:

- `expo-location`'s background mode config (`UIBackgroundModes: ["location"]` + `NSLocationAlwaysAndWhenInUseUsageDescription` + an explicit `requestBackgroundPermissionsAsync()` call, which iOS requires as a separate step after foreground permission is already granted — unlike Android where both can be requested together).
- Push: `react-native-firebase` already abstracts FCM vs APNs under one API, so the app code does not branch — but APNs requires its own certificate/key uploaded to the Firebase project, which is an infra step, not a code change.
- iOS notification permission prompt copy/timing (iOS's permission dialog is a one-shot, no re-prompt without a settings deep-link, so the timing of the ask matters more than on Android).

**Phase 2 task list (after day 15, not gating it):**
1. Apple Developer Program enrollment — this has the least compressible lead time of anything in this entire project and should be started as early as organizationally possible even though the coding work is deferred, since enrollment/verification can itself take days.
2. Run `expo run:ios` / first `eas build --platform ios --profile development` and fix whatever narrow iOS-specific issues surface (expect mostly config-plugin and permission-copy issues, not logic rewrites).
3. iOS background-location "Always" permission flow and its App Store review scrutiny — Apple's review for background location is at least as strict as Google's, arguably stricter about the "Always" tier specifically; expect a similar prominent-disclosure requirement plus possible reviewer questions.
4. TestFlight internal, then external testing (external requires Apple's ~48-hour build review and has a 90-day build expiry to track).
5. App Store submission and review.

---

## 6. Smoothness / UX standards (binding conventions, not optional polish)

| Concern | Choice | Why |
|---|---|---|
| Ride history / long lists | `FlashList` (Shopify) | Confirmed still the current standard for RN list virtualization in 2026; drop-in FlatList replacement with far better recycling performance — use from day 1, not a later optimization pass. |
| Transitions / gesture-driven UI | `react-native-reanimated` v3 (already required by expo-router's own transitions and by `@gorhom/bottom-sheet` v5) | Runs on the UI thread, avoids JS-thread jank during map/list interaction — this is the same engine expo-router itself now uses for its native transitions, so no extra dependency conflict. |
| Bottom sheets (ride details, category picker, incoming request) | `@gorhom/bottom-sheet` v5 | Still the de facto standard, confirmed current in 2026 research; requires `GestureHandlerRootView` at the app root and `BottomSheetView`/`BottomSheetScrollView` wrappers for any scrollable content per its v5 API. |
| Images (driver photo, vehicle photo) | `expo-image` | Built-in disk+memory caching and placeholder/blurhash support out of the box, avoids the flicker/re-fetch problems of RN's default `Image`. |
| Loading states | Skeleton components in `packages/mobile-shared/src/ui` (`Skeleton.tsx`) for ride history, fare estimate, and profile screens | Perceived-performance win for the exact screens that hit the network on every mount; treat as a required state per screen (loading/error/empty/data), not just a spinner. |
| Optimistic UI | OTP verify (advance to next screen immediately, roll back on server rejection) and ride actions (accept/arrive/start/end show the new state immediately, reconcile on socket/API confirmation) | These are the exact interactions where perceived latency matters most (a driver tapping "Accept" needs instant feedback before another driver's accept could race it) — the reconciliation-on-confirm pattern is required, not "just show a spinner and wait." |
| Map re-renders | Memoize marker components, update driver marker position via a ref-driven animated value rather than React state on every socket tick | `react-native-maps` markers re-rendering on every ~1s location tick is the most common source of map jank in RN ride-hailing apps; this is a correctness requirement for the tracking screen, not a nice-to-have. |
| Gesture root | `GestureHandlerRootView` wraps the app root in both apps' `_layout.tsx` | Required by both `@gorhom/bottom-sheet` and Reanimated's gesture-driven transitions — a common source of "gestures don't work" bugs when omitted. |

---

## 7. Revised day-by-day (15 days, Android-only target)

**Day 1 — Foundation**
Scaffold `apps/rider-mobile`, `apps/driver-mobile` (both using the `src/app` SDK 55 layout), `packages/mobile-shared`, wire pnpm workspace + `metro.config.js` `watchFolders`/`nodeModulesPaths`, add Turborepo tasks. Run `npx expo prebuild --platform android` + `npx expo run:android` locally for both apps to confirm the toolchain (JDK 17, Android SDK, `adb`) is wired correctly end-to-end — this is the local-build smoke test, no EAS/cloud step here. Create the Play Console app listings (draft) and internal testing track shells for both apps — **assumes account identity verification (Section 8.2) was already started before day 1** (outside-voice finding, added during the full-plan review); if it wasn't, that verification is the actual blocking pre-day-1 gate, not a same-day task. Confirm Firebase config (`google-services.json`) is available for the backend's Firebase project.

**Day 2 — Shared foundations**
Build `packages/mobile-shared`: API client + refresh interceptor, socket factory, secure storage wrapper, theme tokens, base UI primitives (Button, Input, Card, Skeleton). `GestureHandlerRootView` + Reanimated installed and verified working in both apps.

**Days 3-4 — Auth + navigation shell (both apps) — DONE, see commit `9c11439`**
OTP request/verify screens against `/auth/otp/request` and `/otp/verify`, with optimistic advance-then-rollback UX. Token refresh wired end-to-end. `expo-router` stacks with protected-route guard via `(auth)`/`(tabs)` groups. Rider: home/map tab shell. Driver: online/offline toggle shell, earnings tab shell. Android notification channels created via `expo-notifications`, device tokens registering against `/api/v1/notifications/devices` — `@react-native-firebase/messaging` itself is **not** installed yet (stubbed pending `google-services.json`, see updated Section 3.4). Full detail, screen-by-screen, in Section 7.1.

### 7.1 Days 3-4 detail

**App boot / auth-state sequence (added during the full-plan review — the most complex state machine either app has, worth a diagram):**

```
App launch
   │
   ▼
SplashScreen.preventAutoHideAsync()  (root _layout.tsx, module scope)
   │
   ▼
zustand-persist rehydration starts
   │
   ├── SecureStore/AsyncStorage read throws ──► clearAuth() (fail-safe logged-out)
   │        (issue 1B)                                │
   │                                                   ▼
   └── read succeeds ──────────────────────────► hasHydrated = true
                                                        │
                                                        ▼
                                        SplashScreen.hideAsync()
                                                        │
                                                        ▼
                                        root Stack renders index.tsx
                                                        │
                                        isAuthenticated? ─────────────┐
                                             │ no                     │ yes
                                             ▼                        ▼
                                    Redirect /(auth)/phone   Redirect /(tabs)/home
                                             │                        │
                              (auth)/_layout guard:          (tabs)/_layout guard:
                              isAuthenticated? ──yes──►      isAuthenticated? ──no──►
                              bounce to /(tabs)/home          bounce to /(auth)/phone
                                             │                        │
                                             ▼                        ▼
                                    phone.tsx renders            tab screens render
                                    (step: 'phone' | 'otp'
                                     sub-state, same screen)
                                             │
                                    OTP verify succeeds
                                             │
                                             ▼
                                    setAuth() + setupPushNotifications()
                                             │
                                             ▼
                                    router.replace('/(tabs)/home')
```

Every arrow above already has an owning code path: the two `_layout.tsx` guards are defense-in-depth against direct deep links (verification checkpoint #3), not just the default `index.tsx` redirect.

**Confirmed contracts (read from `api/src/modules/auth` and `api/src/modules/notifications` directly, not assumed):**
- `POST /auth/otp/request` — body `{ phone, role: 'user'|'driver', purpose: 'login' }` → `{ message, otp? }` (`otp` present only outside production, for dev). Errors: `AUTH_OTP_RATE_LIMITED`, `AUTH_OTP_LOCKED`.
- `POST /auth/otp/verify` — body `{ phone, otp, role, purpose: 'login' }` → `201` (`isNew`) or `200` with `{ tokens: { accessToken, refreshToken, expiresIn, refreshExpiresIn }, principal, isNew }`. Errors: `AUTH_OTP_EXPIRED`, `AUTH_OTP_LOCKED`, `AUTH_OTP_INVALID`.
- `POST /api/v1/notifications/devices` (authenticated) — body `{ token, platform: 'android' }` → `204`. `DELETE` same path/body to unregister.
- Backend already sends raw FCM pushes (M10 done) — the client needs a real FCM token, not an Expo push token, so `@react-native-firebase/messaging` is required over `expo-notifications`' own push service (which would hand back an Expo-format token the backend can't send to).

**Screens — reusing `apps/driver/src/pages/Login.tsx`'s proven two-step UX, not reinventing it:**
- `(auth)/phone.tsx` — phone entry, `formatPhone()` ported as-is (10-digit → `+91` prefix). `keyboardType="phone-pad"`, submit button disabled until 10 digits.
- `(auth)/otp.tsx` — **one** `TextInput`, not four/six manual digit boxes: `textContentType="oneTimeCode"` (iOS autofill) + `autoComplete="sms-otp"` + `keyboardType="number-pad"` (Android autofill). This is simultaneously the accessible choice (a screen reader handles one field far better than N boxes with manual focus-juggling), the platform-recommended choice (native SMS autofill on both OSes for free), and the lazy choice (no paste-splitting/backspace-across-boxes logic to write or debug). Reuse the `countdownRef`/`setInterval` 30s resend-cooldown pattern and the `otpRequestInFlightRef`/`otpVerifyInFlightRef` double-submit guards verbatim from `Login.tsx`. In non-production, auto-populate the field from the response's `otp` field (mirrors `devOtp` in the web app) to keep the 15-day dev loop fast.
- Step transition (phone → otp) is a Reanimated `FadeIn`/`SlideInRight` on the same screen, not a stack push — it's a sub-state, not a new route (matches the web app's `AnimatePresence` treatment of the same flow). **Android back-button gap (outside-voice finding, resolved):** since there's no second route to pop, Android's hardware/gesture back from the OTP sub-state would otherwise exit the `(auth)` stack instead of returning to phone entry (the web pattern this was ported from has no hardware back button, so this was silently dropped in the port). Fixed with a `BackHandler.addEventListener('hardwareBackPress', ...)` active only in the OTP sub-state, reverting to the phone sub-state and returning `true` (handled) instead of the default pop.
- Optimistic advance-then-rollback (already a binding convention per Section 6): on submit, the button shows a spinner and the input is disabled ("verifying" sub-state) rather than navigating away immediately; only route to `(tabs)` on confirmed success. On rejection, re-enable the input and show one specific inline message per error code via `mapOtpErrorCode()` (issue 2A, resolved) — a new pure function in `packages/mobile-shared/src/api/errorMessages.ts` (`AUTH_OTP_EXPIRED` → "Code expired, request a new one"; `AUTH_OTP_INVALID` → "Incorrect code"; `AUTH_OTP_LOCKED`/`AUTH_OTP_RATE_LIMITED` → "Too many attempts, try again in a few minutes"), shared by both apps instead of duplicated — never surface `error.message` or raw response bodies (CLAUDE.md security rule applies to the client too, not just the API).

**`useAuthStore` per app** — new stores for both apps (there is no existing mobile or rider-web zustand store to port — rider-web's `apps/user/lib/auth-context.tsx` is plain React Context; `apps/driver/src/store/useAuthStore.ts` is the *shape reference*, not something either mobile store extends), following the same shape (`token`/`refreshToken`/`driver` or `user`/`isAuthenticated`/`setAuth`/`clearAuth`). **Hybrid storage split (issue 1A, resolved):** `secureStorage.ts` itself documents a hard 2048-byte ceiling and says explicitly "never full profile/history objects" — persisting the entire store as one blob through it would violate that ceiling as the profile shape grows (vehicle info, documents, etc., already foreshadowed elsewhere in this codebase). `packages/mobile-shared` exports a `hybridSecureStorage` (zustand `StateStorage`) that routes `token`/`refreshToken` through `createSecurePersistStorage()` (SecureStore-backed) and everything else (`user`/`driver`, `isAuthenticated`) through plain `AsyncStorage`, driven by the persisted key name. `rider-mobile` stores `user`, `driver-mobile` stores `driver` (same `DriverProfile` shape already defined web-side).

**Write-path atomicity (outside-voice finding, resolved):** a single zustand `persist` write fanning out to two backends risks leaving auth state inconsistent if one write succeeds and the other throws (e.g. SecureStore quota/keystore error). `hybridSecureStorage.setItem()` writes the SecureStore (token) portion first; the AsyncStorage (profile) write only runs if that succeeds, and either failure rejects the whole call so zustand's persist middleware surfaces the error rather than silently landing a half-written state — a later state change retries the write and self-heals.

**Testability (outside-voice finding, resolved):** rather than `hybridSecureStorage` importing `expo-secure-store`/`AsyncStorage` directly, it's `createHybridStorage(secure, async)` — a factory taking both backends as injected parameters, matching the `createApiClient`/`createSocket` pattern already established. The `vitest` test passes trivial in-memory fakes for both, so the routing logic gets full coverage with zero native-module mocking — no `jest-expo`/`AsyncStorage` jest mock needed, and no second test runner in the package.

**Wiring `createApiClient`/`createSocket`:** instantiated once per app in `src/services/api/index.ts` / `src/services/socket/index.ts`, passed the store's token getters and `setAuth`/`clearAuth` as the factories' injected callbacks — per Day 2's decision that these factories take callbacks and must not assume either app's store shape.

**Dedup decision (logged `f7b56947`):** the FCM registration sequence and the secure-persist storage adapter are identical logic across both apps, so both become `packages/mobile-shared` factories rather than being written twice — `createSecurePersistStorage()` (above) and `registerPushNotifications(apiClient, channelConfig)` (below), matching the existing `createApiClient`/`createSocket` pattern of taking injected config rather than assuming an app's shape.

**Route guards (`expo-router`):**
- `(auth)/_layout.tsx`: `isAuthenticated` → `<Redirect href="/(tabs)/home" />`.
- `(tabs)/_layout.tsx`: not `isAuthenticated` → `<Redirect href="/(auth)/phone" />`.
- Root `_layout.tsx`: hold the splash screen (`SplashScreen.preventAutoHideAsync()`) until zustand-persist finishes rehydrating from `hybridSecureStorage`, then hide it — without this guard there's a real, common RN bug where the wrong screen flashes for one frame before the redirect fires.
- **Rehydration failure (issue 1B, resolved):** if `SecureStore.getItemAsync()` throws during rehydration (corrupted keychain entry, OS-level keystore error — a real, not hypothetical, failure mode), the rehydration `await` is wrapped in `try/catch`; any error calls `clearAuth()` (fail safe to logged-out) before hiding the splash, so the app never hangs indefinitely on a black splash screen — worst case the user has to log in again.
- **`hasHydrated` signal (outside-voice finding, resolved):** the store's `onRehydrateStorage` callback (the same one wired for the 1B fix above) also sets a `hasHydrated: true` field once rehydration settles (success or failure) — later phases (e.g. Days 6-8's deep-link-into-`ride/[id]` routing from a killed-state notification tap) read this instead of re-deriving the same rehydration-complete signal from scratch.

**Tab shells (scaffolded stub files from Day 1, now given real shells):**
- Rider `(tabs)`: `home` (static "Where to?" search-bar shell — the real map lands Days 6-8), `trips`/`profile` show `EmptyState` from `mobile-shared` until wired.
- Driver `(tabs)`: `home` (online/offline toggle rendered but inert/disabled — real logic is Days 9-10 (background location itself is Day 5's spike), a static disabled `Button` is enough now, not a state machine built early), `earnings`/`profile` show `EmptyState`.
- Built on `expo-router`'s built-in `Tabs`, respecting the 44×44pt minimum touch target (Apple HIG / Material both mandate this) and `tabBarAccessibilityLabel` on any icon-only tab.

**FCM device-token registration — `registerPushNotifications(apiClient, channelConfig)` in `packages/mobile-shared`:** takes the app's `createApiClient` instance and a small per-app channel config (rider passes a default channel only; driver additionally passes the high-importance `ride_requests` channel), so the permission/token/register sequence itself is written once. Called only after login (the route requires `authenticate()`): request `POST_NOTIFICATIONS` runtime permission on Android 13+ via `expo-notifications`' permission API (RNFirebase doesn't manage this Android 13 runtime permission itself), get the FCM token via `@react-native-firebase/messaging`, `POST /notifications/devices` with `{ token, platform: 'android' }`, and create the app's Android notification channels with `Notifications.setNotificationChannelAsync()` (already part of `expo-notifications`, no extra `notifee` dependency needed). On logout, each app calls the matching `unregisterPushNotifications(apiClient)` best-effort (`DELETE /notifications/devices`) before clearing its store — not blocking logout on it.

**Permission-denial signal (outside-voice finding, resolved):** for the driver app specifically, a denied `POST_NOTIFICATIONS` prompt means silently missing OS alerts for incoming ride requests — a functional gap, not cosmetic. `registerPushNotifications()` returns whether permission was granted; both apps store that outcome now (`pushPermissionGranted` on `useAuthStore`) so the fact isn't lost, but the actual settings-redirect banner UI is deferred to Days 13-14's already-planned "full FCM handling" polish pass rather than pulled into this auth-focused phase — the driver home tab is still an inert shell this phase anyway (Days 9-10 owns the real online/offline logic), so a banner on it now would have nowhere functional to point back to.

**Accessibility (built into these screens now, not audited in later as an afterthought):**
- Every interactive element gets `accessibilityRole` + `accessibilityLabel` — icons are never the only cue.
- Phone/OTP inputs get `accessibilityHint` describing the expected format.
- Inline error text uses `accessibilityLiveRegion="polite"` so a screen reader announces it automatically — no imperative `AccessibilityInfo.announceForAccessibility()` call needed for this case.
- Never set `allowFontScaling={false}` anywhere (RN defaults it to `true`) — dynamic type must keep working.
- Verify the theme tokens' indigo-on-white / white-on-indigo pairs hit WCAG AA (4.5:1) specifically for error/success text, the highest-risk spot for contrast failures.
- Any icon-only touch target under 44×44pt gets `hitSlop` to compensate.

**CI coverage (outside-voice finding, resolved):** `turbo.json` gained a `typecheck` task in Day 1-2, but `.github/workflows/ci.yml` was never updated — every other app in this repo (`typecheck-user`, `typecheck-driver`, `typecheck-admin`) has a dedicated CI job, and the two new mobile apps would otherwise ship auth/token code for weeks with zero CI enforcement. Days 3-4 adds a `typecheck-mobile` job to `ci.yml` matching the existing per-app pattern: `pnpm turbo run typecheck --filter=rider-mobile --filter=driver-mobile --filter=mobile-shared` (typecheck-only, no Android SDK/Gradle needed in CI).

**Automated tests (issue 3A, resolved):** no test framework exists yet for any mobile app or `mobile-shared` — Days 3-4 adds `vitest` (already the `api/` standard) scoped to `packages/mobile-shared` only, covering the three pieces of pure, RN-runtime-free logic this phase introduces: `jwt.test.ts` (`tokenExpiresSoon` — valid/expired/malformed token), `errorMessages.test.ts` (`mapOtpErrorCode` — every `AUTH_OTP_*` code plus the unknown-code fallback), `secureStorage.test.ts` (`hybridSecureStorage`'s key-routing — token keys go to SecureStore, profile keys go to AsyncStorage). Screen-level RN component/E2E automation is explicitly deferred (would need `jest-expo` + React Native Testing Library, a heavier setup not justified yet) — covered instead by the manual verification checkpoints below, same as before.

**Verification checkpoints (goal-driven, not "make it work"):**
1. OTP round-trip for both a new and an existing phone number, both roles, against the local API (`docker exec ocar_postgres ...` running) → 201/200 as expected, tokens land in SecureStore, and killing + relaunching the app keeps the user logged in (persist rehydration works).
2. Force each backend error code → the correct specific inline copy shows, input stays editable after rollback, nothing raw leaks into the UI.
3. Logged-out user cannot reach `(tabs)` via direct deep link; logged-in user is bounced out of `(auth)` if navigated back to it.
4. After login, `select * from device_tokens` in the local DB shows the row, and the `ride_requests` channel is visible in the driver app's Android system notification settings.
5. TalkBack can complete phone → otp → home end-to-end without sighted assistance — the actual accessibility bar, not just "labels exist."
6. Both apps still `tsc --noEmit` clean and `gradlew assembleDebug` succeeds with everything above wired in.
7. `vitest run` in `packages/mobile-shared` passes: every `AUTH_OTP_*` code maps correctly (plus the unknown-code fallback), `tokenExpiresSoon` handles valid/expired/malformed tokens, `hybridSecureStorage` routes token keys to SecureStore and profile keys to AsyncStorage.
8. Android hardware back button from the OTP sub-state returns to phone entry (not out of the app); `typecheck-mobile` CI job passes on the PR.

### NOT in scope (Days 3-4)

- **Screen-level RN component/E2E automation** (jest-expo + React Native Testing Library) — deferred; the manual checkpoints above (device testing, TalkBack) cover this phase's actual UI risk. Revisit once the app has enough screens that manual verification stops scaling (likely around Days 6-8's map/booking flow).
- **The real map, fare estimate, and booking flow** — Days 6-8 per the day-by-day; this phase's rider `home` tab is a static shell only.
- **Real online/offline toggle logic** — Days 9-10 (background location itself is Day 5's spike, per the outside-voice resequencing in Section 7); this phase's driver `home` tab renders the toggle inert/disabled.
- **iOS-specific auth/push behavior** (APNs, iOS `expo-notifications` permission flow differences) — Phase 2 per Section 1, after day 15; Android is the only platform actually exercised through these verification checkpoints.
- **Rate-limiting/backoff beyond the existing 30s resend cooldown** — the backend already enforces `AUTH_OTP_RATE_LIMITED`; no additional client-side throttling logic beyond disabling the resend button during cooldown.

### What already exists (reused, not rebuilt)

- Two-step phone→OTP UX, countdown/in-flight-guard pattern, `formatPhone()`, dev-OTP autofill — `apps/driver/src/pages/Login.tsx` (ported, not reinvented).
- `useAuthStore` shape (`token`/`refreshToken`/`driver`/`isAuthenticated`/`setAuth`/`clearAuth`) — `apps/driver/src/store/useAuthStore.ts` (same shape, different storage backend per issue 1A).
- `createApiClient`/`createSocket` factories with injected callbacks — `packages/mobile-shared` (Day 2).
- `secureStorage.ts`'s byte-cap enforcement — `packages/mobile-shared` (Day 2); this phase respects rather than works around it (issue 1A).
- Skeleton/EmptyState/Button/Input UI primitives — `packages/mobile-shared/src/ui` (Day 2).
- OTP/error backend contracts — `api/src/modules/auth`, `api/src/modules/notifications` (read directly, not assumed, before this plan was written).

### Failure modes

| Codepath | Failure scenario | Test? | Error handling? | User-visible? |
|---|---|---|---|---|
| `tokenExpiresSoon` malformed token | Corrupted/truncated JWT in storage | ✅ unit test (issue 3A) | Returns a safe default rather than throwing | N/A — internal check |
| SecureStore rehydration | Keystore/keychain error on app launch | Manual checkpoint only | ✅ try/catch → fail-safe logged-out (issue 1B) | Yes — routed to login, not a hang |
| `hybridSecureStorage` routing | Wrong key routed to wrong backend | ✅ unit test (issue 3A, injected-fakes design) | N/A — deterministic key list | N/A |
| `hybridSecureStorage` partial write | SecureStore write succeeds, AsyncStorage write throws (or vice versa) | Not unit-tested (would need fault injection) | ✅ SecureStore-first, whole call rejects on either failure (outside-voice finding) | No — surfaces as a persist error, self-heals on next write |
| Android hardware back from OTP state | User presses back while on OTP sub-state | Manual checkpoint only | ✅ `BackHandler` intercept reverts to phone step (outside-voice finding) | Yes — correct back behavior instead of exiting the app |
| OTP verify — network failure | API unreachable during submit | Manual checkpoint (#2 covers server error codes; airplane-mode check covers this) | ✅ generic "check your connection" message, separate from server error codes | Yes — clear retry message |
| FCM registration failure | Permission denied, or `POST /notifications/devices` fails | Not covered | Explicitly "best-effort" per plan — login must not block on this; denial outcome is stored (`pushPermissionGranted`) for Days 13-14 to act on | Silent this phase by design — driver push-denial banner deferred to Days 13-14 (outside-voice finding) |
| CI enforcement gap | Mobile TS ships with no CI typecheck gate | N/A | ✅ `typecheck-mobile` job added to `ci.yml` (outside-voice finding) | N/A — process gap, not runtime |

### Worktree parallelization strategy

Sequential implementation, no parallelization opportunity — both apps' Days 3-4 work touches the same shared dependency (`packages/mobile-shared`'s new `errorMessages.ts`/`hybridSecureStorage`) which must land first, and the two apps' auth screens are small enough that splitting them across worktrees would cost more in coordination than it saves.

### Implementation Tasks

- [ ] **T1 (P1, human: ~35min / CC: ~10min)** — mobile-shared — Add `createHybridStorage(secure, async)` (injected-backend factory; routes token/refreshToken to `secure` first, then `async`, rejecting the whole write on either failure) and `createSecurePersistStorage()`
  - Surfaced by: Architecture issue 1A; write-atomicity + testability outside-voice findings
  - Files: `packages/mobile-shared/src/storage/secureStorage.ts`, new `hybridStorage.ts`
  - Verify: `vitest run` — routing + partial-failure-rejects tests pass, using injected fakes (no native mocks)
- [ ] **T2 (P1, human: ~15min / CC: ~5min)** — mobile-shared — Add `mapOtpErrorCode()` pure function
  - Surfaced by: Code Quality issue 2A
  - Files: new `packages/mobile-shared/src/api/errorMessages.ts`
  - Verify: `vitest run` — all codes + fallback covered
- [ ] **T3 (P1, human: ~20min / CC: ~5min)** — mobile-shared — Set up `vitest` in `packages/mobile-shared`, write `jwt.test.ts`/`errorMessages.test.ts`/`hybridStorage.test.ts`
  - Surfaced by: Test review issue 3A
  - Files: `packages/mobile-shared/vitest.config.ts`, `package.json`, the three test files
  - Verify: `vitest run` exits 0
- [ ] **T4 (P1, human: ~15min / CC: ~3min)** — both apps — Wrap persist rehydration in try/catch with fail-safe `clearAuth()` before hiding splash; set `hasHydrated: true` in the same `onRehydrateStorage` callback
  - Surfaced by: Architecture issue 1B; `hasHydrated` outside-voice finding
  - Files: `apps/rider-mobile/src/app/_layout.tsx`, `apps/driver-mobile/src/app/_layout.tsx`, both `src/store/useAuthStore.ts`
  - Verify: manual checkpoint — simulate a SecureStore throw, confirm app reaches login screen, not a hang; confirm `hasHydrated` flips to `true` after rehydration
- [ ] **T5 (P2, human: ~15min / CC: ~5min)** — both apps — OTP screen catches network-layer failure (not just server error codes) with a generic retry message
  - Surfaced by: Failure modes critical gap (OTP verify network failure)
  - Files: `apps/rider-mobile/src/app/(auth)/otp.tsx`, `apps/driver-mobile/src/app/(auth)/otp.tsx`
  - Verify: manual checkpoint — airplane mode during submit, confirm inline message, no unhandled rejection in logs
- [ ] **T6 (P1, human: ~2h / CC: ~30min)** — both apps — Screens, store, route guards, tab shells, FCM wiring per Section 7.1, including the `BackHandler` intercept on the OTP sub-state and storing `pushPermissionGranted` on registration
  - Surfaced by: this plan section in full; Android back-button + push-denial outside-voice findings
  - Files: per app — `src/app/(auth)/*`, `src/app/(tabs)/*`, `src/app/_layout.tsx`, `src/store/useAuthStore.ts`, `src/services/api/index.ts`, `src/services/socket/index.ts`, `src/services/notifications/index.ts`
  - Verify: verification checkpoints 1-8 above
- [ ] **T7 (P1, human: ~15min / CC: ~5min)** — CI — Add `typecheck-mobile` job to `ci.yml`
  - Surfaced by: CI-coverage outside-voice finding
  - Files: `.github/workflows/ci.yml`
  - Verify: job runs and passes on the PR that lands this phase's code

**Day 5 — Background-location spike (driver app only) — added during the full-plan review (outside-voice finding)**
The plan's own Section 3.3 calls background location "the highest-risk module," yet it was originally scheduled as day 3-of-3 inside Days 8-10, right before the P1 cut consumes whatever slack remains — the riskiest native integration in the whole plan was getting discovered latest, with the least runway to react. Pulled forward into its own narrow spike, isolated from the rest of driver booking: `Location.startLocationUpdatesAsync` + `TaskManager` wired per Section 3.3/4, the prominent-disclosure screen shown before the OS permission dialog, one real-device test confirming tracking survives Doze/App Standby backgrounding. If this blows up, it's discovered on day 5 with 10 more days available to react, not on day 9-10 (the original placement) with only the P1 slot left.

**Days 6-8 — Rider: core point-to-point booking**
**Pacing re-check (outside-voice finding, added during the full-plan review):** after this block completes, compare actual time spent + issues found against Days 3-4's real numbers (7 tasks, 8 checkpoints, 13 review findings — for auth, arguably the simplest domain in the app). Re-validate the remaining day-by-day (Days 9-10, 11-12, 13-14, 15) before continuing — don't assume the original 15-day total still holds untested just because it was the original estimate.
Map screen with foreground current location. Pickup/drop pickers wired to `/geo/autocomplete`, `/geo/place/:id`, `/geo/reverse`. Fare estimate (`POST /pricing/estimate`) + category selection (`GET /vehicles/categories`), skeleton loading on both. Booking creation (`POST /rides`), "searching" state over `ride:status_update` with reconnect-and-rejoin wired per Section 3.2. Driver-assigned screen with animated (ref-driven, not React-state-driven) live marker updates + ETA. In-ride tracking screen, start/end-OTP display, cash-collection confirmation. Ride history via `FlashList` against `/rides/me/history`, `/me/upcoming`.

**Days 9-10 — Driver: core point-to-point booking (background location already de-risked by Day 5)**
**Checkpoint at start of day 9: if rider P0 isn't done, absorb days 11-12's P1 slot into finishing this instead.**
**FCM gate (outside-voice finding, added during the full-plan review):** driver P0's incoming-ride-request alert depends on real FCM, which depends on `google-services.json` (Firebase access, itself downstream of Play Console identity verification — Section 8.2). This is a real, unowned dependency chain spanning Sections 1/3.4/8, not something to discover at day 8. If `google-services.json` still isn't available by day 8, driver P0 ships with a degraded mode instead of blocking: foreground-only ride-request alerts via in-app polling, not real push. Do not silently block the whole driver flow on an external Firebase-access dependency clearing on schedule.
Online/offline toggle (`/rides/sessions/online`/`/offline`), wiring the Day 5 spike's background tracking into the real online/offline state transition. Incoming ride-request handling via `ride:request` socket event + data-only FCM fallback when backgrounded, full-screen incoming-request UI with sound (via the `ride_requests` high-importance channel), `ride:request:ack` emit, countdown against `expiresAt`/`timeoutSeconds`. Accept/arrived/start-OTP screens with optimistic state advance. Active-trip screen emitting `location:update` at the existing ~3s cadence with `POST /sessions/location` HTTP fallback. End-OTP + cash collection UI. Trip history/earnings summary.

**Days 11-12 — Stretch: outstation + rentals (P1, cut first if behind)**
Ride-type selector expanded beyond point-to-point. Outstation round-trip toggle + `return-cab-available`/`start-return`. Rental package-tier picker. Multi-stop only if both land early. **Also run the EAS dry-run build (outside-voice finding, added during the full-plan review, see Section 4):** `eas build --profile preview --platform android` — first `eas login`, first cloud build, first config-plugin resolution under EAS instead of local Gradle. Fits inside this window regardless of whether the P1 stretch scope itself gets cut.

**Days 13-14 — Push, polish, edge cases, Android hardening**
Full FCM handling across foreground/background/killed on both apps, deep-linking a notification tap into the relevant `ride/[id]` screen. Loading/error/empty states audited across all screens (not just added — actually walked one by one against the table in Section 6). Network-retry handling, forced logout on refresh-token expiry. Background-location prominent-disclosure screen copy finalized (needed for the Play Console submission, not just UX). Battery-optimization tester instructions written.

**Day 15 — Device testing & Play Console submission prep**
Real physical Android device testing (not emulator) — background location behavior, killed-app push delivery, battery-optimization edge cases across at least one non-Pixel OEM device if available. This is the day `eas login` happens for the first time: run `eas build --profile production --platform android` to get the signed AAB, upload to Play Console internal testing track, invite testers. Record the short demonstration video required for background-location review (disclosure dialog + feature in use). Final bug pass against P0 only.

**Day 15 checkpoint: Android done.** P0 verified end-to-end on a physical device, AAB uploaded to Play Console internal testing, background-location review materials submitted. P1 items not completed are explicitly logged, not silently dropped.

**Phase 2 (iOS) — starts after day 15, no fixed day count assumed:**
Apple Developer Program enrollment (start this as early as possible, ideally in parallel with late-stage Android work, since it's pure lead time with no coding dependency). First iOS dev-client build and fix of the narrow iOS-specific surface (background location "Always" flow, APNs cert upload to Firebase, notification permission timing). TestFlight internal, then external (48-hour Apple review, 90-day build expiry to track). App Store submission and review.

---

## 8. Open items to resolve before day 1

### 8.1 Local environment setup (machine-side, install before day 1)

- **Node.js** (match the version already pinned by the root `package.json` engines field) + **pnpm** — already required for the existing monorepo, no new install if it's set up.
- **Java JDK 17** — required by the Android Gradle build toolchain that EAS/Expo invokes under the hood, even for cloud builds triggered locally.
- **Android Studio + Android SDK** (installed via Studio's SDK Manager) — gives a local emulator for fast iteration and, more importantly, the Android SDK platform-tools needed for `adb`. Not strictly required if relying entirely on EAS cloud builds + a physical device, but strongly recommended for debugging speed.
- **`adb` on PATH** (comes with Android SDK platform-tools) — used to install dev-client builds on the physical Android test device, and to read logs via `adb logcat` during native-module debugging (location/FCM issues will need this).
- **EAS CLI** — `npm i -g eas-cli`. Install it now (cheap, no account needed yet), but `eas login`/account creation is deferred to day 15 per the local-first build strategy above — days 1-14 need only the local Android SDK/Gradle toolchain, not an Expo account.
- **Watchman** — optional on Windows (it's primarily a macOS/Linux Metro file-watching perf tool); skippable here.
- **On the physical Android test device**: enable Developer Options + USB debugging (Settings → About → tap Build Number x7, then Settings → Developer Options → USB debugging), and confirm Google Play Services is present (standard on any non-rooted stock/OEM device) — FCM cannot be tested without it.

### 8.2 Accounts and access (start these in parallel with 8.1, some have lead time)

- Firebase config file (`google-services.json`) for the same Firebase project the backend's Admin SDK credential belongs to — Android-only for this window; `GoogleService-Info.plist` is a Phase 2 item. Requires Firebase console access (can reuse the Google account used for Play Console).
- Google Play Console developer account access, to create the app listings and internal testing tracks on day 1. This is the task with the most real lead time on the Android side: registration is a one-time $25 fee, and since 2023 Google requires identity verification (individual or D-U-N-S for organizations) before a new account can publish even to internal testing — verification can take anywhere from a few hours to a few days for a brand-new account. Start this the moment the project is greenlit, not on day 1 itself.
- Physical Android test device(s), ideally including at least one non-Pixel OEM (Xiaomi/Oppo/Vivo) given their more aggressive battery-optimization defaults, since background location behaves differently across OEM Android skins.

**Moved to Phase 2 (iOS) — no longer blocking day 1:**
- Apple Developer Program access (start enrollment early regardless, since it's pure lead time, but it does not block any Android-focused day-1-through-15 work).
- Physical iOS test device / TestFlight setup.
- `GoogleService-Info.plist`.

---

## 9. Full-plan review addendum (2026-09-16)

Written after a `/plan-eng-review` pass across the entire document (Sections 1-8, Days 1-15), following the earlier pass that covered only Section 7.1.

### NOT in scope (this review)

- **Expanding Days 5-15 to Section 7.1's level of detail** — considered and explicitly deferred (Step 0 decision). That detail gets written just-in-time, right before each block is implemented, matching how 7.1 itself was produced. Doing it now for unbuilt days risks the same drift Sections 2/3.1/3.4 already showed once Days 3-4 was actually built.

### What already exists (whole-plan level)

- Days 1-2 foundation (scaffolding, toolchain, `packages/mobile-shared` primitives) — built, not re-reviewed line-by-line here since it predates any review process; no issues surfaced against it during this pass.
- Days 3-4 (Section 7.1) — fully implemented and previously reviewed; this pass found 3 further issues in it (FCM doc drift, baseURL doc drift, unsafe error-cast), all resolved above.
- The repo's own established conventions (inline `api.post()` calls, no typed API wrapper modules, per-app independent auth stores) — confirmed via the web app and now made the explicit convention for mobile too (issues 1D/2A).

### Failure modes (new, whole-plan level)

| Area | Failure scenario | Status |
|---|---|---|
| `.npmrc` hoisting (issue 1C) | A future dependency removal in `api/`/web apps was silently relying on hoisting | Investigated with a real remove-and-rebuild test, not assumed — confirmed still required for the mobile apps' native builds (a different pnpm-symlink/native-autolinking failure, not just the path-length issue). Documented in Section 2 with the exact evidence. |
| Error-cast type safety (issue 2B) | A non-axios error thrown in the OTP submit path was silently mis-read | Fixed in both apps — `axios.isAxiosError()` guard now used, matching the pattern already inside `createApiClient`. |

### Worktree parallelization strategy (whole-plan level)

Unlike Days 3-4 (correctly sequential — both apps depended on the same new `mobile-shared` factories landing first), **Days 6-8 (rider booking) and Days 9-10 (driver booking, after Day 5's background-location spike) are genuinely parallelizable**: they touch entirely separate app directories (`apps/rider-mobile` vs `apps/driver-mobile`), and neither's spec currently calls for new shared `packages/mobile-shared` code — both reuse what Days 1-4 already built (API client, socket factory, storage, notifications).

| Step | Modules touched | Depends on |
|---|---|---|
| Day 5 (background-location spike) | `apps/driver-mobile/` | Days 1-4 (done) |
| Days 6-8 (rider booking) | `apps/rider-mobile/` | Days 1-4 (done) |
| Days 9-10 (driver booking) | `apps/driver-mobile/` | Days 1-4 (done), Day 5 spike |

**Solo-build note (outside-voice finding, added during the full-plan review):** this plan is scoped for one person/session (Section 1's header). The lanes below are an option only if a second agent/session is available to run Lane B concurrently — not part of the default 15-day path.

**Lane A:** Days 6-8 (independent). **Lane B:** Day 5 spike → Days 9-10 (Day 5 is sequential prerequisite within this lane, not parallel with itself). **Conflict flag:** if either block *does* end up needing a new `mobile-shared` addition partway through (plausible — e.g. a shared `FareCard` component, or a ride-status-mapping helper), that lands sequentially first, same as the Day 3-4 pattern, before the two lanes resume in parallel.

### Test review (whole-plan level)

Days 1-4: `vitest` (11/11 passing) for `mobile-shared`'s pure logic, `typecheck-mobile` CI gate, manual verification checkpoints for screen-level behavior — solid, per the earlier detailed review. Days 5-15: no test framework decision needed yet beyond what's already established (`vitest` for new pure logic in `mobile-shared`, manual/device checkpoints for screens, `jest-expo`/RNTL deferred to `TODOS.md` until screen count justifies it) — the pattern already set doesn't need re-deciding per day-block.

One regression-adjacent note: the `axios.isAxiosError()` fix (issue 2B) touched already-shipped Days 3-4 code with no existing automated coverage for that catch block (screen-level tests are the explicitly deferred TODO). Not adding an ad-hoc test for this one line — doing so would contradict the just-reaffirmed decision to defer screen-level testing as a block, not test individual lines piecemeal. Flagged here for traceability, not left silent.

### Performance review (whole-plan level)

No new issues. Section 6's existing conventions (memoized map markers, ref-driven position updates, `FlashList`, skeleton states) already cover the plan's real performance risk areas (Days 5-10's map/list screens) before they're built — nothing to add at this pass.
