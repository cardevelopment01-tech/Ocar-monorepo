# React Native + Expo Mobile — Android-First Build Spec (Rider & Driver Apps)

**Supersedes for execution purposes:** `2026-09-14-react-native-expo-mobile-mvp.md` (kept as historical record; this doc carries forward its scope decisions and refines architecture, folder structure, and sequencing).

**Window:** 15 days, solo build, **Android-only completion target.** iOS is written in parallel by default (RN is cross-platform, most code is shared), but iOS-specific testing, native store polish, and submission are explicitly Phase 2, after day 15 — not inside this window.

**Stack:** Expo SDK 55+ (New Architecture is mandatory, not optional, as of SDK 55 — RN 0.83), custom development builds (not Expo Go — background location, Firebase messaging, and maps all need native modules Expo Go can't load), TypeScript, two new apps + one shared package inside the existing pnpm + Turborepo monorepo.

**Build strategy (local-first):** all day-to-day builds run locally via `npx expo run:android` against the Android SDK/JDK/emulator installed on this machine — no EAS account, login, or cloud queue needed for the 15-day window. This is strictly faster for iteration (no upload/queue wait) and has no monthly build quota. EAS is brought in exactly once, on day 15, to produce the signed `production`-profile AAB for the Play Console internal testing track upload — see Section 4's EAS build profiles and the day-by-day below.

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

**Day 8 checkpoint (unchanged mechanism):** if Android P0 isn't functionally complete by day 8, P1 does not start — days 10-11 get reabsorbed into P0 hardening instead.

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
        storage/                    # re-exports packages/mobile-shared secure storage with rider-specific keys
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
        auth.ts                     # /auth/otp/request, /otp/verify, /refresh
        rides.ts                    # /rides/* typed calls, mirrors api's Zod schemas where practical
        geo.ts
        pricing.ts
        vehicles.ts
        notifications.ts            # device token register/unregister, feed
        types.ts                    # shared response/request types
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

---

## 3. Service layer design

**Ownership rule (binding for both apps):** side-effecting services (socket, location, notifications) are owned by a top-level provider mounted once in `app/_layout.tsx`, which subscribes to the relevant zustand store and starts/stops the service in response to store state changes — screens never call `connect()`/`disconnect()` directly. This mirrors why `apps/driver/src/lib/socket.ts` centralizes reconnect/refresh logic in one module rather than per-screen: it prevents duplicate connections when a user navigates back and forth between screens, and it makes "did we tear this down correctly on logout" a single code path to audit instead of N screens.

Concretely, for the driver app: a `RideLifecycleProvider` (or the `_layout.tsx` root component) watches `useRideStore().activeRide` and `useSessionStore().isOnline`, and:
- starts the socket connection and joins `driver:{driverId}` when the driver goes online,
- starts background location tracking when `isOnline` flips true, stops it when false,
- joins `ride:{id}` when `activeRide` is set, leaves it when cleared.

This is a direct port of the proven concept in `apps/driver/src/lib/socket.ts` and `useRideStore.ts` — the mobile spec does not reinvent this, it re-expresses the same lifecycle ownership in a provider because RN has no route-level `App.tsx` singleton the way the Vite app does.

### 3.1 API client (`packages/mobile-shared/src/api/client.ts`)
- Axios instance, `baseURL` from `expo-constants` env config (dev/staging/prod variants via EAS build profiles).
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
- FCM registration on login (`react-native-firebase` `messaging().getToken()`), POSTed to the existing `/api/v1/notifications` device-token endpoint — no backend change needed, it already accepts device tokens per owner.
- Foreground: `messaging().onMessage()` shows an in-app toast/banner (do not rely on the OS notification tray while the app is open — this is where FCM/Expo integration conflicts most commonly surface, per current library guidance, so keep it to one single foreground listener registered once in the root provider).
- Background/killed: `messaging().setBackgroundMessageHandler()` (Android-only requirement — this handler is what fires when the app is not in the JS foreground) triggers the OS notification via a Notifee or `expo-notifications`-created channel; tapping it uses `messaging().onNotificationOpenedApp()` / `getInitialNotification()` to deep-link into `ride/[id]` via expo-router's `router.push`.
- Data-only messages (not `notification`-type FCM payloads) are used for the ride-request alert specifically, since the driver app needs to trigger its own full-screen incoming-request UI/sound rather than a plain OS notification tap — this matches how the existing backend's `sendNotification`/`notifyOwner()` helpers already separate push payload from in-app feed row.
- Android notification channels are created once at app startup (e.g. `ride_requests` channel with `IMPORTANCE_HIGH` + custom sound, `ride_status` channel with default importance) — required on Android 8+ regardless of FCM vs Expo notifications, and this is also where the OS-level "make it loud enough to notice while backgrounded" requirement for ride requests is satisfied.

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
- **Days 1-14: local builds only.** `npx expo prebuild --platform android` generates the native `android/` project once (regenerate after any config-plugin/native-dependency change), then `npx expo run:android` builds via local Gradle + JDK 17 and installs straight onto the connected device/emulator via `adb`. No account, no login, no upload wait, no monthly quota — this is the fast inner loop for all of days 1-14, including the background-location and FCM work in days 8-10.
- **Day 15 only: one EAS build.** `eas build --profile production --platform android` produces the signed AAB required for Play Console upload — EAS's managed keystore signing is the one piece worth using its cloud service for (self-managing a release keystore locally is possible but not worth the setup time inside this window). This is the only point `eas login` is needed.
- `eas.json` still defines all three profiles for optionality (`development` dev-client, `preview` internal-distribution APK, `production` AAB) — but `development` and `preview` cloud builds are a fallback only (e.g. if local Gradle breaks and there's no time to debug it), not the default path.

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
Scaffold `apps/rider-mobile`, `apps/driver-mobile` (both using the `src/app` SDK 55 layout), `packages/mobile-shared`, wire pnpm workspace + `metro.config.js` `watchFolders`/`nodeModulesPaths`, add Turborepo tasks. Run `npx expo prebuild --platform android` + `npx expo run:android` locally for both apps to confirm the toolchain (JDK 17, Android SDK, `adb`) is wired correctly end-to-end — this is the local-build smoke test, no EAS/cloud step here. Create the Play Console app listings (draft) and internal testing track shells for both apps. Confirm Firebase config (`google-services.json`) is available for the backend's Firebase project.

**Day 2 — Shared foundations**
Build `packages/mobile-shared`: API client + refresh interceptor, socket factory, secure storage wrapper, theme tokens, base UI primitives (Button, Input, Card, Skeleton). `GestureHandlerRootView` + Reanimated installed and verified working in both apps.

**Days 3-4 — Auth + navigation shell (both apps)**
OTP request/verify screens against `/auth/otp/request` and `/otp/verify`, with optimistic advance-then-rollback UX. Token refresh wired end-to-end. `expo-router` stacks with protected-route guard via `(auth)`/`(tabs)` groups. Rider: home/map tab shell. Driver: online/offline toggle shell, earnings tab shell. `react-native-firebase` installed, Android notification channels created, device tokens registering against `/api/v1/notifications`.

**Days 5-7 — Rider: core point-to-point booking**
Map screen with foreground current location. Pickup/drop pickers wired to `/geo/autocomplete`, `/geo/place/:id`, `/geo/reverse`. Fare estimate (`POST /pricing/estimate`) + category selection (`GET /vehicles/categories`), skeleton loading on both. Booking creation (`POST /rides`), "searching" state over `ride:status_update` with reconnect-and-rejoin wired per Section 3.2. Driver-assigned screen with animated (ref-driven, not React-state-driven) live marker updates + ETA. In-ride tracking screen, start/end-OTP display, cash-collection confirmation. Ride history via `FlashList` against `/rides/me/history`, `/me/upcoming`.

**Days 8-10 — Driver: core point-to-point booking**
**Checkpoint at start of day 8: if rider P0 isn't done, absorb days 10-11's P1 slot into finishing this instead.**
Online/offline toggle (`/rides/sessions/online`/`/offline`) with the background-location disclosure screen shown before the OS permission dialog, then background tracking wired in per Section 3.3/4 — this is the highest native-integration risk in the whole plan, budget real slack here. Incoming ride-request handling via `ride:request` socket event + data-only FCM fallback when backgrounded, full-screen incoming-request UI with sound (via the `ride_requests` high-importance channel), `ride:request:ack` emit, countdown against `expiresAt`/`timeoutSeconds`. Accept/arrived/start-OTP screens with optimistic state advance. Active-trip screen emitting `location:update` at the existing ~3s cadence with `POST /sessions/location` HTTP fallback. End-OTP + cash collection UI. Trip history/earnings summary.

**Days 11-12 — Stretch: outstation + rentals (P1, cut first if behind)**
Ride-type selector expanded beyond point-to-point. Outstation round-trip toggle + `return-cab-available`/`start-return`. Rental package-tier picker. Multi-stop only if both land early.

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
