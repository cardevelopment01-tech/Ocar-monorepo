# Production-Grade Traffic & Navigation System — Research + Phased Plan

**Date:** 2026-07-11
**Trigger:** Client wants navigation "like Uber." Following the traffic-layer patch (see status
note in `docs/MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md`, 2026-07-11), this doc researches what
Uber/industry actually does end-to-end, then right-sizes it to what Ocar (3 fixed corridors,
Bhubaneswar/Cuttack/Puri, single-vendor Google Maps stack) should actually build.

> **Status note (2026-07-11): Phases 1, 2, and 4 implemented; Phase 3 needs one manual console step.**
> - **Phase 1** (traffic-tinted route polyline): `google.provider.ts` gained a
>   `getTrafficIntervals()` call to the Routes API (`TRAFFIC_ON_POLYLINE`), gated
>   behind a new `withTrafficIntervals` option kept separate from `trafficAware`
>   specifically so server-side ETA reads (Phase 4) don't pay for it. Rendered via
>   new `TrafficColoredRoute.tsx`, mounted on both driver nav screens. Only
>   SLOW/TRAFFIC_JAM segments are tinted; NORMAL is left untinted, matching how
>   Google Maps itself only calls out non-free-flowing stretches. `redis-keys.ts`'s
>   `routeKey()` was updated to fold the new option into the cache key — without
>   that, a request without traffic intervals could have populated the cache first
>   and silently starved a later request that wanted them, for the rest of the 90s
>   TTL. Caught in review, fixed before shipping.
> - **Phase 2** (GPS heading gating): `useDriverLocation.ts` no longer trusts raw
>   `coords.heading` past the first fix — heading is now derived from the bearing
>   between consecutive fixes, gated on >8m movement (mirrors the rider app's
>   existing `useInterpolatedPosition.ts` fix), rejecting the device-compass noise
>   that caused stationary jitter. The same computed heading is now also what gets
>   synced to the backend (previously the raw, noisier value), improving data
>   quality for anything else reading `driver_location_snapshots.heading`.
> - **Phase 3** (dark map style): code-side only — `DriverMapView.tsx` accepts a
>   `mapId` override, wired to `VITE_GOOGLE_MAPS_DARK_MAP_ID` on both nav screens,
>   falling back to the normal map style when unset. **Still needs a manual step**:
>   create the actual dark-styled Map ID in Google Cloud Console (Map Management)
>   and set the env var — this can't be done from code, as originally noted.
> - **Phase 4** (ETA instrumentation): new `ride_eta_snapshots` table (migration
>   045) logs the routing engine's predicted duration at `acceptRide` (to-pickup
>   leg, origin = driver's last known location) and `verifyStartOTP` (to-destination
>   leg, origin = pickup point) — both fire-and-forget, wrapped so a routing
>   failure never blocks the ride transition. Actuals are read from rides' existing
>   `accepted_at`/`driver_arrived_at`/`started_at`/`completed_at` columns, nothing
>   duplicated. New `GET /api/v1/admin/analytics/eta-accuracy` (same RBAC as the
>   existing `/summary` endpoint) reports MAE/MAPE per corridor/leg.
> - Verified: `tsc --noEmit` clean on both `api` and `apps/driver`; `pnpm test`
>   unchanged (82 passed, same 2 pre-existing integration-test failures from no
>   local `TEST_DATABASE_URL`, unrelated to this work); migration 045 applied
>   cleanly against the dev DB.
> - **Not done, deliberately**: no self-hosted routing engine, no crowdsourced
>   traffic pipeline, no ML ETA correction model, no Kalman filtering, no full HMM
>   map-matching — see §4, unchanged from the original research.

## 0. The one assumption this whole doc rests on — read first

**"Like Uber" is not one thing — it's a menu, and most of it doesn't apply here.** Uber's
navigation stack is inseparable from three problems Ocar doesn't have: (1) global coverage
across countries with no single good map vendor, (2) tens of millions of trips/day generating
enough GPS probe density to *build your own* traffic data, and (3) a dedicated ML platform team
whose job is exactly this. Below, every technique is researched honestly, then explicitly marked
**adopt / defer / decline** for Ocar's actual scale. Where I decline something, I say why —
that's the point of this doc, not a gap to feel bad about.

If this framing is wrong — if the client genuinely wants Ocar to build proprietary routing/ML
infra regardless of cost — that's a real scope/budget conversation to have explicitly before
Phase 3+ below, not something to assume silently.

---

## 1. What Uber (and the industry) actually does

### 1.1 Routing engine

Uber doesn't call Google Directions per-request at scale — it runs its own routing graph, forked
from open-source engines, so it can bake in proprietary traffic and cost models. For a team our
size, the realistic building blocks are the same three open-source engines everyone in this space
uses:

| Engine | Model | Traffic support | Fit for Ocar |
|---|---|---|---|
| **OSRM** | Contraction hierarchies, fastest queries | No built-in live traffic feed, but MLD algorithm supports dynamic edge-weight updates without a full graph rebuild — you still have to supply the traffic data yourself | Good if we ever self-host, but "you supply the traffic data" is the whole hard problem |
| **Valhalla** | Dynamic costing, flexible per-request options (JSON costing at query time, no rebuild) | Same story — no built-in feed, costing model needs custom traffic ingestion | Better fit *if* self-hosting, since Ocar's fleet is tiny and query-time flexibility matters more than raw throughput |
| **GraphHopper** | Dijkstra + contraction hierarchies | Same | Aimed at higher-volume continental routing — overkill for 3 cities |

**Key finding that matters most:** none of these three engines ship live traffic out of the box —
Uber, Lyft, and everyone else feeds them their **own** probe-vehicle speed data. Self-hosting a
routing engine and getting *worse* traffic awareness than Google's default output would be a
regression, not an upgrade, unless the traffic-ingestion problem (§1.2) is solved first.

**Decision for Ocar: decline self-hosting for now.** Google's Routes/Directions API already gives
traffic-aware routing (`departure_time=now`, or the newer `TRAFFIC_AWARE_OPTIMAL` preference on
the Routes API) tuned on Android device density — which is *particularly strong in India*, per
the existing audit doc's §2.3 research. Self-hosting would trade a known-good traffic signal for
an infra project, for zero traffic-quality gain, unless Ocar's own fleet is large enough to
generate usable probe density (see §1.2 — it isn't, yet).

### 1.2 Where live traffic data actually comes from

This is the part of "like Uber" that's usually invisible and does the most work. Two sourcing
models exist:

1. **Crowdsourced / floating-car data (what Uber, Google, and Waze do at their scale):** every
   moving vehicle in the fleet is a GPS probe. Aggregate enough trajectories per road segment per
   time bucket, and you get a live speed matrix — no external vendor needed. This *only* works
   above a minimum trip-density threshold per segment; below that, the "traffic" data is noise
   (a handful of stale points averaged into a meaningless number).
2. **Third-party traffic feed (what almost everyone else does, including us today):** buy it —
   Google's `TrafficLayer` / `departure_time=now`, HERE Traffic API, TomTom, etc.

**Ocar's actual probe density:** a few hundred active drivers across 3 corridors is nowhere near
what's needed to self-derive traffic speeds with any reliability — Google's crowdsourced signal,
built from the entire population of Android phones in Odisha, will always be more accurate than
anything Ocar could build from its own fleet at this scale.

**Decision: decline building a proprietary traffic-ingestion pipeline.** This is the single
biggest "looks like Uber" temptation to avoid — it's a multi-quarter data-engineering project
that would produce a *worse* signal than the Google API call already in place. Revisit only if/when
Ocar's own trip volume per corridor is high enough to be probe-dense (a concrete, measurable
trigger, not a vibe) — realistically hundreds of concurrent trips per corridor, which is an
order of magnitude past where Ocar is today.

### 1.3 Map matching (snapping GPS to the road)

Industry standard (used by OSRM, Valhalla, Mapbox, and Uber itself) is a **Hidden Markov Model +
Viterbi** approach (Newson & Krumm's paper is the canonical reference): candidate road segments
near each noisy GPS fix are scored on (a) proximity to the fix and (b) transition plausibility
from the previous fix's most-likely segment, and the most probable *path* through time is decoded
— not just the nearest point at each instant in isolation.

**What Ocar has today:** `apps/driver/src/lib/geo.ts`'s `nearestPointOnPolyline()` — a plain
nearest-point projection onto the known route polyline, no history, no transition probabilities.
This works *only* because the driver is already following a known route (the polyline came from
the routing call) — it's snapping to "the one road we told you to take," not general-purpose
map-matching onto an entire road network. That distinction matters: full HMM map-matching solves
"which of these 6 parallel roads is the vehicle actually on," which isn't Ocar's problem once a
route is chosen. It becomes Ocar's problem only for **off-route detection accuracy** — see §3.1.

**Decision: adopt a lightweight upgrade, decline full HMM.** A real HMM implementation (e.g.
wiring in Valhalla's Meili matching service, or a `turf.js`-based multi-hypothesis tracker) is
justified when snapping onto an *unknown, unconstrained* road network (e.g. general fleet
tracking with no predetermined route). Ocar's driver always has a routing-provided polyline to
snap to, so the ROI of full HMM is low. What *is* worth adding: basic GPS noise rejection before
the existing projection (§3.1).

### 1.4 GPS smoothing (why the car icon "isn't stable")

Kalman filtering — fusing raw GPS with a motion model (last known heading/speed) to reject noisy
fixes and interpolate through gaps (tunnels, urban canyon multipath) — is the standard technique,
and is *exactly* the class of fix the existing heading-jump bug (§1.1 of the audit doc) is a
symptom of. A full Kalman filter is more than the current bug needs; the audit doc's diagnosis
(double-rotation + missing movement-gating) was the *actual* root cause and has already been
fixed. A lightweight exponential-smoothing filter on raw `coords.speed`/`coords.heading` (already
partially present via the rider app's `dist > 8` gate) covers the remaining jitter without a full
Kalman implementation.

**Decision: adopt a lightweight upgrade, decline full Kalman.** Full Kalman filtering is worth it
once we have a concrete failure mode it would fix that gating/smoothing doesn't (e.g. sustained
GPS loss in a specific known dead zone) — not speculatively.

### 1.5 ETA prediction (Uber's DeepETA)

Uber's DeepETA is a **post-processing** model: the routing engine still produces a base ETA
(distance/speed/traffic based), and a neural net (encoder-decoder with self-attention) predicts
only the *residual* — the gap between the routing engine's estimate and what actually happened —
trained on Uber's own historical trip data at global scale. It's the highest-QPS model at Uber
specifically because it doesn't replace the routing engine, it corrects it.

**Why this doesn't transfer to Ocar's current stage:** DeepETA needs a large volume of
(predicted ETA, actual arrival time) pairs *per corridor/time-of-day bucket* to train a residual
model that beats "just use Google's number." Ocar doesn't have that dataset yet, and won't until
enough rides have actually completed on each corridor. Building an ML ETA-correction model today
would be fitting noise, not signal.

**Decision: decline for now, instrument for later.** The actionable step now isn't the model —
it's *starting to log the (Google ETA, actual duration) pair on every completed ride* (see Phase 4
below) so that in 6-12 months, if ETA accuracy becomes a real complaint, there's a real dataset to
train a correction model on instead of starting from zero.

### 1.6 Turn-by-turn UX conventions (already largely matched)

Industry convention (Mapbox/Google's own navigation UI patterns): a maneuver banner with primary
instruction + distance-to-maneuver + (when relevant) a secondary/sub-maneuver preview of what
comes right after; voice announcements fired at fixed distance bands before a turn; large,
high-contrast text sized for a glance, not a read. Ocar's `ManeuverBanner.tsx` + `useVoiceGuidance.ts`
(shipped 2026-07-10, per the audit doc) already match this shape — banner + 300m/100m voice bands.
**No gap here**; the one documented deviation (announcing the backend's raw instruction text
instead of hand-built "in 300m, turn left" phrasing) is a deliberate, sound choice to avoid
unreviewed Hindi grammar, not a shortfall.

### 1.7 Battery, offline, and reliability

Native offline-area downloads cut mobile data use during nav by up to ~94% and extend battery
life 22-38%, because the device stops polling for tile updates. This is a genuinely large
practical effect, but Ocar's corridors are 3 well-covered city routes, not the wilderness — tile
availability isn't the pain point offline maps solve, and Wake Lock (already shipped) plus keeping
GPS at high-accuracy only during active-ride screens (already the policy per the audit doc §3
item 9) covers the bulk of the battery risk. Full offline vector-tile caching is real infra
(storage budgeting, eviction policy, pre-fetch-on-ride-accept) that solves a problem Ocar mostly
doesn't have (NH16 dead zones are a *connectivity* gap the audit doc already flagged, not a
battery one).

**Decision: decline offline tile caching for now.** Revisit only if driver reports specifically
cite tile-loading failures in known coverage gaps (NH16 stretch), not preemptively.

---

## 2. Gap-fulfillment table — where Ocar stands today vs. each technique

| Capability | Industry best practice | Ocar today | Verdict |
|---|---|---|---|
| Turn-by-turn maneuver banner + voice | Distance-banded announcements, primary/secondary maneuver | ✅ Shipped (`ManeuverBanner.tsx`, `useVoiceGuidance.ts`) | Done |
| Heading-locked follow camera, dynamic zoom/pitch | `easeTo({bearing, pitch, zoom})`, tighter zoom near turns | ✅ Shipped (`RecenterMap.tsx`) | Done |
| Off-route detection + reroute | Deviation threshold + consecutive-fix debounce, capped backoff | ✅ Shipped (`useTurnByTurn.ts`, 40m/3 fixes, 12s cooldown) | Done |
| Live traffic visualization | Traffic tile overlay | ✅ Shipped 2026-07-11 (`TrafficLayer.tsx`) | Done |
| Traffic-aware routing/ETA | `departure_time=now` / `TRAFFIC_AWARE_OPTIMAL` | ✅ Wired 2026-07-11 (`trafficAware` param → Google Directions) | Done |
| Traffic-tinted route polyline (color line by congestion) | Per-segment congestion color on the route itself | ❌ Not built | **Phase 1** — small, high visual-impact |
| GPS noise gating before route-snap | Reject/smooth outlier fixes before matching | ⚠️ Partial (rider app only; driver's `SelfCarMarker` has no gating per audit §1.1) | **Phase 2** — small |
| Route-network map matching (HMM) | Full Viterbi decode over candidate road segments | ❌ Not built (only nearest-point-on-known-polyline) | **Decline** — see §1.3, not the actual problem here |
| Kalman-filtered position smoothing | Motion-model fusion for GPS | ❌ Not built | **Decline for now** — see §1.4 |
| Proprietary crowdsourced traffic | Self-derived probe-vehicle speed matrix | ❌ Not built | **Decline** — see §1.2, fleet too small |
| Self-hosted routing engine | OSRM/Valhalla/GraphHopper | ❌ Not built (Google Directions only) | **Decline** — see §1.1 |
| ML ETA correction (DeepETA-style) | Residual model on top of routing ETA | ❌ Not built | **Decline now, instrument for later** — see Phase 4 |
| Routing/ETA quality observability | MAE/RMSE/MAPE vs. ground truth, logged per corridor | ❌ Not built | **Phase 4** — needed regardless of ML plans |
| Offline tile caching | Pre-fetched vector tiles, eviction policy | ❌ Not built | **Decline** — see §1.7 |
| Dark map style during nav | Cloud-configured Map Style | ❌ Not built (needs Google Cloud Console config, not code) | **Phase 3** — trivial, cosmetic |

---

## 3. Phased Plan

### Phase 1 — Traffic-tinted route polyline (visual "wow" completion)
**Closes:** the last visible gap between "colored roads in the background" (shipped) and the full
Google-Maps look (route line itself colored by congestion severity).

1. Google's Directions API (with `departure_time=now`) returns `duration_in_traffic` per leg but
   not natively per-segment congestion color the way its own consumer app renders it. Two
   realistic paths:
   - **(a)** Use the Routes API's traffic-aware polyline data (`travelAdvisory.speedReadingIntervals`)
     if available on our tier — gives per-segment speed category (NORMAL/SLOW/TRAFFIC_JAM)
     directly, which maps cleanly to green/orange/red segments.
   - **(b)** If that field isn't available on our current API tier/plan, approximate it: compare
     each step's `duration` vs `duration_in_traffic` (if Directions API — not Routes — is what's
     billed today) to derive a per-step severity ratio, color that step's polyline segment
     accordingly. Cruder than (a), zero additional API cost.
2. Render as multiple `Polyline` segments (one per congestion bucket) instead of one solid line,
   reusing the existing polyline-drawing code path in both driver and user map components.
3. **Verify:** on a real drive through a congested BBSR stretch (e.g. Rasulgarh at evening rush),
   confirm the route line visibly changes color where the `TrafficLayer` tile overlay already
   shows red/orange.

**Effort:** small — one API-field check + a rendering change, no new dependency.

### Phase 2 — GPS gating on the driver's own marker (closes the last stability gap)
**Closes:** the one asymmetry the original audit flagged but didn't fully close — `SelfCarMarker`
still has no movement/noise gating (unlike the rider app's `useInterpolatedPosition.ts`, which
gates on `dist > 8`).

1. Port the same `dist > 8`-style gate into the driver app's own heading computation before
   feeding `selfHeading` into `RecenterMap`/`SelfCarMarker` — reject bearing recomputation from
   fixes too close together to produce a reliable heading (device GPS noise at near-zero speed).
2. **Verify:** stand still with the driver app open in nav mode; confirm the car icon/camera no
   longer twitches heading at a red light or stop.

**Effort:** small — mirrors existing code in the same repo, no new library.

### Phase 3 — Cosmetic polish
1. Configure a dark Cloud-based Map Style in Google Cloud Console and apply its `mapId` during
   active navigation screens (already flagged as "not achievable from code alone" in the original
   audit — this is the actual console-side step to close it).
2. **Verify:** nav screen renders the dark style at night; daytime/idle screens unaffected.

**Effort:** trivial, console config + one conditional `mapId` swap.

### Phase 4 — Instrumentation now, so ML ETA is possible later (the honest long-term step)
This is the one piece of "Uber-grade" infra actually worth starting today, specifically because
it's cheap now and expensive to backfill later — you cannot retroactively generate historical ETA
accuracy data you never logged.

1. On every completed ride, persist: the routing-engine ETA at ride-accept time, the routing
   ETA at driver-arrived time, and the actual elapsed time for both the to-pickup and to-drop-off
   legs. A new lightweight table (or reuse `fare_snapshots`-style pattern) — few columns, no new
   infra.
2. Add a basic internal dashboard/query (admin analytics module already exists) reporting MAE/MAPE
   of ETA vs. actual, broken out per corridor and time-of-day bucket.
3. **Do not** build a correction model yet. Revisit once this data shows a *specific, quantified*
   ETA error pattern (e.g. "BBSR-Puri estimates are consistently 15% low during evening rush") —
   that's the trigger for a targeted fix (even a simple per-corridor/time-bucket correction factor
   before ever reaching for a neural net), not a speculative ML project today.
4. **Verify:** after 2 weeks of live data, confirm the dashboard produces a non-degenerate MAE
   number per corridor (i.e., the logging pipeline actually works end-to-end).

**Effort:** small-medium — one migration, a few log-write call sites, one admin query/chart.

---

## 4. What NOT to build, restated plainly

Don't self-host OSRM/Valhalla/GraphHopper. Don't build a crowdsourced traffic-ingestion pipeline.
Don't implement full HMM map-matching or Kalman-filtered positioning. Don't build a DeepETA-style
correction model. Don't build offline vector-tile caching. Every one of these is a legitimate,
well-documented industry technique — and every one of them solves a scale or data-density problem
Ocar doesn't have yet. Building them now would be infrastructure in search of a problem, at the
direct cost of the actually-scoped Phase 1-4 work above. If Ocar's trip volume grows by an order
of magnitude and any of these becomes genuinely load-bearing, that's a real, separate scoping
conversation — not a default to reach for because "Uber does it."

---

## Sources

- [DeepETA: How Uber Predicts Arrival Times Using Deep Learning](https://www.uber.com/en-IN/blog/deepeta-how-uber-predicts-arrival-times/)
- [DeeprETA: An ETA Post-processing System at Scale (arXiv)](https://arxiv.org/pdf/2206.02127)
- [Scaling Real-Time Traffic Forecasting with a Graph-Aware Transformer — Uber](https://www.uber.com/us/en/blog/scaling-real-time-traffic/)
- [OSRM vs Valhalla vs GraphHopper: Self-Hosted Routing Engines Compared 2026 — Pi Stack](https://www.pistack.xyz/posts/2026-04-25-graphhopper-vs-osrm-vs-valhalla-self-hosted-routing-engines-guide-2026/)
- [OSRM vs Valhalla vs GraphHopper: choosing a routing engine in 2025 — Mapsi](https://mapsi.dev/developers/routing-engine-comparison)
- [Open Source Routing Engines And Algorithms — An Overview — GIS OPS](https://gis-ops.com/open-source-routing-engines-and-algorithms-an-overview/)
- [Map Matching done right using Valhalla's Meili — Towards Data Science](https://towardsdatascience.com/map-matching-done-right-using-valhallas-meili-f635ebd17053/)
- [A Practical Guide to an Open-Source Map-Matching Approach for Big GPS Data — Springer](https://link.springer.com/article/10.1007/s42979-022-01340-5)
- [An Improved Map-Matching Algorithm on the Kalman Filter](https://www.depts.ttu.edu/transtech/documents/publications/11.pdf)
- [How to Smooth Your Location Data & Snap to the Nearest Road — PubNub/DEV](https://dev.to/pubnub/how-to-smooth-your-location-data-snap-to-the-nearest-road-54ib)
- [Available traffic options — Routes API — Google for Developers](https://developers.google.com/maps/documentation/routes/traffic-opt)
- [Routes API Usage and Billing — Google for Developers](https://developers.google.com/maps/documentation/routes/usage-and-billing)
- [Maneuver instructions — Mapbox Navigation SDK](https://docs.mapbox.com/android/navigation/guides/ui-components/maneuver/)
- [More efficient offline map tiles — Mapbox Mobile SDKs](https://www.mapbox.com/blog/more-efficient-offline-map-tiles-save-up-to-40-storage-space)
- [Designing a Real-Time Ride-Hailing System Architecture (Uber) — Medium](https://ashutoshkumars1ngh.medium.com/designing-a-real-time-ride-hailing-system-architecture-uber-643ca23c863f)
- [Part 2: How to Design an ML System for ETA Prediction in Ride-Hailing Services](https://mlsavvy.substack.com/p/part-2-how-to-design-an-ml-system)
