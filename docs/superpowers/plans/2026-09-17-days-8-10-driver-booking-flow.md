<!-- /autoplan restore point: "C:\\Users\\sujal\\.gstack\\projects\\cardevelopment01-tech-Ocar-monorepo\\develop-autoplan-restore-20260917-135315.md" -->
# Days 8-10 — Driver: Core Point-to-Point Booking Flow

Source: Section 7 of `docs/superpowers/plans/2026-09-15-react-native-expo-mobile-android-first-spec.md`
("Days 8-10 — Driver: core point-to-point booking"), expanded into a concrete implementation plan.

## Implementation plan

### Context

`apps/driver-mobile` currently has: OTP auth (Days 3-4, done), tab shell (`home`/`earnings`/`profile`),
and a proven Day 5 spike (`services/location/backgroundTask.ts`, `features/go-online/`) confirming
`expo-location`'s background mode survives Android backgrounding/Doze with the two-step
foreground-then-disclosure-then-background permission flow. `services/api`, `services/socket`,
`services/notifications`, and `store/useAuthStore` are already wired (Days 1-4) and don't need
re-plumbing — this phase consumes them, it doesn't rebuild them.

Confirmed backend contracts (read directly from `api/src/modules/rides/rides.routes.ts` and
`api/src/websocket/socket.server.ts`, not assumed):
- `POST /rides/sessions/online` → returns `{ id, ... }` session object (need the session id for
  `location:update`); `POST /rides/sessions/offline`; `GET /rides/sessions/current` (restores state
  on app relaunch if the driver was already online — reuse this instead of re-deriving online state
  from local storage).
- `POST /rides/sessions/location` — HTTP fallback for the location ping; `socket.emit('location:update', { sessionId, lat, lng, heading?, speed?, recordedAt })` is the primary path over the already-open
  connection (same handler backend-side, confirmed at `socket.server.ts:99-118`).
- Socket `ride:request` (payload: `rideId, pickup, drop, pickupLat, pickupLng, distanceToPickup,
  estimatedFare, rideType, isReturnCab, expiresAt, timeoutSeconds`, optionally
  `destinationLat/Lng, returnAt, tripHours, stopCount`), `ride:request:ack` (client → server, just
  `{ rideId }`), `ride:request_expired`.
- **Server already re-delivers pending assignments on reconnect** (`socket.server.ts:120-152`,
  `getPendingAssignmentsForDriver`) — the client does NOT need its own missed-request reconciliation
  logic, just render whatever `ride:request` events arrive. Don't build what the server already does.
- `POST /rides/:id/accept`, `/arrived`, `/start-otp`, `/end-otp`, `/collect-cash`,
  `/cancel-driver`; `GET /rides/me/active` (driver's current active ride, for relaunch-mid-ride
  recovery — same pattern as rider's `/me/active-user` from Days 6-8); `GET /rides/me/trips`,
  `GET /rides/me/earnings-summary`.
- Ride OTPs are 4-digit, SHA-256-hashed server-side (CLAUDE.md) — the driver app only ever sends
  what the driver types, never sees or stores a hash.

### Screens / features to build

1. **Online/offline toggle** (`(tabs)/home.tsx` upgrade) — replaces the Day 5 spike's temporary
   "Location test" card. First time a driver goes online: show `LocationDisclosure` (already built),
   then on accept, call `POST /sessions/online`, store the returned session id, start
   `startBackgroundTracking()` (already built) using that session id for the `location:update` ticks.
   On relaunch, check `GET /sessions/current` first — if a session is already active, restore the
   online UI state and resume tracking instead of assuming offline.
2. **Ride-request handling** (`features/ride-requests/`) — a root-level listener (owned the same
   place `services/socket`'s connect lifecycle already lives, not per-screen) for `ride:request`,
   full-screen incoming-request UI with countdown against `expiresAt`/`timeoutSeconds`, emits
   `ride:request:ack` on display per the server's ack-clears-redelivery contract, accept/reject
   actions. FCM full-screen-while-backgrounded delivery is **explicitly deferred** — see Known risk.
3. **Active-ride flow** (`app/active-ride/`, `features/active-ride/`) — accept → navigate-to-pickup
   → arrived (`POST /:id/arrived`) → start-OTP entry (`POST /:id/start-otp`) → in-progress (emits
   `location:update` at the existing ~3s cadence, reusing `backgroundTask.ts`'s tracking, HTTP
   fallback via `POST /sessions/location` per the master spec) → end-OTP entry (`POST /:id/end-otp`)
   → cash-collection confirmation (`POST /:id/collect-cash`, `collectedAmount`/`notCollected`/`note`
   per CLAUDE.md's payments contract). Optimistic state advance on each action per the master spec's
   binding UX convention (Section 6) — reconcile on the server response, don't block the UI on it.
4. **Relaunch-mid-ride recovery** — `GET /rides/me/active` on app start (after auth hydration);
   if a ride is active, route straight into the matching `active-ride` step instead of the tab shell.
5. **Trip history / earnings summary** (`(tabs)/earnings.tsx` upgrade) — `FlashList` against
   `GET /rides/me/trips` and `GET /rides/me/earnings-summary`, same reused pattern as rider's
   Days 6-8 ride history.

### Explicitly NOT in scope for Days 8-10 (per the master spec's own day boundaries)

- Outstation/rental ride types (`start-return`, package pricing), multi-stop — Days 11-12.
- Real FCM push delivery for ride requests while the app is backgrounded/killed —
  `@react-native-firebase/messaging` isn't installed yet (`services/notifications/index.ts`'s
  existing TODO: blocked on `google-services.json`, which isn't available). Socket-based delivery
  while the app is foregrounded or briefly backgrounded (not killed) is this phase's real scope;
  full push-delivery robustness is Days 13-14 per the master spec.
- Physical-device testing pass, battery-optimization tester instructions, Play Console
  disclosure-video recording — Day 15.

### Known risk carried in from the master spec

The FCM gap above means a ride request can be silently missed if the app is fully killed (not just
backgrounded) during this phase — acceptable per the master spec's own sequencing (push hardening is
explicitly Days 13-14's job, not this phase's), but worth stating plainly rather than glossing over:
this phase's driver experience is "reliable while the app is open or briefly backgrounded," not yet
"reliable when killed."


<!-- autoplan-accepted:ceo -->
- Approach A (direct fill-in per existing feature-folder convention) selected for driver-session state, per 0C-bis.
- Server-side metric on `ride:request` emitted to a disconnected driver socket (Section 8 / 0D cherry-pick #1).
- Forward-compatibility one-line note for Days 13-14 FCM wake-up flow vs this phase's ride-request listener (0D cherry-pick #4).
- Location-tick HTTP fallback must be wired to auto-trigger on `socket.connected === false`, not just exist as an unused option (Section 1).
- `GET /sessions/current` must gate the "Go Online" button (disabled until resolved) to prevent the online-state race with `POST /sessions/online` (Section 4).
- Optimistic lifecycle actions (`arrived`/`start-otp`/`end-otp`/`collect-cash`) must revert UI to last-confirmed status + show inline error on server rejection, not leave an unconfirmed state indefinitely (Section 4, subagent Finding 2).
- Double-tap protection on ride-request Accept/Reject buttons (Section 4).
- Android hardware back-button handling on active-ride screens (no-op or confirm-cancel) (Section 1/4).
- Unit test for the `GET /sessions/current` vs `POST /sessions/online` race-guard logic (Section 6) — pure state logic, vitest-testable without RN rendering.
- Minimum 48dp touch targets on ride-request Accept/Reject buttons (Section 11).
- Lightweight foreground poll fallback for missed ride requests — DEFERRED to TODOS.md, not this phase's scope (0D cherry-pick #2).
<!-- /autoplan-accepted:ceo -->

<!-- autoplan-accepted:design -->
- Incoming-request overlay renders above any active screen at the root navigator level, not scoped to the home tab (Pass 1).
- Full interaction-state table for go-online toggle, incoming-request overlay, active-ride steps, trip completion, and earnings list (Pass 2).
- Dedicated trip-completion screen showing fare earned + tip + "Back to online" CTA — not a silent snap back to the toggle screen (Pass 3, subagent's top journey finding).
- Cash-collection UX: pre-filled expected fare, one-tap "Confirm ₹X collected" primary action, "Didn't collect/partial" secondary path (Pass 3, subagent finding).
- Countdown-expiry visual treatment: circular countdown ring around Accept button, server-`expiresAt`-driven (not client-independent), color escalates primary→warning in final 5 seconds; auto-dismiss with "Request expired" toast at zero (Pass 2/4).
- Persistent online-status indicator (colored dot + label) in tab bar/header, using existing success/ink400 tokens (Pass 4).
- Countdown remaining-seconds value exposed via `accessibilityLabel` on the Accept button, not conveyed by color alone (Pass 6).
- Android back-button on the incoming-request overlay = reject-with-confirm, mirroring the active-ride back-button pattern (Pass 6, subagent finding, distinct from Section 1's active-ride fix).
- Loading state on Go-online toggle: in-toggle spinner (not full-screen) while the session-restore race-guard resolves (Pass 2).
- Socket-disconnect-during-active-ride gets a deliberate visual choice: silent (HTTP fallback is transparent to the driver, matching Section 1/8's "transparent" rescue action) — not a banner, since the location tick still succeeds via fallback and a banner would create false alarm for a non-user-facing failure.
<!-- /autoplan-accepted:design -->

<!-- autoplan-accepted:eng -->
- Explicit error/retry state for `GET /sessions/current` failure — not an infinite disabled-button spinner (Section 1).
- `GET /rides/me/active` failure on relaunch must block with retry, never silently fall through to the tab shell as if no ride were active (Section 1, HIGH severity).
- Countdown ring computed as `timeoutSeconds - elapsed-local-time`, never raw `expiresAt - Date.now()` — clock-skew-safe; Accept always re-validates expiry server-side (Section 1, HIGH severity).
- Losing-an-Accept-race UX: "Already accepted by another driver" inline, disable actions, auto-dismiss after 2s (cross-referenced with Design Phase 2 Pass 2, confirmed to also cover this specific race).
- Debounce the HTTP location-fallback trigger on socket-flapping (>2 continuous seconds disconnected, not every blip) (Section 1).
- Explicit cash-collection field mapping: `collectedAmount` = actual amount, `notCollected` = true only when 0, `note` = required free-text when partial (Section 1).
- Active-ride's four optimistic lifecycle transitions (`arrived`/`start-otp`/`end-otp`/`collect-cash`) implemented as one reducer keyed by server-confirmed status + a pending-optimistic overlay field, not four ad-hoc booleans (Section 1/Code Quality).
- Four new unit tests added to this phase's scope: session-restore race-guard, clock-skew-safe countdown, active-ride reducer transition table, relaunch-mid-ride routing function (Section 3).
- Verify (not build): `ride:request:ack` is scoped to the authenticated driver's own socket session in `socket.server.ts` (Section 3, low/verify-only).
<!-- /autoplan-accepted:eng -->
## Review record

### Phase 1 — CEO Review (Strategy & Scope)

**Mode: SELECTIVE EXPANSION** (context default for "feature enhancement/iteration on existing system" — this phase iterates on the already-scaffolded driver-mobile app, same as Days 6-8's mode).

**System audit (pre-review):** `git log --oneline -30` shows two prior review cycles touching this exact area — `a6b76cb` (full-plan eng review, fixed doc/impl drift) and `75db524` (Days 1-2-5 eng review: fixed orphaned tracking, storage rollback, spike gating). Per the Retrospective Check rule, this means location/socket/storage code in this area has already been problematic once — reviewed more aggressively below (Sections 1, 2, 8). No stashed work, no other open branches touching driver-mobile. One relevant TODO in scope: `services/notifications/index.ts:6` (FCM blocked on `google-services.json`, already accounted for in this plan's "NOT in scope"). One relevant prior learning applied: **"rider-mobile-no-socket-connect-callsite" (confidence 9/10, observed 2026-09-16)** — rider-mobile never calls `connectSocket()` anywhere; this plan must decide driver-mobile's connect-on-online policy explicitly rather than repeating that gap (see Section 1).

**0A. Premise Challenge:**
1. Right problem? Yes — a driver app with auth but no ride-acceptance loop isn't a usable product; this is the critical path, not a proxy problem. Confirmed independently by the CEO subagent (below).
2. Actual outcome: drivers can go online, receive and act on ride requests, complete a trip, and see it reflected in the app. The plan is the most direct path to that.
3. Do-nothing cost: real — Days 11-15 (outstation/push-hardening/device-testing/release) all assume a working driver core loop exists first.

**0B. Existing Code Leverage:** every sub-problem in this plan maps to code that already exists and just needs real logic wired in, not new infrastructure:
| Sub-problem | Existing code |
|---|---|
| Auth/token refresh | `services/api/index.ts`, `store/useAuthStore.ts` (Days 1-4) |
| Socket connect/reconnect/refresh | `services/socket/index.ts` (Days 1-4) |
| Background location start/stop | `services/location/backgroundTask.ts` (Day 5 spike, proven) |
| Permission disclosure flow | `features/go-online/LocationDisclosure.tsx` (Day 5) |
| Room-join-on-reconnect pattern | `@ocar/mobile-shared`'s `useRoomJoin` (built Days 6-8 for rider, explicitly designed to be shared with driver per its own code comment) |
| Push notification channel registration | `services/notifications/index.ts` (Days 1-4, FCM token itself stubbed) |
| Splash-gate-on-hydration pattern | `app/_layout.tsx`'s `hasHydrated` (Days 1-4) — same hook point for relaunch-mid-ride recovery |
Nothing in this plan rebuilds existing code; it fills empty `.gitkeep` directories (`features/ride-requests/`, `features/active-ride/`, `app/active-ride/`) with real logic.

**0C. Dream State Mapping:**
```
CURRENT STATE                      THIS PLAN                           12-MONTH IDEAL
Driver has auth + tab shell +  --> Driver can go online, receive   --> Driver app is a reliable
proven location spike, but no      requests, complete a trip end-       income-generating tool:
real ride-acceptance loop.         to-end via socket while the app      instant, unmissable ride
                                    is foregrounded/briefly backgrounded. alerts (FCM), outstation/
                                    Killed-app delivery is a known gap.  rental support, offline-
                                                                          resilient earnings.
```
This plan moves directly toward that ideal — it is the load-bearing middle step, not a detour.

**0C-bis. Implementation Alternatives (auto-decided per P5 explicit-over-clever + P3 pragmatic — not a close call):**
```
APPROACH A: Direct fill-in (this plan's approach)
  Summary: Wire real logic into the already-scaffolded features/services structure;
           new driver-session state lives in a small new store (mirrors useAuthStore's
           existing zustand+persist pattern), online/ride-request/active-ride are
           separate concerns per the existing feature-folder convention.
  Effort:  M
  Risk:    Low — reuses proven Day 1-5 plumbing, no new architecture
  Pros:    Matches CLAUDE.md's established service-ownership convention; smallest diff;
           consistent with how rider-mobile's Days 6-8 booking flow was built
  Cons:    Session state (online?/sessionId/activeRideId) spread across 2-3 small
           stores/hooks rather than one object

APPROACH B: Unified driver-session FSM
  Summary: One state-machine service owning online/offline, active ride-request, and
           active-ride state as a single typed FSM, replacing the distributed approach.
  Effort:  L
  Risk:    Medium — new abstraction, more code to review/test, delays shipping
  Pros:    Single source of truth for "what is the driver doing right now"
  Cons:    No second driver-flow variant exists yet to justify a generalized FSM
           abstraction (one-implementation-interface smell); duplicates what
           zustand + the existing service-ownership pattern already provide;
           over-engineering per Search-Before-Building's reuse ladder

RECOMMENDATION: Approach A because it reuses proven, already-reviewed code and matches
the codebase's established pattern (CLAUDE.md's service-ownership convention) — Approach
B invents a one-off abstraction Karpathy's Simplicity First guideline and gstack's own
Search-Before-Building ladder both flag as premature (no second use case exists yet).
```
Not a taste decision — the two approaches are not close; B is unjustified complexity for a single driver-flow variant.

**0F. Mode:** SELECTIVE EXPANSION (confirmed, per context default — no user prompt needed, autoplan override).

**0D. Mode-specific analysis (SELECTIVE EXPANSION — HOLD SCOPE baseline first, then cherry-pick scan):**
- Complexity check: plan touches ~15 new files across 3 feature folders + 1 new store — above the 8-file smell threshold by file count, but each file is a single small screen/hook already implied by the master spec's own Day 8-10 scope, not accidental complexity. No reduction warranted.
- Minimum set achieving the goal: exactly what's in "Screens/features to build" — nothing padded.
- Cherry-pick scan (candidates only, not yet in scope):
  1. **Server-side "ride:request fired to disconnected socket" metric** (from CEO subagent Finding 3) — S effort, closes a real visibility gap in the accepted FCM-gap risk. **Auto-decided: ADD to scope** (P2 boil-lakes: in blast radius — touches `broadcast.processor.ts` which this plan already reads from — and <1 day effort).
  2. **Lightweight foreground poll fallback for missed ride requests** (subagent Finding 4) — S-M effort, partial mitigation for the same gap. **Auto-decided: DEFER to TODOS.md** (P3 pragmatic — the metric above already buys visibility cheaply; a poll adds a second delivery path to maintain for a gap that's explicitly scheduled to close in Days 13-14, marginal value for the added complexity right now).
  3. **Explicit rollback/retry UX for failed optimistic lifecycle actions** (subagent Finding 2) — this is not a scope expansion, it's a gap in the existing accepted scope's correctness (Section 4/6 territory) — folded into Section 4 below, not treated as a cherry-pick.
  4. **Forward-compatibility note for Day 13-14 FCM wake-up flow** (subagent Finding 5) — zero-effort, a one-line design note. **Auto-decided: ADD to scope** (trivially in blast radius, prevents Days 13-14 rework).

**0E. Temporal Interrogation:**
```
HOUR 1-2 (foundations):   New driver-session store shape must be decided before any
                          screen work starts (online flag, sessionId, activeRideId) —
                          resolved above in 0C-bis Approach A.
HOUR 3-5 (core logic):    Ride-request countdown timer interacting with app
                          foreground/background transitions (AppState) needs a decision
                          NOW: does the countdown pause when backgrounded, or keep
                          running against server `expiresAt` (source of truth)? Resolved
                          in Section 1 below: server `expiresAt` is authoritative, client
                          timer is cosmetic only — avoids drift/exploit surface.
HOUR 6-8 (integration):   Reconciling `GET /sessions/current` (relaunch) with a fresh
                          `POST /sessions/online` call racing on app start — resolved in
                          Section 4 below.
HOUR 9+ (polish/tests):   Manual verification checklist for the online/offline +
                          ride-request + active-ride flow (RN screens have no automated
                          test harness yet — see existing TODOS.md item, reaffirmed in
                          Section 6 below, not re-litigated).
```

**Dual Voices — CEO:**

CODEX: unavailable (not installed — see Phase 0.5 preflight). No outside-model pass ran.

CLAUDE SUBAGENT (independent CEO reviewer, fresh context, plan-only input): completed, 5 findings (2 medium, 1 high-but-pre-accepted, 2 low-medium). Full report:
1. Reconnect-redelivery premise may not cover full-kill+relaunch case (medium)
2. No stated rollback for failed optimistic lifecycle actions (medium)
3. Missed-request gap is invisible without telemetry (high, pre-accepted risk — needs visibility, not re-scoping)
4. No lightweight poll fallback considered (low-medium)
5. Forward-compatibility of ride-request UI with future FCM wake-up unchecked (low)

```
CEO DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                            Claude   Codex   Consensus
  ──────────────────────────────────── ──────── ─────── ─────────
  1. Premises valid?                   Mostly   N/A     N/A
  2. Right problem to solve?           Yes      N/A     N/A
  3. Scope calibration correct?        Yes      N/A     N/A
  4. Alternatives sufficiently explored?Partial  N/A     N/A
  5. Competitive/market risks covered? Yes(low) N/A     N/A
  6. 6-month trajectory sound?         Yes      N/A     N/A
═══════════════════════════════════════════════════════════════
CONFIRMED = completed subagent + outside; primary cannot replace outside.
Outside disabled/unavailable: six Consensus cells N/A, never CONFIRMED.
[single-model] — Codex unavailable, findings above are subagent-only, weighted accordingly.
```

**Sections 1-10 (full accepted scope, per SELECTIVE EXPANSION mode table):**

**Section 1 — Architecture:**
Dependency graph (new components only):
```
app/_layout.tsx (root, owns lifecycle per Section 3 of master spec)
  └── watches useAuthStore + NEW useDriverSessionStore
        ├── on isOnline=true  → services/location.startBackgroundTracking(sessionId)
        ├── on isOnline=true  → services/socket.connect() + join driver:{id} (server auto-joins)
        └── on activeRideId set → useRoomJoin(socket, `ride:{activeRideId}`)  [reused from mobile-shared]

features/ride-requests/  (NEW)
  └── listens socket 'ride:request' → shows full-screen UI, emits 'ride:request:ack'
      Countdown displayed client-side but AUTHORITATIVE deadline is server `expiresAt`
      (resolved in 0E) — client timer never independently expires a request, it only
      re-renders against the server-given timestamp. Prevents clock-drift bugs.

features/active-ride/  (NEW)
  └── FSM-shaped but NOT a formal FSM class (0C-bis Approach A) — screens keyed off
      useDriverSessionStore.activeRide.status, transitions driven by server responses
```
Data flow (ride-request happy/nil/empty/error paths):
```
HAPPY: socket 'ride:request' event --> features/ride-requests listener --> setState(request)
       --> full-screen UI renders --> emit 'ride:request:ack' --> driver taps Accept
       --> POST /:id/accept --> 200 --> navigate to active-ride flow
NIL:   socket delivers no event (driver offline / not subscribed) --> no UI shown.
       GAP (accepted, pre-existing per master spec): no client-side signal that a
       request *should* have arrived and didn't. Mitigated by the new server-side
       metric added in 0D cherry-pick #1 (visibility, not client-side detection).
EMPTY: payload missing optional fields (destinationLat/Lng, returnAt, tripHours) --
       already handled: master spec's payload shape marks these optional, UI must
       render point-to-point layout when absent (existing pattern, not new).
ERROR: POST /:id/accept fails (already accepted by another driver, network drop) --
       show inline error, do NOT clear the request from view; let it expire naturally
       or let the driver retry accept once. This is a NEW requirement this plan must
       implement (not previously specified) -- added to Implementation Tasks below.
```
State machine (active-ride, informal per Approach A):
```
  [none] --accept--> [accepted] --arrived--> [arrived] --start-otp ok--> [in_progress]
                                                                              |
                                                                          end-otp ok
                                                                              v
                                                                       [collecting_cash]
                                                                              |
                                                                        collect-cash ok
                                                                              v
                                                                           [none]
  Invalid transitions (e.g. start-otp before arrived) are prevented by which screen
  is even reachable -- expo-router's stack navigation, not a runtime guard -- since
  Approach A deliberately has no separate FSM object to guard against. ACCEPTED GAP:
  a driver who navigates back (Android hardware back button) could reach a screen
  out of sequence. Folded into Section 4's interaction edge cases below, not
  re-raised here.
```
Coupling: `features/active-ride` now depends on `services/location` (for the in-progress location:update ticks) -- justified, matches rider-mobile's `useRideTracking` pattern already established. No new coupling to anything outside the existing driver-mobile app.
Security: every new endpoint (`/accept`, `/arrived`, `/start-otp`, `/end-otp`, `/collect-cash`) is already `authenticate()`-gated server-side (confirmed in `rides.routes.ts`) and scoped to `req.driver!.id` inside the service layer -- no new auth surface introduced by this plan, it only calls existing authenticated endpoints.
Production failure scenario: socket disconnects mid-active-ride (tunnel/elevator) -- `location:update` ticks fail silently over the socket; **GAP**: plan's HTTP fallback (`POST /sessions/location`) is mentioned but not wired to auto-trigger on socket disconnect. **Auto-decided fix (P5 explicit, in blast radius):** `services/location`'s tick emitter must fall back to the HTTP POST when `socket.connected === false`, not just "exists as an option" -- added to Implementation Tasks.
Rollback posture: pure client-side app logic, no DB migration -- rollback is a build revert / EAS rollback, no special procedure needed.
Reversibility: 5/5 (two-way door -- purely additive mobile screens, no schema change).

**Section 2 — Error & Rescue Map:**
```
METHOD/CODEPATH                    | WHAT CAN GO WRONG              | EXCEPTION CLASS
------------------------------------|--------------------------------|------------------
POST /sessions/online (goOnline)   | Network timeout                | AxiosTimeoutError
                                    | 409 already online elsewhere   | (existing backend code)
POST /:id/accept                   | 409 already accepted by other  | RIDE_ALREADY_ASSIGNED (existing)
                                    | 401 token expired mid-flow     | handled by createApiClient's
                                    |                                 refresh interceptor (existing)
socket 'location:update' emit      | socket disconnected            | silent no-op (Section 1 GAP)
POST /sessions/location (fallback) | Network timeout                | AxiosTimeoutError

EXCEPTION CLASS         | RESCUED? | RESCUE ACTION                      | USER SEES
-------------------------|----------|-------------------------------------|------------------
AxiosTimeoutError (online)| Y (NEW) | Show inline retry, do not flip      | "Couldn't go online,
                          |          | isOnline=true until 200            | tap to retry"
RIDE_ALREADY_ASSIGNED    | Y (NEW) | Keep request card visible, disable  | "Already accepted by
                          |          | Accept button, show message        | another driver"
socket disconnect (location)| N -> FIXED per Section 1 | fall back to HTTP POST | (transparent)
AxiosTimeoutError (fallback POST)| Y (existing pattern) | drop this tick, next 3s tick retries | (transparent, same as rider)
401 mid-flow              | Y (existing) | createApiClient refresh-and-retry | (transparent)
```
No catch-all `catch (e) {}` proposed anywhere above -- every rescue is named.

**Section 3 — Security & Threat Model:**
Attack surface: zero new endpoints (this plan only calls existing authenticated routes). Input validation: OTP entry fields (`start-otp`, `end-otp`) already validated server-side (4-digit, hashed) per CLAUDE.md -- no new client-side validation logic needed beyond basic "4 digits" input masking, which is a UI nicety not a security control. Authorization: server-side `req.driver!.id` scoping already prevents driver A from acting on driver B's ride (existing, confirmed). No new secrets. No new dependencies beyond `@react-native-firebase/messaging` which is explicitly NOT installed this phase (deferred). No new PII handling beyond what auth already handles. **No findings** -- this phase is pure client wiring against an already-authenticated, already-scoped backend surface.

**Section 4 — Data Flow & Interaction Edge Cases:**
Async ordering (the 0E Hour 6-8 item): `GET /sessions/current` (on app start) racing `POST /sessions/online` (if user taps "Go Online" before the current-session check resolves) --
```
  T0: app start -> GET /sessions/current fires
  T1: (before T0 resolves) user taps "Go Online" -> POST /sessions/online fires
  T2: GET /sessions/current resolves: { active: null }  -- stale, session was just created at T1
  T3: POST /sessions/online resolves: { id: 'sess_123' }
  Race outcome if T2 is handled naively: driver-session store gets overwritten to
  "offline" by the stale T2 response landing after T3.
  MECHANISM PREVENTING VIOLATION (required, per master spec's own async-ordering rule
  from Days 6-8's socket work): gate the "Go Online" button disabled until the initial
  GET /sessions/current resolves (T0 must complete before T1 can start), eliminating
  the race by construction rather than by response-ordering logic. Added to
  Implementation Tasks -- this is a NEW requirement, not previously stated in the plan.
```
Interaction edge cases:
```
INTERACTION              | EDGE CASE                        | HANDLED? | HOW
--------------------------|-----------------------------------|----------|------------------
Ride-request UI           | Double-tap Accept                | N->FIXED | disable button on first tap, per optimistic-advance convention
Ride-request UI           | Request expires while viewing    | Y        | server 'ride:request_expired' event dismisses UI (already in master spec's event list)
Active-ride flow          | Android back button mid-sequence | N->FIXED | intercept hardware back on active-ride screens, no-op or confirm-cancel (matches Section 1's informal-FSM gap)
Active-ride flow          | Optimistic advance, server rejects| N->FIXED | per subagent Finding 2 -- on lifecycle POST failure, revert the optimistic UI state to the last server-confirmed status and show inline error, do not leave UI showing an unconfirmed state indefinitely
Go-online toggle          | Network drop during POST /online | Y (Section 2)| inline retry, no state flip until 200
```

**Section 5 — Code Quality:** New code follows the existing feature-folder convention exactly (no deviation). No DRY violations found -- `useRoomJoin` is correctly reused from `mobile-shared` rather than reimplemented. No over-engineering (0C-bis rejected the one abstraction candidate). No under-engineering beyond the gaps already caught and fixed in Sections 1/2/4 above. No method in this plan's scope branches more than 5 times (screen-level React components, not complex branching logic).

**Section 6 — Test Review:**
```
NEW UX FLOWS: go-online toggle, ride-request accept/reject, active-ride step sequence, earnings list
NEW DATA FLOWS: sessions/online race (Section 4), location:update w/ HTTP fallback (Section 1)
NEW CODEPATHS: optimistic-advance-then-revert (Section 4), disconnected-socket location fallback
NEW BACKGROUND WORK: none new (reuses Day 5's TaskManager task)
NEW INTEGRATIONS: none new (all existing backend endpoints)
NEW ERROR/RESCUE PATHS: per Section 2 table above
```
Testable-now (vitest, pure logic, matches existing `mobile-shared` pattern): the `GET /sessions/current` vs `POST /sessions/online` race-guard logic (Section 4) is pure state logic and CAN be unit tested without RN rendering -- **added to Implementation Tasks** as a concrete, cheap test this phase should actually write (closes part of the existing TODOS.md gap incrementally rather than waiting for the full RN testing setup). Everything else (screen rendering, gesture, native location/socket behavior) remains a manual verification checkpoint per the existing TODOS.md item and Days 3-4/6-8 precedent -- not re-litigated, reaffirmed.
Test ambition (2am-Friday check): the race-guard test above + manually verifying "accept a ride request from two simulated driver sessions, confirm the second gets RIDE_ALREADY_ASSIGNED cleanly" before shipping.

**Section 7 — Performance:** No new DB queries (client-only phase). No new large data structures (ride-request payload is small, single object). `location:update` cadence is already fixed at ~3s (existing, not changed). No connection-pool concerns (client-side). **No findings.**

**Section 8 — Observability & Debuggability:** This is where the accepted cherry-pick (0D #1) lands: **new metric/log** on the backend (`broadcast.processor.ts`, already in this plan's read-scope) when a `ride:request` is emitted to a driver whose socket is not currently connected -- gives visibility into the accepted FCM-gap risk without building FCM early. Client-side: log (not just silently no-op) when the location-tick HTTP fallback fires (Section 1 fix), so a support engineer can tell from logs whether a driver's poor location accuracy during a shift was a socket-outage artifact. Both added to Implementation Tasks.

**Section 9 — Deployment & Rollout:** No DB migration. No feature flag needed (this is the first working version of driver ride-handling, nothing to toggle against). Rollout order: none (client-only). Rollback: EAS rollback / build revert. Deploy-time risk window: N/A (mobile client, not a shared server deploy). Post-deploy check: manual smoke test of go-online -> receive request -> complete ride on a physical device before wider internal-testing distribution (ties into Day 15's device-testing pass, not duplicated here). **No new findings beyond the existing master-spec Day 15 process.**

**Section 10 — Long-Term Trajectory:** Debt introduced: the informal-FSM gap (Section 1) and the accepted FCM-gap (Days 13-14) are both named, tracked debt, not silent debt. Path dependency: low -- Approach A's structure doesn't lock out a future formal FSM if driver flows grow more complex (e.g. multi-stop pickup chaining), it just doesn't build one prematurely. Reversibility: 5/5. 1-year question: a new engineer reading this in 12 months would find the driver/rider structural parity (same `useRoomJoin`, same service-ownership convention) obvious and consistent -- this plan reinforces an existing pattern rather than forking a new one.

**Section 11 — Design & UX Review (UI scope detected):**
Information architecture: online toggle is the single, primary action on the driver home tab -- correct hierarchy (a driver's first need is "can I start earning"). Incoming ride-request is a full-screen interrupt (correct -- this is the highest-priority interaction in the whole app, deserves to dominate the screen, matches ride-hailing industry convention). Interaction state coverage:
```
FEATURE            | LOADING            | EMPTY           | ERROR                | SUCCESS         | PARTIAL
--------------------|---------------------|-----------------|------------------------|-----------------|------------------
Go-online toggle    | disabled+spinner    | n/a             | inline retry (Sec 2)  | toggle flips on | n/a
Ride-request UI     | n/a (event-driven)  | n/a             | accept-fails message  | navigate to trip| expired-mid-view (handled, Sec 4)
Active-ride flow     | button spinner per step | n/a         | revert+retry (Sec 4)  | advance to next step | n/a
Earnings/trips list | Skeleton (FlashList, per master spec)| EmptyState ("No trips yet") | ErrorState+retry | list renders | n/a
```
AI slop risk: low -- this reuses the project's actual indigo-family design tokens (`packages/mobile-shared/src/theme/tokens.ts`), not generic defaults. DESIGN.md alignment: consistent (same tokens as rider-mobile). Responsive: N/A beyond standard phone-width RN layout, no tablet requirement stated anywhere in the master spec. Accessibility: full-screen ride-request UI must have adequate touch-target size on Accept/Reject given it's often tapped in a moving vehicle -- **added to Implementation Tasks** as a concrete acceptance criterion (min 48dp touch targets, matches Material Design guidance, not a new invented standard).
Required diagram: user flow already covered by the state machine ASCII diagram in Section 1 (screens ARE the states in Approach A).

**"NOT in scope" section:**
- Outstation/rental, multi-stop -- Days 11-12 (unchanged from original plan).
- Real FCM push delivery -- Days 13-14 (unchanged from original plan; visibility metric added in 0D #1 partially mitigates in the meantime).
- Lightweight foreground poll fallback for missed requests -- deferred to TODOS.md (0D #2), marginal value given the metric already buys visibility and Days 13-14 closes the real gap.
- A formal driver-session FSM class (0C-bis Approach B) -- rejected as premature abstraction, not deferred (no second use case exists to justify it).
- Physical-device testing, battery-optimization tester instructions, Play Console disclosure video -- Day 15 (unchanged).
- Full RN component/screen automated test coverage -- existing TODOS.md item, not re-scoped here; one new unit-testable piece (the online-race guard) is pulled into this phase's scope per Section 6, the rest stays manual-verification per precedent.

**"What already exists" section:** see 0B Existing Code Leverage table above -- every sub-problem maps to already-built, already-reviewed Days 1-5 code; this phase adds zero new services/infrastructure classes, only screens/hooks that consume them.

**Dream state delta:** After this phase, the system is one step from the 12-month ideal: real-time ride handling works end-to-end except for killed-app push delivery (Days 13-14) and multi-ride-type support (Days 11-12). No architectural rework required to close either gap -- both are additive.

**Error & Rescue Registry:** see Section 2 table (complete).

**Failure Modes Registry:**
```
CODEPATH                          | FAILURE MODE                | RESCUED? | TEST? | USER SEES?         | LOGGED?
------------------------------------|------------------------------|----------|-------|----------------------|--------
GET /sessions/current vs POST /online race | stale response overwrites online state | Y (FIXED, Sec 4) | Y (added, Sec 6) | n/a (prevented)     | n/a
location:update over disconnected socket | silent tick loss        | Y (FIXED, Sec 1) | manual  | n/a (transparent)   | Y (FIXED, Sec 8)
ride:request to disconnected driver | request silently missed     | ACCEPTED GAP (Days 13-14 closes it) | n/a | driver sees nothing (accepted) | Y (FIXED, Sec 8 metric)
Optimistic lifecycle action, server rejects | UI shows unconfirmed state indefinitely | Y (FIXED, Sec 4) | manual | inline error + revert | existing error toast pattern
Double-tap Accept on ride-request  | double POST /accept          | Y (FIXED, Sec 4) | manual | n/a (second tap no-ops) | n/a
```
No row is RESCUED=N + TEST=N + USER SEES=Silent -- the one accepted gap (missed request) is explicitly named as accepted, not silent-by-omission, and now has logging (Section 8).

**Completion Summary:**
```
+====================================================================+
|            MEGA PLAN REVIEW — COMPLETION SUMMARY (CEO)              |
+====================================================================+
| Mode selected        | SELECTIVE EXPANSION                          |
| System Audit         | 2 prior review cycles in this area; 1 relevant TODO; 1 relevant pitfall learning applied |
| Step 0               | Approach A (direct fill-in) selected over Approach B (FSM) -- not close |
| Section 1  (Arch)    | 2 issues found (socket-disconnect location fallback not wired; informal-FSM back-button gap) |
| Section 2  (Errors)  | 5 error paths mapped, 0 unrescued GAPS after fixes |
| Section 3  (Security)| 0 issues found |
| Section 4  (Data/UX) | 5 edge cases mapped, 0 unhandled after fixes (1 race condition fixed) |
| Section 5  (Quality) | 0 issues found |
| Section 6  (Tests)   | Diagram produced, 1 new unit-testable piece pulled into scope |
| Section 7  (Perf)    | 0 issues found |
| Section 8  (Observ)  | 2 gaps found, both fixed (missed-request metric, fallback-tick logging) |
| Section 9  (Deploy)  | 0 new risks beyond existing Day 15 process |
| Section 10 (Future)  | Reversibility: 5/5, debt items: 2 (both named/tracked, not silent) |
| Section 11 (Design)  | 1 issue found (touch-target size), fixed |
+--------------------------------------------------------------------+
| NOT in scope         | written (6 items)                            |
| What already exists  | written                                      |
| Dream state delta    | written                                       |
| Error/rescue registry| 5 methods, 0 CRITICAL GAPS                   |
| Failure modes        | 5 total, 0 CRITICAL GAPS                     |
| TODOS.md updates     | 1 item proposed (foreground poll fallback)   |
| Scope proposals      | 4 proposed, 2 accepted, 1 deferred, 1 rejected |
| CEO plan             | written (see below)                          |
| Outside voice        | Codex unavailable; Claude subagent completed, 5 findings incorporated |
| Lake Score           | 2/2 -- both close-call decisions (Approach A vs B, poll vs metric) chose the option that best served the actual goal, not just the smaller diff |
| Diagrams produced    | 4 (dependency graph, data flow w/ shadow paths, state machine, async-ordering schedule) |
| Stale diagrams found | 0 |
| Unresolved decisions | 0                                             |
+====================================================================+
```

**TODOS.md update (auto-decided, added):** "Lightweight foreground poll fallback for missed ride requests" -- What: poll `GET /rides/me/active`-adjacent pending-request endpoint (or equivalent) every N seconds while driver is online and app is foregrounded, as a partial mitigation for missed `ride:request` socket events. Why: cheap partial closure of the accepted FCM-gap risk before Days 13-14 lands. Pros: nearly free, foreground-only so no battery cost. Cons: doesn't help backgrounded/killed case (that's still FCM's job); adds a second delivery path to reason about. Context: surfaced during Days 8-10 CEO review as a cherry-pick candidate, deferred because the accepted visibility metric (Section 8) already buys awareness of the gap's real frequency before investing further. Effort: S (human) -> S (CC). Priority: P3. Depends on: nothing; natural trigger point is if the Section 8 metric shows missed-request volume is non-trivial before Days 13-14 ships.

<!-- autoplan-accepted:ceo -->
- Approach A (direct fill-in per existing feature-folder convention) selected for driver-session state, per 0C-bis.
- Server-side metric on `ride:request` emitted to a disconnected driver socket (Section 8 / 0D cherry-pick #1).
- Forward-compatibility one-line note for Days 13-14 FCM wake-up flow vs this phase's ride-request listener (0D cherry-pick #4).
- Location-tick HTTP fallback must be wired to auto-trigger on `socket.connected === false`, not just exist as an unused option (Section 1).
- `GET /sessions/current` must gate the "Go Online" button (disabled until resolved) to prevent the online-state race with `POST /sessions/online` (Section 4).
- Optimistic lifecycle actions (`arrived`/`start-otp`/`end-otp`/`collect-cash`) must revert UI to last-confirmed status + show inline error on server rejection, not leave an unconfirmed state indefinitely (Section 4, subagent Finding 2).
- Double-tap protection on ride-request Accept/Reject buttons (Section 4).
- Android hardware back-button handling on active-ride screens (no-op or confirm-cancel) (Section 1/4).
- Unit test for the `GET /sessions/current` vs `POST /sessions/online` race-guard logic (Section 6) — pure state logic, vitest-testable without RN rendering.
- Minimum 48dp touch targets on ride-request Accept/Reject buttons (Section 11).
- Lightweight foreground poll fallback for missed ride requests — DEFERRED to TODOS.md, not this phase's scope (0D cherry-pick #2).
<!-- /autoplan-accepted:ceo -->

**Phase 1 complete.**
Codex: unavailable (not installed). Claude subagent: completed, 5 findings (2 medium, 1 high-pre-accepted, 2 low-medium), all incorporated above.
Consensus: N/A (outside unavailable) — subagent findings applied via [single-model] weighting; 0 disagreements requiring gate escalation.
Passing to Phase 2.

### Phase 2 — Design Review (UI scope detected)

**Mockup generation deliberately skipped (deviation, stated plainly):** the gstack designer binary is available (`DESIGN_READY`), and its default per this skill is to generate AI mockups for any plan with UI scope. Skipped here because this phase introduces zero new visual design decisions — every screen is a composition of already-implemented, already-approved `packages/mobile-shared` UI primitives (`Button`, `Card`, `Skeleton`, `EmptyState`, `ErrorState`) and the same indigo-family design tokens already visually established and shipped in rider-mobile's Days 6-8 work. Generating fresh AI mockups for screens built from an already-consistent, already-implemented component set would produce no new design information, and the board-based approval flow requires live human interaction with a served HTML comparison board — which would stall this otherwise-automated review pipeline for a step that has nothing new to decide visually. Proceeding with text-based review per the skill's own explicit fallback ("Design mockups are a progressive enhancement, not a hard requirement").

**Step 0 — Design Scope Assessment:**
- **0A. Initial rating: 4/10** on design completeness. Backend contracts are unusually specific (exact routes, payloads, line numbers), but the plan is almost silent on what the user actually *sees and feels* at its two highest-emotion moments (getting a job, getting paid) — confirmed independently by the design subagent below. A 10 would specify every interaction state, the countdown's visual treatment, and the cash-collection/completion UX concretely enough that three different engineers would build the same thing.
- **0B. DESIGN.md status:** exists (`DESIGN.md` at repo root) — all fixes below calibrated against its indigo-family tokens (`packages/mobile-shared/src/theme/tokens.ts`), not invented values.
- **0C. Existing design leverage:** `Button`/`Card`/`Skeleton`/`EmptyState`/`ErrorState` from `packages/mobile-shared/src/ui` (already used identically in rider-mobile's `RideHistoryList.tsx` — confirmed by direct read), the same tab-shell/full-screen-modal navigation pattern already established in rider-mobile's booking flow.
- **0D. Focus areas (no user interrupt needed — SELECTIVE EXPANSION override applies focus automatically):** the two clusters the design subagent flagged as high-severity — (1) interaction-state specificity (countdown expiry, cash-collection input, completion/reward screen) and (2) concrete visual treatment (colors, urgency escalation, button hierarchy) — get full treatment below; lower-severity items get a fix + one-line rationale.

**Dual Voices — Design:**
CODEX: unavailable (not installed).
CLAUDE SUBAGENT (independent design reviewer, fresh context): completed. Findings: 2 high (countdown-expiry state undefined; cash-collection input UX undefined, plus overall UI-specificity gap), 6 medium (overlay priority, session-restore loading state, socket-disconnect visual indicator, inline-error placement, missing reward/completion screen, back-button on request screen), 1 low-medium (trip-history empty state).

```
DESIGN OUTSIDE VOICES — LITMUS SCORECARD:
═══════════════════════════════════════════════════════════════
  Check                                    Claude  Codex  Consensus
  ─────────────────────────────────────── ─────── ─────── ─────────
  1. Brand unmistakable in first screen?   N/A*    N/A    N/A
  2. One strong visual anchor?             N/A*    N/A    N/A
  3. Scannable by headlines only?          N/A*    N/A    N/A
  4. Each section has one job?             YES     N/A    N/A
  5. Cards actually necessary?             YES     N/A    N/A
  6. Motion improves hierarchy?            N/A*    N/A    N/A
  7. Premium without decorative shadows?   N/A*    N/A    N/A
  ─────────────────────────────────────── ─────── ─────── ─────────
  Hard rejections triggered:               0       N/A    N/A
═══════════════════════════════════════════════════════════════
* This litmus set is written for marketing/landing-page classification (PERSUADE
  mode). This plan is APP UI (OPERATE mode, per Pass 4's classifier) -- utility
  screens for a working driver, not a first-impression/brand moment. Marked N/A
  rather than forced answers per the classifier's own instruction to judge each
  surface against its matching rule set, not the marketing checklist.
[single-model] -- Codex unavailable, findings above are subagent-only.
```

**Passes 1-7:**

**Pass 1 — Information Architecture: 6/10 → 9/10 after fixes.** Gap (per subagent finding 1, auto-fixed as structural per override): the plan doesn't state that the incoming-request screen must overlay above *any* current screen, not just the home tab. **Fix (applied):** ride-request listener renders as a full-screen overlay mounted at the root navigator level (same root that owns socket/location lifecycle, per Section 1's architecture), above whatever tab/screen is active -- a driver mid-earnings-check must see an incoming request exactly as fast as one sitting on the home tab. Screen/state hierarchy:
```
  Idle (home tab, offline)
    -> Go online (loading -> online, per Pass 2)
        -> [any screen] -- ride:request arrives --> Full-screen request overlay (highest z-order, interrupts everything)
            -> Accept --> Active-ride flow (arrived -> start-otp -> in-progress -> end-otp -> cash-collect -> completion, per Pass 3)
            -> Reject/expire --> back to whatever screen was active underneath
```

**Pass 2 — Interaction State Coverage: 5/10 → 9/10 after fixes.** Interaction state table (fixes applied per subagent findings 1, 2, 3, 5, 6):
```
FEATURE                | LOADING                          | EMPTY              | ERROR                        | SUCCESS                     | PARTIAL
------------------------|-----------------------------------|---------------------|--------------------------------|-------------------------------|------------------
Go-online toggle        | Spinner IN the toggle (not full-  | n/a                | Inline retry text below toggle| Toggle flips to "Online" +  | n/a
                        | screen) while GET /sessions/current |                    | ("Couldn't go online, tap to  | green indicator dot          |
                        | resolves and gates the button (Pass |                    | retry")                        |                              |
                        | 7 decision)                        |                    |                                 |                              |
Incoming-request overlay| n/a (event-driven, appears instantly)| n/a             | "Already accepted by another  | Navigates to active-ride flow| Request expires mid-view:
                        |                                    |                    | driver" inline, buttons       |                              | countdown ring hits zero ->
                        |                                    |                    | disabled, auto-dismiss after 2s|                              | auto-dismiss with a brief
                        |                                    |                    |                                |                              | "Request expired" toast (Pass 4 fix)
Active-ride steps       | Button-local spinner per step      | n/a                | Revert to last-confirmed step | Advance to next step         | n/a
                        | (arrived/start-otp/end-otp/cash)   |                    | + inline banner ("Couldn't    |                                |
                        |                                    |                    | confirm, try again")           |                                |
Trip completion         | n/a                                | n/a                | n/a                            | Completion screen: fare      | n/a
                        |                                    |                    |                                | earned, tip if any, "Back to |
                        |                                    |                    |                                | online" CTA (Pass 3 fix)     |
Earnings/trips list     | Skeleton (FlashList, existing      | EmptyState ("No   | ErrorState + retry (existing  | List renders                | n/a
                        | pattern)                            | trips yet" -- exact| pattern, confirmed reused     |                                |
                        |                                    | reused copy from   | from RideHistoryList.tsx)     |                                |
                        |                                    | rider's pattern)   |                                |                                |
```

**Pass 3 — User Journey & Emotional Arc: 4/10 → 8/10 after fixes.** Journey storyboard (fixes applied per subagent finding: the reward moment, the plan's single biggest journey gap):
```
STEP | USER DOES              | USER FEELS            | PLAN SPECIFIES?
-----|-------------------------|------------------------|------------------
1    | Taps "Go Online"       | Hopeful, a little      | Yes (Pass 2 loading/error states)
     |                         | anxious ("will it work")|
2    | Waits for a request    | Idle anxiety, checking  | Partially -- no persistent
     |                         | phone periodically      | online-status indicator spec (Pass 5 fix)
3    | Incoming request fires | Urgency, quick decision | Yes, fully (Pass 1/2/4 fixes)
     |                         | pressure                |
4    | Accepts, drives to     | Purposeful, committed   | Yes (existing plan + Section 4 back-
     | pickup, runs the trip  |                          | button fix from Section 1 review)
5    | Collects cash          | Wants this to be FAST   | Fixed this pass: pre-filled expected
     |                         | and low-friction, not   | fare amount, one-tap "Confirm ₹X
     |                         | a typing chore          | collected" primary action, "Didn't
     |                         |                          | collect / partial" as secondary path
     |                         |                          | (subagent finding, high severity)
6    | Sees the trip complete | Reward, closure --       | FIXED this pass (was completely
     |                         | "that's why I do this"  | missing): dedicated completion screen
     |                         |                          | showing fare earned + tip (if any) +
     |                         |                          | explicit "Back to online" CTA, not a
     |                         |                          | silent snap back to the toggle screen
```
Time-horizon check: 5-second (visceral) -- the request overlay's countdown ring is the make-or-break element, now specified (Pass 4). 5-minute (behavioral) -- cash-collection friction now minimized (one-tap confirm). 5-year (reflective) -- a driver who consistently sees clear "you earned X" moments builds trust in the app being fair and transparent about pay, which is the single biggest driver-retention lever in gig-work apps generically (not this app specifically -- stated as reasoning, not a market claim).

**Pass 4 — AI Slop Risk: N/A hard-rejection scan (classifier: OPERATE / APP UI, not PERSUADE) → 8/10 on specificity after fixes.** Classifier: this is APP UI (dashboards/tools a working driver operates to finish a task), not a marketing surface -- App UI Rules apply (calm surface hierarchy, dense-but-readable, utility copy, cards only when card IS the interaction), not the landing-page hero/brand rules. Zero hard-rejection patterns apply (no card grids, no marketing hero, no carousel -- this is a functional tool). Specificity gap (per subagent, this plan's single biggest gap category) fixed via concrete decisions below:
- **Countdown-expiry visual treatment (fix, subagent's top finding):** a circular countdown ring around the Accept button (fills clockwise → depletes counter-clockwise as `expiresAt` approaches, driven by the server timestamp per Section 1's "server-authoritative deadline" architecture decision, not a client-independent timer), ring color escalates `colors.primary` → `colors.warning` in the final 5 seconds (existing tokens, `packages/mobile-shared/src/theme/tokens.ts`, not invented values) -- gives urgency without inventing new visual language.
- **Persistent online-status indicator (fix, closes Pass 3's journey gap):** a small colored dot + label in the tab bar/header (`colors.success` filled = online, `colors.ink400` outline = offline) -- existing token reuse, not a new component.
- **Disabled-button visual during session-restore race-guard (fix, subagent finding):** standard `opacity: 0.5` disabled state already defined in `packages/mobile-shared/src/ui/Button.tsx` -- reused as-is, no new pattern needed (confirmed by direct read of the existing component).

**Pass 5 — Design System Alignment: 7/10 → 9/10 after fixes.** DESIGN.md exists; every fix above cites existing tokens (`colors.primary`, `colors.warning`, `colors.success`, `colors.ink400`) rather than inventing new values -- no new component types introduced (countdown ring uses Reanimated's existing driver-marker-animation pattern already established in rider-mobile's `LiveMarker.tsx`, ref-driven not React-state-driven, matching the master spec's binding convention). Remaining 1-point gap: the completion/reward screen (Pass 3 fix) is a genuinely new screen type not yet precedented elsewhere in either app -- flagged, not blocking, since it composes entirely from existing `Card`/`Button`/typography tokens.

**Pass 6 — Responsive & Accessibility: 6/10 → 9/10 after fixes.** Touch targets: minimum 48dp on Accept/Reject already accepted in CEO Phase 1 (Section 11) -- carried forward, not re-asked. Responsive: standard phone-width RN layout, no tablet requirement anywhere in the master spec (confirmed, not assumed). Accessibility fix (auto-applied, structural): the countdown ring must not be the *only* signal of urgency -- screen-reader users need the remaining-seconds value exposed via `accessibilityLabel` on the Accept button (e.g. "Accept ride, 12 seconds remaining"), updated on each tick; color-escalation alone (Pass 4) is insufficient for colorblind/screen-reader users. Android back-button handling on the incoming-request overlay itself (subagent finding, distinct from Section 1's active-ride back-button fix): back = reject-with-confirm, mirroring the active-ride pattern rather than leaving it unspecified.

**Pass 7 — Unresolved Design Decisions:**
```
DECISION NEEDED                                    | IF DEFERRED, WHAT HAPPENS
----------------------------------------------------|---------------------------
(none remain unresolved -- all findings above were   | n/a
structural/missing-state gaps, auto-fixed per the
SELECTIVE EXPANSION override's "structural issues:
auto-fix" rule; no aesthetic/taste calls arose that
would require a TASTE DECISION at the gate)
```

**"NOT in scope" (design):** Full visual mockups / AI-generated imagery -- deliberately skipped, reasoning stated at the top of this phase. A dedicated design system review of the new completion/reward screen pattern once it's actually built -- deferred to `/design-review` post-implementation per this skill's own "Post-Implementation Design Audit" convention, not re-litigated here.

**"What already exists" (design):** `DESIGN.md` token system, `packages/mobile-shared/src/ui` component set (`Button`, `Card`, `Skeleton`, `EmptyState`, `ErrorState`), rider-mobile's `RideHistoryList.tsx` (empty/error state reference), rider-mobile's `LiveMarker.tsx` (ref-driven Reanimated animation reference for the new countdown ring).

**Completion Summary:**
```
+====================================================================+
|         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
+====================================================================+
| System Audit         | DESIGN.md exists; UI scope confirmed (4 "screen" matches) |
| Step 0               | Initial rating 4/10; focus: interaction-state specificity + visual treatment |
| Pass 1  (Info Arch)  | 6/10 → 9/10 after fixes                     |
| Pass 2  (States)     | 5/10 → 9/10 after fixes                     |
| Pass 3  (Journey)    | 4/10 → 8/10 after fixes                     |
| Pass 4  (AI Slop)    | 0 hard rejections (APP UI, not PERSUADE); specificity 8/10 after fixes |
| Pass 5  (Design Sys) | 7/10 → 9/10 after fixes                     |
| Pass 6  (Responsive) | 6/10 → 9/10 after fixes                     |
| Pass 7  (Decisions)  | 0 resolved via question, 0 deferred (all auto-fixed as structural) |
+--------------------------------------------------------------------+
| NOT in scope         | written (2 items)                           |
| What already exists  | written                                     |
| TODOS.md updates     | 0 new (all fixes landed in this phase's scope) |
| Approved Mockups     | 0 generated (deliberately skipped, reasoning stated) |
| Decisions made       | 10 added to plan (all auto-fix, structural)  |
| Decisions deferred   | 0                                            |
| Overall design score | 4/10 → 8/10 (lowest of passes 1-6 after fixes) |
+====================================================================+
```

<!-- autoplan-accepted:design -->
- Incoming-request overlay renders above any active screen at the root navigator level, not scoped to the home tab (Pass 1).
- Full interaction-state table for go-online toggle, incoming-request overlay, active-ride steps, trip completion, and earnings list (Pass 2).
- Dedicated trip-completion screen showing fare earned + tip + "Back to online" CTA — not a silent snap back to the toggle screen (Pass 3, subagent's top journey finding).
- Cash-collection UX: pre-filled expected fare, one-tap "Confirm ₹X collected" primary action, "Didn't collect/partial" secondary path (Pass 3, subagent finding).
- Countdown-expiry visual treatment: circular countdown ring around Accept button, server-`expiresAt`-driven (not client-independent), color escalates primary→warning in final 5 seconds; auto-dismiss with "Request expired" toast at zero (Pass 2/4).
- Persistent online-status indicator (colored dot + label) in tab bar/header, using existing success/ink400 tokens (Pass 4).
- Countdown remaining-seconds value exposed via `accessibilityLabel` on the Accept button, not conveyed by color alone (Pass 6).
- Android back-button on the incoming-request overlay = reject-with-confirm, mirroring the active-ride back-button pattern (Pass 6, subagent finding, distinct from Section 1's active-ride fix).
- Loading state on Go-online toggle: in-toggle spinner (not full-screen) while the session-restore race-guard resolves (Pass 2).
- Socket-disconnect-during-active-ride gets a deliberate visual choice: silent (HTTP fallback is transparent to the driver, matching Section 1/8's "transparent" rescue action) — not a banner, since the location tick still succeeds via fallback and a banner would create false alarm for a non-user-facing failure.
<!-- /autoplan-accepted:design -->

**Phase 2 complete.**
Codex: unavailable (not installed). Claude subagent: completed, 9 findings (2 high, 6 medium, 1 low-medium), all incorporated as structural auto-fixes.
Consensus: N/A (outside unavailable) — 0 disagreements, 0 taste decisions requiring gate escalation.
Passing to Phase 2.5 (DX Review) — DX scope was detected in Phase 0.

### Phase 2.5 — DX Review (scope re-examined, treated as inapplicable)

**Finding, before running any pass:** Phase 0's DX-scope detection (`dxRequired: true`, matches on the terms "API" ×3, "shell" ×2, "package" ×1, "action" ×1, threshold 2+) is a false positive from generic technical vocabulary in this plan's backend-contract descriptions (REST API routes, `google-services.json`, optimistic UI actions) — not a signal that this plan produces a developer-facing product. Read directly against the `/plan-devex-review` methodology's own stated scope ("developer-facing products: APIs, CLIs, SDKs, libraries, platforms, docs" — an external developer installing/integrating something), this plan builds a driver-facing mobile app screen (ride-request handling, cash collection) for gig drivers, not a tool other developers install or integrate against. Its core evaluation apparatus — Time to Hello World benchmarks, "SDK completeness," CLI ergonomics, README/getting-started friction, upgrade/migration guides for external consumers — has no referent here: there is no SDK, no CLI, no external installer, no third-party integrator.

**Decision (auto-decided, not a taste call):** treat this phase as inapplicable rather than force answers to questions that don't map onto a driver mobile screen (e.g. "time to hello world" for a ride-request UI, or "SDK completeness" for a React Native feature folder). This is the same judgment the CEO/Design phases already exercise when a section has "zero findings" — the honest output here is "the dimension doesn't apply," not a manufactured score. No structural DX-relevant finding exists to lose by skipping (the one genuinely adjacent concern — will the next engineer picking up this plan find it clear and complete — is already covered by the CEO phase's Section 5/6 code-quality and test-review passes, and by this plan's own unusually specific backend-contract sourcing noted independently by both outside voices in Phases 1 and 2).

**Dual Voices — DX:** Not dispatched. Given the scope-mismatch finding above, dispatching subagent/Codex calls to answer TTHW/SDK/CLI questions about a mobile ride-request screen would manufacture findings against inapplicable criteria rather than produce a genuine independent read — the honest action is not to ask the question, not to force an answer to it. `outside_status: skipped` for this phase (not "unavailable" — this is a scope decision, not a provider failure).

**Completion Summary (DX):**
```
+====================================================================+
|         DX PLAN REVIEW — COMPLETION SUMMARY                        |
+====================================================================+
| System Audit         | DX scope flagged by keyword match only (API/shell/package/action) |
| Scope re-examination | This is a driver-facing mobile app screen, not a developer-facing product (no SDK/CLI/external integrator) |
| Passes 1-8           | Not run — inapplicable per scope re-examination, not skipped for convenience |
+--------------------------------------------------------------------+
| NOT in scope         | Full DX pass (TTHW/SDK/CLI/docs benchmarks) — inapplicable to this plan's product type |
| Overall DX score     | N/A — dimension does not apply, not scored as low |
+====================================================================+
```

**Phase 2.5 complete.**
DX overall: N/A (scope re-examined as inapplicable, not scored).
Codex: skipped (scope decision, not a provider failure). Claude subagent: not dispatched (same reason).
Consensus: N/A.
Passing to Phase 3 (Eng Review — the required gate reviews the final amended plan).

### Phase 3 — Eng Review (required gate, reviews the final amended plan)

**Step 0 — Scope Challenge:**
1. Existing code leverage: see CEO Phase 1's 0B table — every sub-problem maps to already-built Days 1-5 code; nothing here is a parallel rebuild.
2. Minimum set of changes: matches "Screens/features to build" exactly, no padding, already stress-tested by CEO Phase 1's 0C-bis alternatives analysis.
3. **Complexity check triggers**: ~15 new files across 3 feature folders + 1 new store — above the 8-file smell threshold. **Auto-decided: proceed as scoped, do not reduce** (autoplan override "Scope challenge: never reduce (P2)" — mechanical, not a taste call; CEO Phase 1 already ran this exact complexity check and concluded the file count reflects the master spec's own Day 8-10 boundary, not accidental sprawl).
4. Search check: no new architectural pattern introduced beyond what's already established (socket room-join, background location, optimistic UI) — all proven Layer-1 patterns already in this codebase, no framework-built-in vs custom-rolled question arises.
5. TODOS cross-reference: the existing "RN component testing" TODO is not blocking (per its own stated trigger point, already reaffirmed in CEO Phase 1 Section 6); this phase's new unit-testable logic (below) makes incremental progress on it without waiting for the full setup.
6. Completeness check: plan is the complete version already (CEO Phase 1 rejected the one "shortcut" candidate — a formal driver-session FSM — as the *wrong direction*, not as a completeness cut; nothing here is a knowingly-incomplete shortcut).
7. Distribution check: N/A — no new artifact type, ships as part of the existing driver-mobile Android build pipeline (Day 15 EAS build per master spec).

**Dual Voices — Eng:**
CODEX: unavailable (not installed).
CLAUDE SUBAGENT (independent eng reviewer, fresh context): completed. Findings: 2 high (no error path for `GET /rides/me/active` on relaunch — silently strands a driver mid-ride if the check itself fails, not just returns empty; countdown clock-skew — comparing local `Date.now()` to server `expiresAt` directly is wrong, must anchor off `timeoutSeconds` + local receipt time), 1 medium-architecture (Go-online gating on `GET /sessions/current` has no stated failure path — button could stay disabled forever on a timeout), 3 medium (losing-Accept-race UX unspecified; socket-flapping could double-fire the HTTP location fallback; partial-cash-collection field mapping ambiguous), 1 low/verify-only (confirm `ride:request:ack` is scoped to the authenticated driver's own socket, not just assumed), plus a hidden-complexity recommendation: treat the four active-ride optimistic transitions (`arrived`/`start-otp`/`end-otp`/`collect-cash`) as one reducer keyed by server-confirmed status with a pending-optimistic overlay, not four independent ad-hoc flags.

```
ENG DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?               Yes*    N/A    N/A
  2. Test coverage sufficient?         Partial N/A    N/A
  3. Performance risks addressed?      Yes     N/A    N/A
  4. Security threats covered?         Yes     N/A    N/A
  5. Error paths handled?              No      N/A    N/A
  6. Deployment risk manageable?       Yes     N/A    N/A
═══════════════════════════════════════════════════════════════
* sound overall, with the reducer-vs-four-flags refinement noted above
[single-model] -- Codex unavailable, findings above are subagent-only.
```

**Section 1 — Architecture (auto-decided fixes, all P5 explicit-over-clever / P2 in-blast-radius):**

Dependency graph (extends CEO Phase 1's Section 1 diagram with the two new fixes below):
```
app/_layout.tsx (root)
  └── watches useAuthStore + useDriverSessionStore
        ├── on mount: GET /sessions/current
        │     ├── success -> resolve isOnline, gate "Go Online" button enabled
        │     └── FAILURE (network/timeout) -> FIXED THIS PHASE: show "Couldn't check
        │         status" inline retry on the toggle itself, keep button disabled but
        │         NOT silently forever -- a visible retry affordance, not an infinite
        │         spinner (Eng subagent finding, architecture)
        ├── on mount (after auth hydration): GET /rides/me/active
        │     ├── 200, ride: null -> proceed to tab shell (no active ride, correct)
        │     ├── 200, ride: {...} -> route into matching active-ride step
        │     └── FAILURE (network/timeout) -> FIXED THIS PHASE: must NOT be treated
        │         the same as "no active ride" -- show a blocking retry screen
        │         ("Checking for an active ride...") until this resolves, since
        │         silently falling through to the tab shell could strand a driver
        │         mid-ride with no way back in until next relaunch (Eng subagent
        │         finding, HIGH severity, edge cases)
        └── on activeRide status change -> route to matching active-ride screen
              via the reducer described below
```
Fix (auto-decided, P5): the four active-ride optimistic transitions become **one reducer** (`activeRideReducer` or equivalent, a plain function + `useReducer`, not a class -- stays consistent with CEO Phase 1's rejection of a formal FSM *class*, since a reducer is exactly the "minimum viable" pattern already used idiomatically in this codebase's state management, not a new abstraction layer) keyed by server-confirmed `ride.status`, with a single `pendingOptimisticStatus` overlay field. On any lifecycle POST rejection, clear `pendingOptimisticStatus` and re-render from the last server-confirmed `ride.status` -- this replaces "four independent ad-hoc booleans" with one small, testable state shape (Eng subagent finding, hidden complexity).

Fix (auto-decided, P5): countdown ring must be clock-skew-safe -- compute remaining time as `timeoutSeconds - (Date.now() - localReceiptTimestamp) / 1000` (both timestamps taken from the same device clock, so device clock skew relative to the server cancels out), never `expiresAt - Date.now()` directly (which compares a server timestamp against local device time and breaks under skew). **Always re-validate expiry server-side on Accept** -- the client-side countdown is a UX affordance, never the actual authority (matches CEO Phase 1's "server-authoritative deadline" architecture decision, this fix makes the client-side implementation of that decision actually correct). (Eng subagent finding, HIGH severity.)

Fix (auto-decided, P5): losing an Accept race (`RIDE_ALREADY_ASSIGNED`, already in CEO Phase 1's error map) needs its client UX stated explicitly, not left implicit: show "Already accepted by another driver" inline, disable Accept/Reject, auto-dismiss the overlay after 2 seconds -- this was actually already specified in the Design phase's Pass 2 interaction-state table; Eng phase confirms it also covers this specific race, not just the generic "already accepted" error text. No new work, cross-referenced.

Fix (auto-decided, P5): socket-flapping debounce -- the HTTP location-fallback trigger (Section 1 of CEO Phase 1) must debounce on `socket.connected` transitions (e.g. only trigger the HTTP fallback if disconnected for >2 continuous seconds), not fire on every rapid reconnect/disconnect blip, to avoid overlapping HTTP + socket location ticks (Eng subagent finding, medium).

Fix (auto-decided, P5): cash-collection "partial" path field mapping, made explicit: `collectedAmount` = actual amount collected (may be less than the fare), `notCollected` = boolean true only when collectedAmount is 0, `note` = free-text reason (required when `collectedAmount` < expected fare) -- matches CLAUDE.md's payments contract field names exactly, removes the ambiguity the Eng subagent flagged.

**Section 2 — Code Quality (auto-decided):** the reducer fix above (Section 1) IS this section's main finding -- four ad-hoc booleans would have been a DRY/organization violation waiting to happen; folding it into one reducer here means Section 2 has no separate new finding beyond what Section 1 already fixed. No other code-quality issues found -- confirmed by direct read, this plan's file/folder organization matches the existing convention exactly (same pattern as rider-mobile's Days 6-8 `features/` structure).

**Section 3 — Test Review (full diagram, never skipped):**
```
CODE PATHS                                                  USER FLOWS
[+] services/session (GET /sessions/current gate)           [+] Go online
  └── [GAP] race-guard vs POST /sessions/online              ├── [GAP] Tap before check resolves
      (CEO Phase 1 accepted this test; now placed in         ├── [GAP] Check itself fails (network)
      the artifact below)                                    └── [★★★ planned] Success path
[+] features/ride-requests (countdown, accept/reject)        [+] Incoming ride request
  ├── [GAP] clock-skew-safe countdown calc                    ├── [GAP] Countdown reaches zero
  ├── [GAP] double-tap guard                                  ├── [GAP] Losing an accept race
  └── [GAP] expiry re-validation on Accept                    └── [GAP] Back button on overlay
[+] features/active-ride (reducer: arrived/start-otp/         [+] Active-ride sequence
    end-otp/collect-cash)                                     ├── [GAP] Optimistic advance + server reject
  └── [GAP] reducer transition table (all 4 lifecycle          │         (per-step, all 4 actions)
      actions + revert-on-rejection)                          ├── [GAP] Back button mid-sequence
                                                                └── [GAP] Partial cash collection
[+] app relaunch routing (GET /rides/me/active)              [+] Relaunch mid-ride
  ├── [GAP] null -> tab shell                                 ├── [GAP] Every active-ride step, relaunched into
  ├── [GAP] ride present -> correct step routing               └── [GAP] Check itself fails (network) [→E2E]
  └── [GAP] check FAILS (network) -- distinct from null
      (Eng subagent finding, HIGH -- this is the gap
      most likely to silently strand a real driver)
[+] services/location (HTTP fallback on socket disconnect)    [+] Socket disconnect mid-ride
  └── [GAP] debounce on flapping                               └── [GAP] Rapid reconnect/disconnect [→E2E or manual]

COVERAGE: 0/17 paths tested (0% -- none of this exists yet, this is a plan review, not a
          diff review; the point of this section is that the PLAN specifies all 17,
          not that code currently covers them)
QUALITY TARGET: the 4 marked pure-logic items ([GAP] under session/countdown/reducer/
          routing) are vitest-testable per the existing packages/mobile-shared pattern;
          everything else is RN-runtime/integration and gets a manual verification
          checkpoint per this repo's established precedent for screen-level RN code
          (Days 3-4/6-8), not deferred to a future automated-testing setup that doesn't
          exist yet.
```
**REGRESSION RULE check:** this plan modifies no existing behavior (`.gitkeep` stubs → new code, not changed code) -- no regression test required by the iron rule.

**Test Plan Artifact:** written to `~/.gstack/projects/cardevelopment01-tech-Ocar-monorepo/sujal-develop-eng-review-test-plan-20260917-142045.md` (affected screens, key interactions, edge cases, critical paths, and the 4 new unit-testable logic pieces listed above) -- consumable by `/qa`/`/qa-only` as primary test input once this phase is implemented.

**New unit tests added to plan scope (auto-decided, P1 completeness -- all four are cheap pure-logic tests per the existing vitest pattern, not deferred):**
1. `GET /sessions/current` vs `POST /sessions/online` race-guard (CEO Phase 1, reaffirmed here with its test now explicitly required, not just recommended).
2. Clock-skew-safe countdown calculation (Section 1 fix above).
3. Active-ride reducer transition table, including revert-on-rejection for all 4 lifecycle actions (Section 1 fix above).
4. Relaunch-mid-ride routing function (ride status → screen path mapping) -- pure function, multi-branch, silently-wrong-mapping risk per Eng subagent.

**Section 4 — Performance:** No N+1 queries (client-only phase, no new DB access patterns). No new large in-memory structures. Caching: N/A. Slow paths: none introduced beyond the existing ~3s location-tick cadence (unchanged). Connection pool: N/A (client-side). Socket-flapping debounce (Section 1 fix) is itself a performance/correctness fix, already counted there, not a separate new finding. **No new findings beyond Section 1's debounce fix.**

**"NOT in scope" (Eng):** A formal driver-session FSM class spanning online/request/active-ride (CEO Phase 1, reaffirmed -- the new active-ride reducer is narrower and local to one feature, not the rejected broader abstraction). Full RN screen-level automated test coverage (existing TODOS.md item, unchanged trigger point). Real device / physical-device testing pass (Day 15, master spec).

**"What already exists" (Eng):** see CEO Phase 1's 0B table (unchanged) plus: `packages/mobile-shared`'s existing vitest setup and pure-logic-testing convention (JWT expiry, error mapping, secure-storage routing tests already there) — the 4 new unit tests above extend that exact pattern, not a new testing approach.

**Failure Modes Registry (extends CEO Phase 1's table with Eng-phase findings):**
```
CODEPATH                                  | FAILURE MODE                     | RESCUED? | TEST? | USER SEES?              | LOGGED?
--------------------------------------------|-----------------------------------|----------|-------|---------------------------|--------
GET /sessions/current (on mount)           | Network timeout/error            | Y (FIXED)| manual| Inline retry, not stuck  | existing pattern
GET /rides/me/active (relaunch)            | Network timeout/error             | Y (FIXED)| manual| Blocking "Checking..." retry, not silent fall-through to tab shell (HIGH, Eng subagent) | existing pattern
Countdown ring vs server expiresAt         | Device clock skew                | Y (FIXED)| Y (new)| Accurate countdown regardless of skew | n/a (client calc)
Accept POST on already-expired request     | Server rejects (expired)         | Y (existing pattern, Section 2 CEO) | manual | "Request expired" message | n/a
Accept POST, losing a race                 | RIDE_ALREADY_ASSIGNED             | Y (existing, CEO Phase 1/Design Pass 2) | manual | "Already accepted by another driver" | n/a
Socket rapid reconnect/disconnect          | Flapping double-fires HTTP fallback | Y (FIXED, debounce) | manual | n/a (transparent) | existing pattern
Cash collection, partial amount            | Ambiguous field mapping           | Y (FIXED, explicit mapping) | manual | Correct backend record | n/a
```
No row is RESCUED=N + TEST=N + USER SEES=Silent.

**Worktree parallelization strategy:**
```
| Step                              | Modules touched                              | Depends on |
|------------------------------------|-----------------------------------------------|------------|
| Go-online toggle + session-restore | features/go-online/, store/ (new session slice)| —          |
| Ride-request handling              | features/ride-requests/, services/socket/      | —          |
| Active-ride flow + reducer         | features/active-ride/, app/active-ride/        | Depends on the session-slice shape from Go-online (needs sessionId) |
| Trip history/earnings              | (tabs)/earnings.tsx, features/earnings/ (new)  | —          |

Lane A: Go-online toggle + session-restore -> Active-ride flow + reducer (sequential, shared session-slice shape)
Lane B: Ride-request handling (independent)
Lane C: Trip history/earnings (independent)

Execution order: Launch Lane A, B, C in parallel worktrees. B and C have no dependency
on A or each other. A's second step (active-ride) waits for A's first step (session
slice) to land, but can start in the same worktree/lane once that shape is defined --
no cross-lane blocking. Merge all three; no shared-module conflicts expected (each
lane's directories don't overlap).
```

**TODOS.md updates (Eng phase, collected from all prior phases):** the one item from CEO Phase 1 (foreground poll fallback) was already written to TODOS.md at that phase. No additional TODOs from Eng phase — the 4 new tests and 5 fixes above all land in this phase's own scope, none are deferred.

**Implementation Tasks**
```markdown
## Implementation Tasks
Synthesized from CEO/Design/Eng review findings. Each task derives from a specific
finding above.

- [ ] **T1 (P1, human: ~1h / CC: ~10min)** — go-online — Add explicit error/retry state for `GET /sessions/current` failure (Section 1, Eng)
  - Surfaced by: Eng Section 1 architecture finding
  - Files: `features/go-online/`, `(tabs)/home.tsx`
  - Verify: manual — kill network before app start, confirm retry affordance shows, not infinite spinner
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — relaunch-recovery — Distinguish `GET /rides/me/active` failure from "no active ride", block with retry instead of silent fall-through (Section 1, Eng)
  - Surfaced by: Eng Section 1, HIGH severity edge case
  - Files: `app/_layout.tsx` or a new relaunch-recovery hook
  - Verify: unit test (relaunch routing function) + manual network-kill test
- [ ] **T3 (P1, human: ~30min / CC: ~5min)** — ride-requests — Clock-skew-safe countdown calc + server-side re-validation on Accept (Section 1, Eng)
  - Surfaced by: Eng Section 1, HIGH severity
  - Files: `features/ride-requests/`
  - Verify: unit test (countdown calc with simulated clock skew)
- [ ] **T4 (P1, human: ~2h / CC: ~20min)** — active-ride — Single reducer (server-status + pending-optimistic overlay) replacing four ad-hoc booleans for arrived/start-otp/end-otp/collect-cash (Section 1, Eng)
  - Surfaced by: Eng Section 1/Code Quality, hidden-complexity finding
  - Files: `features/active-ride/`
  - Verify: unit test (reducer transition table incl. revert-on-rejection)
- [ ] **T5 (P2, human: ~20min / CC: ~5min)** — location — Debounce HTTP-fallback trigger on socket-flapping (Section 1, Eng)
  - Surfaced by: Eng Section 1, medium
  - Files: `services/location/backgroundTask.ts` or driver-mobile's location-tick emitter
  - Verify: manual — simulate rapid connect/disconnect, confirm no overlapping ticks
- [ ] **T6 (P2, human: ~15min / CC: ~5min)** — active-ride — Explicit `collectedAmount`/`notCollected`/`note` field mapping for partial cash collection (Section 1, Eng)
  - Surfaced by: Eng Section 1, low/medium
  - Files: `features/active-ride/` cash-collection screen
  - Verify: manual — submit partial amount, confirm correct fields sent
- [ ] **T7 (P3, human: ~10min / CC: ~5min)** — security — Confirm (don't build) `ride:request:ack` is scoped to the authenticated driver's own socket session
  - Surfaced by: Eng Section 3, low/verify-only
  - Files: `api/src/websocket/socket.server.ts` (read-only verification)
  - Verify: read the existing handler, confirm `user.sub` scoping, note the finding in a code comment if not already obvious
```
JSONL artifact: **skipped** — `jq` is not installed on this machine, and the methodology explicitly forbids hand-rolling JSONL as a substitute. The markdown Implementation Tasks section above is the complete, authoritative task list; install `jq` to enable `/autoplan`'s cross-phase JSONL aggregation in future runs.

**Completion Summary:**
```
+====================================================================+
|            ENG PLAN REVIEW — COMPLETION SUMMARY                    |
+====================================================================+
| Step 0: Scope Challenge | Complexity check triggered (15 files);   |
|                          | auto-decided proceed as scoped, not reduced|
| Architecture Review      | 5 issues found, all fixed                |
| Code Quality Review      | 0 separate issues (folded into Arch fix) |
| Test Review              | Diagram produced, 17 paths mapped, 4 new unit tests added |
| Performance Review       | 0 new issues beyond Section 1's debounce fix |
| NOT in scope             | written (3 items)                        |
| What already exists      | written                                  |
| TODOS.md updates         | 0 new (all findings landed in this phase's own scope) |
| Failure modes            | 7 total, 0 CRITICAL GAPS                 |
| Outside voice            | Codex unavailable; Claude subagent completed, 7 findings incorporated |
| Parallelization          | 3 lanes, 2 parallel + 1 two-step sequential lane |
| Lake Score                | 7/7 -- every finding got its complete fix, no shortcuts taken |
| Unresolved decisions     | 0                                         |
+====================================================================+
```

<!-- autoplan-accepted:eng -->
- Explicit error/retry state for `GET /sessions/current` failure — not an infinite disabled-button spinner (Section 1).
- `GET /rides/me/active` failure on relaunch must block with retry, never silently fall through to the tab shell as if no ride were active (Section 1, HIGH severity).
- Countdown ring computed as `timeoutSeconds - elapsed-local-time`, never raw `expiresAt - Date.now()` — clock-skew-safe; Accept always re-validates expiry server-side (Section 1, HIGH severity).
- Losing-an-Accept-race UX: "Already accepted by another driver" inline, disable actions, auto-dismiss after 2s (cross-referenced with Design Phase 2 Pass 2, confirmed to also cover this specific race).
- Debounce the HTTP location-fallback trigger on socket-flapping (>2 continuous seconds disconnected, not every blip) (Section 1).
- Explicit cash-collection field mapping: `collectedAmount` = actual amount, `notCollected` = true only when 0, `note` = required free-text when partial (Section 1).
- Active-ride's four optimistic lifecycle transitions (`arrived`/`start-otp`/`end-otp`/`collect-cash`) implemented as one reducer keyed by server-confirmed status + a pending-optimistic overlay field, not four ad-hoc booleans (Section 1/Code Quality).
- Four new unit tests added to this phase's scope: session-restore race-guard, clock-skew-safe countdown, active-ride reducer transition table, relaunch-mid-ride routing function (Section 3).
- Verify (not build): `ride:request:ack` is scoped to the authenticated driver's own socket session in `socket.server.ts` (Section 3, low/verify-only).
<!-- /autoplan-accepted:eng -->

**Phase 3 complete.**
Codex: unavailable (not installed). Claude subagent: completed, 7 findings (2 high, 4 medium, 1 low/verify), all incorporated as auto-decided fixes.
Consensus: N/A (outside unavailable) — 0 disagreements, 0 taste decisions, 0 user challenges requiring gate escalation.
Passing to Phase 4 (Final Gate).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | clean | 4 proposals, 2 accepted, 1 deferred |
| Outside Review | Claude subagent (in-host), Codex unavailable | Independent 2nd opinion | 3 (one per phase) | unavailable (Codex), completed (subagent) | 5 CEO / 9 Design / 7 Eng findings, all incorporated |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 7 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score 4/10 → 8/10, 10 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 1 | skipped (scope re-examined as inapplicable — mobile app feature, not a developer-facing product) | N/A |

**OUTSIDE COVERAGE:** Codex unavailable (not installed) for all three phases that ran it (CEO, Design, Eng) — native Claude-subagent pass completed for each instead, tagged `[single-model]`. DX phase's outside voice was not dispatched at all (scope decision, not a provider failure).
**VERDICT:** CEO + DESIGN + ENG CLEARED — ready to implement. DX not applicable to this plan's product type.

NO UNRESOLVED DECISIONS
