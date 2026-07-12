# Driver Trip UX Redesign Plan — Request → Pickup → Drop-off

Scope: the driver app's trip lifecycle UX (`apps/driver`), from incoming trip request to
trip completion. Planning document only — no code here. Written against the current
implementation of `TripRequestCard.tsx`, `NavigateToPickup.tsx`, `TripInProgress.tsx`,
`DriverMapView.tsx`, and the existing nav hooks (`useTurnByTurn`, `useVoiceGuidance`,
`useDriverLocation`, `useWakeLock`, `useNavPrefsStore`) and map primitives
(`RoutePolyline`, `TrafficColoredRoute`, `SelfCarMarker`, `LocationPin`, `RecenterMap`,
`ManeuverBanner`).

Guiding constraint (reuse ladder): every change below reuses an existing hook/component
where one exists. No new map primitives are invented; the only genuinely new pieces are
one map-mode convention (a props preset, not a component), a pickup-preview layer inside
the request flow, and an arrival-detection micro-state.

---

## 0. The One-Sentence Diagnosis

The pieces of a Google-Maps-grade navigation experience already exist in this codebase
(turn-by-turn, traffic route, voice, camera follow with heading/pitch/zoom-by-maneuver);
what's missing is (a) spatial context *before* accept, (b) deliberate *transitions*
between states instead of hard screen swaps, and (c) one consistent map-mode contract so
the map doesn't visually change identity between screens.

---

## 1. Map Mode System (fixes the style inconsistency — do this first)

This is the foundation everything else sits on. Define exactly **two map modes** and one
transition rule. No third mode — Uber's driver app itself only distinguishes "overview"
and "first-person navigation" with a single-tap toggle between them.

### Mode A — OVERVIEW (flat)
- Tilt `0`, heading `0` (north-up), zoom under manual/default control
  (`distanceToManeuver` **not** passed to `RecenterMap`).
- Used by: Home/GoOnline idle map, the trip-request pickup preview (see §2), the
  post-accept route overview beat (see §3), end-of-trip summary map.
- Purpose: "where are things" — spatial comprehension, fit-bounds framing.

### Mode B — NAVIGATION (tilted, heading-up)
- Tilt `45` (change from the current `50` — 45° is the Google Navigation SDK's own
  `followMyLocation` tilt and reads slightly less extreme on low-end Android WebViews),
  heading = driver bearing (via `RecenterMap`'s existing eased `animateHeadingTo`),
  zoom driven by `distanceToManeuver` (16/17/18 ladder already in `RecenterMap`),
  `bottomPadding` set so the car marker sits in the lower third above the bottom sheet.
- Used by: NavigateToPickup (after the accept transition) and TripInProgress. Only these.
- Purpose: "what do I do next" — first-person route following.

### One map style, everywhere
- **Every** `DriverMapView` instance passes the same Cloud `mapId`
  (`VITE_GOOGLE_MAPS_DARK_MAP_ID`, or better: rename the env var to
  `VITE_GOOGLE_MAPS_MAP_ID` since it's now *the* style, not a nav-only dark variant).
  Make `mapId` default to that env value inside `DriverMapView` itself so callers can't
  forget it — this single change kills the "light map on Home, dark map in nav" jump.
- With one Cloud style in place, re-evaluate the CSS filter
  (`saturate(0.6) brightness(1.04) contrast(0.96)`): the desaturation should be baked
  into the Cloud style so we're not filtering dark tiles that were already styled dark.
  Plan: keep the filter only if the Cloud style can't be edited; otherwise delete it.
  (CSS filters over map tiles also cost paint time on low-end devices.)
- Night mode (auto style swap by time of day, Uber-style): **phase 2, only if drivers
  ask.** One consistent style is the fix; two time-switched styles is gold-plating.

### The mode transition rule
Overview → Navigation (and back) is always **one continuous camera animation, never a
cut**: pitch 0→45, heading 0→bearing, zoom → maneuver zoom, all together over ~600ms
ease-in-out. `RecenterMap` already eases heading (350ms easeOutCubic) but **snaps** tilt
(`map.setTilt(pitch)` fires immediately when the prop changes) and snaps zoom. Extend
`RecenterMap` to animate tilt and zoom changes with the same rAF/easing machinery it
already has for heading — that's the entire implementation surface of the mode system.
No new component; a "mode" is just a documented preset of `RecenterMap` +
`DriverMapView` props:

| Prop | OVERVIEW | NAVIGATION |
|---|---|---|
| `pitch` | 0 | 45 |
| `heading` | undefined (north-up) | driver bearing |
| `distanceToManeuver` | omitted | from `useTurnByTurn` |
| `bottomPadding` | per-screen sheet height | per-screen sheet height |
| `mapId` | default (env) | default (env) — same |

Codify this table as a short comment block in `DriverMapView.tsx` so future screens
don't invent a third mode.

---

## 2. Trip Request Popup — map-visible, spatial, decisive

### What's wrong today
`TripRequestCard.tsx` is a flat card over a dimmed backdrop. The driver sees fare,
distance, and route *text*, but has zero spatial sense of where the pickup is relative
to them — the single highest-value input to an accept/decline decision. The timer bar
and beep/vibrate are already good; keep them.

### Industry pattern (research appendix, §A)
Uber consolidates trip info in a bottom sheet and shows **only the map elements relevant
to the proposed pickup** behind it — a deliberately decluttered dispatch map. The whole
card is the accept target ("tap anywhere on the black bar"), the timer is a draining
ring/bar, and decline is a small, separate, low-emphasis affordance. Information is
sized for the "3-foot-1-second rule": glanceable numbers (fare, ETA to pickup, trip
length), not paragraphs.

### Redesign
**Layout — card becomes a bottom sheet over a live map preview:**
- Render the request over the map the driver is already on (GoOnline screen), instead
  of a full-screen dimmed backdrop. Structure: map (OVERVIEW mode) + darkened gradient
  scrim on the top half + `TripRequestCard` docked to the bottom ~55% of the screen.
- On the map behind: `SelfCarMarker` at driver position, `LocationPin` at pickup, and a
  driver→pickup `RoutePolyline`. Fit-bounds both points with padding for the sheet.
  - Route source: fire the same `driverRideApi.getRoute` used by `useTurnByTurn`
    (no steps, no traffic — cheap call) when the request arrives. If it hasn't resolved
    within ~1.5s or fails, draw a simple geodesic line between the two points instead —
    **never delay showing the request on a network fetch.** The card and its timer
    appear instantly; the polyline pops in when ready (200ms fade-in).
  - Show drop location too? Yes, as a second small pin with the route extended
    pickup→drop **only if** the estimate payload already carries drop coords and a
    polyline; if it would require a second route fetch, skip it — pickup context is the
    decision-driver, and the fare/distance text already conveys trip size.
- The backdrop dim goes away; the scrim + sheet give focus without hiding the map.

**Information hierarchy (top → bottom inside the sheet):**
1. **ETA/distance to pickup** — biggest number after fare ("4 min · 1.2 km away").
   This is currently missing prominence and is the #1 accept factor for drivers.
2. **Fare** — large, as today.
3. Trip distance + rough duration, pickup/drop addresses (two-line route display,
   as today), ride-type badges (round_trip/rental — keep, these matter for intercity).
4. Rider rating (already surfaced per commit 27074cb) — small, near the addresses.

**Timer redesign:**
- Replace the draining top bar with a **countdown ring around the Accept button** —
  the timer and the action become one visual object (the eye is already on the button).
  Ring drains clockwise; under 5s it turns red and the button pulses subtly
  (scale 1.0→1.02, 600ms alternate) — carry over the existing red-under-5s logic.
- Keep the beep + vibrate on mount exactly as-is. Add one soft tick/haptic at the 5s
  mark (single `navigator.vibrate(50)`), nothing more — no per-second ticking.

**Accept interaction:**
- Accept = the large button (with ring). Full-card-tap-to-accept (Uber style) is
  tempting but risky with a decline button present — **skip it** (mis-taps on a moving
  phone cost more than the reach saves). Decline stays a text-weight button below/beside,
  visually quiet.
- **Accept animation (the moment of commitment):**
  1. On tap: ring completes to full instantly (0→100% sweep, 250ms ease-out) and the
     button morphs to the "Accepting…" state (existing spring-tap + label swap — keep).
  2. On API success: a single confirmation beat — check-mark swap in the button +
     one short vibrate (`vibrate(80)`) — then the sheet **does not disappear**; it
     collapses (see §3 transition). Total time budget from tap to nav screen: < 1s of
     perceived animation on top of the API round-trip; never block on animation if the
     API is slow — animate while the request is in flight.
  3. On API failure (ride taken by another driver): sheet shakes horizontally once
     (3-cycle, 300ms) + "Ride no longer available" toast, then dismisses.

**What stays:** countdown auto-dismiss behavior, decline flow, ride-type badges,
dark navy `#0F172A` sheet surface (it matches the map style now).

**Out of scope / phase 2:** request stacking (multiple simultaneous requests),
accept-rate stats on the card, surge/incentive chips.

---

## 3. Accept → Navigate-to-Pickup Transition

### What's wrong today
Accept success does a hard route change to `NavigateToPickup` — new screen, new map
instance, camera state starts from scratch, and the map visually "reboots."

### Redesign — a three-beat continuous transition
The goal is Uber's "the map never blinks" feel. Since the request now renders over a
live map (§2), the transition can be continuous:

- **Beat 1 — collapse (200ms):** on accept success, the request sheet slides down and
  cross-fades into the NavigateToPickup rider sheet (avatar/name/rating/call/Arrived
  CTA). If the router remount makes true sheet-morphing impractical, an acceptable
  cheat: both sheets share height/corner-radius/surface tokens so a 150ms cross-fade
  reads as a morph. Do the cheat first (YAGNI); real shared-element morphing is phase 2.
- **Beat 2 — route overview beat (~1.2s hold):** map stays in OVERVIEW, fit-bounds
  driver→pickup with the full route polyline now drawn from `useTurnByTurn` (which
  `NavigateToPickup` already runs). This is the "here's your job" glance — Uber and
  Google Maps both show a route overview before entering follow mode.
- **Beat 3 — dive into NAVIGATION (600ms):** the single continuous camera animation
  from §1 (pitch 0→45, rotate to bearing, zoom to maneuver level). Voice guidance
  (`useVoiceGuidance`) speaks its first instruction at the *start* of this beat so
  audio covers the visual transition. `ManeuverBanner` slides in from the top
  (translateY, 300ms ease-out) as the dive completes.

Implementation note: beats 2–3 live entirely inside `NavigateToPickup` — mount in
OVERVIEW props, then after route load + a short delay, switch the `RecenterMap` props
to the NAVIGATION preset and let the (newly animated) tilt/zoom/heading interpolation
do the work. No new state machine; one `useState<'overview' | 'nav'>` per nav screen.

### Navigate-to-Pickup screen itself (mostly keep)
- **Keep:** `ManeuverBanner` + `useTurnByTurn` + `useVoiceGuidance`, `RoutePolyline` +
  `TrafficColoredRoute`, the reconnecting/degraded-tier states, rider bottom sheet with
  call button, cancel flow with reason codes, `useWakeLock`.
- **Route styling — differentiate pickup leg from trip leg** (Uber does this
  deliberately so drivers always know which leg they're on): pickup leg renders the
  polyline in a distinct secondary treatment — e.g. the app's accent color at reduced
  weight, or dashed casing — while the trip leg (§4) is the full-weight "classic blue
  line." Exact tokens to be picked at implementation; the *rule* is: pickup leg ≠ trip
  leg, visibly, at a glance.
- **Camera:** NAVIGATION preset per §1. Add an **overview toggle button** (small map
  icon, above the sheet) that flips to OVERVIEW fit-bounds of the remaining route and
  back — the Uber "single tap between overview and first-person" convention. Any manual
  pan/zoom also drops follow mode; a "Re-center" chip appears (Google Maps convention)
  and tapping it re-enters NAVIGATION via the standard 600ms transition. If
  `RecenterMap` doesn't currently detect user gestures, that detection (a `dragstart`
  listener that pauses following) is in scope — it's the other half of the toggle.
- **Arrival detection (new micro-state):** when `useDriverLocation` position is within
  ~75m of the pickup point:
  - Bottom sheet's "Arrived at Pickup" CTA elevates from secondary to primary emphasis
    (color fill + one gentle pulse) — driver still confirms manually; **no auto-arrive**
    (GPS drift near buildings makes auto-arrival wrong too often; Lyft/Uber also keep
    the manual "I'm here" tap).
  - Voice speaks "You have arrived at the pickup point."
  - Camera relaxes: tilt eases 45→0 and zoom fixes at ~17 over the standard transition —
    turn-by-turn is over; the driver now needs a flat local view to spot the rider.
  - `ManeuverBanner` swaps to a static "Pick up {rider name}" banner.
- After "Arrived": the existing OTP flow proceeds unchanged (`OtpVerifyPanel`).

**Out of scope / phase 2:** lane guidance, speed-limit display, ETA sharing with rider,
auto-arrival geofence events to the backend.

---

## 4. Trip-in-Progress — "follow the blue line"

### What's wrong today
`TripInProgress` already has the right skeleton (same map shell, driver→drop route,
stops checklist, elapsed timer, complete-trip OTP sheet). What it lacks is the mode
discipline and the pickup→trip transition moment.

### Redesign
- **Post-OTP transition:** OTP verified → do the reverse-then-forward camera move:
  ease to OVERVIEW fit-bounds of the *full trip route* (driver→[stops]→drop, ~1.2s
  hold, "here's the journey" beat — especially meaningful for intercity trips where the
  drop is 60km away), then dive into NAVIGATION per the standard transition. Voice
  announces "Trip started. Head to {first stop | destination}."
- **The blue line:** trip leg uses the full-weight primary route treatment —
  `RoutePolyline` under `TrafficColoredRoute` exactly as today, but with the
  primary-leg styling from §3 so pickup vs. trip legs are never confusable. The
  polyline consumed behind the driver should visually recede: cheapest acceptable
  version is none at all (Google's own consumed-path graying is phase 2 — it requires
  splitting the polyline at the snapped index every fix; `nearestPointOnPolyline`
  already returns what's needed, but don't build it until someone misses it).
- **Camera:** NAVIGATION preset, same overview toggle + re-center chip as §3. Same
  arrival relaxation (tilt→0) when within ~150m of the drop (larger radius than pickup;
  highways near drops make 75m too tight), with the "Complete Trip" CTA elevating to
  primary emphasis and voice announcing arrival.
- **Stops carried forward:** the stop itinerary checklist stays. Two integrations:
  - `useTurnByTurn`'s destination is already the *next* stop; on "reached"/"skip" the
    destination changes and the hook refetches — when that happens, run a **mini
    overview beat** (fit-bounds to next leg, ~0.8s) before diving back to NAVIGATION,
    so the driver sees each new leg before following it. Same transition primitive,
    shorter hold.
  - Within arrival radius of the *current stop*, elevate that stop's "Reached" button
    exactly like the drop CTA. One rule, three uses (pickup / stop / drop).
- **Keep:** elapsed-time counter, complete-trip OTP bottom sheet, `/ride/end`
  navigation, degraded-tier surfacing, `useWakeLock`.

**Out of scope / phase 2:** consumed-route graying (above), rider chat, share-trip,
speed alerts UI (backend `speed_alert_log` exists but driver-side display is a separate
feature decision).

---

## 5. Motion Spec (single reference table)

Principles applied: animate what changes meaning (camera mode, commitment moments),
snap what's merely data (numbers, list rows); ease-out for things entering/responding
to the user, ease-in-out for camera moves the user is inside of; nothing over 700ms
except deliberate "beat" holds.

| Moment | Motion | Duration / easing |
|---|---|---|
| Request arrives | Sheet slides up from bottom + map fit-bounds pans behind it; beep + vibrate (existing) | 300ms ease-out (sheet); map pan native `panTo` |
| Pickup polyline resolves | Fade in | 200ms linear |
| Timer | Ring drains continuously; red + button pulse < 5s | pulse 600ms alternate |
| Accept tap | Ring sweep to full + button morph to "Accepting…" (existing spring) | 250ms ease-out |
| Accept success | Check swap + vibrate(80) → sheet cross-fade to rider sheet | 150–200ms |
| Accept failure | Horizontal shake + toast, dismiss | 300ms, 3 cycles |
| Route overview beat | Hold on fit-bounds | ~1.2s (0.8s for mid-trip stop legs) |
| Overview → Navigation dive | Pitch 0→45 + heading 0→bearing + zoom, one interpolation in `RecenterMap` | 600ms ease-in-out |
| Navigation → Overview (toggle / arrival) | Reverse of above | 600ms ease-in-out |
| Heading while driving | Existing eased rotation — keep | 350ms easeOutCubic |
| ManeuverBanner enter/swap | Slide from top / crossfade text | 300ms ease-out / 150ms |
| Re-center chip appear | Fade + slight rise | 200ms ease-out |
| CTA elevation on arrival | Color fill + single pulse | 400ms ease-out, one pulse |
| Numbers (fare, ETA, elapsed, distance-to-maneuver) | **Snap.** No count-up animations while driving | — |

---

## 6. Implementation Order (each step ships independently)

1. **Map style unification** — default `mapId` inside `DriverMapView`, remove
   per-screen overrides, decide CSS-filter fate. Smallest change, biggest visual
   consistency win.
2. **`RecenterMap` transition support** — animate tilt + zoom changes (reuse its rAF
   pattern); add gesture-pause + re-center chip + overview toggle. This *is* the mode
   system.
3. **Trip request over live map** — restructure request rendering (map + scrim +
   sheet), pickup pin + route preview, info hierarchy, countdown ring + accept/failure
   animations.
4. **Nav screen transitions** — overview beat → dive on `NavigateToPickup` mount and
   post-OTP in `TripInProgress`; mini-beat on stop change.
5. **Arrival micro-states** — proximity CTA elevation + camera relaxation + voice line,
   shared rule across pickup/stops/drop.
6. **Route leg styling** — pickup-leg vs trip-leg polyline treatments.

Explicitly deferred (phase 2, only on demand): night-mode style switching, true
shared-element sheet morph, consumed-route graying, full-card tap-to-accept, request
stacking, auto-arrival, lane guidance/speed limits.

---

## Appendix A — Industry Research Notes

**Uber Driver app**
- Incoming request: trip details surface in a bottom bar/sheet over the map; the driver
  has ~15 seconds and taps the bar itself to accept — timer and accept target are
  unified, decline is secondary. ([Uber Help — Getting a trip request](https://help.uber.com/driving-and-delivering/article/getting-a-trip-request?nodeId=e7228ac8-7c7f-4ad6-b120-086d39f2c94c))
- Dispatch map is decluttered to "only map elements relevant to the proposed pick-up";
  trip info and actions consolidate into the bottom sheet. Design is governed by the
  **3-foot-1-second rule**: readable at arm's length in a one-second glance; minimal
  required interaction while driving. ([Uber Blog — Building a Scalable and Reliable Map Interface for Drivers](https://eng.uber.com/building-a-scalable-and-reliable-map-interface-for-drivers), [Medium/Uber Design — Uber Navigation](https://medium.com/uber-design/uber-navigation-f662e7611f3))
- Navigation: custom cartography, maneuver iconography, side-of-street indicators,
  **route line previews** and **camera animations** that differentiate pickup legs from
  dropoff legs and answer "what's next?" between trip phases; a **single tap toggles
  between overview and first-person navigation**; night mode uses a subdued palette
  tuned so guidance UI, map UI, and map style stay harmonious. ([Medium/Uber Design — Uber Navigation](https://medium.com/uber-design/uber-navigation-f662e7611f3), [D/UX — Uber Navigation](https://www.dreamerux.com/articles/maj76hfzs79642e5afslagnty5727j))
- Drivers most want trip distance, time, and rider name persistently visible during the
  trip (research-informed hierarchy). ([Medium — Uber's interactive map usage](https://medium.com/design-bootcamp/interactive-map-usage-in-ubers-ui-user-emotion-flow-84648ab09940))

**Lyft Driver app**
- Request notification shows passenger name, **pickup ETA**, and ride type; tap
  anywhere to accept. Arrival is a manual "I'm here" tap; a rider-wait countdown starts
  after notifying the passenger. ([Lyft Help — How to navigate a ride](https://help.lyft.com/hc/en-us/all/articles/115012926147), [Ridester — Lyft Driver App walkthrough](https://www.ridester.com/topics/lyft-driver-app/))

**Ola Partner**
- Same structural flow (request notification → navigate to pickup → OTP at pickup →
  navigate to drop); public driver feedback centers on wanting fare/distance clarity
  *before* accepting — reinforcing ETA-to-pickup + fare as the top of the card
  hierarchy. ([Ola Driver — Google Play](https://play.google.com/store/apps/details?id=com.olacabs.oladriver&hl=en_US), [Product Locus — OLA App Design, Product vs Drivers](https://medium.com/productlocus/product-review-ola-app-design-product-vs-drivers-part-2-b50dd9bcab15))

**Google (navigation camera conventions)**
- The Navigation SDK's default follow mode is **45° tilt, camera behind the position
  marker, heading-up**; alternates are top-down north-up and top-down heading-up. A
  **Re-center button** appears whenever the camera leaves follow mode and tapping it
  restores `followMyLocation`. These are the conventions §1's NAVIGATION mode and the
  re-center chip copy. ([Google — Navigation SDK camera](https://developers.google.com/maps/documentation/navigation/android-sdk/camera))

**Bolt / Rapido** — no primary design documentation found worth citing; their flows
match the Uber/Ola structure above and add nothing this plan would change.
