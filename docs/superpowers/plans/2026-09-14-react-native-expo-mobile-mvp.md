# React Native + Expo Mobile MVP — Rider & Driver Apps

**Window:** 15 days, solo build
**Stack:** Expo SDK 55+ (New Architecture, mandatory), EAS custom development builds (not Expo Go), TypeScript, added as two new apps inside the existing `pnpm` + Turborepo monorepo.

## 1. Scope

**In for MVP (P0 — must ship):**
- Rider app: OTP auth, point-to-point booking (pickup/drop via existing `/geo` endpoints), live driver tracking, ride lifecycle through cash payment, ride history.
- Driver app: OTP auth, online/offline + background location, incoming ride-request handling (socket + push), accept → arrived → start-OTP → in-progress → end-OTP → cash collection, trip history/earnings summary.
- Push notifications (FCM) for ride-request alerts and status updates on both apps.

**In, as stretch (P1 — cut first if behind schedule):**
- Outstation rides: round-trip toggle, `GET /rides/return-cab-available`, `POST /rides/:id/start-return`.
- Rental rides: package-tier selection via `GET /pricing/rental-packages/:categoryId`.
- Multi-stop rides (`POST /rides/:id/stops`, `PATCH /rides/:id/stops/:sequence`).

**Explicitly out of the 15-day window:**
- Razorpay in-app payment (cash-only for MVP — the backend's verify/retry endpoints already exist, so this is a pure UI addition later, not a backend gap).
- Driver onboarding/document-upload flow (drivers are onboarded via the existing web driver app for now).
- In-app chat UI (`chat:message`/`chat:read` events exist server-side; can be added post-MVP without backend work).
- Admin-facing anything.

This list is the thing to revisit on day 8 — if P0 isn't done by then, P1 doesn't start.

## 2. Architecture decisions

- **Two apps, one monorepo.** `apps/rider-mobile` and `apps/driver-mobile`, added alongside the existing `apps/user`, `apps/driver`, `apps/admin`, `api` in the pnpm workspace. A new `packages/mobile-shared` holds what both apps need identically: the typed API client (mirroring `auth`, `rides`, `geo`, `pricing`, `vehicles` route shapes), the Socket.io client wrapper, token storage (`expo-secure-store`), and the shared design tokens ported from `DESIGN.md` (`#4F46E5` indigo family). Building this once on day 1 avoids drifting duplicate logic between the two apps under time pressure.
- **Custom EAS development build from day one, not Expo Go.** Maps, background location, Firebase messaging and (post-MVP) Razorpay all require native modules Expo Go can't load. Treat the first `eas build --profile development` as the actual day-1 deliverable, not a later step — it takes 15–30 minutes per platform and should be kicked off before writing app code, run in the background while the workspace/API client is built.
- **Location:** `expo-location`. Android needs `isAndroidForegroundServiceEnabled`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`, and a foreground-service notification title/body in the config plugin. iOS needs `UIBackgroundModes: ["location"]` plus an explicit `requestBackgroundPermissionsAsync()` call for "Always" authorization. This only works in a dev/production build, never Expo Go — confirmed against Expo's own docs.
- **Maps:** `react-native-maps` for the MVP. It has New-Architecture interop friction but is the more mature/documented option; `expo-maps` is cleaner long-term but its iOS 17+ floor is a real constraint not worth taking on mid-sprint. Revisit post-MVP.
- **Push:** `react-native-firebase` (FCM directly), not Expo's push service. The backend already stores `fcm_token` per user/driver and sends via Firebase Admin SDK — this is the smaller integration, not the larger one. Needs `google-services.json` (Android) / `GoogleService-Info.plist` (iOS) from the Firebase project the backend's Admin SDK credential belongs to — **confirm these can be generated day 1, since nothing else in the push chain can be tested without them.**
- **Real-time:** `socket.io-client` configured with `transports: ['websocket']` to match the backend (which is websocket-only, no polling fallback — the ALB has no sticky sessions), and `auth: { token }` on connect to match `socket.handshake.auth.token` server-side. Rejoin `ride:{id}` after reconnect the same way the driver auto-rejoin logic does server-side.
- **Ride-type/category data is already server-driven** — `GET /vehicles/categories` lists categories, `POST /pricing/estimate` and `GET /pricing/rate-cards` give live pricing, `GET /pricing/rental-packages/:categoryId` gives rental tiers. Nothing here needs to be hardcoded client-side. (Note: the `packages` module in the API is a *driver wallet/ledger* system — topups, balance, consumption — unrelated to ride rental packages, which live under `pricing`. Don't confuse the two when wiring this up.)

## 3. Day-by-day

**Day 1 — Foundation**
Scaffold `apps/rider-mobile`, `apps/driver-mobile`, `packages/mobile-shared` in the workspace. Kick off first EAS dev-client builds for both apps (both platforms) in the background. Build the shared API client (auth header + refresh-token interceptor against `POST /auth/refresh`), Socket.io wrapper, secure token storage, and the shared theme/UI primitives (Button, Input, Card, BottomSheet). Confirm Firebase config files are available.

**Days 2–3 — Auth + navigation shell (both apps)**
OTP request/verify screens (phone input, resend timer) against `/auth/otp/request` and `/otp/verify`. Token refresh wired end-to-end. `expo-router` stacks with a protected-route guard. Rider: home/map tab shell. Driver: online/offline toggle shell, earnings tab shell. `react-native-firebase` installed and registering device tokens against the backend's `fcm_token` field on both apps.

**Days 4–6 — Rider: core point-to-point booking**
Map screen with current location (`expo-location`, foreground). Pickup/drop pickers wired to `/geo/autocomplete`, `/geo/place/:id`, `/geo/reverse`. Fare estimate (`POST /pricing/estimate`) and category selection (`GET /vehicles/categories`). Booking creation (`POST /rides`), "searching for driver" state over `ride:status_update`. Driver-assigned screen with live `driver:location` socket updates and ETA. In-ride tracking screen. Start/end-OTP display (role-masked fields from `GET /rides/:id`), cash-collection confirmation. Ride history (`GET /rides/me/history`, `/me/upcoming`).

**Days 7–9 — Driver: core point-to-point booking**
Online/offline toggle (`POST /rides/sessions/online` / `/offline`) with background location wired in — budget real time here, this is the highest-risk native integration on the plan. Incoming ride-request handling via the `ride:request` socket event plus FCM fallback when backgrounded, `ride:request:ack` emit, countdown against `expiresAt`/`timeoutSeconds`. Accept/arrived/start-OTP screens. Active-trip screen emitting `location:update` over the socket (matching the ~3s cadence the web driver app already uses) with the `POST /sessions/location` HTTP path as fallback. End-OTP + cash collection UI (`collectedAmount` / `notCollected` / `note`). Trip history and earnings summary (`GET /me/trips`, `/me/earnings-summary`).

**Days 10–11 — Stretch: outstation + rentals (P1, cut first if behind)**
Ride-type selector expanded beyond point-to-point. Outstation: round-trip toggle, `GET /rides/return-cab-available`, driver-side `POST /rides/:id/start-return`. Rentals: package-tier picker against `GET /pricing/rental-packages/:categoryId`. Multi-stop only if both of the above land early (`POST /rides/:id/stops`, `PATCH /rides/:id/stops/:sequence`).

**Days 12–13 — Push, polish, edge cases**
Full FCM handling across foreground/background/killed states on both apps, deep-linking a notification tap straight into the relevant ride screen. Loading/error/empty states across all screens, network-retry handling, forced logout on refresh-token expiry. Permission-rationale screens for location (foreground + background) and notifications — required for both App Store and Play Store review, not optional polish.

**Days 14–15 — Device testing & release prep**
Real-device testing (Android physical + iOS physical/TestFlight). EAS preview/production builds, internal distribution (TestFlight + Play internal testing track). Final bug pass. Defer mobile Sentry wiring unless everything above is already done early.

## 4. Open items to resolve before day 1

- Firebase config files (`google-services.json`, `GoogleService-Info.plist`) for the same Firebase project the backend's Admin SDK credential belongs to.
- Apple Developer + Google Play Console access for EAS builds and internal distribution — these have their own lead time (Apple review for TestFlight external testing, Play Console internal-track propagation) that doesn't compress no matter how the coding schedule goes.
- Physical Android + iOS test devices, since background-location and push behave differently on simulators than on real hardware, especially around killed-app push delivery on iOS.
