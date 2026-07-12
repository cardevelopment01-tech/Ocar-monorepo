# Ocar Navigation — Phase 5+ Plan: Verify First, Then Close the Real Gaps

**Date:** 2026-07-12
**Status:** Draft — follows the 2026-07-09/10/11 docs. Phases 1–4 shipped. Client still not satisfied.

---

## 1. Framing: why two "done" rounds didn't land

Read the status notes in both prior docs again. Both say the same thing, verbatim in the first one:

> "Genuinely unverified — none of the above has been confirmed on a real device or real drive."

Every feature the client asked for is code-complete: traffic-tinted polyline, heading-up camera, voice guidance, reroute, wake lock. `tsc` passes, lint passes, and **not one of these has ever run in a moving car**. That is the most plausible explanation for persistent dissatisfaction. The client isn't reviewing a feature list — they're holding a phone in a car on NH16 and judging *feel*. Heading jitter, a voice prompt that fires late, a screen that sleeps at minute 41, a reroute that thrashes near the Trisulia flyover — all of these look fine in code review and feel broken on the road. Two rounds of unverified polish reads to a client as two rounds of "still not fixed."

So this plan inverts the usual order:

- **Phase 5 is a structured field-verification pass.** Nothing ships to the client, and no new feature is called client-ready, until it passes.
- Phases 6–11 close the genuinely-missing table-stakes features found in today's audit (dead "Message driver" button, no trip-share link, no pre-accept preview, no arrival geofence, no driver-side fare visibility, no reroute rate limit). These are small-to-medium, all reuse existing patterns, none require new infra.
- The "don't build" list from the prior docs stands unchanged. No relitigating.

Adopted: field QA as a phase with pass/fail criteria; quick-reply messaging (not full chat); tokenized trip-share; pre-accept preview; suggest-mode arrival geofence; fare-drift parity; a dedicated route-endpoint limiter.
Declined (still): everything in §3.

---

## 2. Phases

### Phase 5 — Real-device, real-drive verification pass (BLOCKING)

**Industry standard it matches:** Uber runs continuous real-world pickup-accuracy programs precisely because GPS/sensor behavior can't be validated at a desk ([Uber Beacon / location-accuracy engineering](https://eng.uber.com/beacon-improving-pickups-with-better-location-accuracy/)). For a web driver app there is no device farm shortcut — Android Chrome geolocation, SpeechSynthesis, and Wake Lock behavior are only observable on hardware, in motion.

**Effort:** Medium (2 people, ~2–3 days of drives + 1 day of fixes). Zero new code except a debug overlay.

**Prep (half a day):**
- Add a dev-only debug overlay to the driver nav screen (behind a `?debug=1` query flag): current GPS accuracy, derived heading, distance-to-route, reroute counter, last-TTS timestamp, wake-lock state. Log to an in-memory ring buffer downloadable as JSON. Lives in `apps/driver/src/pages/ActiveRide/` next to `NavigateToPickup.tsx`; reads state that `useTurnByTurn.ts` and `useRideStore.ts` already hold. Do not build a telemetry pipeline — a download button is enough.
- Two phones minimum: one mid-range Android (₹10–15k class, what drivers actually own) on Chrome, one iPhone on Safari. Screen-record everything.

**Drive matrix (all three corridors, both directions):**

| Corridor | Route | Specific hunt targets |
|---|---|---|
| Bhubaneswar ↔ Cuttack | NH16 | Trisulia flyover + toll plaza — parallel-road GPS snap, reroute thrash near ramps (the documented risk); high-speed heading stability at 80+ km/h |
| Bhubaneswar ↔ Puri | NH316 | Longest leg (~60 km, ~75 min) — the 40-minute Android Chrome TTS queue-wedge window; wake lock across a full hour; battery/thermal throttling of GPS fix rate |
| Cuttack ↔ Puri | via Phulnakhara | Mixed urban/rural — GPS dropout in low-signal stretches, off-route threshold behavior on narrow service roads |

Plus one deliberate abuse drive: intentionally leave the route 5+ times near a flyover, lock/unlock the screen mid-nav, take a phone call mid-nav, background the tab and return.

**Pass/fail criteria (each is binary, recorded per drive):**

| Check | Pass |
|---|---|
| Heading-up camera | No visible spin/jitter at city speeds; rotation settles < 1s after turns |
| Off-route detection (40m / 3 fixes / 12s cooldown) | Zero false reroutes on straight NH16 driving; genuine departure detected < 15s |
| Reroute at flyover/toll | ≤ 2 reroutes per flyover pass; never a reroute loop |
| Voice guidance | Every maneuver announced at ~300m and ~100m; still speaking at minute 50 of the Puri leg (queue-wedge check); works after a phone call |
| Wake Lock | Screen never sleeps during active nav; survives a manual lock/unlock cycle |
| Maneuver banner | Instruction/distance matches the road ≥ 95% of maneuvers |
| Traffic tint | Polyline colors visibly change on a known-congested Cuttack stretch at peak hour |
| ETA sanity | Spot-check 3 legs against `ride_eta_snapshots` — predicted vs actual within ±25% (the instrumentation is live; use it) |
| Battery | < 25% drain per hour of nav on the Android device |

**Exit condition:** every row passes on the Android device, or the failure has a filed fix that is itself re-verified on a drive. Then — and only then — schedule the client demo, **in a car, on NH16, on the driver's own class of phone**. Do not demo from a desk again.

**Verification:** the phase *is* the verification. Deliverable: filled-in matrix + screen recordings + downloaded debug logs, attached to the repo docs.

---

### Phase 6 — "Message driver": quick-reply canned messages (not full chat)

**Recommendation:** canned quick-replies, both directions. Not full free-text chat, not deleting the button.

**Reasoning:** Uber's own data-driven answer to in-trip messaging is One-Click Chat — four tappable canned replies ("Yes, I'm on my way", "Sorry, still in traffic", "I'm at your pick-up address", "Call me please") because drivers cannot type while driving ([Uber One-Click Chat](https://www.uber.com/us/en/blog/one-click-chat/)); Ola ships driver–rider in-app chat as a standard feature ([Ola UK](https://www.facebook.com/OlaDriversUK/posts/665063354277374/)). Full free-text chat means moderation, retention policy, and abuse surface — for a few hundred drivers on 3 corridors, canned messages cover ~90% of the actual need ("where are you?", "coming in 2 min", "I'm at the gate") with zero moderation burden. Deleting the button is the truly lazy option, but this is the rider's only non-phone-call channel and the client has table-stakes parity on the brain; build the small version.

**Build:**
- New `ride_messages` table (finally gives `013_messaging.sql` a reason to exist): `ride_id`, `sender_type`, `message_key`, `created_at`. Fixed message catalog lives in a shared constants file — rider set (~5) and driver set (~5), English + Odia display strings (no TTS needed, this is text — Odia works here even though voice can't).
- `POST /api/v1/rides/:id/messages` (validate `message_key` against the catalog, participants only) + `GET`. Emit over the existing `ride:{rideId}` room via `socketEvents` in `api/src/websocket/socket.server.ts`.
- Rider UI: wire the dead button in `apps/user/app/(main)/ride/[id]/page.tsx` to a bottom sheet of tappable chips + message log. Driver UI: same sheet on the active-ride screens; incoming message shows as a toast via the existing `useNotificationsStore.ts` toast path and is read aloud-adjacent (large text, auto-dismiss) — no typing surface at all for the driver while in nav.

**Verification:** send each canned message both directions on the Phase 5 drive; confirm socket delivery latency < 2s and driver toast is glanceable at speed.
**Effort:** Medium.

---

### Phase 7 — "Share my trip" live-location link

**Industry standard:** Uber's Share Trip Status sends trusted contacts an SMS/link showing live map location, driver first name, vehicle, and ETA — viewable **without the app** ([Uber Share Status](https://www.uber.com/us/en/ride/how-it-works/share-status/), [Uber Help FAQ](https://help.uber.com/en/riders/article/sharing-your-trip-status-faq?nodeId=e1f8ed2b-c0e5-4456-9c73-552cf11c5581)). Ola and Rapido ship the same. This is the single most visible safety-perception feature Ocar is missing, and the safety module already exists to hang it on.

**Build:**
- `ride_share_tokens` table: `ride_id`, `token` (random 128-bit, hashed at rest per the refresh-token pattern), `expires_at` (ride end + 30 min), `revoked_at`.
- `POST /api/v1/safety/rides/:id/share` (rider-auth) → returns `https://<user-app>/t/{token}`. Rider taps native `navigator.share()` — WhatsApp/SMS for free, no SMS-send cost, no contact-list feature. Skip "trusted contacts" storage entirely; the copy-link flow is the one people actually use.
- Public unauthenticated Next.js page `apps/user/app/t/[token]/page.tsx`: driver first name, vehicle reg, pickup/destination, live driver position + ETA. Reuse the existing ride-tracking map component from `ride/[id]/page.tsx`; feed it via a **read-only public socket namespace or short-poll endpoint that resolves token → whitelisted fields only** — never join the authenticated `ride:{rideId}` room from an anonymous session.
- Rider entry point: a "Share trip" row next to the SOS button on the tracking screen, reusing `SOSButton.tsx`'s confirm-sheet pattern (`apps/user/components/ui/SOSButton.tsx`).
- Token invalidated on ride completion + expiry sweep.

**Verification:** open the link on a phone with no Ocar session during a Phase 5 drive; confirm live position updates and that the link 404s after ride end.
**Effort:** Medium.

---

### Phase 8 — Pre-accept route/fare preview on the driver request card

**Industry standard:** Uber's trip request screen shows upfront payout, surge separately, destination, and estimated trip time/mileage before accept ([Uber upfront fares](https://help.uber.com/en/driving-and-delivering/article/upfront-fares?nodeId=bc83ed7e-6725-41de-afcb-72d263e5589f), [Ridesharing Driver analysis](https://www.ridesharingdriver.com/uber-driver-upfront-fares/)); Uber explicitly markets showing destination pre-accept ([Uber blog](https://www.uber.com/gh/en/blog/see-your-destination-before-accepting-a-ride/)). Ocar drivers currently accept blind on everything except fare + pickup address.

**Build:**
- Broadcast payload already flows through `api/src/jobs/processors/broadcast.processor.ts` → extend it with `distance_to_pickup_km`, `eta_to_pickup_min`, and the ride's `route_polyline` (the fare snapshot's route geometry already exists server-side from the estimate; do **not** issue a fresh Directions call per broadcast recipient — one route fetch per ride at booking, reuse for every driver offered it; distance-to-pickup is one PostGIS `ST_Distance` per candidate, already computed for dispatch ranking).
- `apps/driver/src/components/ui/TripRequestCard.tsx`: add a small static map (a non-interactive `@vis.gl/react-google-maps` instance with the decoded polyline + pickup/destination markers, gestures disabled) plus "X km / ~Y min to pickup" and trip distance. Keep accept/decline buttons exactly where they are — the card must not get taller than the fold.

**Verification:** trigger 5 broadcasts in the simulator (the drive-simulator script from commit `5c8fd0d`); confirm card renders route + numbers in < 1s and accept flow is unchanged.
**Effort:** Small–Medium.

---

### Phase 9 — Arrival geofence: auto-*suggest*, not auto-trigger

**Industry standard:** ride-hail apps geofence the pickup pin and flip/prompt the "arrived" state on proximity; production systems use tight radii (down to ~150–500m for facility-scale fences, tighter for pickup pins) with dwell logic to avoid drive-past false positives ([geofencing in taxi apps](https://www.appicial.com/blog/geofencing-in-taxi-apps-what-it-is-and-how-to-use-it.html), [PubNub rideshare geofencing](https://www.pubnub.com/blog/how-to-build-a-rideshare-dispatch-system-with-google-maps-geofencing/)). Uber's engineering work on pickup accuracy exists precisely because raw GPS at the curb is noisy ([Uber Beacon](https://eng.uber.com/beacon-improving-pickups-with-better-location-accuracy/)) — which is why we **suggest**, and the driver confirms with one tap. No silent state transitions on GPS alone.

**Build:**
- Client-side only, in `useTurnByTurn.ts`'s existing GPS-fix loop (it already has distance math and the N-consecutive-fixes gating pattern from off-route detection — reuse it verbatim): within **75m** of the pickup pin for **3 consecutive fixes** AND speed < 8 km/h → surface a full-width "You've arrived — confirm?" sheet on `NavigateToPickup.tsx` that fires the *existing* arrived mutation in `apps/driver/src/lib/ride-api.ts`. Manual button stays as-is.
- 75m/3-fix/speed values as constants next to the off-route constants — Phase 5 drive data tunes them (urban Cuttack lanes may need 100m).
- No backend change. No server-side geofence table.

**Verification:** on a Phase 5 drive, prompt appears within 10s of stopping at the pin, and never fires when driving past the pickup at speed.
**Effort:** Small.

---

### Phase 10 — Driver-side fare/surge visibility parity

**Industry standard:** Uber shows drivers surge as a separately-listed amount and discloses when an upfront fare changes materially mid-flow ([Uber upfront fares](https://help.uber.com/en/driving-and-delivering/article/upfront-fares?nodeId=bc83ed7e-6725-41de-afcb-72d263e5589f), [when fares change](https://www.uber.com/gb/en/blog/understanding-your-upfront-fare-when-it-can-change-and-what-extra-fees-may-apply/)). Ocar's rider gets a `fareDrift` banner; the driver — the person whose earnings drift — gets nothing.

**Build:**
- The producer already exists: `api/src/jobs/processors/dispatch-scheduled.processor.ts` computes drift past `FARE_DRIFT_DISCLOSURE_THRESHOLD` (10%) and emits `fareDrift: { previousFare, currentFare }`. Extend that same emit to the `driver:{driverId}` room (one line in the processor + the `socketEvents` helper) — do not build a second drift computation.
- `apps/driver/src/store/useRideStore.ts`: hold `fareDrift`; render the same style of dismissible banner the rider app uses on the active-ride screens ("Fare updated: ₹X → ₹Y"). Also surface current fare + surge multiplier statically on the active-ride screen (data already in the ride payload from `rides.repository.ts`).

**Verification:** force a >10% drift via the scheduled-dispatch path in dev; banner appears on both apps within 2s and shows identical numbers.
**Effort:** Small.

---

### Phase 11 — Backend hardening: dedicated rate limit on `/api/v1/geo/route`

**Why:** the 12s reroute cooldown is client-side only. A buggy build or hostile client can hammer the route endpoint — which costs real money per Google Routes call — with nothing but the shared `generalLimiter` in the way. The flyover-thrash risk is already documented; this is its server-side backstop.

**Build:**
- Add `routeLimiter` to `api/src/middleware/rateLimit.middleware.ts` following the existing limiter pattern: keyed on authenticated principal (driver/user id), not IP — **10 requests/min, burst 3** (a legitimate worst-case flyover pass under the 12s cooldown is ≤ 5/min; 10 gives headroom). 429 with a safe error code, no message leakage.
- Mount on the route endpoint only, in the geo router. One log line on limit-hit with driver id, so repeated 429s surface a client bug instead of hiding it.

**Verification:** small script (or supertest case) firing 15 route requests in 60s as one driver — 11–15 get 429; a second driver is unaffected. Confirm during the Phase 5 abuse drive that a real driver never hits it.
**Effort:** Small.

**Sequencing note:** Phase 5 is strictly first and gates the client demo. 6–11 can proceed in parallel with Phase 5's drive days, but each lands behind its own drive-verification line item — nothing gets called done at a desk again. Phase 11 can merge immediately (pure hardening, no UX).

---

## 3. Still NOT building (unchanged — prior docs hold)

One line each; the deep research already happened.

- **Self-hosted routing engine (OSRM/Valhalla/GraphHopper)** — 3 corridors, a few hundred drivers; Google Routes cost is trivial, ops burden is not.
- **ML ETA correction model** — the `ride_eta_snapshots` dataset is weeks old; revisit when there are months of per-corridor data and a measured MAPE problem.
- **Full HMM map-matching / Kalman filtering** — the bearing-gated heading fix shipped; escalate only if Phase 5 drives show it's insufficient.
- **Offline map tile caching** — Google Maps JS API doesn't support it; would force a renderer migration for a corridor with adequate coverage. The "Open in Google Maps" fallback covers dead zones.
- **Native/hybrid app rewrite** — nothing in Phases 5–11 requires a capability the web platform lacks; revisit only if Phase 5 proves a web-platform dead end (e.g. background geolocation hard-fails).
- **Odia voice guidance** — no TTS engine exists, vendor gap, not ours. (Odia *text* does ship in Phase 6's canned messages.)
- **Full multi-stop route visualization** — deliberate leg-by-leg design stands (Android multi-waypoint deep links are flaky; matches real driver behavior). Sole open product call, one line: should the driver's ETA readout show per-leg or summed-across-remaining-stops? Pick one, 30-minute change either way.
- **Free-text in-trip chat with moderation** — declined in favor of Phase 6 canned replies; revisit only on measured demand.
- **Trusted-contacts storage / SMS fan-out for trip share** — `navigator.share()` + link covers it at zero SMS cost.
- **Dark map style** — still a 15-minute Google Cloud Console task (create the Map Style, set `VITE_GOOGLE_MAPS_DARK_MAP_ID`), not a code task. Assign it to a human with console access this week; stop carrying it as a "gap."

---

## 4. Why this should finally satisfy the client

Take the complaints on record one at a time:

- **"No colored traffic on the roads"** — closed in Phase 4 (traffic-tinted polyline + TrafficLayer + traffic-aware ETA). Feature-complete; Phase 5 confirms it *visibly works* on a congested Cuttack stretch at peak hour, which is the form the client will judge it in.
- **"Small map" / "icon rather than following"** — closed by heading-up rotation, dynamic zoom, 50° pitch, bearing-derived heading. But these are exactly the features where code-complete ≠ feels-right. If the heading jitters or the camera lags in a real car, the client experiences "still not fixed" no matter what the diff says. Phase 5 is where this complaint actually dies.
- **"Still not like Google Maps"** — partly the two items above, partly a category error we should name plainly in the client conversation: Ocar's nav will not be pixel-identical to the Google Maps app, because that app is a native product with proprietary rendering. What Ocar *can* match is the behavioral checklist — turn-by-turn, voice, traffic, heading-up, reroute — and after Phase 5 every item on it is verified on the client's own roads, on a driver-class phone.

The honest diagnosis: the feature list has been substantially complete since Phase 4. What was never done is proving it in the environment the client evaluates it in. Phase 5 fixes the process failure; Phases 6–10 close the remaining parity gaps a client comparing against Ola/Rapido will notice next (messaging, trip share, pre-accept preview, arrival prompt, fare visibility); Phase 11 hardens the one endpoint the shipped nav work made expensive to abuse. After this, if dissatisfaction persists, it is a requirements conversation — not an engineering gap.

---

## Sources

- Uber Engineering — Beacon / pickup location accuracy: https://eng.uber.com/beacon-improving-pickups-with-better-location-accuracy/
- Uber — Share Trip Status: https://www.uber.com/us/en/ride/how-it-works/share-status/
- Uber Help — Sharing your trip status FAQ: https://help.uber.com/en/riders/article/sharing-your-trip-status-faq?nodeId=e1f8ed2b-c0e5-4456-9c73-552cf11c5581
- Uber — One-Click Chat (canned driver replies): https://www.uber.com/us/en/blog/one-click-chat/
- Ola Drivers UK — driver–rider in-app chat launch: https://www.facebook.com/OlaDriversUK/posts/665063354277374/
- Uber Help — Upfront fares (driver-visible payout/surge/destination pre-accept): https://help.uber.com/en/driving-and-delivering/article/upfront-fares?nodeId=bc83ed7e-6725-41de-afcb-72d263e5589f
- Uber — See your destination before accepting: https://www.uber.com/gh/en/blog/see-your-destination-before-accepting-a-ride/
- Ridesharing Driver — Trip Radar & upfront fares analysis: https://www.ridesharingdriver.com/uber-driver-upfront-fares/
- Uber — Understanding your upfront fare / when it can change: https://www.uber.com/gb/en/blog/understanding-your-upfront-fare-when-it-can-change-and-what-extra-fees-may-apply/
- Appicial — Geofencing in taxi apps: https://www.appicial.com/blog/geofencing-in-taxi-apps-what-it-is-and-how-to-use-it.html
- PubNub — Rideshare dispatch with Google Maps geofencing: https://www.pubnub.com/blog/how-to-build-a-rideshare-dispatch-system-with-google-maps-geofencing/
