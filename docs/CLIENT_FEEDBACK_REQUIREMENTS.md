# Ocar — Client Feedback Analysis & Change Requirements

**Prepared by:** Product Analysis
**Date:** 2026-07-04
**Last verified against code:** 2026-07-08
**Scope:** User (Next.js) · Driver (Vite/React) · Admin (Next.js) · API (Express/PostgreSQL/PostGIS/Socket.io)
**Basis:** Live code review of `api/src/modules/rides`, `api/src/websocket/socket.server.ts`, `api/src/jobs/workers/notifications.worker.ts`, user/driver app flows, plus existing `docs/RIDE_FLOWS_AUDIT.md` and `docs/RIDE_TYPES_PLAN.md`.

---

## Executive Summary

| # | Issue | Severity | Category | Status |
|---|---|---|---|---|
| 1 | Online cabs disappear when phone screen is off | High | Real-time | ✅ Fixed (76c2fd5) |
| 2 | Cancellation not propagating between user ↔ driver | Critical | Real-time | ✅ Fixed (413faac) |
| 3 | OTP never reaches user → ride cannot start | Critical | Booking Flow | ⚠️ Partial — SMS is now a real provider (Fast2SMS); the `user:{userId}` privacy-room fix and a user-scoped `GET /rides/:id/otp` are **still not done** — driver still receives the passenger's OTP via the shared ride room |
| 4 | No drop / multi-drop on Rental & Round Trip | High | Booking Flow | 🔲 Pending — `ride_stops` table still unused; "Add stops" UI still shows a "coming soon" toast |
| 5 | No date/day picker for advance & multi-day bookings | High | Booking Flow | ⚠️ Partial — single-date scheduling **done** end-to-end (7431f3f, 4e2d742); multi-day duration/pricing still not implemented |
| 6 | Booking confirmation missing cab & driver details | High | UX | ✅ Fixed (a149d32) — real driver photo, rating, vehicle model/colour/plate now render; no hardcoded placeholders remain |
| 7 | Real phone numbers exposed between user & driver | Critical | Safety | 🔲 Pending — no masking provider integrated; raw `driverPhone` still emitted via socket and SMS |
| 8 | Local (intra-city) rides allowed on one-way/round-trip | High | Backend Logic | ✅ Fixed (40964cb) — server-side PostGIS same-city guard + client-side warning both in place |

**Two issues remain launch-blocking: 7 (phone masking) and the OTP-leak half of 3.** Issue 2 is fully resolved. See "Additional Fixes Found in Later Commits" below for two more bugs closed that weren't in the original list.

---

## Round 2 — Video Testing Bugs (2026-07-04)

Reported after client tested with live videos. Five new bugs surfaced:

| # | Issue | Severity | Category | Status |
|---|---|---|---|---|
| V1 | Ride completely disappears on page reload | Critical | State / UX | ✅ Fixed — layout checks for active ride on mount and redirects to /ride/{id} |
| V2 | Car icon rotates wrong (turns right while going forward), map quality low | High | Map / Navigation | ✅ Fixed (81f602b, 7adf0ba, 51934c9) |
| V3 | Driver marker stuck on map when navigating to pickup, no ETA shown | Critical | Real-time / Map | ✅ Fixed (18306ee) |
| V4 | User waiting screen missing driver photo, vehicle name, colour, plate number | High | UX | ✅ Fixed (a149d32) |
| V5 | OTP UI infinitely shows "generating…" after user returns from a phone call | Critical | OTP Flow | ⚠️ Partially fixed (c918865 — Redis OTP recovery; private user room + SMS pending) |
| V6 | Map provider was OpenFreeMap/MapLibre — low quality, poor Odisha street detail | High | Map / Infra | ✅ Fixed (81f602b) — migrated to Google Maps |
| V7 | Browser back button reopens completed ride screens (rating, navigate-to-pickup) | Medium | UX / Navigation | ✅ Fixed (a9586da) |

### V1 — Ride disappears on reload
- **Current:** User refreshes or reopens the app mid-ride → active ride state is gone, no way to resume.
- **Expected:** App always resumes the active ride on reload, showing current status and driver position.
- **Scope:** User app (persist active ride ID + re-fetch on mount), possibly driver app too.

### V2 — Car icon heading wrong + low map quality
- **Current:** Car image rotates to face right while physically moving forward. Map tile quality is low with poor Odisha street detail.
- **Expected:** Car icon heading matches actual direction of travel. Map provider upgraded to Google Maps or Ola Maps.
- **Scope:** Driver app map (heading/bearing calculation in `RoutePolyline` / `RecenterMap`). Map provider migration is a planned infra change.
- **Note:** Map is acknowledged as experimental to client. Provider migration (Google Maps / Ola Maps) is the long-term fix.

### V3 — Driver marker frozen on user map during navigate-to-pickup
- **Current:** Driver's position dot on the user's tracking screen doesn't move. ETA not shown.
- **Expected:** Driver marker updates smoothly as driver moves; ETA countdown visible.
- **Scope:** Real-time location pipeline (`driver:location` socket event → user map component). Related to Issue 1/2 socket fixes — may be partially resolved by deploy.

### V4 — Driver profile + vehicle details missing on user waiting screen
- **Current:** Hardcoded placeholders for driver name/rating; no photo, vehicle colour, or plate number shown.
- **Expected:** Live data: driver photo, name, star rating, vehicle model, colour, and registration plate shown as soon as driver is assigned.
- **Scope:** API (`GET /rides/:id` join on `driver_vehicles`), user tracking page. Duplicate of Issue 6.

### V5 — OTP UI spins forever after returning from phone call
- **Current:** User taps the call button → switches to phone app → returns → OTP section shows "Generating your trip OTP…" indefinitely, never resolves.
- **Expected:** OTP is shown immediately on return, recovered from sessionStorage or `GET /rides/:id/otp`.
- **Scope:** User ride page (OTP state lost when app is backgrounded and component remounts). Will be resolved by Issue 3 fix (Redis-backed OTP + recovery endpoint + sessionStorage persistence).

---

## Issue 1 — Online cabs vanish when the phone screen is off

- **Severity:** High
- **Category:** Real-time
- **Current behavior:** When the mobile screen locks/sleeps, the user portal stops showing online cabs. Two independent mechanisms are involved:
  - The **driver app** goes quiet when backgrounded. The driver sends GPS/location via `updateLocation`; when the OS suspends the PWA, pings stop and the WebSocket eventually disconnects. The server then runs a 45s grace timer (`OFFLINE_GRACE_MS` in `socket.server.ts`) and flips the driver to `offline`, setting `driver_location_snapshots.is_available = false`. The driver drops out of `findNearbyDrivers` results.
  - The **user app** relies on an 8s poll of `/rides/nearby-drivers`; when the user's own screen sleeps, the poll pauses and the map goes stale.
- **Expected behavior:** A driver who is genuinely online should remain visible to users even while the driver's phone screen is off; a user reopening the app should immediately see the current fleet.
- **Technical scope:** Driver app (background location), API (session lifecycle / grace period), User app (availability refresh).
- **Implementation notes:**
  - Driver side: implement background geolocation and/or a heartbeat that survives screen-off. As a PWA this is constrained — evaluate a **service-worker keep-alive**, `wakeLock`, or a native wrapper (Capacitor). At minimum, extend `OFFLINE_GRACE_MS` and distinguish "socket blip" from "driver ended shift."
  - Server side: do not equate "socket disconnected" with "driver offline" so aggressively. Consider a separate `stale` state (no recent ping) vs. `offline` (explicit go-offline), and keep `stale` drivers visible with a "last seen" marker.
  - User side: refresh nearby drivers on `visibilitychange`/app-resume, not only on a timer. Preferred: replace the poll with a socket push of availability per city zone.
  - **Edge cases:** driver in a network dead-zone vs. genuinely offline; rapid screen on/off flapping (debounce state changes); a driver on-trip must never be shown as "available."

---

## Issue 2 — Cancellation not propagating between user and driver

- **Severity:** Critical
- **Category:** Real-time
- **Current behavior:** The backend cancellation is **fully implemented on both sides** — `cancelRide` (user) and `cancelRideAsDriver` (driver) in `rides.service.ts` both update `rides.status`, write `ride_cancellations`, free the driver session, and call `socketEvents.sendRideStatusUpdate(rideId, { status: 'cancelled', cancelledBy })` into the `ride:{rideId}` room. Despite this, the counterparty is not notified. Root cause: **the notification only reaches sockets that have joined the `ride:{rideId}` room**, and joining is not reliable:
  - `join:ride` in `socket.server.ts` must be explicitly emitted by each client. The **driver app does not invoke `join:ride`**, so the driver socket is never in the room and never receives the user's cancellation.
  - The user side joins on the tracking screen but can leave the room on navigation/reload, missing a driver-initiated cancellation.
- **Expected behavior:** A cancellation by either party is reflected on the other party's screen in real time (and on reconnect).
- **Technical scope:** Driver app (must join ride room + handle `ride:status_update`), User app (robust join/rejoin + handler), API (delivery guarantee).
- **Implementation notes:**
  - Ensure **both** apps emit `join:ride` as soon as a ride is active and re-emit on reconnect; both must handle `ride:status_update` with `status: 'cancelled'` and route to a terminal screen.
  - **Delivery guarantee (important):** socket emits are fire-and-forget. If the target socket is disconnected at emit time, the event is lost. On reconnect / screen resume, each app must **re-fetch ride status** (`GET /rides/:id`) to reconcile — do not depend solely on the live event.
  - Also notify via the existing BullMQ/SMS path (a "your ride was cancelled" template) as an out-of-band backstop.
  - **Edge cases:** driver-side cancellation must re-broadcast or clearly end the ride; cancellation fees (`ride_cancellations.fee_amount`) are written as `0` today — surface the fee to the user before they confirm; concurrent cancel + accept (CAS `WHERE status = $expected` already guards the DB row — keep it).

---

## Issue 3 — OTP never reaches the user; ride cannot start

- **Status (verified 2026-07-08):** ⚠️ **Partial.** SMS is fixed — `api/src/providers/sms.provider.ts` now calls a real Fast2SMS HTTP API (dev falls back to console log only when no key configured), and `notifications.worker.ts` correctly guards `if (ride.user_phone)`. **Not fixed:** the `user:{userId}` socket room is joined on connect (`socket.server.ts:119`) but nothing ever emits into it — there is no `sendToUser` helper. OTPs still broadcast into the shared `ride:{rideId}` room (`rides.service.ts:460-463, 514-518`), so the driver still receives the passenger's plaintext OTP. There is also still **no `GET /rides/:id/otp`** endpoint — `GET /rides/:id` does return the OTP but is only gated by `isOwner` (user OR driver OR admin), not user-scoped, so it doesn't fix the leak either.
- **Severity:** Critical
- **Category:** Booking Flow
- **Current behavior:** On `markArrived`, the start OTP is delivered two ways: (a) a `ride:status_update` socket event to the `ride:{rideId}` room, and (b) an `otp_sms` BullMQ job — **but only if `ride.user_phone` is set**, and only if the SMS provider (`sendSms`) is actually live. In practice the user does not receive the OTP because:
  - The OTP arrives **only via socket** into component state and is **lost on page reload** — there is no recovery endpoint; only the SHA-256 hash is in the DB.
  - The OTP is emitted to the **shared ride room**, so if the user's socket hasn't joined (same root cause as Issue 2) they never see it — while the driver, who may be in the room, receives it (a privacy leak).
  - The SMS fallback depends on a real SMS provider; in the current environment `sendSms` may be a stub/no-op, so no out-of-band copy arrives.
  - Because the start OTP is mandatory to move `driver_arrived → in_progress`, the ride is **hard-stuck** the moment the user can't read the code.
- **Expected behavior:** The user reliably obtains the start OTP through the app (and ideally SMS), survives reloads, and can always start the ride.
- **Technical scope:** API (add a user-scoped OTP retrieval path + private room), User app (persist + display + recover OTP), Notifications (working SMS provider).
- **Implementation notes:**
  - Add a **`user:{userId}` private socket room** and emit OTPs only there (never the shared ride room). OTPs currently leak to the driver via the shared room — fix both problems together.
  - Add **`GET /rides/:id/otp`** gated to `ride.user_id === req.user.id`, returning the current start/end OTP for display. This makes OTP survive reload and removes reliance on live events.
  - Short-term client mitigation: persist the received OTP in `sessionStorage` keyed by `rideId`.
  - Make the SMS provider real (M10 notifications) so the OTP has a genuine out-of-band channel; guard the `if (ride.user_phone)` path so a missing phone can't silently drop the only copy.
  - **Edge cases:** user with no phone on file; user reloads during `driver_arrived`; ensure the driver never receives the plaintext OTP (they must ask the passenger for it — this is the security intent).

---

## Issue 4 — No drop / multiple-drop location on Rental & Round Trip

- **Status (verified 2026-07-08):** 🔲 **Still pending.** `apps/user/app/(main)/search/page.tsx` "Add stops" button still just opens a toast saying "Multi-stop trips coming soon." API only carries `stopCount?: number` for fare calc — no `stops[]` array, no reads/writes to `ride_stops` anywhere in `rides.repository.ts`. The `ride_stops` table exists in the schema (007_m5_booking.sql) but is completely unused.
- **Severity:** High
- **Category:** Booking Flow
- **Current behavior:**
  - **Rental** intentionally has **no drop** — by product design rental is "hire by the hour, go anywhere within the city," so no destination is expected. However there is **no stop/waypoint entry** at all.
  - **Round Trip** supports a single destination (A → B → A) but optional **intermediate stops are not implemented**. Multi-drop is absent.
  - The fare engine already supports `stop_count`/`stop_charges` and there is a `ride_stops` table, so the backend is partially ready.
- **Expected behavior:** Users can add one or more intermediate/drop stops on Round Trip (and, where the client expects it, on Rental) with each stop searchable and priced.
- **Technical scope:** User app (stop UI on both pages), API (accept a `stops[]` array into `ride_stops`, price via existing stop charges), fare display.
- **Implementation notes:**
  - Implement the planned "Add a stop" flow: open `/search` with `backTo` + `stopIndex`, up to 3 stops, removable chips, forwarded as `stops[i][address|lat|lng]`.
  - Persist stops into `ride_stops` and include them in the fare snapshot; ensure `stop_count` drives `stop_fare`.
  - **Product clarification needed:** rental is intra-city with no fixed destination by design. The client asking for "drop location on rental" likely wants **waypoints for pricing/routing**, not a hard destination. Confirm intent before building — a hard drop on rental would conflict with the hourly-package model.
  - **Edge cases:** stop ordering; a stop outside the city boundary on Rental (ties into Issue 8 / boundary alerts); max stop count; recomputing fare when a stop is added/removed.

---

## Issue 5 — No day/date picker for advance & multi-day bookings

- **Status (verified 2026-07-08):** ⚠️ **Partial.** Single-date scheduling is fully wired end-to-end (commits 7431f3f, 4e2d742): `createBooking` validates `scheduledFor`, inserts the ride as `status='scheduled'`, and enqueues a delayed BullMQ job via `scheduler.worker.ts` (with a repeatable `sweep_scheduled_rides` safety net). The user app has a real date/time picker (`ScheduleRideSheet.tsx` + `DateTimePickerSheet.tsx`) wired into search, round-trip, rental, and select-ride pages. **Multi-day duration/pricing is not implemented** — no day-range or per-day pricing fields exist anywhere in the codebase; round-trip/rental remain single hour-block/package selectors.
- **Severity:** High
- **Category:** Booking Flow
- **Current behavior:** There is **no advance-scheduling UI**. The `rides.return_at` column exists and is reserved for advance booking, but no date picker populates it. The rental page had a `startAt` picker that is **not wired into the booking payload** — a "book for tomorrow 9am" request dispatches immediately. Round Trip is duration-based (hours), with no calendar for multi-day trips.
- **Expected behavior:** Users can pick a **day/date (and time)** to schedule a ride in advance, and can book a car spanning **multiple days** (round trip / rental).
- **Technical scope:** User app (date-time picker + multi-day duration input), API (accept `scheduledFor`; delayed dispatch), Driver app (surface scheduled rides), Admin (visibility of scheduled bookings).
- **Implementation notes:**
  - Add `scheduledFor` to `BookingRequest` + Zod schema; thread through `createBooking → createRide`; in the broadcast processor, **enqueue a delayed BullMQ job** (`delay = scheduledFor - now`) instead of broadcasting immediately.
  - For **multi-day**, extend the duration model beyond the current hour chips (4/6/8/10/12h) — introduce a day count or a start-date + end-date range, and a pricing model for multi-day (per-day rate, driver allowance/detention). This is a **new pricing dimension** not yet in the fare engine.
  - **Edge cases (implicit):** validation that `scheduledFor` is in the future; no-driver-available at scheduled time (retry/fallback); cancellation window for scheduled rides; timezone handling (IST); overnight driver allowance for multi-day; reminder notifications before a scheduled pickup.

---

## Issue 6 — Booking confirmation missing cab & driver details

- **Status (verified 2026-07-08):** ✅ **Fixed** (a149d32). `apps/user/app/(main)/ride/[id]/page.tsx` renders live `driverRating`, `driverPhoto`, `vehicleModel`, `vehicleColor`, and plate number sourced from the assignment payload — no hardcoded "4.8★"/"Sedan" strings remain. `GET /rides/:id` (`rides.repository.ts:302-317`) joins `drivers`, `driver_vehicles`, and `vehicle_models` to return the full detail set, and `acceptRide` emits the same via `sendDriverAssigned` including a presigned driver photo URL.
- **Severity:** High
- **Category:** UX
- **Current behavior:** On assignment, `sendDriverAssigned` emits `driverName` + `driverId` (and currently `driverPhone` — see Issue 7) to the ride room, but the tracking screen shows **hardcoded placeholders**: driver rating `4.8★` and vehicle `Sedan` are static strings. The required set — registration number, model, colour, driver photo, real rating, name, start OTP — is not surfaced together.
- **Expected behavior:** After booking/assignment the user sees:
  - (a) Cab registration number
  - (b) Cab model
  - (c) Car colour
  - (d) Driver profile photo
  - (e) Driver star rating
  - (f) Driver name
  - (g) Start OTP (after driver arrives — see Issue 3)
- **Technical scope:** API (assignment payload + `GET /rides/:id` must return driver + vehicle detail), User app (render real data), driver/vehicle data model.
- **Implementation notes:**
  - Extend the ride/assignment response to join `driver_vehicles`/`vehicles` (plate number, model, **colour**) and driver profile (photo URL, aggregate rating from `ratings`, name). Colour must exist on the vehicle record — **verify the schema has a colour field**; if not, it requires a small migration + admin/onboarding capture.
  - Driver photo is an S3 document — return via `getPresignedUrl` (prod) per the storage convention.
  - Start OTP must come from the user-scoped path described in Issue 3, not the shared room.
  - Replace hardcoded `4.8★` / `Sedan` with real fields.
  - **Edge cases:** driver with no photo/rating yet (fallback avatar, "New" badge); plate formatting; data must persist for the ride history view, not just live.

---

## Issue 7 — Real phone numbers exposed between user and driver

- **Status (verified 2026-07-08):** 🔲 **Still pending — remains the top launch-blocking gap.** No masking/virtual-number provider integrated anywhere (zero hits for Exotel/Twilio/Knowlarity). `rides.service.ts:419` still emits `driverPhone: ride?.driver_phone` via `sendDriverAssigned` into the shared ride room, and the `ride_accepted` SMS body still embeds the driver's raw phone number (`notifications.worker.ts:87-89`).
- **Severity:** Critical
- **Category:** Safety
- **Current behavior:** Raw phone numbers are shared in **both** directions:
  - `sendDriverAssigned` emits `driverPhone: ride.driver_phone` to the ride room.
  - The `ride_accepted` SMS to the user includes the driver's phone in the message body.
  - Driver-facing ride data exposes `user_phone` (used for SMS and reachable in payloads).
  - There is **no proxy/masked-calling layer** anywhere.
- **Expected behavior:** Neither party sees the other's real number. Calls route through **masked/proxy numbers** (virtual number pairing) so contact is possible without disclosure. Mandatory for safety.
- **Technical scope:** API (integrate a masked-calling provider — e.g. Exotel/Twilio/Knowlarity number-masking), both apps (call via a proxy, never `tel:` the raw number), notifications (strip raw numbers from all messages/payloads).
- **Implementation notes:**
  - Integrate a **number-masking provider**: on ride accept, provision a virtual-number binding for the (user, driver) pair valid for the ride's lifetime; expose only the proxy number and a "Call" button to each app.
  - **Remove `driverPhone` from `sendDriverAssigned`** and **remove the phone from the `ride_accepted` SMS body**; audit all payloads and logs for raw numbers.
  - Apps must never receive the counterparty's real MSISDN.
  - **Edge cases:** binding teardown on ride completion/cancel (release the virtual number); call records/audit for disputes and SOS; SMS between parties also masked; provider outage fallback (in-app chat) — note the "Message driver" button currently has no handler.

---

## Issue 8 — Local (intra-city) rides allowed on one-way / round-trip

- **Status (verified 2026-07-08):** ✅ **Fixed** (40964cb). Server-side guard in `createBooking` (`rides.service.ts:184-199`) calls the PostGIS-backed `classifyTrip` (`geo.service.ts:72`) and throws a 422 ("This trip stays within {cityName} — book it as a City Ride instead") when scope is `in_city` for one-way/round-trip. Client-side warning also wired into home/search pages via `geo-api.ts`.
- **Severity:** High
- **Category:** Backend Logic
- **Current behavior:** `createBooking` accepts any `rideType` for any origin/destination pair. There is **no same-city guard** — an intra-city trip (origin city == destination city) booked as `one_way` or `round_trip` is accepted and dispatched normally. Per product spec, intra-city travel should be served **only through Rental**; Round Trip is defined as "outstation — crosses city boundary by definition."
- **Expected behavior:** Local city rides (same-city origin+destination, or a destination inside the origin city's boundary) must be **blocked** on one-way and round-trip and steered to the Rental flow.
- **Technical scope:** API (server-side guard in booking + estimate), User app (block/redirect in UI before booking), geo/PostGIS (city-boundary containment).
- **Implementation notes:**
  - **Server-side enforcement (authoritative):** in the booking Zod refinement / service, reject `one_way` and `round_trip` when origin and destination resolve to the **same city** (or destination lies within origin's PostGIS boundary). Return a clear error steering to Rental. Do not rely on the client alone (URL params are tamperable).
  - **Client-side UX:** on the one-way/round-trip search screens, detect same-city selection and surface "This is a local trip — please use Rental," disabling proceed. The user app already reads `originCityId`/`destinationCityId`, so the check is available client-side.
  - **Edge cases:** border/near-boundary points (define tolerance); missing/unresolved city id (fail safe — block and ask for clarification); a one-way that starts intra-city but ends outstation (allowed); ensure fare estimate endpoint enforces the same rule.

---

## Cross-Cutting Root Causes (implicit findings)

1. **Socket room membership is not guaranteed.** Issues 1, 2, 3, 6 all stem from clients not being reliably in the `ride:{rideId}` room and events being fire-and-forget. Fix pattern: mandatory `join:ride` on both apps + **reconcile on reconnect via `GET /rides/:id`** + a private `user:{userId}` room for sensitive data. This single fix substantially de-risks four issues.
2. **No out-of-band safety net.** OTP, cancellation, and assignment all depend on a live socket. A working SMS/push channel (M10) plus retrievable server state (`GET /rides/:id`, `GET /rides/:id/otp`) is needed as backstop.
3. **Client-supplied trust.** Booking trusts client `rideType`, city ids, and distances. City/ride-type rules (Issue 8) and fare must be enforced server-side.
4. **Privacy by default.** Raw phone numbers currently flow through sockets, SMS bodies, and localStorage — Issue 7 requires a sweep of every payload, log, and persisted store.

---

## Prioritized Action List

**Status key:** ✅ Done · ⚠️ Partial · 🔲 Pending — verified against code 2026-07-08.

### P0 — Launch-blocking (Critical)

1. **Issue 7 — Phone masking:** 🔲 integrate number-masking provider; strip all raw numbers from payloads/SMS/logs. *(Safety, non-negotiable — still fully open.)*
2. **Issue 3 — OTP delivery:** ⚠️ SMS provider done; still need `user:{userId}` emit path (room is joined but nothing sends to it) + a user-scoped `GET /rides/:id/otp` to stop the OTP leaking to the driver.
3. **Issue 2 — Cancellation propagation:** ✅ Done — `join:ride` + reconnect reconciliation + SMS backstop shipped (413faac).

### P1 — High (pre-GA)

4. **Issue 8 — Block local rides on one-way/round-trip:** ✅ Done (40964cb) — server-side same-city guard + client redirect.
5. **Issue 6 — Full cab/driver details on confirmation:** ✅ Done (a149d32) — real vehicle/driver data, presigned photo, real rating.
6. **Issue 1 — Keep cabs visible with screen off:** ✅ Done (76c2fd5) — wake-lock re-acquisition + resume-refresh.

### P2 — High (fast-follow)

7. **Issue 4 — Intermediate/multi-stop on Round Trip:** 🔲 Still pending — `ride_stops` table unused, UI still shows "coming soon."
8. **Issue 5 — Advance & multi-day booking:** ⚠️ Single-date scheduling done (7431f3f, 4e2d742); multi-day duration & pricing model still not built.

### Found and fixed along the way (not in original list)

9. **Rider stuck on `in_progress` ride with no exit path** (a2ac7b6) — staleness sweeper (flags at 10min GPS silence, auto-cancels at 30min), admin force-resolve, rider "report a problem" escape hatch via SOS pipeline.
10. **Round-trip fare only charged one leg instead of both** (083161a) — billing bug; return leg was not being doubled into the fare, plus no recalculation on early termination.

---

## Dependencies / Sequencing

- Do the **socket-room + reconnect-reconcile** fix first — it underpins Issues 2, 3, 6 and helps 1.
- **`cities.boundary` PostGIS polygon** is a shared prerequisite for Issues 8 and the rental/round-trip stop edge cases in 4.
- **SMS/push provider (M10)** is a shared backstop for Issues 2, 3, and the reminders in 5.

---

## Round 3 — Client Message (2026-07-11)

Raw feedback from client after a fresh testing pass on driver + user panels. Split below into **actual bugs** (regressions in shipped features) and **net-new feature requests** the client is describing as "issues" but were never built.

### Bugs (real regressions — prioritize first)

| # | Issue | Severity | Category | Status |
|---|---|---|---|---|
| B1 | Ongoing trip disappears on refresh/back-nav (driver **and** user panel) — no way to resume/complete the trip | Critical | State / UX | ✅ Fixed (b06df2e) — removed the premature redirect race in the driver app, added retry to both apps' restore/active-ride checks, added Home-screen resume banners as a fallback on both apps |
| B2 | Repeated cancellations (2-3+) degrade both panels — rider panel stuck on "finding drivers"/"no cab," driver panel goes stale-online (online but not receiving broadcasts) | Critical | Real-time / Matching | ✅ Fixed (b06df2e) — rate limiter now keys by authenticated principal instead of shared IP; drivers holding an unaccepted request now get it dismissed immediately when the rider cancels, instead of waiting out the broadcast timeout |
| B3 | SOS button on driver panel is positioned awkwardly (fixed at an odd spot) | Low | UI | ✅ Fixed (b06df2e) — moved to a dedicated top-right slot, clear of the maneuver banner/status pill |

### B1 — Trip state lost on refresh/back-nav
- **Current:** Driver or user refreshes, or navigates back, mid-ride → active ride view is lost, app returns to the main/home page with no way back into the ride.
- **Expected:** Both apps always resume the active ride on load/remount (same pattern as V1's fix, but V1 only closed this for the user app on page *reload* — this report covers driver app too, and in-app back-navigation, not just browser reload).
- **Scope:** Driver app (persist active ride id + resume-on-mount check, mirroring what shipped for user app), user app (extend V1 fix to also catch in-app back-nav, not just full reload).

### B2 — System slows down after repeated cancellations
- **Current:** Cancelling a booking 2-3+ times in a row (from either side) causes both panels to lag/slow to refresh; rider sees no drivers / stuck "finding driver," driver stays marked online but stops receiving new ride broadcasts.
- **Expected:** Cancel-and-rebook cycles should be clean — no queue backlog, no stale driver-online state.
- **Scope:** API — audit `broadcast.processor.ts` fan-out and driver session/availability reset logic after a `ride_cancellations` write; check for orphaned BullMQ jobs or `driver_location_snapshots.is_available` not being restored after a ride is cancelled mid-broadcast.

### B3 — SOS button placement (driver panel)
- **Current:** SOS button sits at an awkward fixed position on the driver active-ride screen.
- **Expected:** Move to a corner, top of screen — out of the way of primary controls, still reachable.
- **Scope:** Driver app UI only, no backend change.

---

### Feature requests (not built yet — scope for roadmap, not "fixes")

| # | Request | Notes |
|---|---|---|
| F1 | Live navigation map on driver panel for the full trip, auto-opened to the 1st drop; multi-stop sequencing UI ("reached stop N" → close stop → proceed to next) for both point-to-point multi-stop and rental-package rides; user can edit/add destinations mid-trip | Overlaps `MULTI_STOP_PLAN.md` and `MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md` — driver-side nav map does not exist yet; `ride_stops` table is unused (same gap as Issue 4 above) |
| F2 | Driver rates user after trip completion (with reasons) | Only user→driver rating exists (M09). New rating direction + UI. |
| F3 | SOS button on user panel + live trip-sharing with a third party | ⚠️ Partial — **SOS half done**: added `SOSButton` to the user ride-tracking page (`apps/user/app/(main)/ride/[id]/page.tsx`), reusing the existing `safetyApi.triggerSos()` backend (already actor-agnostic, no backend change needed). Live trip-sharing with a third party is still fully new, not started. |
| F4 | Context-aware cancellation reasons: different reason sets pre-pickup vs. post-arrival, for both user and driver; driver-side cancel option after arriving at pickup; pickup wait-timer (2-3 min) with driver-initiated cancel after timeout; wait-time overage billed to the customer as a waiting charge (from timer end until OTP entry) | Whole cancellation-policy subsystem — none of this exists today. Needs a design pass (state machine + fare engine hook) before building. |
| F5 | Mask/hide user's real phone number from driver (incl. during calls) | This is **Issue 7** from Round 1 (phone masking) — still open, client is re-flagging the same launch-blocking gap. No new scope, just a priority signal. |
| F6 | Show user's rating to the driver (pre-trip) | ✅ Done — `users.rating_avg` now threaded through `getRideById`/`getActiveRideForDriver` to the driver app and shown next to the rider's name on the pickup screen (`NavigateToPickup.tsx`). Scoped to post-accept (pickup screen), not the pre-accept incoming-request card — showing it before accept would need broadcast-payload changes, treated as a fast-follow if wanted. |
| F7 | Merge Khurda + Cuttack into Bhubaneswar's city-ride business radius instead of treating them as outstation-only | Geo/business-rule change: extend or redraw the Bhubaneswar `cities.boundary` PostGIS polygon (or introduce a metro-zone grouping) so Rental/city-ride is offered across all three, matching how Ola/Uber/Rapido zone the area. Needs a product decision on pricing within the merged zone, not just a boundary edit. |

**Client also requested a physical meeting** to walk through remaining issues and testing together — flagged as still open, not yet scheduled.

---

*Grounding references: `api/src/modules/rides/rides.service.ts`, `api/src/websocket/socket.server.ts`, `api/src/jobs/workers/notifications.worker.ts`, `docs/RIDE_FLOWS_AUDIT.md`, `docs/RIDE_TYPES_PLAN.md`.*
