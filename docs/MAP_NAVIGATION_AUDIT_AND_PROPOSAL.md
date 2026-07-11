# In-Ride Map & Navigation: Audit and Proposal

**Date:** 2026-07-09
**Trigger:** Client feedback: "the map still stays the same small like it was and shows icon rather than helping driver follow the roads and traffic like Google Maps." Clients want Google-Maps-grade navigation with voice instructions.

> **Status note (2026-07-10): Phases 1-3 are implemented and deployed to production.**
> Decided (§4 open decisions): TBT provider is **Google Routes/Directions only** (no
> Mapbox, no HERE) — extends the existing `google.provider.ts`, no new vendor/env var.
> Voice language is Hindi-default + English-toggle, voice defaults **on** with a mute
> control. Phase 2's traffic-tinted polyline (§2 "nice-to-have") was **not** built.
>
> **Phase 1 (driver)** — shipped across 5 commits (`4a262b3`, `866dd05`, plus the
> heading/first-fix bug fix folded into `4a262b3`):
> - §1.1 heading double-rotation fix: `RecenterMap.tsx` now eases `setHeading()` over
>   ~350ms instead of hard-snapping; `SelfCarMarker.tsx` only rotates the icon when the
>   map itself isn't already heading-up (kept optional `heading` prop for the north-up
>   idle screen, `Home.tsx`, which still needs icon rotation).
> - Backend: `google.provider.ts` `getRoute()` takes an optional `opts` (`language`,
>   `withSteps`, `trafficAware`) and parses `legs[].steps[]` (incl. each step's own
>   `polyline`, needed for accurate step-boundary snapping — not in the original plan,
>   added because §4's plan only specified start/end points per step, which isn't enough
>   to know which step you're on mid-curve). Redis-cached via existing `setWithTTL`/
>   `getJSON` helpers, 90s TTL. **Deviation from §B.1**: did not build the full
>   `RouteProvider` interface/registry abstraction — extended the existing functions
>   directly instead, since there's only one active provider; the interface was
>   speculative for a "maybe later" second provider that was explicitly declined.
> - `apps/driver/src/lib/useTurnByTurn.ts` (new): route fetch + GPS-to-route snapping
>   (`apps/driver/src/lib/geo.ts`'s new `nearestPointOnPolyline`) + off-route detection
>   (40m / 3 consecutive fixes) + resilient reroute (never drops the stale route on a
>   failed fetch, capped backoff 2s→16s, 12s cooldown). Replaces the old >200m-deviation
>   />60s-staleness timer refetch in both `NavigateToPickup.tsx`/`TripInProgress.tsx`.
> - `ManeuverBanner.tsx` (new) wired into both nav screens; permanent "Open in Google
>   Maps" fallback button added to `TripInProgress.tsx` (previously only existed on
>   `NavigateToPickup.tsx`).
> - Voice: `useVoiceGuidance.ts` + `useNavPrefsStore.ts` (zustand-persist, mirrors
>   `useSessionStore`'s pattern) + `VoiceToggleButton.tsx` + `HindiVoiceHint.tsx`.
>   **Deviation from §3 item 5**: does not hand-build an "In 300m, turn left…"
>   announcement sentence — speaks the backend's already-localized instruction text
>   directly at two distance bands (300m, 100m) instead, to avoid fabricating unreviewed
>   Hindi grammar. Flagged as worth a native-speaker review if richer phrasing is wanted.
> - `RecenterMap.tsx` pitch (50°) + distance-based zoom (18/17/16), and `useWakeLock.ts`
>   extracted from the two screens' duplicated inline logic.
> - **Not built**: the dark map style during nav (§3 item 9) — needs a Cloud-based Map
>   Style configured in the Google Cloud Console, not achievable from code alone.
>
> **Phase 2 (rider)** — shipped in `1fd8bb4`: `RecenterMap.tsx` ported the same smoothed
> heading-rotation (built correctly from the start, not copying the driver app's
> original hard-set bug), gated on `headingKnown` from `useInterpolatedPosition.ts`
> (which itself was fixed to stop defaulting to a fake `heading=0` on the first GPS fix
> — see §1.1). Live ETA (traffic-aware duration + distance) added to the ride status row
> during the driver-pickup/driver-dest legs, refreshed on reroute rather than a timer.
>
> **Phase 3** — shipped in `390d9f9`: `maplibre-gl`/`react-map-gl` removed from both
> apps' `package.json`, plus two leftover CSS `@import`s that were silently shipping
> maplibre's stylesheet (driver app's CSS bundle dropped ~109kB → ~39kB).
>
> **Genuinely unverified** — none of the above has been confirmed on a real device or
> real drive. Heading smoothness, off-route threshold tuning (40m/3 fixes), the
> Android Chrome voice-queue-wedge-after-40-minutes failure mode, and Wake Lock across
> screen-lock are all things §4/testing-section flagged as needing real-device
> verification, not something achievable from this environment. Do that before
> considering this client-ready.
>
> Also fixed along the way (not in this doc's original scope, found via user reports
> while testing): `select-ride/page.tsx` never classified in-city vs outstation, so it
> showed One Way/Round Trip tabs for in-city trips that would always 422 at booking
> time (`0a4ccad`); Bhubaneswar's stored city boundary was a rough placeholder rectangle
> that excluded real outskirts like AIIMS Sijua (`c8ea3fe`, still just a wider rectangle,
> not a real polygon — flagged as needing an actual admin-drawn boundary eventually).

> **Status note (2026-07-11): live traffic layer added — the one gap Phase 1-3 left open.**
> Client feedback after seeing Phase 1-3 live: still not "like Google Maps," specifically
> no colored traffic on the roads. This was the single item explicitly deferred in §2/§4
> ("traffic-tinted polylines... nice-to-have, not required for the core complaint") —
> closed now rather than left as a follow-up.
> - `apps/driver/src/components/map/TrafficLayer.tsx` (new) — mounts the free
>   `google.maps.TrafficLayer` tile overlay (same live congestion data as the Google Maps
>   app, no extra billed API calls) onto the existing map instance via `useMap()` from
>   `@vis.gl/react-google-maps`. Reads `window.google` dynamically at runtime rather than
>   referencing an ambient `google.maps` type, since this repo has no `@types/google.maps`
>   declared.
> - Mounted `<TrafficLayer />` inside both `NavigateToPickup.tsx` and `TripInProgress.tsx`
>   (lazy-imported, matching the existing pattern for `RecenterMap`/`ManeuverBanner`), so
>   both the pickup leg and the drop-off leg now show colored road congestion.
> - `apps/driver/src/lib/ride-api.ts`: `driverRideApi.getRoute()` gained an optional
>   `trafficAware` param, forwarded as a query string to `GET /api/v1/geo/route`.
> - `apps/driver/src/lib/useTurnByTurn.ts`: the route-fetch hook now always passes
>   `trafficAware: true`. The backend already supported this — `google.provider.ts`'s
>   `opts.trafficAware` (see Phase 1 note above) was built but never invoked from the
>   frontend until now — so routing/ETA responses actually factor in live congestion,
>   not just static travel time.
> - `apps/user/components/map/TrafficLayer.tsx` (new, same pattern) + `RideMapScene.tsx`
>   mounts it too, gated on `!isRecap` (no traffic overlay on the post-ride recap map) —
>   parity with the driver app's live-tracking view.
> - **Not verified**: `tsc --noEmit` was not run to a clean completion in the session that
>   made this change (environment issue, not a code issue) and nothing was exercised in a
>   running browser. Confirm before showing the client:
>   ```
>   cd apps/driver && npx tsc --noEmit
>   cd apps/user && npx tsc --noEmit
>   pnpm dev   # both apps — confirm colored traffic actually renders on a real route
>   ```
> - Still not done: traffic-tinted route polyline (color the line itself by segment
>   congestion, vs. the tile overlay added here) remains unbuilt — this was always the
>   "optional/nice-to-have" item in Phase 2 item 3, separate from the traffic layer itself.

---

## 1. Current State (Audit)

Stack: both `apps/user` and `apps/driver` render maps via `@vis.gl/react-google-maps` (Google Maps JavaScript API). `maplibre-gl` / `react-map-gl` are also in `package.json` but **unused** — dead dependencies, no `MAPBOX_TOKEN` anywhere in the repo.

### What already works
The implementation is more capable than it looks visually:

- **Driver app** (`apps/driver/src/components/map/RecenterMap.tsx`, consumed from `pages/ActiveRide/NavigateToPickup.tsx` and `TripInProgress.tsx`):
  - Full-screen map (not actually "small" — `absolute inset-0` behind the top bar/bottom sheet).
  - Follows live GPS: `map.panTo()` on every fix beyond a ~2m threshold.
  - **Rotates the map to heading** (`map.setHeading()`), a genuine compass-following camera.
  - Draws a route polyline fetched from the backend, re-fetched on >200m deviation or >60s staleness.
  - Manual "Locate me" recenter button on `TripInProgress.tsx`.
- **User app** (`apps/user/components/map/RideMapScene.tsx`, `app/(main)/ride/[id]/page.tsx`):
  - Follows the driver's position via `RecenterMap` (pan only, no rotation).
  - Draws the same route polyline.
  - Shows a breadcrumb trail of past driver positions during `in_progress`.
  - `CarMarker` icon rotates to heading via CSS, but **the camera itself stays north-up**; only the icon rotates, not the map.
- **Location pipeline** is solid: driver `watchPosition` → throttled 3s HTTP sync → `api/src/modules/rides/rides.service.ts` persists + `socket.server.ts` emits `driver:location` to `ride:{rideId}` → user client smooths it with `useInterpolatedPosition.ts` (rAF lerp), so the marker glides rather than jumps. 10s poll fallback if the socket drops.

### What's actually missing (the real gap behind the complaint)
1. **No turn-by-turn maneuver instructions.** The route polyline is drawn but never decomposed into steps/maneuvers. There's no "Turn left in 200m" banner anywhere.
2. **No voice guidance at all.** Grep for `voice|tts|speech|SpeechSynthesis` across both apps returns nothing.
3. **No live traffic.** No traffic layer, no traffic-aware ETA, no traffic-based re-routing.
4. **Driver's "Navigate" button just deep-links to `maps.google.com`** (`NavigateToPickup.tsx`), i.e. today drivers already leave the app to get real turn-by-turn from Google Maps, and the in-app map is cosmetic during actual navigation. This is almost certainly what "feels immature" to clients: the driver has to tab out to a *different app* to get real guidance, and the in-app view they're left looking at doesn't help them.
5. **No re-routing on deviation** beyond silently re-fetching a new polyline: no distance-to-maneuver, no off-route detection driving a "rerouting…" state.
6. **User app camera doesn't rotate**, which feels static/toy-like compared to a heading-locked navigation view even though the underlying position data is already there.

**Conclusion:** the complaint isn't really about map *rendering* (follow/pan/heading already exist on the driver side); it's the absence of the navigation *layer* on top: maneuver instructions, voice, and traffic. That's the actual gap to close.

### 1.1 Car icon heading instability — root cause found

Clients also flagged that the car icon's orientation "doesn't remain intact" — it visibly jumps/resets instead of smoothly pointing the direction of travel. Traced to two separate, concrete bugs:

**Bug 1 — rider app (`apps/user`), first-fix snap-to-north.**
`apps/user/lib/useInterpolatedPosition.ts` correctly gates heading updates on movement (`dist > 8` before recomputing bearing, line 71), so a stationary car does *not* spin randomly. But on the **very first GPS fix** (before a second point exists to compute a bearing from), it snaps immediately to the raw `rawHeading` value sent by the backend, which is frequently `null`/`NaN` from the device and defaults to `0` in `CarMarker`. Result: the car icon can render pointing due north on trip start or on reconnect, regardless of actual direction of travel, until the driver moves >8m and a real bearing is computed.

**Bug 2 — driver app (`apps/driver`), double-rotation.**
This is the more visible one:
- `apps/driver/src/components/map/RecenterMap.tsx` (lines 68-75) calls `map.setHeading(heading)` — this rotates the **entire map viewport** so "up" = direction of travel. Markers rendered inside that map (including the driver's own) rotate along with the whole canvas automatically.
- `apps/driver/src/components/map/SelfCarMarker.tsx` (line 86) **separately** applies `transform: rotate(heading)` in CSS to the car icon itself, using the *same* `selfHeading` value.
- Both are fed from the same source (`selfHeading` from `useDriverLocation`) into both components simultaneously (`TripInProgress.tsx:180,184`, `NavigateToPickup.tsx:148,150`) — so the icon is rotated **twice** by the same angle (effectively `2 × heading` relative to true screen-up), and the two rotations use different timing (`map.setHeading()` is an instant hard-set; the marker's CSS has a separate `0.4s` transition), so during any turn the map snaps instantly while the icon eases independently — a visible mismatch/jump every time heading changes ≥2°.
- Additionally, `SelfCarMarker.tsx` has **no stationary/noise gating** (unlike the rider app's `dist > 8` guard) — raw `coords.heading` from the device is often erratic at low speed, so the icon jitters even when barely moving.

**Fix (to fold into Phase 1 below):** pick one rotation model per screen, not both. If the map rotates via `setHeading()` (heading-up mode — recommended for the driver's own navigation view), the marker icon itself should stay fixed at `0°` in screen space. If the map stays north-up (rider-tracking view), only the icon should rotate, with the same movement-gating the rider app already has, ported into `SelfCarMarker`. Also smooth `map.setHeading()` calls (interpolate over ~300-400ms) instead of hard-setting, to match the marker's existing transition and eliminate the snap.

---

## 2. How Modern Cab Apps Do This (Research)

- **Big players build proprietary nav** (Uber Nav, Ola Maps on OSM+Krutrim) — not a realistic bar for a platform this size.
- **Critical constraint for us:** Google's and Mapbox's real "Navigation SDKs" (bundled voice, auto-instructions, lane guidance) are **native Android/iOS only**. There is no browser Navigation SDK from either vendor. Since `apps/driver` is a Vite+React web SPA (not native), true turn-by-turn has to be **assembled**, not bought:
  - a web map renderer (already have: Google Maps JS API) +
  - a directions API that returns step-by-step maneuvers +
  - our own follow-camera, maneuver-tracking, and voice logic.
- **Mapbox Directions API** is the standout for *web* builds specifically because it can return `steps=true&banner_instructions=true&voice_instructions=true` — pre-written banner text and voice strings with the exact distance-before-maneuver to announce them. This removes most of the hardest client logic (when to say what). Google's Routes API gives `navigationInstruction` text per step but no voice/banner timing metadata — more work to replicate client-side.
- **Camera follow pattern:** `map.easeTo({ center, bearing, pitch: ~45–60°, zoom })` on each fix; auto-recenter after N seconds of user pan inactivity; zoom in near turns, out on straightaways. Matches what `RecenterMap.tsx` already does on the driver side — needs pitch/zoom-by-context added, and the same rotation ported to the user app.
- **Maneuver tracking:** snap live GPS to the route polyline (nearest-point-on-line, e.g. `turf.js` `nearestPointOnLine`), compute remaining distance in the current step, advance on maneuver-pass, declare off-route at ~30–50m perpendicular deviation for several consecutive fixes → re-request directions.
- **Voice:** browser `SpeechSynthesis` (Web Speech API) is viable for a foreground navigation screen (which this always is) but has caveats — background-tab throttling (moot here), utterances >~200-250 chars can truncate in Chrome, first `speak()` needs a prior user gesture (satisfied by the driver tapping "Start Trip"/"Arrived" etc.), voice/quality varies by device. Pattern: feed Mapbox's `voiceInstructions[].announcement` into `SpeechSynthesisUtterance` at the specified distance.
- **Traffic-aware routing:** Google Routes API `routingPreference: TRAFFIC_AWARE(_OPTIMAL)` + `departureTime`, or Mapbox's `mapbox/driving-traffic` profile — both bake live traffic into ETA and route choice.
- **Location fan-out:** 3–5s driver emit cadence (we're already at 3s), rider-side rAF interpolation so the marker never teleports (we already have this via `useInterpolatedPosition.ts`) — Ocar's plumbing is already aligned with industry practice here.

### Provider comparison (India, browser-based, small-startup budget)

| | Google Maps Platform | Mapbox | Mappls | Ola Maps |
|---|---|---|---|---|
| Web renderer | Maps JS API (in use today) | Mapbox GL JS, 50k free loads/mo | Vector Web SDK | MapLibre-compatible |
| Traffic-aware routing | Routes API, best India traffic data, steep India-billing discounts | `driving-traffic` profile, 100k free req/mo | India-tuned, sales-led pricing | Directions API, 5M free calls/mo, ~50% of Google's India rates |
| Web TBT building blocks | Steps only, no voice/banner timing — more client work | **Best fit**: `steps` + `banner_instructions` + `voice_instructions` with timing built in | No web nav SDK | Raw directions JSON, least mature |
| Verdict | Good if staying single-vendor | Best API ergonomics, but see §2.3 | Not ideal for browser TBT | Cheapest, but immature/higher integration risk |

---

### 2.3 Voice/text language — the finding that flips the provider recommendation

The comparison above scores providers on API ergonomics only. Language support changes the answer:

- **Mapbox `voice_instructions`/banner text has no Indic language at all** (its supported list covers Arabic through Vietnamese, no Hindi, no Odia). The "pre-written strings remove the hardest client logic" advantage in §2 is an advantage only if drivers understand English — most Odisha drivers don't, they speak Hindi/Odia.
- **Google Routes/Directions supports `language=hi`** and returns Hindi maneuver text natively.
- **Odia has no viable TTS anywhere** — not Google TTS, not any mainstream browser/OS engine. This is a hard vendor gap, not an engineering gap. **Odia voice is explicitly out of scope**; ship Hindi (default) + English (toggle) only, and say so to the client once, deliberately, rather than let it surface as a bug report later.
- **Practical TTS delivery:** feed maneuver text into `SpeechSynthesisUtterance` with `lang: 'hi-IN'`. Android Chrome delegates to the system TTS engine — a Hindi voice is commonly present on Indian Android phones, but if the voice pack isn't installed, Chrome silently substitutes an English voice reading Hindi text (mangled). There's no reliable way to detect this ahead of time; mitigate with a one-time "voice guidance is in Hindi — install the Hindi voice pack in phone settings" hint on first use, and an English toggle as the escape hatch.
- **Odisha road-data quality is untested.** Mapbox's India routing is OSM-based; Google's is reinforced by Android device density. Neither doc section has verified which is better for Cuttack's inner-town one-ways / newer BBSR layouts specifically — this needs a cheap spot-check (see §4), not an assumption.

**Net effect on the provider decision:** the real choice is *Google Routes (`language=hi` text, self-built announce-timing)* vs *Mapbox (better-built timing, but Hindi strings have to be self-templated from the structured maneuver JSON since Mapbox won't supply them)*. Settle it with the 10-route spot-check in §4, not on API ergonomics alone.

---

## 2.1 Does being a website put a hard ceiling on navigation quality?

Client question: is a browser app inherently worse at navigation than a native app? Short answer — **mostly no, with one real exception (backgrounding).**

**GPS access is not degraded on web.** `navigator.geolocation.watchPosition` in mobile Chrome/Safari reaches the same underlying hardware as native apps — Chrome on Android uses the same Fused Location Provider, Safari uses CoreLocation. With `enableHighAccuracy: true` on a foregrounded tab, fix rate (~1 Hz) and accuracy (3-10m) are comparable to native. What's missing on web: raw per-satellite data, sensor-fused heading at high rate, and control over request priority — `coords.heading`/`coords.speed` are frequently null/jumpy, which is *exactly* the mechanism behind the heading bugs in §1.1. Native Navigation SDKs paper over this with built-in heading smoothing and snap-to-road; on web that logic has to be built explicitly (it currently isn't, which is the actual root cause, not "websites can't do this").

**Rendering is not the bottleneck either.** Google Maps JS API's default raster mode is weak for camera-follow, but the WebGL vector mode (`mapId`-based — already in use, see §1) and Mapbox GL JS are both GPU-accelerated and capable of smooth 60fps interpolated camera-follow with rotation/tilt on mid-range phones. The visual gap vs. native is small once implemented correctly (smoothing, `easeTo`, gated heading updates per §1.1's fix).

**The one real, unavoidable ceiling: backgrounding.** On iOS Safari specifically, when the screen locks or the browser is backgrounded: `watchPosition` callbacks stop, timers freeze, WebSockets get suspended, and `SpeechSynthesis` goes silent. There is no web equivalent of iOS's "Always" background location permission, and no way for a website to run a persistent foreground location service the way a native Android app can. Android Chrome is somewhat more forgiving but still throttles background tabs. **Practical implication for Ocar:** as long as the driver keeps the app foregrounded and the screen on during navigation (reasonable for a nav UI — enforce with the Wake Lock API, Safari 16.4+/Chrome, to prevent screen sleep), none of this applies. It only bites if a driver locks their phone or switches to WhatsApp mid-navigation — which a native app (or a wrapped app via Capacitor) would handle, but a plain website cannot.

**Bottom line:** today's instability is ~80% a missing-engineering problem (no TBT logic, no heading smoothing, the double-rotation bug in §1.1) and ~20% a genuine web constraint (can't navigate with the screen locked). The engineering fixes in this doc close the 80%; the 20% would require going native/hybrid, which is a separate, much larger decision not currently in scope.

## 2.2 HERE Technologies — client's requested addition

The client asked to use "HERE Technologies together with Google Maps, like Uber does." Findings:

- **What HERE is:** formerly Navteq → Nokia HERE, now owned by a BMW/Audi/Mercedes/Intel consortium. Offers a browser-compatible JS SDK, Routing API v8, Traffic API, Geocoding & Search, Positioning API, and is widely embedded in car OEM navigation systems and fleet/logistics tooling. It's a legitimate, browser-usable provider (~30k free transactions/month, then ~$0.83/1,000 requests) — not a native-only or vaporware product.
- **The Uber claim is real but the reason doesn't transfer.** Uber named HERE a "global location provider" at CES 2024, and Lyft uses HERE for search/places. But this is a **multi-country, multi-billion-request-scale** decision driven by: coverage gaps in regions where Google is weak, per-transaction cost renegotiation leverage at Uber's volume, and avoiding single-vendor lock-in globally. None of those forces are in play for a single-state Odisha platform.
- **Is HERE more accurate for Bhubaneswar/Cuttack/Puri?** No evidence of it. HERE's strengths are automotive-grade positioning and coverage in Europe/North America; Google's India data (POIs, live traffic sourced from Android device density, local road updates) is generally considered stronger in India specifically, and this project is already on Google.
- **Would adding HERE reduce the "unstable results"?** No — the instability traced in §1.1 is a client-side logic bug (double rotation, unsmoothed heading), not a data-quality problem from Google. Swapping or adding a second map provider doesn't touch that code path at all.

**Recommendation:** don't adopt HERE as a primary or dual-source provider for accuracy reasons — there's no evidence it would be more accurate here, and Google's India coverage is the stronger asset already in use. If the client wants multi-provider resilience specifically (not accuracy), the honest, low-cost version of that ask is: put routing/geocoding behind a provider-abstraction interface in `api/src/modules/geo/providers/`, and add HERE Routing API v8 as a **fallback only** — used solely if Google's API is down/erroring, not to "average" or improve results. This should be framed to the client as a cost-cheap reliability hedge, not the accuracy upgrade they're expecting — the accuracy fix is the heading/TBT engineering work in §1.1 and §3.

---

## 3. Proposed Solution

### Guiding principle
Don't rip out the existing Google Maps rendering — it works and both apps are already keyed to it (API keys, `AdvancedMarker`, `mapId` styling, admin app shares the same provider). Instead, **add a navigation layer on top for the driver app** (where it matters — the driver is the one who needs to "follow the roads"), and **bring the user app's camera behavior up to the same standard** it visually needs to look "live."

### Phase 1 — Driver in-app turn-by-turn (highest client-facing impact)
1. Switch route-fetching (driver-side only, for active-ride screens) to a directions provider that returns maneuver steps with voice/banner text, called from the existing backend route endpoint (`api/src/modules/geo/providers/`) as a new provider alongside the current Google one, to avoid a wholesale vendor migration. **Provider choice is an open decision pending the spot-check in §4/§2.3** — Mapbox (`driving-traffic`, `steps=true&banner_instructions=true&voice_instructions=true`) has the more complete API but no Hindi voice/text; Google Routes has `language=hi` support but requires self-built announce-timing. Whichever is chosen, Hindi is a Phase 1 requirement, not a follow-up.
2. Add a maneuver-tracking hook (`useTurnByTurn`) in `apps/driver/src/lib/`: snaps each GPS fix to the route, tracks current step index, computes distance-to-maneuver, detects off-route (>40m for 3+ consecutive fixes) and triggers re-fetch. **Network-resilience contract for this hook (required, not optional):** never discard the current route/steps on a failed reroute request — keep guiding against the stale route, show a passive "reconnecting…" indicator, retry with capped exponential backoff, and enforce a 10–15s minimum cooldown between reroute calls (GPS noise near flyovers/toll plazas otherwise triggers reroute storms). Banner and voice must not depend on map tiles rendering — instructions keep running through tile blackouts in highway dead zones (NH16 has real coverage gaps).
3. **Retire the existing 60s-staleness periodic refetch** when this hook lands — reroute only on confirmed off-route, not on a timer. This matters for cost: unbounded periodic refetch on a ~90min BBSR–Puri trip is ~90 requests/ride against Mapbox's paid tier past 100k/mo free; maneuver-tracked reroute-only is ~2–6/ride. Add a short-TTL (60–120s) server-side cache on the route endpoint plus a per-ride rate cap as a backstop against client bugs.
4. Add a maneuver banner UI (top of `NavigateToPickup.tsx` / `TripInProgress.tsx`) showing next-turn icon, instruction text, and distance — replacing the current dead "Navigate" deep-link button. **Keep "Open in Google Maps" as a permanent fallback button, not a temporary escape hatch** — v1 in-app TBT will be rougher than the Google Maps app for a while, and a driver must never be stuck with no way out. Glanceability requirements (dashboard-mounted phone, driver glancing while moving): distance-to-maneuver and turn icon large and high-contrast, all tap targets on active-ride screens ≥48px, no confirmation dialogs or text entry reachable mid-trip.
5. Add voice guidance: `SpeechSynthesisUtterance` in Hindi (default) / English (toggle), fired at each instruction trigger distance, gated by a driver-toggleable mute button. Call `speechSynthesis.cancel()` before each `speak()` — Android Chrome's utterance queue is known to wedge after long idle periods otherwise (manifests as "voice randomly stops working after 40 minutes").
6. Upgrade `RecenterMap.tsx` (driver): add `pitch` (~45-60°) and dynamic zoom (tighter near upcoming turns, wider on straightaways) to the existing pan+heading follow logic.
7. **Fix the heading double-rotation bug (§1.1)** as part of this phase, not separately — it's in the same files being touched (`RecenterMap.tsx`, `SelfCarMarker.tsx`): pick heading-up mode (map rotates via `setHeading`, marker icon fixed at 0°) for the driver's own navigation view, smooth the `setHeading()` calls instead of hard-setting, and add the same movement-gating the rider app already has in `useInterpolatedPosition.ts` to `SelfCarMarker`. Also fix the rider-side first-fix snap-to-north by holding the icon hidden/neutral until a real bearing can be computed from two points, instead of defaulting to `heading = 0`.
8. Add a Wake Lock (`navigator.wakeLock`) on active-ride screens to prevent the phone screen from sleeping mid-navigation — closes most of the backgrounding gap noted in §2.1 without going native.
9. **GPS/battery policy (state it explicitly, don't leave it implicit):** high-accuracy `watchPosition` + Wake Lock apply only on active-ride screens (acquire on mount, release on trip end/cancel). Online-idle (waiting for a ride) stays on the existing lower-accuracy/cadence mode — an 8-hour idle shift at high accuracy is the drain that gets the app uninstalled, not a 90-minute nav session. Use a dark map style during navigation as a minor OLED-battery bonus (drivers frequently navigate at night anyway).

### Phase 2 — User app live-tracking parity
1. Port heading-based map rotation from the driver's `RecenterMap.tsx` into the user app's `RecenterMap.tsx` (currently pan-only) so the camera itself follows the driver's direction of travel, not just the car icon.
2. Add a live ETA that reflects traffic (`driving-traffic` profile / Google Routes traffic-aware duration) instead of a static route-time estimate, refreshed on each re-route.
3. Optional: light traffic-tinted route line (color-code polyline segments by congestion) if the chosen provider returns per-segment traffic annotations — nice-to-have, not required for the core complaint.

### Phase 3 — Cleanup
- Remove unused `maplibre-gl` / `react-map-gl` dependencies from both `apps/user/package.json` and `apps/driver/package.json` (confirmed dead weight from the audit).
- Consolidate: if Mapbox proves out in Phase 1, evaluate consolidating the *renderer* too (Mapbox GL JS instead of Google Maps JS API) to avoid running two paid map SDKs — but this is a bigger, separable decision and shouldn't block Phase 1.

### What NOT to do
- Don't attempt to license Google's or Mapbox's native Navigation SDKs — they don't exist for the browser; that path is a dead end regardless of budget.
- Don't build a self-hosted OSRM/Valhalla stack yet — it drops live traffic entirely, which is the one thing clients are explicitly asking for ("like Google Maps... traffic").

### Effort shape
- Phase 1 (driver TBT + voice) is the piece that directly answers the client complaint and should be prioritized. It touches: one new backend directions provider, one new driver-side hook, one new banner component, voice wiring, and `RecenterMap.tsx` pitch/zoom upgrade.
- Phase 2 is smaller (mostly porting existing driver-side rotation logic to the user app) and improves rider-facing polish.
- Phase 3 is trivial cleanup, do it opportunistically alongside Phase 1.

---

## 4. Open Decisions for Product/Eng Sign-off
- **Provider choice for driver TBT**: no longer purely an API-ergonomics call (§2.3 flips it) — Mapbox has better-built voice/banner timing but zero Hindi support (self-templating Hindi strings from its structured maneuver JSON required); Google Routes supports `language=hi` natively but needs self-built announce-timing. Resolve with a half-day spot-check: run ~10 real corridor routes (both directions, including Cuttack inner-town pickups) through both providers and compare maneuver accuracy/road coverage before committing — Odisha road-data quality hasn't been verified for either.
- **Language scope**: Hindi (default) + English (toggle) for Phase 1 voice/text. **Odia is out of scope** — no browser/OS TTS engine supports it today; this is a vendor gap, not an engineering one, and should be communicated to the client as a deliberate, known limitation rather than surfacing later as a bug report.
- **Voice on/off default**: default-on with mute control, or default-off/opt-in first trip.
- **Scope of Phase 2 rollout**: whether traffic-tinted polylines are worth the added API cost per ride for the initial release.
- **HERE Technologies**: recommend declining as a primary/accuracy provider (§2.2 — no evidence it improves accuracy for Odisha, and doesn't touch the actual instability bug). If the client still wants it for reliability optics, scope it strictly as a Google-outage fallback behind a provider-abstraction layer, not a routing/positioning upgrade — needs explicit client sign-off on that framing so expectations are set correctly.
- **Native/hybrid app**: out of scope for this proposal, but flag to the client that the one true web ceiling (no navigation while phone is locked/backgrounded, §2.1) can only be removed by going native or wrapping the driver app (e.g. Capacitor) — not by any map provider choice.
- **Mapbox ToS guardrail** (only relevant if Mapbox is chosen): if Mapbox Directions results are rendered on the existing Google Maps canvas, that's permitted with attribution — but Mapbox's Map Matching API is restricted to use on Mapbox maps only. Keep snap-to-route client-side (`turf.js` `nearestPointOnLine`, as already planned in §2) rather than "upgrading" to Mapbox Map Matching later while still rendering on Google; add Mapbox attribution text if its route data is drawn on the map.
