# Mobile performance, smoothness and battery audit

Date: 2026-10-13. Scope: `apps/rider-mobile`, `apps/driver-mobile`, and the `packages/mobile-shared` code both import.
Stack: Expo 57.0.22, RN 0.86.3, React 19.2.3, Reanimated 4.6, FlashList 2.3, react-native-maps 1.27, zustand 4.

**Method.** Three Opus agents read the source. Two audited the apps file by file. One researched fixes online. Every finding below cites `file:line`, and each was read in code. Nothing was run on a device, so battery and memory numbers are estimates from typical Android figures, not measurements. Items marked **[verify]** need a device check before or after the fix.

**Totals.** 86 findings: driver 41 (2 critical, 8 high, 17 medium, 14 low), rider 45 (0 critical, 7 high, 22 medium, 16 low).

Paths are relative to the app's `src/` unless noted. `shared/` = `packages/mobile-shared/src/`. IDs: `D-` = driver audit, `R-` = rider audit.

---

## Tier map

| Tier | Meaning | Items |
|---|---|---|
| **T0** | Leaks memory or breaks a core flow mid-trip. Fix first. | D-P0-1, D-P0-2 |
| **T1** | Steady battery/CPU drain or jank on the screen used most. | R-F1..F7, D-P1-1..8 |
| **T2** | Real but bounded: wasted requests, memory spikes, layout-driven animation, cold start. | 39 items |
| **T3** | Hygiene, dead code, cheap cleanups. | 30 items |

Quick wins (under 30 min each, large effect): delete `MapWarmup` (R-F6), delete the dead GPS log (D-P1-2), `useMemo` the polyline arrays (R-F4, D-P1-3), `freezeOnBlur: true` (R-F5, D-P2-17), `resizeMethod="resize"` on remote images (D-P1-5), swap `router.replace('/(tabs)/home')` for `router.dismissTo` (D-P0-1).

---

## T0. Critical

### D-P0-1. Every ride end and every go-online stacks another `(tabs)` navigator, and the old ones stay mounted
- **Where:** `features/go-online/useConfirmGoOnline.ts:78`; `app/active-ride/[id]/index.tsx:99,164,179`; `app/daily-verification.tsx:94`.
- **Problem:** `router.replace('/(tabs)/home')` from `[(tabs), active-ride]` replaces only the top route with a new `(tabs)` instance (read from expo-router 57's `getNavigationAction`). The old tabs stay below. Each copy keeps its own Google `MapView` (roughly 30-80 MB native), a High-accuracy GPS watch and its pulse animations. A 15-20 ride shift gives 15-20 maps. Memory climbs until Android kills the app, and with it the location service and ride requests.
- **Fix:** `router.dismissTo('/(tabs)/home')` at all four call sites. **[verify]** Log `navigationRef.getRootState().routes.map(r => r.name)` after two rides; before the fix you should see repeated `(tabs)` entries. This was derived from source, not observed.

### D-P0-2. A socket reconnect during a ride replaces the whole ride screen, including the map and Google guided navigation, with a skeleton
- **Where:** `features/active-ride/useActiveRide.ts:55-70,138`; `shared/socket/useRoomJoin.ts:19-25`; `app/active-ride/[id]/index.tsx:125-132`.
- **Problem:** `useRoomJoin` calls `load` on mount and on every reconnect. `load` sets `loading=true` and the screen early-returns a skeleton. That unmounts the map, and `GoogleGuidedMap` cleanup tears down turn-by-turn guidance, which restarts (a new routing request) when the map remounts. Mobile sockets reconnect on every cell/Wi-Fi handoff. On mount, `GET /rides/:id` also runs twice.
- **Fix:** keep `load` for first mount only; pass the silent `refresh` to `useRoomJoin`. Make `attachRoomJoin` skip `onRejoined` on the initial join.

---

## T1. High

### Ride-screen rendering (rider)
| ID | Where | Problem | Fix |
|---|---|---|---|
| R-F1 | `features/map/components/LocationPin.tsx:36-50` | Pickup pin has `tracksViewChanges` true plus an infinite halo animation. On Android the marker view is re-captured to a bitmap about every 40 ms (about 25/s) for the whole trip, on the ride, fare, map-picker and trip-summary maps. Biggest steady CPU/battery cost on the most-used screen. | Snapshot once, then `tracksViewChanges={false}` (the 700 ms pattern already in `MapHero.tsx:165-172`). Draw the pulse as a map `Circle` stepped slowly, or drop it on the ride map. |
| R-F2 | `features/ride-tracking/components/RideMapView.tsx:40-51` | Animated `fitToCoordinates` on every `driver:location` tick; it also re-runs when `pickup`/`drop` array identities change. A rider who pans or zooms is snapped back every few seconds, and the GPU stays busy. | Fit only when bounds meaningfully change (status/leg/stops). Stop fitting after `onPanDrag`. Optionally re-fit when the driver leaves the viewport. |
| R-F3 | `app/ride/[id]/index.tsx:71`; `features/home/useLiveLocation.ts:19-27` | The ride screen runs a GPS watch and a compass watch for the whole trip. It reads only `.coords` (SOS, Edit pickup) and never `heading`. Every compass change over 5 degrees re-renders the entire screen. | No watcher on this screen. Get a fix on demand for SOS. Add a `{ heading }` option to the hook so the compass only runs where used. Start the watcher inside `EditPickupSheet` only while visible. |
| R-F4 | `RideMapView.tsx:53,75-76`; `features/booking/components/SelectRideMap.tsx:91,105-106` | `routePoints.map(...)` builds a new coordinate array on every render, twice per map (casing + line). Fabric re-sends hundreds of points to native each time. | `useMemo` the array; wrap both maps in `memo`; pass stable `stops` (R-F13). |

### Background work (rider)
| ID | Where | Problem | Fix |
|---|---|---|---|
| R-F5 | `app/(tabs)/_layout.tsx:31`; `app/_layout.tsx:64`; `features/home/MapHero.tsx:63-73,161-170`; `features/home/sections.tsx:214-218,306-317`; `store/useLocationStore.ts:205` | Home never pauses. Under booking and ride screens its map, a second GPS + compass watch, three infinite animations and a 15 s interval keep running. | `freezeOnBlur: true` on `Tabs` and `Stack` (freeze stops renders but not native watchers or UI-thread loops). Also gate the watcher and loops on `useIsFocused()` and `cancelAnimation` on blur. |
| R-F6 | `features/map/components/MapWarmup.tsx:13-19`; `app/_layout.tsx:63` | A second Google map is kept alive for the whole process. It was added because Home had no map, but Home now mounts one at launch. Extra memory plus cold-start contention. | Delete `<MapWarmup />` and the file. |
| R-F7 | `shared/socket/createSocket.ts:27-65`; `shared/socket/useRoomJoin.ts:18-26`; `store/useAuthStore.ts:57-60,97-101` | The socket stays open in the background and never emits `leave:ride` (the server supports it, `socket.server.ts:240`). `driver:location` keeps streaming after the rider leaves the ride screen, including for old completed trips. | Emit `leave:ride` in the `useRoomJoin` cleanup. On `AppState` background, disconnect unless a ride screen is mounted; reconnect on active (`loadRide` already resyncs on reconnect). |

### Driver
| ID | Where | Problem | Fix |
|---|---|---|---|
| D-P1-1 | `services/location/backgroundTask.ts:84,97`; `features/active-ride/useDriverLivePosition.ts:33-34` (called from `home.tsx:72`, `active-ride/[id]/index.tsx:115`, `ActiveRideMap.tsx:47`) | Up to four location streams run during a ride. The background task is `Balanced` in both idle and active states, so fixes are often 40-100 m and `isAccurateEnough` (80 m) rejects them, and `speed` is often null (starving `useSpeedAlert`). Meanwhile three separate High-accuracy foreground watches run, and Home's watch also runs whenever the driver is online. The server track, which is what rider and billing see, is the coarse one. | One stream, tuned by state: idle `Balanced / 30 s / 0 m`; active ride `High / 3 s / 5 m`. UI reads `useDriverPositionStore`. Delete `useDriverLivePosition` (or keep it as a one-shot before going online). Largest battery win in the driver app. |
| D-P1-2 | `backgroundTask.ts:51-56,63-66` | A dev-only fix log writes to AsyncStorage on every accepted fix in production (read, parse, push, stringify, write): about 1,200 writes/hour in rides. `getLoggedFixes()` has no callers. | Delete the write and `LOG_KEY`/`getLoggedFixes`/`clearLoggedFixes` (and the call at `useAuthStore.ts:50`). Or wrap in `__DEV__`. |
| D-P1-3 | `features/active-ride/components/ActiveRideMap.tsx:149-159` | Both polylines rebuilt and re-sent to native on every GPS tick (about every 3 s) for the whole trip. A 60 km leg has thousands of points. | `useMemo` the coords. Replace min-distance thinning with Douglas-Peucker at about 5 m (80-90% fewer points on highways). |
| D-P1-4 | `ActiveRideMap.tsx:30-31,94-117` | Route refetched about every 20 s even while the driver follows it. "Deviation" is measured from the last fetch origin, not from the route, plus a 20 s forced refresh. Each refetch makes N+1 `/geo/route` calls. About 360 Directions calls/hour with one stop. | Refetch on leg/stop change or real off-route distance (point-to-polyline above about 75 m), with a 5 min safety refresh. |
| D-P1-5 | `features/onboarding/components/DocSlot.tsx:98`; `app/(tabs)/profile.tsx:163` | Remote doc thumbnails and the avatar decode at full size (1600x1200 is about 7.7 MB each). The Documents screen has up to 11 slots, so about 80 MB for 48 px tiles. OOM risk on 2-3 GB phones. Presigned URLs change each fetch, so nothing caches. | `resizeMethod="resize"` now. Better, add `expo-image` (`cachePolicy="memory-disk"`, `recyclingKey`). Have the API return a stable thumbnail URL. |
| D-P1-6 | `app.json`, manifest, `src/` | No protection against OEM/battery-optimization killing. On Xiaomi/Oppo/Vivo/Realme the foreground service and socket get frozen, matching pauses after 90 s, and the driver silently misses requests. | At first go-online prompt `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (needs the permission in `app.json`) and show OEM autostart guidance once. Send ride-request FCM at `priority: high` **with a notification**. See Play policy note in the research section. |
| D-P1-7 | `active-ride/[id]/index.tsx:115,204-207,303-307`; `useSpeedAlert.ts:40`; `CollapsibleRideSheet.tsx:45`; `SlideToConfirm.tsx:55` | The whole ride screen re-renders on every GPS tick: `live` (used only for SOS) and an always-on `useSpeedAlert` position subscription, even when disabled. `Gesture.Pan()` and the `stops` arrays are rebuilt each time. | Remove screen-level `live` (D-P1-1). Subscribe in `useSpeedAlert` only when enabled, via `store.subscribe`. `useMemo` both gestures and the arrays. |
| D-P1-8 | `android/app/build.gradle:73,123`; `eas.json:17-21`; no `expo-build-properties` | R8, resource shrinking and ABI filtering are off. Unshrunk dex (Firebase, Navigation SDK, PayU) is 30-50% bigger and slower to load; the `preview` APK carries x86/x86_64 libs. `android/` is regenerated by prebuild, so only a plugin can set these. | Add `expo-build-properties` with `enableMinifyInReleaseBuilds`, `enableShrinkResourcesInReleaseBuilds`, `buildArchs: ["arm64-v8a","armeabi-v7a"]` and keep rules for `com.payu.**`, `com.google.android.libraries.navigation.**`, `io.invertase.firebase.**`. **[verify]** PayU checkout, guided navigation, push and maps on a release build. |

---

## T2. Medium

### Rendering and maps
| ID | Where | Problem | Fix |
|---|---|---|---|
| R-F10 | `app/booking/fare.tsx:243,73,78-88,275-288,178` | Inline `ItemSeparatorComponent` remounts every separator each render; `visibleCategories` is rebuilt so the memo recomputes; `CategoryCard` not memoised; the screen re-renders on the 8 s nearby-driver poll. | Module-scope separator, `useMemo`, `useCallback` `renderItem`, `memo(CategoryCard)` with id-based callbacks. |
| R-F11 / D-P2-12 | rider `app/ride/[id]/chat.tsx:67-70,235,292,28-30,297-299,232`; driver `app/active-ride/[id]/chat.tsx:245,308` | Both chats: every keystroke re-renders all visible bubbles (`Bubble` not memoised, new `onRetry` closure), `FadeInDown.springify()` on every bubble including loaded history, `scrollToEnd({animated:true})` per size change. Rider also formats time with `toLocaleTimeString` per bubble per render. | `memo(Bubble)` with a stable `retry`; precompute time label; move the draft input into its own child; animate only messages created after mount; use an inverted list. |
| R-F12 | `app/ride/[id]/index.tsx:60`; `shared/hooks/useTripWindow.ts:15-23,53-64` | Trip-window state lives in the screen and ticks every second in grace/overtime, re-rendering the screen and map. | Move the hook into a small `<RideTripClock>` child. |
| R-F13 | `app/ride/[id]/index.tsx:239,350-357` | New `stops` array and inline `actions` objects each render; `RideMapView` not memoised. | `useMemo` stops, `memo(RideMapView)`, `useCallback`. With F3/F4/F12 a driver tick then only updates `CarMarker`. |
| R-F14 | `features/ride-tracking/useRideTracking.ts:62-64,78-79,118-120`; `CarMarker.tsx:21-26` | `markerLat/Lng/Heading` shared values are written on every tick but never read (dead). The car marker jumps between ticks. | Delete them. For smooth motion use `MarkerAnimated`/`AnimatedRegion.timing` or `animateMarkerToCoordinate`. |
| R-F16 | `features/trip-summary/TripSummary.tsx:98-109,42-46` | Full interactive Google Map for a static, non-interactive 196 px preview; inline arrays re-trigger the fit on every 15 s poll re-render. | `liteMode` (Android static map), memoise the arrays, or render a static image. |
| R-F20 | `features/ride-tracking/components/EditPickupSheet.tsx:50-54,87-93,103-105` | `setProximity` on every drag event re-renders the sheet; the user-dot `Marker` tracks view changes. | Quantise before `setState` or update on drag end; `tracksViewChanges={false}`. |
| R-F28 / R-F29 | `app/(tabs)/home.tsx:285,187-233,259-267,299-310`; `MapHero.tsx:189` | `RevealContext` value, gestures, `ways`/`promos` and `MapHero` props are new objects each Home render; `MapHero` not memoised. | `useMemo` the value and gestures, hoist constants, `memo(MapHero)` with primitive props. |
| D-P2-1 | `ActiveRideMap.tsx:48,63-69,71-87` | Camera stuck in "overview" on the first leg and after relaunch. The overview timer only starts when `leg` changes, so an animated `fitToCoordinates` runs on every GPS tick and overrides the driver's pans. | Start the timer on mount too. Pause follow for about 10 s after `onPanDrag`. |
| D-P2-2 / R-F25 | driver `LocationPin.tsx:17-31,36`, `OnlineToggle.tsx:30-37`, `shared/ui/PulseDot.tsx:13-16`; rider `features/home/sections.tsx:214-218,306-317,60-67,26-55` | Infinite Reanimated loops run where nobody can see them (a halo inside a snapshotted marker, loops on covered or stale screens). Rider loops also ignore reduce-motion. | Gate on `useIsFocused()` and `useReducedMotion()`, `cancelAnimation` when inactive, drop the halo on Android markers, `freezeOnBlur`. |
| D-P2-3 | `CollapsibleRideSheet.tsx:45-70` | Sheet animates `height` per drag frame (Yoga layout + Fabric commit each frame). | `translateY` instead, plus `useMemo` the pan. |
| D-P2-16 | `SlideToConfirm.tsx:70`; `shared/ui/SOSButton.tsx:42`; `EarningsBarChart.tsx:15`; `shared/ui/IntroCarousel.tsx:102-105` | Animated `width`/`height` on fill bars. | Full-width fill with `translateX` or `scaleX` under `overflow: hidden`. |
| D-P2-17 | root `Stack` `app/_layout.tsx:57`, `Tabs` `(tabs)/_layout.tsx:23` | No `freezeOnBlur`; Home (with its MapView) re-renders under the active ride screen. | `freezeOnBlur: true` on both. |
| R-F22 | `app/booking/rental.tsx:57-67,80-81` | `scrollEventThrottle={16}` with a new `withTiming` plus `setState` on every scroll event. | Act only when the boolean flips, or use `useAnimatedScrollHandler`. |
| R-F41 | `rental.tsx:575-576,602,376,439`; `MapHero.tsx:420,435`; `sections.tsx:421` | Multi-layer `boxShadow` on cards inside layout animations (extra blurred drawables per frame on Android). | Single-layer shadow or `elevation` in lists. **[verify]** with GPU profile bars before restyling. |

### Keyboard
| ID | Where | Problem | Fix |
|---|---|---|---|
| R-F23 / D-P2-4 | rider `chat.tsx:62-65,206`, `profile.tsx:48,204`, `safety.tsx:16,113`; driver `features/active-ride/useKeyboardOffset.ts:24-29`, `shared/hooks/useKeyboardOffset.ts:25-30`, `RideSheet.tsx:47-50`, `chat.tsx:64-67`, `profile.tsx:59` | Padding/height animated on `keyboardDidShow`: the input hides for about 250 ms, then a second 220 ms catch-up runs, with a full re-layout of the list each frame. The two driver hooks are duplicates. | `KeyboardProvider` is already mounted. Use `useKeyboardHandler`/`useReanimatedKeyboardAnimation` and drive `translateY`. The "broken on Fabric" notes may predate the 1.21.x upgrade, so re-test. Use one shared hook. |

### Network and data
| ID | Where | Problem | Fix |
|---|---|---|---|
| R-F15 | `useRideTracking.ts:225-228,241-266` | Route/ETA refetched every 20 s with traffic, one `/geo/route` per leg: up to 12 paid calls per minute with 3 stops. | Refresh after about 300 m off route or about 60 s; fetch only the active leg; ideally push ETA from the server. |
| R-F17 | `app/(tabs)/home.tsx:77`; `useRideHistory.ts:75-88`; `(tabs)/_layout.tsx:17` | Home loads the full history set to show two rows, refetches on every focus after 30 s, and calls `/rides/me/active-user` twice at cold start. | A `limit=5` recent-destinations fetch and a shared promise cache for `fetchActiveRideId`. |
| R-F18 | `features/home/fleet.ts:36-61`; `rental.tsx:167-171`; `useFareEstimates.ts:54-105` | Vehicle categories fetched in three places; fare screen fans out to 3N+1 requests with no abort. | One cached `getVehicleCategories()`, pass `signal`, and a batch estimate endpoint server-side. |
| R-F19 | `app/booking/map-picker.tsx:64-74` | An older, slower reverse-geocode can overwrite a newer address; the confirmed pickup uses it. Debounce timer not cleared. | Sequence ref (as in `home.tsx:92-107`) and cleanup. |
| R-F21 / D-P2-8 | rider `app/notifications.tsx:29-41,82,90,66-67`; driver `app/notifications.tsx:82` | `onEndReached` has no in-flight guard, so duplicate pages and duplicate keys. | `loadingMore` ref guard; memoise the row and precompute the time label. |
| D-P2-5 | `services/location/locationSync.ts:48-56` | HTTP location fallback has no backoff, in-flight guard or queue. Failed fixes are dropped, which leaves gaps that affect distance reconciliation. | In-flight flag, 3 s to 30 s backoff, a buffer of about 200 fixes flushed as one batch on reconnect. |
| D-P2-6 | `useSessionResync.ts:28-31`; `backgroundTask.ts:106-112` | After a cold relaunch the 30 s to 3 s ride-interval subscription is gone, so the next ride tracks every 30 s. If the OS dropped the task, tracking is not restarted. | In the `go_online` resync, start tracking if needed or re-arm the subscription. Make the subscribe an idempotent function. |
| D-P2-7 | `(tabs)/_layout.tsx:9`; `profile.tsx:52,89-96`; `home.tsx:46`; `useGoOnlineFlow.ts:43-48`; `wallet.tsx:62-69`; `chat.tsx:108` | Documents status fetched three times on Profile; vehicle/wallet/doc gates refetched on every go-online screen; wallet calls sequential; chat refetches the whole ride. About 8-10 requests where 4 would do. | Small TTL promise cache (like `citiesCache`), pass vehicle via route params, `Promise.all`, pass rider name and status to chat. |
| D-P2-9 | `daily-verification.tsx:63`; `SelfieCapture.tsx:40`; `onboarding/selfie.tsx:44`; `services/uploadImage.ts:41-50` | Each capture is decoded twice at full resolution (about 48 MB per decode); daily verification does 4 decodes back to back. | Pass `width`/`height` from the capture to skip the probe, resize in one pass, and capture smaller frames (`pictureSize`). |
| D-P2-10 | `useActiveRide.ts:267` | Cash-collection follow-up `setTimeout(load, 1200)` shows the skeleton again, and is never cleared. | Use `refresh`, keep the id in a ref, clear on unmount. |

### Startup, config, misc
| ID | Where | Problem | Fix |
|---|---|---|---|
| R-F8 / R-F9 | `assets/home/fleet-*.png` (six at 640x480, about 1.55 MB); `sections.tsx:171,248,288`; `CategoryCard.tsx:52`; `DriverIdentity.tsx:41`; `shared/ui/IntroCarousel.tsx:75` | Fleet art decodes at about 1.2 MB each for 54-62 dp slots; `expo-image` is not installed, so nothing downsamples or caches. | WebP at 3x display size (about 200x150) or reuse the shared WebPs; adopt `expo-image`. |
| R-F24 / D-P2-11 | `shared/theme/useAppFonts.ts:20-29`; `app/_layout.tsx:50-64`; `shared/ui/SplashOverlay.tsx:34,67-71`; driver `app/index.tsx:47-56,74` | Seven fonts loaded at runtime (rider never uses the three Space Grotesk weights, about 87 KB each); a forced 1.45 s overlay plus 0.45 s fade on every cold start. Driver also shows a blank screen until `/rides/me/active` returns (up to the 10 s timeout). | Embed fonts via the `expo-font` config plugin, per-app font set, shorten or skip the overlay on warm starts, route to Home immediately and redirect if an active ride arrives. |
| R-F26 | `app.json`, `babel.config.js` | R8/resource shrinking off (same as D-P1-8); React Compiler not enabled; `preview` APK ships x86 libs. | Same `expo-build-properties` block. `experiments.reactCompiler: true` after `npx react-compiler-healthcheck`. The compiler would auto-memoise much of F10-F13, F28 and F29, but not broad store subscriptions or changing context values. |
| R-F27 | `app/ride/[id]/index.tsx:62-65` | **Functional bug:** the "Driver's location hasn't updated" notice can never appear when updates stop, because the `useMemo` only recomputes when `lastLocationAt` changes. | A 30 s interval or a `setTimeout` to `lastLocationAt + 3 min` that sets `stale` state. |
| D-P2-13 | `services/notifications/index.ts:44-46` | Logout calls `unregisterPushNotifications(api, null)`, which returns immediately. A logged-out phone keeps receiving ride-request and chat pushes (also a privacy problem on shared phones). | Pass the real FCM token, then `deleteToken`. |
| D-P2-14 | `features/ride-requests/useRideAlertSound.ts:31` | Audio mode lacks `shouldPlayInBackground: true`, so the ride-request alarm may stay silent when the app is backgrounded or the screen is off. **[verify]** on a device. | `setAudioModeAsync({ ..., shouldPlayInBackground: true })`. |
| D-P2-15 | `useSpeedAlert.ts:47-62`; `driverPositionStore.ts:31-42` | `setPosition` and `startStaleWatch` each `set`, so every tick notifies subscribers twice. `isStale`, `stopStaleWatch` and `reset()` are never used; the last position survives logout. | One `set` per tick; call `reset()` on offline/logout; delete or wire the stale API to a "signal lost" state. |

---

## T3. Low

**Rider**
- R-F30, R-F31: whole-store zustand subscriptions (`booking/index.tsx:71`, `map-picker.tsx:35`), full result lists re-render per keystroke.
- R-F32: uncleared timers in `phone.tsx:167`, `fare.tsx:302`, `ride/[id]/index.tsx:135,148,167`, `useRideTracking.ts:132`, `EditPickupSheet.tsx:63`.
- R-F33: `useLiveLocation` can leak the position subscription if `watchHeadingAsync` throws (`useLiveLocation.ts:19-37`).
- R-F34: `@shopify/flash-list` installed but unused. Use it for chat (inverted) and notifications, or remove it.
- R-F35: dead `features/home/LocationCallout.tsx` (163 lines, infinite pulse). Delete.
- R-F36 / D-P3-10: the barrel `@ocar/mobile-shared` evaluates everything at startup. Use subpath imports for hot paths.
- R-F37 / D-P3-11: oversized logo PNG (216-218 KB shown at 56-120 px). Export a 360 px WebP.
- R-F38: intro carousel decodes three 1024x1536 images (about 19 MB). Resize to about 720x1080 or use `expo-image`.
- R-F39: `formatCurrency` builds a new `Intl.NumberFormat` per call. Hoist it.
- R-F40: `RideHistoryList` inline closures defeat `RideHistoryRow`'s memo.
- R-F42: `phone.tsx:310-314` large surface with `elevation: 10` (overdraw).
- R-F43: nearby-driver 8 s poll continues while the fare screen is covered (`SelectRideMap.tsx:49-76`). Gate on `useIsFocused()`.
- R-F44: each `useFreshness` caller runs its own 15 s interval. Use one module-level ticker.
- R-F45: `CategoryCard` calls `fleetImageFor(slug)` twice per render.

**Driver**
- D-P3-1: ride-request countdown ticks at 4 Hz (`RideRequestOverlay.tsx:168-178`) though the number changes once a second.
- D-P3-2: timeouts not cleared on unmount (`RiderActionsRow.tsx:42-48`, `OtpEntryCard.tsx:74`, `RateRiderSheet.tsx:45,50`, `phone.tsx:158`).
- D-P3-3: pending-review polling every 30 s ignores app state (`onboarding/pending-review.tsx:103-107`). Pause when not active.
- D-P3-4, D-P3-5: `applyInterval` can race (assign `currentIntervalMs` before the await), and it subscribes to the whole session store (`backgroundTask.ts:75-91,107`).
- D-P3-6: every launch writes the auth store back to storage because `hasHydrated` is persisted (`useAuthStore.ts:79-88`): a SecureStore encrypt plus an AsyncStorage write on each cold start.
- D-P3-7: the audio player is created at app start and held for the app's lifetime. Create it lazily.
- D-P3-8: unused manifest permissions/services (`RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`, media-playback FGS, `AudioControlsService`); iOS `UIBackgroundModes: ["audio"]` is an App Review flag. Set `recordAudioAndroid: false` and `microphonePermission: false` in the plugin configs.
- D-P3-9: `earnings.tsx:20-33` virtualises six static skeleton rows with FlashList. Use a plain `View` map.
- D-P3-12: OTP box animations built inside `useAnimatedStyle` (`OtpBoxInput.tsx:89-102`). Drive from `useEffect` with shared values.
- D-P3-13: dead `isCurrentlyTracking`/`getLoggedFixes` (one is needed for D-P2-6).
- D-P3-14 (config, not perf): the Google Maps key is committed in `app.json:28,36`. Confirm it is restricted to the package and SHA-1. `EX_DEV_CLIENT_NETWORK_INSPECTOR=true` belongs in dev only. Move `gradle.properties` edits to `expo-build-properties`, since `android/` is regenerated.

---

## Researched fixes (sources)

Each claim was checked on the cited page unless marked unverified.

**SDK and runtime**
- Run `expo@>=57.0.17`. `57.0.9` fixes a Hermes V1 memory regression "that could drastically increase memory usage in apps importing `react-native-worklets`", which is every Reanimated app. https://expo.dev/changelog/sdk-57
- Worklets "bundle mode" is experimental. Do not use it in production. Same page.

**Startup**
- expo-router async routes do not work in native production builds, so keep route files thin and import heavy modules only in the screens that use them. https://docs.expo.dev/router/web/async-routes/
- Inline requires only with tree shaking, since they change module evaluation order. Keep `TaskManager.defineTask` in an eagerly imported file. https://docs.expo.dev/guides/tree-shaking/ , https://reactnative.dev/docs/optimizing-javascript-loading
- Embed fonts with the `expo-font` config plugin. https://docs.expo.dev/develop/user-interface/fonts/
- R8: `enableMinifyInReleaseBuilds`, `enableShrinkResourcesInReleaseBuilds`. Google lists faster startup, lower memory and fewer ANRs. https://docs.expo.dev/versions/latest/sdk/build-properties/ , https://developer.android.com/topic/performance/app-optimization/enable-app-optimization
- Measure bundles with `EXPO_ATLAS=true npx expo export --platform android`. https://docs.expo.dev/guides/analyzing-bundles/

**Rendering**
- React Compiler is one line: `experiments.reactCompiler`. It auto-memoises gesture objects. https://docs.expo.dev/guides/react-compiler/ , https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/
- zustand: one selector per value or `useShallow` from `zustand/react/shallow`. Keep live GPS out of React state: use `store.subscribe` or shared values. https://zustand.docs.pmnd.rs/reference/hooks/use-shallow
- FlashList v2: no size estimates, `maintainVisibleContentPosition` on by default, always give `keyExtractor`, never put `key` inside rows, reset recycled row state with `useRecyclingState`. https://shopify.github.io/flash-list/docs/v2-changes , https://shopify.github.io/flash-list/docs/fundamentals/performance
- Reanimated: never read `sv.value` on the JS thread; animate `transform`/`opacity`, not layout props; about 100 simultaneous animated views is the budget on low-end Android. Flags for New-Arch FPS drops: `ANDROID_SYNCHRONOUSLY_UPDATE_UI_PROPS`, `USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS`. https://docs.swmansion.com/react-native-reanimated/docs/guides/performance/ . The exact flag config shape was not verified.
- Keyboard: drive `translateY` from `useReanimatedKeyboardAnimation`. https://kirillzyusko.github.io/react-native-keyboard-controller/docs/guides/first-animation

**Maps**
- `tracksViewChanges={false}` on every custom marker; `onRegionChangeComplete`, not `onRegionChange`; `liteMode` for static thumbnails. https://github.com/react-native-maps/react-native-maps/blob/master/docs/marker.md , `.../mapview.md`
- Camera throttling (about 1 per 1-2 s, pause on user gesture) and Douglas-Peucker polyline simplification are community practice, not documented by the library (unverified).

**Battery**
- Android 14+: location foreground service needs `foregroundServiceType="location"` plus `FOREGROUND_SERVICE_LOCATION`, started while the app is visible. https://developer.android.com/about/versions/14/changes/fgs-types-required
- Google: use the largest background interval and batch with deferred updates; High accuracy is for foreground real-time. https://developer.android.com/develop/sensors-and-location/location/battery . expo options: `deferredUpdatesInterval`, `activityType: AutomotiveNavigation`. https://docs.expo.dev/versions/latest/sdk/location/
- Doze: high-priority FCM that shows a notification wakes the app; a socket kept alive in the background does not. https://developer.android.com/training/monitoring-device-state/doze-standby
- Play policy allows `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` only when the app's core function breaks without it. A ride app that can use FCM may not qualify, so prefer sending the user to the battery settings screen and justify it in the Play declaration. Same Doze page. Whether a driver app with a location FGS qualifies is a policy judgement.
- Android vitals: ANR 0.47%, crash 1.09%, excessive wake locks in 5% of sessions (2 h or more per 24 h; location wake locks are exempt). https://developer.android.com/topic/performance/vitals , https://developer.android.com/google/play/vitals/excessive-wakelock

**Measuring**
- Profile release builds only. Tools: React Native DevTools (React Profiler, Memory heap snapshots, "Highlight updates"), Android Studio Profiler plus Perfetto, Reassure for render regressions, Sentry for slow/frozen frames. https://reactnative.dev/docs/profiling , https://reactnative.dev/docs/react-native-devtools , https://oss.callstack.com/reassure/docs/api

**Not verified:** whether `EXPO_UNSTABLE_TREE_SHAKING` is still needed on SDK 57; whether React Compiler is on by default in the SDK 57 template; whether FlashList v2 requires the New Architecture; Apple's rules for resuming paused location updates; Socket.io v4 default transports; New-Arch support of map-clustering libraries; predictive-back support in expo-router; Play's slow/frozen-frame session thresholds.

---

## Checked and fine

No `console.*` in either app or the shared package. Hermes, New Architecture and edge-to-edge are on. Map markers already use memo comparators. Driver trips list uses FlashList with stable keys and a paging guard. Socket listeners are cleaned up in every hook. Autocomplete is debounced and abortable. Image uploads are downscaled to 1600 px / JPEG 0.82. `useTripWindow` ticks adaptively on the driver side. PayU flow cleans up listeners and polls with capped backoff. Guided navigation tears down its native session.

---

## Suggested order of work

1. **T0:** D-P0-1 then D-P0-2. Two small diffs that stop a memory leak and a mid-drive navigation reset.
2. **Location and battery:** D-P1-1 with D-P1-2, then R-F3. One stream per state, no per-fix disk writes.
3. **Ride-screen rendering:** R-F1, R-F2, R-F4, R-F13, D-P1-3, D-P1-4, D-P2-1 (map polylines, camera, marker snapshotting).
4. **Background work:** R-F5, R-F6, R-F7, D-P2-17 (`freezeOnBlur`, delete `MapWarmup`, socket lifecycle).
5. **Build and memory:** D-P1-8 / R-F26 (R8, ABIs, React Compiler), D-P1-5 / R-F8 / R-F9 (image sizing, `expo-image`), then D-P1-6 (OEM survival).
6. **Cold start:** R-F24 / D-P2-11 (embed fonts, shorter overlay, route first).
7. Remaining T2, then T3 opportunistically. Bundle R-F27 (the stale-location bug) with R-F12.

**Verification after each batch:** release build on a low-end Android phone (2-3 GB RAM); Perfetto trace of a ride; Android Studio memory profiler across two consecutive rides (D-P0-1 should show flat memory); `adb shell dumpsys batterystats` for a 30 minute online-idle run before and after D-P1-1.

---

## Fix status (branch `fix/mobile-performance-audit`, 2 commits)

Verified with `tsc --noEmit`, `eslint`, `vitest` (driver 97, rider 69, shared 78 tests) and a full `expo export --platform android` of both apps with the React Compiler on. **Nothing was run on a device**, so every runtime claim below still needs the device checks listed at the end.

**Fixed:** D-P0-1, D-P0-2, D-P1-1 to D-P1-8, D-P2-1, 2, 3, 5, 6, 8, 9, 10, 12, 13, 14, 15, 16, 17, D-P3-1, 3, 4, 5, 8, 9, 11, 13; R-F1 to R-F7, F10, F11, F12, F14, F15, F17 (in-flight share), F18 (categories cache), F19, F20, F21, F22, F24 (embedded fonts, shorter overlay), F25, F26, F27, F30, F33, F34, F35, F37, F38, F39, F40, F43, F44.
`MapWarmup`, the dead `LocationCallout`, and the rider's unused `@shopify/flash-list` are removed.

**Fixed differently from the audit's suggestion**
- D-P1-6: opens the system battery-optimisation settings once, instead of requesting `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (a Play-restricted permission).
- D-P2-2 / R-F1: the pickup halo is now static instead of animated. Both apps' markers are bitmaps, so the animation was either invisible (driver) or the cost (rider).
- R-F8: fleet art converted to 256 px WebP (about 1.5 MB to 80 KB) rather than adopting `expo-image`.
- D-P1-5: `resizeMethod="resize"` on remote thumbnails rather than adopting `expo-image`.
- R-F12 and R-F13 / F28 / F29: the trip clock moved into its own component; the remaining prop-identity churn is left to the React Compiler, which is now on in both apps (healthcheck: 100/100 and 70/70 components compile).

**Deliberately not done (needs a device or a product decision)**
| Item | Why |
|---|---|
| R-F23 / D-P2-4 keyboard animation | The shared hook's own comment records a confirmed Fabric bug with `useReanimatedKeyboardAnimation`. That was before keyboard-controller 1.21.9, so it may be fixed, but only a device can say. |
| R-F16 TripSummary `liteMode` | Lite mode has no camera animation, so the route fit would need rework and a device check. The per-render re-fit is fixed (R-F2). |
| `expo-image` adoption (R-F9) | Native rebuild plus many call sites. The asset shrink and `resizeMethod` capture most of the win. |
| Dropping Space Grotesk (R-F24) | `OtpBoxInput` and the shared tokens still use it in the rider app, so the audit's "unused" was wrong. Fonts are embedded instead. |
| D-P2-11 driver blank screen until `/rides/me/active` returns | Showing Home first would let a mid-ride driver tap Go Offline. Product call. |
| R-F41 / R-F42 shadows | Profile with GPU rendering bars before restyling. |
| R-F18 fare fan-out (3N+1 requests, no abort) | Needs a batch estimate endpoint server-side. |
| D-P2-7 chained requests | Only concurrent duplicates are shared. Wallet stays sequential on purpose: package-mode drivers shouldn't fetch the wallet at all. |
| D-P3-6, 7, 10, 12; R-F31, 32, 36, 45 | Low value for the risk. |
| D-P3-14 | The Maps key in `app.json` must be restricted to the package and signing SHA-1 in Google Cloud. That is console-side. |

**Device checks before release**
1. Two consecutive rides: memory should stay flat and back should not walk through stale Home copies (D-P0-1). Log `navigationRef.getRootState().routes.map(r => r.name)`.
2. Toggle airplane mode mid-ride: the map and guided navigation must stay up (D-P0-2).
3. Release build with R8 on: PayU checkout, guided navigation, push, maps and the Firebase token flow (D-P1-8).
4. `adb shell dumpsys batterystats` for 30 min online-idle, before and after (D-P1-1).
5. Ride-request alarm with screen off and app backgrounded (D-P2-14).
6. Rider: background the app mid-ride for 2 min and return; status and driver position must resync (R-F7).
7. Rider ride screen: pan the map, confirm it is not snapped back; drive out of frame, confirm it re-fits within about 5 s (R-F2).
8. Collapsed ride sheet (driver): the always-visible part must sit flush above the nav bar after `translateY` (D-P2-3).
