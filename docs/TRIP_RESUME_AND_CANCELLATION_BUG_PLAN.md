# Trip Resume & Cancellation-Storm Bug Fix Plan

**Prepared:** 2026-07-11
**Scope:** B1 (trip disappears on refresh/back-nav), B2 (repeated-cancellation slowdown), B3 (SOS button placement) from `CLIENT_FEEDBACK_REQUIREMENTS.md` Round 3.
**Basis:** Live code review of `apps/driver/src/App.tsx`, `apps/driver/src/pages/ActiveRide/*`, `apps/driver/src/store/useRideStore.ts`, `apps/user/app/(main)/layout.tsx`, `apps/user/app/(main)/ride/[id]/page.tsx`, `api/src/modules/rides/{rides.service,rides.repository}.ts`, `api/src/jobs/processors/{broadcast,ack-check}.processor.ts`, `api/src/middleware/rateLimit.middleware.ts`.

---

## B1 — Ongoing trip disappears on refresh / back-nav

### What's already in place (don't rebuild this)

- **Driver app** (`App.tsx:68-115`): on every auth session start, fetches `driverRideApi.getCurrentSession()` → if `on_trip`, fetches `getActiveRide()`, repopulates `useRideStore`, rejoins the `ride:{id}` socket room, and navigates to the correct step (`navigate`/`otp`/`in-progress`). `useRideStore` is also `zustand/persist`-backed to `localStorage` (`ocar_driver_ride`), so `activeRide` should already be present from a prior render even before this fetch resolves.
- **User app** (`layout.tsx:19-25`): on mount, calls `rideApi.getActiveRide()` and redirects to `/ride/{id}` if one exists. The `/ride/[id]` page itself already handles a *stale* ride id gracefully (404/403 → `router.replace('/home')`, per the V1/V7 fixes already shipped).

So the resume machinery exists on both sides. The bug is two separate races/gaps that defeat it.

### Root cause 1 — Driver: `NavigateToPickup.tsx` redirects before restore completes

`apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx:41-43`:
```tsx
useEffect(() => {
  if (!activeRide) navigate('/', { replace: true })
}, [activeRide, navigate])
```
This page only guards the `accepted` stage (driver en route to pickup, before arrival) — `TripInProgress.tsx` and `OTPVerify.tsx` do **not** have this guard, they just render with fallback values, so they self-heal once `activeRide` populates. `NavigateToPickup` is the odd one out and the one place a refresh mid-race can actually evict the driver.

On a hard refresh, `zustand/persist` rehydration from `localStorage` is asynchronous even though the storage itself is synchronous — there's one render tick where `activeRide` is still `null` before hydration completes. This component's effect fires on that first render and immediately navigates to `/` before either (a) persisted state loads, or (b) the `App.tsx` session-restore fetch resolves. In most cases the `App.tsx` restore effect subsequently fires and navigates back — but if `driverRideApi.getCurrentSession()` or `getActiveRide()` is slow, fails, or (see below) is 429'd, the driver is left stranded on Home with no active ride in the store and no retry.

**Compounding gap:** `App.tsx:114`, the restore chain ends in a bare `.catch(() => {})` — a failed fetch (network blip, rate limit, cold start) silently no-ops. No retry, no error surfaced, no fallback UI on `Home.tsx` that says "you have a trip in progress, tap to resume."

### Root cause 2 — User: `layout.tsx` resume redirect has no error handling and no retry

`apps/user/app/(main)/layout.tsx:19-25`:
```tsx
useEffect(() => {
  if (pathname.startsWith('/ride/')) return
  rideApi.getActiveRide().then(res => {
    if (res?.rideId) router.replace(`/ride/${res.rideId}`)
  })
}, [])
```
No `.catch()`. If this call fails or is slow (see B2 — rate limiting is a live suspect here too), the promise silently rejects, no redirect happens, and the user is on Home with **zero visible path back into the ride** — `Home.tsx` doesn't render any "resume trip" affordance either. This matches the exact complaint: "no way to complete the same trip."

### Fix plan

1. **Driver — remove the premature redirect, make it match the other ride pages:**
   In `NavigateToPickup.tsx`, replace the hard redirect with the same self-healing pattern already used by `TripInProgress.tsx`/`OTPVerify.tsx` — don't navigate away just because `activeRide` is momentarily `null`. If we want *some* eviction for the genuinely-stale case (driver opens this route directly with no ride at all), gate it behind the restore effect having finished at least once (e.g. a `restoreChecked` flag lifted to `App.tsx`/a small context, or simply delay the check until after the `getCurrentSession()` promise in `App.tsx` has settled).
2. **Driver — surface restore failures instead of swallowing them:**
   In `App.tsx`, replace `.catch(() => {})` on the session-restore chain with a retry (e.g. one retry after 2s) and, on final failure, keep whatever `activeRide` is already in the persisted store rather than calling `clearRide()`/redirecting. Never let a network error be indistinguishable from "no active ride."
3. **Driver — add a Home-screen fallback banner:**
   `Home.tsx` should read `activeRide` from `useRideStore` and, if present but the driver isn't on an active-ride route, show a "Trip in progress — tap to resume" banner that navigates to the right step. This is defense-in-depth so a restore race is never a dead end.
4. **User — add error handling + retry to the layout redirect:**
   Add `.catch()` to the `layout.tsx` effect; on failure, retry once after a short delay. Do not let a failed check silently strand the user.
5. **User — same Home fallback banner** as #3, reading from wherever the user app tracks a locally-known ride id (or re-querying `getActiveRide()` on demand when the banner is tapped).
6. **Both — cover in-app back-navigation, not just reload:** confirm `NavigateToPickup`'s fix (and the equivalent user-side handling) also covers SPA-level back (React Router `popstate` / Next.js back) since that doesn't remount `App.tsx` — the fix in #1 (don't hard-redirect on transient null) already covers this since it stops being remount-dependent.

### Files to touch
- `apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx`
- `apps/driver/src/App.tsx`
- `apps/driver/src/pages/Home.tsx`
- `apps/user/app/(main)/layout.tsx`
- `apps/user/app/(main)/home/page.tsx` (or wherever Home lives — confirm path)

### Verification
- Accept a ride as driver → hard refresh while on `/ride/navigate` → driver stays on/returns to the navigate screen, never bounces to Home.
- Kill network for 3s right after refresh, restore it → driver still recovers (retry path).
- As user, refresh mid-ride on `/ride/[id]` and on `/home` while a ride is active → lands back on the tracking page.
- Simulate `getActiveRide()` throwing (e.g. temporarily disable the endpoint) → confirm the Home banner still offers manual resume instead of a dead end.

---

## B2 — Repeated cancellations slow down / desync both panels

### What's correctly handled already

- `cancelRide()` / `cancelRideAsDriver()` (`rides.service.ts:687-831`) both flip `driver_sessions.status` back to `'online'` and `driver_location_snapshots.is_available = true` — but **only when `ride.driver_id` is set**, i.e. only for rides already accepted. For a ride still `requested` (broadcasting, no driver assigned yet), there's nothing to reset, which is correct.
- `processAckCheck()` (`ack-check.processor.ts:33-37`) checks `ride.status !== 'requested'` on every retry tick and deletes the ack key + stops retrying — so a cancelled-while-broadcasting ride doesn't keep re-notifying drivers forever.
- `processBroadcast()` (`broadcast.processor.ts:34`) bails immediately if the ride is no longer `requested` — so queued round-2/round-3 broadcast jobs for an already-cancelled ride are no-ops.
- `findNearbyDrivers()` (`rides.repository.ts:99-135`) matches purely on `is_available = true AND ds.status = 'online'` — it does **not** filter on outstanding `ride_assignments`, so a driver isn't excluded from new broadcasts just because they have a stale assignment row from a prior cancelled ride.

So the backend's cancellation bookkeeping is *mostly* sound. Two real gaps remain:

### Root cause 1 — Drivers holding an unaccepted incoming request are never told the ride was cancelled

When a user cancels a ride that's still `requested` (before any driver accepted), `cancelRide()` emits `socketEvents.sendRideStatusUpdate(rideId, ...)` to the `ride:{rideId}` room. But drivers who received the `ride:request` broadcast and are staring at the `TripRequestCard` **have not joined that room** — room membership only happens in `App.tsx` after `acceptRide()`. So those drivers' incoming-request cards just sit there, un-dismissed, until the client-side countdown (`timeoutSeconds`, tied to `BROADCAST_WINDOW_SECONDS`) expires on its own. During a rapid manual test (cancel → rebook → cancel → rebook), this compounds: each cancelled ride leaves its recipients' cards lingering for up to the full broadcast window, and a fresh `ride:request` for the *next* booking attempt overwrites the card (`setIncomingRequest` unconditionally replaces state — see `App.tsx:166`), which reads to the tester as "driver panel is lagging / not getting the new request cleanly," even though functionally the newest request does eventually show.

**Fix:** emit a lightweight `ride:cancelled` (or reuse `ride:request:expired`) event addressed directly to each broadcasted driver's private room (`driver:{driverId}`, which they *are* always joined to) when a still-`requested` ride is cancelled, so their card is dismissed immediately instead of waiting out the timer. `cancelRide()` already has the list of drivers who received the broadcast available via `ride_assignments` (or can query it) — reuse the same `cancelledDriverIds` pattern already used in `acceptRide()` (`rides.service.ts:478-480`, `socketEvents.sendRequestExpired`).

### Root cause 2 — Shared-IP rate limiting during rapid manual testing

`api/src/middleware/rateLimit.middleware.ts`: `generalLimiter` caps every IP at **200 requests/minute**, applied globally in `app.ts`. During live testing, the rider and driver phones are very likely on the **same Wi-Fi/hotspot**, meaning they share one public IP and one rate-limit bucket. Per-app steady-state traffic already includes:
- Driver location ping every 3s while any active-ride/navigate screen is mounted (`useDriverLocation` → `updateLocation`) — 20 req/min on its own.
- User nearby-drivers poll every 8s while `requested` (`page.tsx:118-126`) — 7.5 req/min.
- Socket reconnects, `getCurrentSession`/`getActiveRide` checks on every mount, notification unread-count fetches, etc.

Two devices doing this concurrently, plus the burst of extra calls a manual cancel→rebook cycle adds (cancel, create booking, accept, arrive, ...), can plausibly exhaust the shared 200/min bucket within a couple of minutes of active testing — especially with 2-3+ repeated cancellations in quick succession. Once throttled (HTTP 429), *any* endpoint sharing that IP starts failing, including the ones this plan already flagged as unguarded in B1 (`getActiveRide()` in `layout.tsx`, `getCurrentSession()` in `App.tsx`) — which is exactly how a rate-limit blip turns into "trip disappeared and driver went offline." This ties B1 and B2 together: fixing B1's error handling (retry + don't silently clear state) also makes B2's rate-limit blips non-fatal instead of stranding either app.

**Fix:**
1. Raise `generalLimiter` from 200/min to something realistic for two concurrently-polling apps sharing an IP during a demo (e.g. 600/min), or move to a **per-user/per-driver token** key instead of per-IP (`keyGenerator` based on the authenticated principal id) so one tester's traffic can't throttle the other's. Per-principal keying is the correct long-term fix — IP-based limiting was never right for two devices on the same network testing concurrently.
2. Reduce steady-state chatter: the 3s location ping and 8s nearby-drivers poll are both candidates to move to a longer interval or event-driven updates (sockets already carry most of this data) — lower priority, follow-up not blocking this fix.
3. Add the socket-based dismissal from Root cause 1 so cancel cycles don't also inflate HTTP traffic via lingering client-side retries/polling tied to a stale request card.

### Files to touch
- `api/src/middleware/rateLimit.middleware.ts` (limit value and/or keying strategy)
- `api/src/modules/rides/rides.service.ts` (`cancelRide` — notify broadcasted drivers directly)
- `api/src/websocket/socket.server.ts` (confirm/add a `sendRequestExpired`-style helper reused for cancellation)
- `apps/driver/src/App.tsx` (listen for the new cancellation-while-pending event, clear `incomingRequest`)

### Verification
- Book, let 2-3 drivers receive the broadcast, cancel before any accepts → confirm all recipients' cards clear within ~1s (socket-driven), not after the full timeout.
- Run rider + driver apps on the same Wi-Fi, do 5 rapid cancel→rebook cycles inside a minute → confirm no 429s in API logs, both apps stay responsive.
- Load-check current per-minute request volume from a real 2-device test session against the new limiter ceiling.

---

## B3 — SOS button placement (driver panel)

### Root cause
`apps/driver/src/components/ui/SOSButton.tsx:33` defaults to `bottom: 100px, right: 16px`. `NavigateToPickup.tsx:251` uses that default; `TripInProgress.tsx:403-407` overrides to `bottom: calc(env(safe-area-inset-bottom) + 224px), right: 16px`. Both sit bottom-right, stacked near/above the primary CTA button ("Arrived at Pickup" / "Complete Trip") and the voice-toggle/nav buttons — cramped and easy to mis-tap during the most safety-critical moment of the trip.

### Fix plan
Move `SOSButton` to a top corner (top-right, clear of the maneuver banner and status pill) on both `NavigateToPickup.tsx` and `TripInProgress.tsx`, using the existing `style` prop override — no component logic changes needed, just the two call-site `style` objects, e.g.:
```tsx
style={{ top: 'max(env(safe-area-inset-top), 2.5rem)', right: '16px', zIndex: 50 }}
```
Check it doesn't collide with the `ManeuverBanner`/status bar at the same top position — likely needs to sit beside it (e.g. `left: '16px'` opposite the status pill, or below it with a fixed offset) rather than directly overlapping. Confirm visually in-browser before calling it done, per the top corner the client asked for.

### Files to touch
- `apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx`
- `apps/driver/src/pages/ActiveRide/TripInProgress.tsx`

### Verification
Visual check on a real/emulated phone viewport at both ride stages — button reachable, not overlapping the maneuver banner, top bar, or primary CTA.

---

## Suggested build order

1. **B3** first — trivial, ships same day, gives the client a visible win.
2. **B1 driver fix (#1, #2, #3 above)** — highest-severity, clearest root cause, self-contained.
3. **B2 rate-limit keying change** — unblocks both B1's error paths and the raw slowdown complaint; do this before #4.
4. **B1 user fix (#4, #5)** + **B2 socket-dismissal fix** — can land together, both touch the cancellation/notification path.

---

## Incidental finding (not in scope, flag separately)
`apps/driver/src/lib/ride-api.ts:183` — `getMyTrips()` calls `api.get('\api\v1\rides\me\trips', ...)` with Windows-style backslashes instead of `/api/v1/rides/me/trips`. This is a broken endpoint path (trip history fetch), unrelated to B1-B3 but worth a one-line fix while in this file.
