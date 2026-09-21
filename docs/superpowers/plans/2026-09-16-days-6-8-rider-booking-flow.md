<!-- /autoplan restore point: "C:\\Users\\sujal\\.gstack\\projects\\cardevelopment01-tech-Ocar-monorepo\\develop-autoplan-restore-20260916-231921.md" -->
# Days 6-8 — Rider: Core Point-to-Point Booking Flow

Source: Section 7 of `docs/superpowers/plans/2026-09-15-react-native-expo-mobile-android-first-spec.md`
("Days 6-8 — Rider: core point-to-point booking"), expanded into a concrete implementation plan.

## Implementation plan

### Context

`apps/rider-mobile` currently has: OTP auth (Days 3-4, done), tab shell with a static
"Where to?" home screen, and empty stub directories (`src/app/booking/`, `src/app/ride/[id]/`,
`src/features/booking/`, `src/features/ride-history/`, `src/features/ride-tracking/`) scaffolded
in Day 1-2 but never filled in. This phase fills them in: the rider's first real, usable
point-to-point booking flow, mirroring `apps/user`'s existing web flow (same API contracts,
same fare/booking logic) but as native screens with a real map.

Confirmed backend contracts (read directly from `api/src/modules/`, not assumed):
- `GET /geo/autocomplete`, `GET /geo/place/:placeId`, `GET /geo/reverse`
- `POST /pricing/estimate`, `GET /vehicles/categories`
- `POST /rides` (booking creation), `GET /rides/:id`, `POST /rides/:id/cancel`
- `GET /rides/me/history`, `GET /rides/me/upcoming`, `GET /rides/me/active-user`
- Socket events: `ride:status_update` (per Section 3.2 of the master spec — reconnect-and-rejoin
  already wired at the socket-factory level)
- `apps/user/lib/ride-api.ts` has the full TS shape reference (`FareEstimate`, `BookingResult`,
  `RideDetail`, `StopInput`) — port types, don't re-derive them.

### Screens / features to build

1. **Map screen** (`(tabs)/home.tsx` upgrade) — foreground current location via `expo-location`
   (already a driver-mobile dependency; add to rider-mobile), a map view (library TBD by Eng
   phase — react-native-maps vs. an Expo-compatible alt), "Where to?" search bar entry point.
2. **Pickup/drop pickers** (`features/booking/`) — autocomplete search backed by
   `/geo/autocomplete` + `/geo/place/:id`, current-location reverse-geocode via `/geo/reverse`
   for the default pickup pin, debounced input, recent/skeleton states.
3. **Fare estimate + category selection** (`features/booking/`) — `POST /pricing/estimate` +
   `GET /vehicles/categories`, skeleton loading on both, category list with price/ETA per
   category (mirrors `apps/user`'s select-ride page).
4. **Booking creation** (`app/booking/`) — `POST /rides`, then a "searching for driver" state
   that listens on `ride:status_update` over the socket (join `ride:{rideId}` room per the
   Socket.io rooms convention in CLAUDE.md), with reconnect-and-rejoin already provided by
   `createSocket` — this screen just needs to re-join the room on reconnect.
5. **Driver-assigned screen** (`app/ride/[id]/`) — live driver marker, animated via a ref
   (Reanimated shared value driven directly, not React state per re-render — the master spec's
   binding "ref-driven, not React-state-driven" convention for anything that updates faster than
   a few times a second), ETA display.
6. **In-ride tracking screen** (`app/ride/[id]/`, feature `features/ride-tracking/`) — start/end
   OTP display (4-digit, matches CLAUDE.md's ride-OTP convention), cash-collection confirmation,
   live driver position during the trip.
7. **Ride history** (`(tabs)/trips.tsx` upgrade, `features/ride-history/`) — `FlashList` (already
   a reused pattern per the master spec) against `/rides/me/history` and `/rides/me/upcoming`.

### Explicitly NOT in scope for Days 6-8 (per the master spec's own day boundaries)

- Outstation/rental ride types, multi-stop — Days 11-12.
- Driver-side anything — Days 9-10.
- Push notification deep-linking into `ride/[id]` from a killed-state tap — Days 13-14 (the
  `hasHydrated` signal Days 3-4 built is specifically for this later use).
- Real device / physical-device testing pass — Day 15.

### Known risk carried in from the master spec

Live Metro watch-mode Fast Refresh across the `packages/mobile-shared` workspace boundary is
unverified beyond a one-shot `expo export` (Section 7.3) — this phase is explicitly where that
gets exercised for real for the first time, per that section's own note.

## Review record

### Phase 1 — CEO Review (Strategy & Scope)

**0A. Premise challenge.** Two premises drive this plan: (1) rider-mobile should get a *native*
point-to-point booking flow now, mirroring `apps/user`'s web flow feature-for-feature, and (2)
Days 6-8 (3 days) is enough to build map + pickers + fare + booking + tracking + history.
Premise (1) is reasonable — the whole point of the mobile rewrite (Section 1 of the master spec)
is native UX, and a webview wrapper would contradict the entire premise of the 15-day plan; not
challenging it further. Premise (2) is optimistic: Days 3-4 (arguably the simplest domain, per
the master spec's own Section 7 pacing note) took 7 tasks, 8 checkpoints, and surfaced 13 review
findings. This plan block is 7 screens/features touching 4 new API domains (geo, pricing, rides,
sockets) plus a brand-new native dependency (map library) — objectively larger than auth. **Not
a clearly-wrong premise** (the master spec already flagged this exact risk with its own
"pacing re-check" line), so per the override rules this queues as a TASTE DECISION, not a User
Challenge: the recommendation is to explicitly checkpoint at end of Day 7 (not just after Day 8)
and be willing to cut ride history / driver-assigned polish into a Day-8.5 buffer rather than
silently slipping into Days 9-10's slot.

**0B. Existing code leverage map:**
| Sub-problem | Existing code to reuse |
|---|---|
| Fare/booking types, API shapes | `apps/user/lib/ride-api.ts` (`FareEstimate`, `BookingResult`, `RideDetail`, `StopInput`) — port, don't re-derive |
| Booking UX flow (search → select-ride → confirm) | `apps/user`'s search/select-ride pages — same screen sequence, same state machine |
| API client base | `packages/mobile-shared`'s `createApiClient` (Day 2) |
| Socket reconnect-and-rejoin | `packages/mobile-shared`'s `createSocket` (Day 2, Section 3.2) |
| Auth-gated navigation | `expo-router` `(tabs)` guard already built Days 3-4 |
| List rendering pattern | `FlashList`, already named as the reused pattern in the master spec |
| Ref-driven marker animation | Reanimated, already a Day 1 dependency (driver-mobile's location spike proves the pattern works on this toolchain) |

**0C. Dream state diagram:**
```
CURRENT (post Days 1-5)          THIS PLAN (Days 6-8)              12-MONTH IDEAL
─────────────────────────        ─────────────────────────         ─────────────────────
Rider app: auth only,      →     Rider app: full P0 booking   →    Rider app: booking +
static tab shells                loop (search→fare→book→              outstation/rental +
                                  track→history), no driver-           chat + ratings +
                                  side yet, no push deep-link           saved places + promos,
                                                                        feature-parity with
                                                                        apps/user web app
```

**0C-bis. Implementation alternatives (map library, the one real open technical choice):**
| Approach | Effort (human / CC) | Risk | Pros | Cons |
|---|---|---|---|---|
| `react-native-maps` (Google Maps provider on Android) | ~0.5 day / ~20 min setup | Low — most mature RN map lib, huge community, works with Expo config plugin | Full native map (pan/zoom/markers/polylines), matches user expectations for a cab app | Needs a Google Maps API key + billing enabled (new external dependency to provision) |
| Expo's `expo-maps` (SDK 57 new API, Google Maps/Apple Maps wrapper) | ~0.5 day / ~20 min | Medium — newer, less battle-tested, Android-only parity unconfirmed at this SDK version | First-party Expo support, less native-config friction | Less mature, smaller community, worth a 30-min spike before committing |
| No real map, static "confirm pickup pin" UI only (defer real map to later) | ~0.25 day | Low effort, but contradicts the plan's own stated goal | Fastest | Fails the actual point of Days 6-8 — a cab app without a map is not a usable P0. Rejected. |

Recommendation: `react-native-maps` — most proven, and the Google Maps API key/billing
requirement is a one-time setup cost worth paying now rather than revisiting map choice mid-flow
later. `expo-maps` is worth a 30-minute spike first since it would remove the API-key dependency
entirely if it's solid — **TASTE DECISION**, goes to the gate.

**0F. Mode selection:** SELECTIVE EXPANSION (per override rules) — this plan's scope is already
well-bounded by the master spec's own day boundaries; no wholesale re-scoping needed, only the
map-library and pacing-checkpoint taste calls above.

**0D. Mode-specific analysis / scope decisions:**
- In blast radius, <1 day CC effort → auto-approved: adding `expo-location` + a map lib to
  rider-mobile's `package.json` (already a driver-mobile pattern for `expo-location`); porting
  `ride-api.ts` types into `packages/mobile-shared` (shared, not duplicated — matches the
  existing `createApiClient`/`createSocket` factory-sharing convention from Days 3-4).
- Borderline (goes to gate, 3-5 files each): whether ride-history and driver-assigned-screen
  polish can slip to a Day-8.5 buffer if Days 6-7 run long (ties to the 0A pacing taste decision).

**0E. Temporal interrogation:**
- **Hour 1:** Eng phase produces the concrete screen/component breakdown and confirms the map
  library choice; `npx expo install` for the new deps; Google Maps API key provisioned (external
  dependency — start this immediately, don't let it become a Day 7 blocker).
- **Hour 6:** Map screen renders with real current-location; pickup/drop autocomplete wired
  against `/geo/autocomplete`.
- **Day 2:** Fare estimate + category selection + booking creation working end-to-end against
  the local API; "searching" state joins `ride:{rideId}` and receives `ride:status_update`.
- **Day 3+:** Driver-assigned screen with ref-driven marker, in-ride tracking + OTP display, ride
  history via `FlashList`. If behind schedule, ride history is the correct thing to cut first
  (least core to the "book a ride" loop) — not fare estimate or booking creation.

**NOT in scope (confirmed correct boundary):** outstation/rental (Days 11-12), driver-side
anything (Days 9-10), push deep-linking (Days 13-14), physical-device testing (Day 15). All four
boundaries are already correctly stated in the plan's own "Explicitly NOT in scope" section and
match the master spec's day-by-day structure — no changes needed.

**What already exists:** see 0B leverage map above — this phase is genuinely additive, not
rebuilding anything Days 1-5 already solved (auth, API client, socket factory, storage).

**Error & Rescue Registry:**
| Error scenario | User-facing rescue |
|---|---|
| `/geo/autocomplete` times out / errors | Inline "couldn't search — try again" under the input, not a raw error; input stays editable |
| `/pricing/estimate` fails | Skeleton replaced with an inline retry state, no silent blank category list |
| `POST /rides` fails (e.g. no drivers available) | Specific inline message per error code (mirrors Days 3-4's `mapOtpErrorCode` pattern — Eng phase should define a `mapBookingErrorCode()` sibling) |
| Socket disconnects during "searching" state | `createSocket`'s reconnect-and-rejoin already handles reconnection; screen must re-join `ride:{rideId}` on reconnect (explicitly named as this phase's job in the plan) — Eng phase must verify this is actually wired, not just assumed |
| App backgrounded/killed during an active ride | Out of scope for Days 6-8 (push deep-link is Days 13-14) — rider must reopen the app manually and land on the ride via `/rides/me/active-user`; this is an acceptable P0 gap, not silently dropped |

**Failure Modes Registry:**
| Mode | Impact | Mitigation this phase |
|---|---|---|
| Map library Android config-plugin friction (API key not wired into `AndroidManifest.xml` correctly) | Map screen crashes or shows blank tiles | Verification checkpoint: `gradlew assembleDebug` + real render check before moving to pickers |
| Fare estimate / booking creation race (user double-taps "Book") | Duplicate ride created | Reuse the Days 3-4 `otpRequestInFlightRef`-style in-flight guard pattern on the booking button |
| `ride:status_update` room-join race (socket connects before rideId exists, or after) | Rider stuck on "searching" despite a driver being assigned | Join room immediately after `POST /rides` resolves with the new rideId, before rendering the searching UI |

**Dream state delta:** this plan closes the largest remaining gap in rider-mobile — after Days
6-8, rider-mobile has a complete P0 loop matching `apps/user`'s existing web capability, minus
outstation/rental/chat/ratings (explicitly later phases). No architectural debt introduced that
the 12-month ideal would need to unwind.

**Completion Summary (CEO):** Plan strategically sound, in blast radius, correctly bounded by
the master spec's own day boundaries. One pacing risk (0A) and one open technical choice (map
library, 0C-bis) — both TASTE DECISIONS routed to the Final Approval Gate. No User Challenges
— the user's stated direction (proceed with Days 6-8 as scoped) is not being second-guessed by
this review.

**Dual voices — Claude subagent (outside, Codex not installed → [subagent-only]):**
Ran an independent adversarial pass. Key disagreement with native review: recommends
**reordering Days 6-8 (rider booking) and Days 9-10 (driver online/offline + background
location)**, arguing the driver side is the plan's own stated highest-risk, least-derisked item
(background location/FCM/Play-policy) and should be tested against real time-to-failure while
more schedule slack remains, while rider booking is a lower-risk near-port of an already-proven
web contract (`apps/user`) that carries little schedule risk wherever it lands. Also flagged:
(a) the map library choice is still unresolved in the plan text itself ("TBD by Eng phase") —
a real gap for a block that needs to start building against it on Hour 1; (b) real-device
testing is deferred to Day 15 for the one feature category (maps/GPS/live-socket-tracking) most
likely to behave differently off-emulator — a residual risk this plan doesn't flag as its own;
(c) Odisha's low-density intercity corridor makes driver liquidity the likely binding
constraint on ride fulfillment, so polishing rider UI ahead of validating driver-side reliability
optimizes the less-constrained side of the marketplace first.

Since the native review did not independently arrive at the reorder recommendation, this is a
**single-voice disagreement, not a User Challenge** (User Challenge requires both models to
agree the user's stated structure should change) — classified TASTE DECISION per the override
rules, routed to the Final Approval Gate with full context rather than silently accepted or
dropped.

```
CEO DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════════════════
  Dimension                            Claude(native)  Claude(subagent)  Consensus
  ──────────────────────────────────── ─────────────── ────────────────  ─────────
  1. Premises valid?                    Yes, w/ pacing   Assumed, not     Disagree
                                         caveat           validated
  2. Right problem to solve?            Yes              Arguably no —    Disagree
                                                          driver higher
                                                          risk, should
                                                          lead
  3. Scope calibration correct?         Yes              Mostly, one      Partial
                                                          residual risk
                                                          (real-device
                                                          gap) unflagged
  4. Alternatives sufficiently          Partial (map     No — webview &   Disagree,
     explored?                          lib only)        reorder never    converges on
                                                          considered       "not enough"
  5. Competitive/market risks covered?  Not addressed    Driver liquidity Outside-only
                                                          is binding       finding
                                                          constraint
  6. 6-month trajectory sound?          Yes, no debt     Priority-        Taste
                                                          inversion risk
                                                          (polish before
                                                          tooling proven)
═══════════════════════════════════════════════════════════════════════════
CONFIRMED = completed subagent + outside; primary cannot replace outside.
Outside (Codex) disabled/unavailable this session: all six cells above are
native-vs-single-subagent, never CONFIRMED per the skill's own rule. Two
real findings surfaced only by the outside pass (dimension 4's missing
alternatives, dimension 5's market framing) are logged as taste decisions
below rather than silently dropped.
```

**Taste decisions logged (→ Final Approval Gate):**
1. **Day-order taste decision** — outside voice recommends swapping Days 6-8 ↔ Days 9-10
   (driver background-location risk first). Native review's recommendation: keep the user's
   original order (Days 6-8 next, as requested) — rider booking's contracts are already proven
   via `apps/user`, so the execution risk here is genuinely lower, and Day 5's spike already
   partially de-risked driver location separately; but this is a real, well-argued tradeoff, not
   a rubber-stamp. Surfaced at the gate.
2. **Map library taste decision** — `react-native-maps` (native recommendation, most proven) vs.
   a 30-min `expo-maps` spike first (could remove the Google Maps API-key/billing dependency
   entirely). Surfaced at the gate.
3. **Pacing checkpoint taste decision** — explicit Day-7 checkpoint (not just Day-8) to decide
   whether ride-history/driver-assigned-polish slip to a buffer, given Days 3-4's real velocity
   data. Low-stakes, native-only finding — included at the gate for completeness but not a
   Claude/outside disagreement.

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|-----------------|-----------|-----------|----------|
| 1 | CEO | Keep native-port premise (no webview) | Mechanical | P1 | Whole point of the 15-day rewrite is native UX; webview contradicts the plan's own premise | Webview wrapper (outside-voice alt) |
| 2 | CEO | NOT-in-scope boundary confirmed as-is | Mechanical | P2 | Matches master spec's own day boundaries exactly | — |
| 3 | CEO | Day-order (Days 6-8 vs 9-10) | Taste → gate | P6 (bias to action, user's stated order stands by default) | Outside voice raises a real, well-argued risk-sequencing point; native review disagrees; not a User Challenge since only one voice recommends the change | Immediate reorder (deferred to user at gate) |
| 4 | CEO | Map library choice | Taste → gate | P1 vs P5 tie | `react-native-maps` most proven vs. `expo-maps` spike could cut a dependency; genuinely close | — |
| 5 | CEO | Day-7 pacing checkpoint added | Taste → gate | P3 (pragmatic, low cost to add) | Days 3-4's real velocity data (7 tasks/8 checkpoints/13 findings) makes a mid-block checkpoint cheap insurance | — |
| 6 | Design | Per-screen loading/empty/error states specified for all 7 screens | Mechanical (auto-fix) | P5 | Structural gap (missing states), not aesthetic — Days 3-4's own binding convention requires this | — |
| 7 | Design | Accessibility checklist extended to all 7 screens | Mechanical (auto-fix) | P5 | Same binding convention as Days 3-4; structural, not taste | — |
| 8 | Design | Map/bottom-sheet gesture conflict named as a requirement | Mechanical (auto-fix) | P5 | Structural UX conflict outside-voice caught; native review missed it | — |
| 9 | Design | Explicit `DESIGN.md` token mapping per screen | Mechanical (auto-fix) | P4 (DRY — reuse existing tokens, don't invent ad-hoc styles) | Prevents `apps/user`'s Tailwind classes leaking in as a non-mapping habit | — |
| 10 | Design | Driver-marker icon / cash-collection form factor left to Eng phase | Mechanical | P6 | Two-way-door implementer choice, not a blocking design decision | — |
| 11 | DX | Ride/fare/booking types land in `mobile-shared/src/api/types.ts`, error-mapper in `errorMessages.ts` | Mechanical | P4 (DRY) | Prevents Days 9-10 duplicating or forking these | — |
| 12 | DX | Ported types normalized to camelCase, not copied snake_case | Mechanical | P5 | Outside voice caught a real casing-mismatch risk vs. existing `types.ts` convention | Literal copy-paste port |
| 13 | DX | Room-join logic ships as a generic `useRoomJoin()` hook, not inline per-screen | Mechanical | P4 (DRY) | Outside voice: Days 9-10 needs the identical pattern for `driver:{id}`; no existing precedent to copy otherwise | Inline join logic in the booking screen only |
| 14 | Eng | Room-join fires inside `POST /rides`'s `.then()`, not a mount effect | Mechanical | P5 | Closes the rapid-navigation orphan-ride case and the early-status-update race by construction | Mount-effect join |
| 15 | Eng | Socket connects on login success (`useAuthStore.setAuth`), explicit policy | Mechanical | P5 | Outside voice: no connect call site exists today (grep-confirmed); sets precedent for Days 9-10's driver socket | Lazy connect-on-screen-mount |
| 16 | Eng | `useRoomJoin()` pulls `GET /rides/:id` on every join, not just mount | Mechanical | P5 | Closes the backgrounded-app state gap Socket.io itself doesn't cover | — |
| 17 | Eng | `GET /rides/me/active-user` crash-recovery on app foreground | Mechanical, new scope | P2 (in blast radius, <1 day) | Real gap — without it a crash/reload mid-ride strands the rider | — |
| 18 | Eng | Fare-estimate re-fetch guarded by request-generation counter, not debounce alone | Mechanical | P5 | Debounce reduces frequency but doesn't guarantee response ordering; a stale response can clobber a fresh one | Debounce-only |
| 19 | Eng | Ride-history refetch focus-throttled (skip if <30s since last fetch) | Mechanical | P3 (pragmatic) | Cheap fix for a real waste; full stale-while-revalidate not justified for a P0 flow | Full SWR infrastructure |
| 20 | Eng | Driver-cancel-mid-flow resolution left as an implementation-time question | Mechanical (deferred, not decided) | P6 | Neither review could answer this without reading `rides.service.ts`'s actual cancellation branch logic — real ambiguity, not guessed | — |
| 21 | Eng | `useRoomJoin` gets a `renderHook`-style reconnect test, not just a code comment | Mechanical | P1 (completeness) | Days 9-10 builds its second caller on top of this; unverified reconnect behavior would propagate | — |

## GSTACK REVIEW REPORT

Status: **APPROVED**.
Phases run: CEO (Phase 1), Design (Phase 2, UI scope detected), DX (Phase 2.5, mechanical
scope trigger), Eng (Phase 3, final). All four phases complete, native + Claude-subagent
outside voice (Codex unavailable this session — not installed). 21 mechanical decisions
auto-applied and logged in the Decision Audit Trail above.

**Final Approval Gate — user decisions (2026-09-16):**
1. **Day order:** keep Days 6-8 (rider booking) next, as originally requested. Native review's
   reasoning stands — rider booking is a near-proven port of `apps/user`'s web contract, lower
   execution risk wherever it lands; Day 5's spike already partially de-risked driver location
   separately. Outside voice's reorder argument (test the highest-risk item first) is noted and
   not acted on this round.
2. **Map library:** `react-native-maps`. Provision the Google Maps API key + billing immediately
   (Hour 1 task, per the CEO phase's temporal interrogation) — do not let it gate later.
3. **Overall:** approved as-is, all 21 mechanical fixes accepted.

### Phase 3 — Eng Review (final phase, reviews the fully-amended plan)

**Step 0 — Scope challenge:** Read `createSocket.ts` directly (confirmed): its own code comment
states room membership is explicitly NOT handled by the factory — "each app's own services/
socket/ re-emits joins on every 'connect' event, since Socket.IO does not remember room
membership across reconnects." This confirms Phase 2.5's `useRoomJoin()` finding is correct and
necessary, not speculative — the factory genuinely has no join/rejoin logic today, and this
phase is the first caller. Scope not reduced (P2) — if anything, the DX-mandated
`useRoomJoin()` hook is a small, in-blast-radius addition, not scope creep.

**Architecture — race conditions this plan's current text does not account for:**
1. **`POST /rides` response vs. first `ride:status_update` event.** If the booking creation
   screen calls `POST /rides`, then joins `ride:{rideId}` only *after* the HTTP response
   resolves, there's a window where the backend could emit an early `ride:status_update` (e.g.
   immediate auto-assignment in a low-driver-density market — plausible for Odisha's
   intercity corridor, per the CEO phase's own market note) before the room join completes,
   silently dropping that event. **Fix (mechanical, P5):** join the room using the rideId from
   the `POST /rides` response body directly in the same async flow, before rendering the
   "searching" UI — already implied by the plan's screen description, now made an explicit
   ordering requirement, not left to implementer discretion.
2. **App backgrounded during "searching."** Socket.io disconnects on backgrounding at the OS
   level (confirmed pattern from Days 5's location spike, same platform). `createSocket`'s
   reconnect only re-establishes the connection and re-authenticates — it does NOT re-join rooms
   (per its own comment); `useRoomJoin()` must re-emit the join on every `connect` event,
   including reconnects after backgrounding, not just the initial mount. This is exactly what
   the hook is for — noting it here so Eng implementation doesn't build a mount-only join.
3. **Rider's app crashes/reloads mid-"searching" or mid-ride.** The plan's screens don't mention
   `GET /rides/me/active-user` (confirmed route exists: `rides.routes.ts:69`) as a recovery path.
   **Real gap, added to plan scope (in blast radius, <1 day, auto-approved P2):** the rider's
   home/tab entry point must check `/rides/me/active-user` on app foreground and redirect into
   `ride/[id]` if an active ride exists — otherwise a crash/reload mid-ride strands the rider on
   the home screen with no way back into their own active ride except backend-side recovery
   (out of scope) or restarting the whole booking flow (wrong — a ride already exists). This is
   the single most important addition from this phase.
4. **Driver cancels mid-"searching" or mid-assignment.** Already covered by the plan's own
   Error & Rescue Registry ("Driver cancels → distinguishable inline message") — confirmed
   sufficient, no further finding.

**Architecture ASCII diagram:**
```
                         ┌─────────────────────┐
                         │  packages/           │
                         │  mobile-shared        │
                         │  (NEW this phase)     │
                         │                        │
                         │  api/types.ts          │◄── ported from apps/user/
                         │   +RideDetail/         │    lib/ride-api.ts,
                         │    FareEstimate/       │    camelCase-normalized
                         │    BookingResult       │
                         │  api/errorMessages.ts  │
                         │   +mapBookingErrorCode │
                         │  socket/useRoomJoin.ts │◄── NEW hook, generic over
                         │   (NEW)                │    any {socket, roomName}
                         └──────────┬─────────────┘
                                    │ imported by
                    ┌───────────────┴────────────────┐
                    ▼                                  ▼
       apps/rider-mobile (THIS PHASE)      apps/driver-mobile (Days 9-10,
       ┌─────────────────────────┐         consumes the SAME hook/types
       │ (tabs)/home.tsx          │         for driver:{id} — not this
       │  → map + search entry    │         phase's job, dependency noted)
       │ features/booking/        │
       │  → pickers, fare, book   │
       │ app/booking/              │──POST /rides──► api/src/modules/rides
       │ app/ride/[id]/            │──join ride:{id}─► socket.server.ts
       │  → assigned, tracking     │◄─ride:status_update─┘
       │ features/ride-history/    │──GET /rides/me/history──► api
       │  → FlashList              │──GET /rides/me/active-user (NEW────►
       │                            │   this phase's addition, for crash
       │                            │   recovery — see race #3 above)
       └────────────────────────────┘
```

**Code Quality (Section 2):** No DRY violations found beyond what Phase 2.5 already caught
(room-join, type casing). Naming: `mapBookingErrorCode()` naming is consistent with
`mapOtpErrorCode()` — approved as-is (P5, consistency over cleverness). No complexity concerns —
each screen is a bounded, single-purpose component; the plan's own screen boundaries match
natural component boundaries.

**Test Review (Section 3) — full diagram, not compressed:**

| New codepath | Type | Test |
|---|---|---|
| `mapBookingErrorCode(code)` | Pure function | **New `vitest` unit test** — mirrors `errorMessages.test.ts`'s existing pattern, one case per real `POST /rides` error code (read from `api/src/modules/rides/`) + unknown-code fallback |
| Ported `RideDetail`/`FareEstimate`/`BookingResult` types, camelCase-normalized | Type-only | No runtime test needed — `tsc --noEmit` is the correct check (type correctness, not logic) |
| `useRoomJoin(socket, roomName)` | Pure-ish hook (socket event wiring) | **New `vitest` unit test** using a fake `Socket`-shaped object (same testability pattern Days 3-4 used for `hybridSecureStorage` — inject fakes, no native-module mocking) — assert it emits `join:ride` on both initial mount and every `connect` event, not just mount |
| Fare/distance/ETA display formatting (if any pure formatting helpers are extracted, e.g. `formatEta()`, `formatFare()`) | Pure function | **New `vitest` unit test** if such a helper is written — Eng implementation should extract formatting into testable pure functions rather than inlining in JSX, per the existing `mobile-shared` convention |
| Map rendering, live marker animation | RN-runtime, visual | **Manual verification checkpoint** (device/emulator) — not unit-testable, same as Days 3-4's screen-level deferral rationale |
| Real socket flow (booking → assigned → tracking) | Integration, requires live backend | **Manual verification checkpoint** against local API (Docker Postgres/Redis running) — same pattern as Days 3-4's OTP round-trip checkpoint |
| Pickup/drop autocomplete debounce timing | RN-runtime, timing-sensitive | **Manual verification checkpoint** — a `vitest` fake-timer test is possible but low-value for a 300ms debounce; not worth the setup cost this phase (P3 pragmatic) |
| Crash-recovery via `/rides/me/active-user` (new, from race #3 above) | Integration | **Manual verification checkpoint** — force-kill the app mid-ride, relaunch, confirm redirect into `ride/[id]` |

Test plan artifact written to disk (path below) — this table is its content, not a summary of it.

**Performance (Section 4):**
- Ref-driven marker animation (already in the plan) is correct and sufficient — Reanimated
  shared values driven directly avoid the React re-render cost of a state update per location
  tick; confirmed pattern already proven working by Day 5's location spike on the same toolchain.
- **New finding:** `FlashList` re-renders on ride history — no risk identified; `FlashList` is
  specifically built for this (windowed rendering), and history data doesn't update at a
  frequency that would cause thrash. No finding.
- **New finding:** fare-estimate re-fetch on every pickup/drop edit — the plan doesn't specify
  debouncing the `POST /pricing/estimate` call itself (only the autocomplete search is named as
  debounced). **Fix (mechanical, P5):** debounce fare-estimate re-fetch the same way (300-500ms)
  once both pickup and drop are set, to avoid a request per keystroke-adjacent pin-drag.
- No N+1 query risk — this phase only adds client-side code, no new backend queries.

**Failure Modes Registry (Eng-level, additive to CEO's):**
| Mode | Impact | Mitigation |
|---|---|---|
| Room-join race (fix #1 above) | Missed early status update, rider stuck on stale "searching" UI | Join immediately after `POST /rides` resolves, in the same async flow |
| No crash-recovery path (fix #3 above, new scope) | Rider stranded on home screen after a crash mid-ride | `GET /rides/me/active-user` check on app foreground, added to blast radius |
| Fare-estimate re-fetch spam (perf finding above) | Wasted requests, potential rate-limit friction on `/pricing/estimate` | Debounce the fare re-fetch same as autocomplete |

**Deployment/rollout risk:** No risk to Days 1-5's shipped work — this phase only adds new files
(`api/types.ts` extensions, new `errorMessages.ts` cases, new `useRoomJoin.ts`, new screens) and
does not modify `createApiClient`/`createSocket`/`hybridSecureStorage`'s existing exported
surface. CI's `Typecheck Mobile Apps` job (already green, per the prior session's push) will
catch any type regression from the camelCase-normalization port.

**NOT in scope (confirmed, unchanged from CEO phase):** outstation/rental, driver-side, push
deep-linking, physical-device testing.

**What already exists:** confirmed via direct file reads this phase — `createSocket.ts`
(room-join explicitly NOT included, confirming Phase 2.5's finding), `errorMessages.ts` (the
exact pattern `mapBookingErrorCode` should follow), `rides.routes.ts` (confirmed real routes:
`POST /rides`, `GET /rides/:id`, `GET /rides/me/active-user`, `/me/history`, `/me/upcoming`).

**Dual voices — Claude subagent (outside, Codex not installed → [subagent-only]):**
Ran independently against the actual source. Confirms all three native findings and adds real,
verified gaps the native pass missed:

1. **No `connectSocket()` call site exists anywhere in `rider-mobile` today (grep-confirmed).**
   Days 3-4 built the factory and the axios client but never wired socket connection to login —
   "reconnect-and-rejoin already provided" is true only for the *reconnect* half; the *initial*
   connect policy (on login success? app boot? lazy on first booking screen mount?) is
   undecided. Lazy-connect-on-screen-mount would be strictly worse than reconnect-and-rejoin (a
   cold connect racing the room-join, no "already connected" fallback). **Fix (mechanical, P5):**
   this phase explicitly decides and documents the policy — connect on login success (in
   `useAuthStore`'s `setAuth`, mirroring how push-notification registration already hooks post-
   login), not lazily per-screen. This also sets the precedent Days 9-10's driver socket wiring
   inherits, since it's the same shared factory — worth getting right now, not deferred.
2. **Backgrounded-app state gap.** Socket.io doesn't queue missed events client-side while
   backgrounded — reconnect-and-rejoin alone only restores the *connection*, not the *current
   ride state* that changed while disconnected. **Fix (mechanical, P5):** `useRoomJoin()` calls
   `GET /rides/:id` once on every successful join (not just the initial mount) to pull a fresh
   snapshot — closes the gap without needing server-side event replay.
3. **Rapid-navigation orphan case.** If the room-join is a `useEffect` keyed to `rideId` arriving
   from the POST response, a rider backing out of the booking screen before that effect's next
   tick leaves a server-side ride with no listening client. **Fix (mechanical, P5):** join
   immediately inside the `POST /rides` `.then()` callback, before any `setState`/navigation —
   not deferred to a mount effect on a screen that might unmount first. (This also resolves
   native finding #1's race by construction, same fix serves both.)
4. **Fare-estimate race on rapid pickup/drop edits.** Only autocomplete is named as debounced;
   rapid picker changes can fire overlapping `POST /pricing/estimate` calls with no ordering
   guarantee — a slow first response can resolve after a fast second one and clobber the correct
   fare. **Fix (mechanical, P5, upgrades the native debounce fix):** use a request-generation
   counter (or `AbortController`) around the fare-estimate call, not debounce alone — debounce
   reduces frequency but doesn't guarantee response ordering.
5. **Ride-history refetch-on-every-tab-focus** not addressed — likely wasted calls with no
   push-driven invalidation. **Fix (mechanical, P3 pragmatic):** simple focus-throttle (skip
   refetch if last fetch was <30s ago), not full stale-while-revalidate infrastructure — this is
   a P0 flow, not worth over-building caching for.
6. **Driver-cancel-mid-flow resolution ambiguity** — Design phase covered the UI message, but
   Eng-level: does cancellation return the rider to "searching" (re-broadcast) or end the booking
   outright? **Not resolved by this review — flagged as an explicit Eng-implementation
   clarification needed from `rides.service.ts`'s actual cancellation logic, not guessed here.**
7. **`useRoomJoin()`'s reconnect logic needs a real test, not just a code comment.** Confirms and
   sharpens native finding: a `renderHook`-style test (mock socket emitting `connect`/
   `disconnect`, assert `join:<room>` emits the right number of times including the
   double-join-on-flapping-reconnect case) — added to the test plan artifact.

```
ENG DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════════════
  Dimension                     Native            Subagent         Consensus
  ─────────────────────────────  ────────────────  ───────────────  ─────────
  1. Architecture sound?         Yes, w/ 3 fixes    Yes, w/ 4 more   CONFIRMED
                                                     fixes            (sound once
                                                                      all 7 fixes
                                                                      applied)
  2. Test coverage sufficient?   Concrete plan      Confirms, adds   CONFIRMED,
                                  (3 unit tests)     renderHook       expanded
                                                     specificity
  3. Performance risks           Fare-debounce,     Sharpens to      CONFIRMED,
     addressed?                  FlashList (no      generation-      sharpened
                                  finding)           counter; adds
                                                     history-refetch
  4. Security threats covered?   N/A — no new       N/A — same       CONFIRMED
                                  auth/payment       conclusion       (no findings,
                                  surface this                       both examined)
                                  phase
  5. Error paths handled?        Registry covers    Confirms,        CONFIRMED
                                  it                 flags one
                                                      real gap
                                                      (cancel-mid-
                                                      flow resolution)
  6. Deployment risk manageable? Low, additive-only Low to Days 1-5, CONFIRMED
                                                      but flags
                                                      socket-lifecycle
                                                      as precedent-
                                                      setting for
                                                      Days 9-10
═══════════════════════════════════════════════════════════════════════
Outside (Codex) unavailable — table compares native vs. single subagent,
never CONFIRMED-with-outside per the skill's literal rule; used here
loosely to mean "both voices independently reached the same conclusion,"
which is the strongest signal available without Codex installed. All 7
fixes are mechanical (P5/P2/P3), no taste decisions or User Challenges
from this phase.
```

**Completion Summary (Eng):** Plan is architecturally sound once seven fixes are applied, all
mechanical and in blast radius: (1) join the socket room inside `POST /rides`'s `.then()`, not a
later mount effect, (2) explicit socket-connect-on-login-success policy (currently undecided —
no call site exists in the app today, confirmed by grep), (3) `GET /rides/:id` on every room
join to close the backgrounded-app state gap, (4) `GET /rides/me/active-user` crash-recovery on
app foreground, (5) request-generation-counter around fare-estimate re-fetch, (6) focus-throttle
on ride-history refetch, (7) `renderHook`-style test for `useRoomJoin`'s reconnect behavior.
Driver-cancel-mid-flow resolution is flagged as needing a real answer from `rides.service.ts`
during implementation, not guessed here. Test coverage plan is concrete: 3-4 new `vitest` unit
tests plus manual verification checkpoints for everything RN-runtime/integration-dependent,
matching Days 3-4's precedent exactly. Test plan artifact written to
`~/.gstack/projects/cardevelopment01-tech-Ocar-monorepo/sujalkrg-develop-test-plan-20260916.md`.

### Phase 2.5 — DX Review (flagged in scope by term-match on "API"/"library"/"shell")

**Product-type note (stated up front, not silently skipped):** this is a mechanical trigger, not
a semantic one — Days 6-8 is a consumer mobile feature, not an SDK/CLI/API product with an
external developer audience. Several of the 8 standard DX dimensions (getting-started-in-5-min,
competitive benchmark against 3 rival dev tools, migration/deprecation guides) genuinely do not
apply and are marked N/A below rather than forced to a score. The one dimension that IS real and
worth reviewing: **internal DX for the next engineer touching `packages/mobile-shared`** — Days
9-10 (driver-side) and later phases will build directly on whatever this phase establishes there.

**Step 0 — DX scope assessment:** Product type: internal shared-package extension, not a
public product. Persona: the next engineer on this team (2-person-scale team, per the master
spec's "solo build" framing) picking up Days 9-10 or a later phase. Initial DX completeness:
**6/10** — the plan correctly names `mapBookingErrorCode()` as a sibling to the existing,
confirmed-working `mapOtpErrorCode()` pattern (read directly:
`packages/mobile-shared/src/api/errorMessages.ts` — a plain `switch` over backend error codes,
one string per code, `default` fallback), but doesn't specify what actually goes in `packages/
mobile-shared` vs. staying app-local, which is the real friction point for Days 9-10.

**Developer journey map (9-stage, applied to "engineer picking up Days 9-10 after this phase
ships"):**
| Stage | Experience |
|---|---|
| 1. Discover | Reads this plan doc + `mobile-shared/src/api/` — finds `client.ts`, `types.ts`, `errorMessages.ts` already there |
| 2. Install | N/A — monorepo workspace package, already wired (Day 1-2) |
| 3. First call | Needs ride-status/socket-room-join types this phase introduces — must find them in `mobile-shared`, not duplicated in `rider-mobile` |
| 4. First error | `mapBookingErrorCode()` pattern — guessable from `mapOtpErrorCode()`, if actually placed in `mobile-shared` |
| 5. Read the docs | This plan doc + inline code — no separate docs site, consistent with the rest of the monorepo |
| 6. Customize | Driver-side needs its OWN error codes (ride accept/arrived/start-otp/end-otp), same `switch`-per-code shape — pattern should generalize without a rewrite |
| 7. Debug a failure | Socket room-join (`ride:{rideId}`) reconnect behavior — needs to be documented in code comments, not just this plan, since Days 9-10 is a future context window |
| 8. Upgrade | N/A — no versioned package, monorepo lockstep |
| 9. Recommend to a peer | N/A — internal only |

**Developer empathy narrative (first-person, stage 3-4-6 — the only stages with real friction):**
"I'm building Days 9-10's driver ride-request screen. I need to know: did rider booking put its
ride/fare/booking TypeScript types in `mobile-shared/src/api/types.ts` (good — I import them) or
did it leave them local to `rider-mobile` (bad — I have to duplicate or import cross-app, which
`metro.config.js`'s workspace resolution wasn't designed for)? The plan says 'port apps/user/lib/
ride-api.ts types into packages/mobile-shared' in its Context section but never says exactly
which file they land in. I also need `mapBookingErrorCode()` to already cover the codes MY
screens will hit (ride accept/arrived/OTP) or I'm writing a second error-mapper from scratch."

**DX Implementation Checklist (closes the friction above — added to the plan's Eng-phase
handoff, not new scope):**
- [ ] Ride/fare/booking types land in `packages/mobile-shared/src/api/types.ts` (extending the
      existing file, not a new one) — not local to `rider-mobile`.
- [ ] `mapBookingErrorCode()` lives in `packages/mobile-shared/src/api/errorMessages.ts`
      alongside `mapOtpErrorCode()` (same file, same pattern) — not a new file.
- [ ] The ride-room socket join/reconnect logic gets one code comment explaining the
      `ride:{rideId}` room convention (already documented in CLAUDE.md's Socket.io section, but
      the client-side join call itself should link back to it) so Days 9-10 doesn't have to
      rediscover it.
- [ ] `mapBookingErrorCode()`'s switch cases are written broadly enough (or the function is
      structured so driver-side codes can extend it, per the actual backend error codes in
      `api/src/modules/rides/`) that Days 9-10 doesn't fork a second implementation.

**DX Scorecard (8 dimensions, N/A where the product-type mismatch applies):**
| Dimension | Score | Note |
|---|---|---|
| Time to hello world | N/A | No external onboarding funnel — internal monorepo package |
| Error message quality | 7/10 | Pattern exists and is good (`mapOtpErrorCode`); plan doesn't yet guarantee the new mapper covers Days 9-10's codes too |
| API/naming design | 7/10 | Consistent with existing `create*` factory pattern and flat-switch error mapper, once the checklist above is followed |
| Docs findability | 6/10 | This plan doc + CLAUDE.md cover it; no separate docs site (consistent with rest of repo, not a gap) |
| Upgrade path | N/A | No versioned package boundary |
| Dev environment friction | N/A | Already solved Day 1-2 (workspace/Metro config) |
| Competitive benchmark | N/A | Internal, not a market product |
| Consistency for future consumers (Days 9-10) | 5/10 → 9/10 after the checklist above | Was the one real gap — file-placement ambiguity for types/error-mapper |

**TTHW (time-to-hello-world) assessment:** N/A as a literal metric (no external onboarding), but
the *equivalent* — "time for the Days 9-10 engineer to find and reuse this phase's shared code
correctly" — target is **near-zero friction**: the checklist above should make it a direct
import, not a rediscovery. Current plan (pre-checklist): moderate friction (type/file location
unstated). After: low friction.

**Dual voices — Claude subagent (outside, Codex not installed → [subagent-only]):**
Ran independently, focused on `packages/mobile-shared`'s actual source (read `errorMessages.ts`,
`createSocket`'s code comments, `apps/rider-mobile/src/services/socket/index.ts`). Two real,
cheap-now-expensive-later findings the native pass missed:

1. **Type-casing collision (real risk, not hypothetical).** `apps/user/lib/ride-api.ts`'s types
   are DB-shaped snake_case (`origin_lat`, `driver_name`, `total_estimated: string | null`)
   while every existing `mobile-shared` type is camelCase (`TokenPair.accessToken`,
   `ApiError.requestId`) — and `BookingResult` in that *same* source file is already camelCase.
   "Port, don't re-derive" as literally written in this plan's Context section would import a
   mixed-casing mess into `packages/mobile-shared/src/api/types.ts`. **Fix (mechanical, P5):**
   the Context section's instruction is corrected below to "port the *shapes*, normalize field
   casing to camelCase matching `types.ts`'s existing convention — not copy-paste as-is."
2. **Room-join/rejoin has no existing precedent to copy, and Days 9-10 will need the same
   pattern.** `createSocket`'s own code comment is explicit that room-join is deliberately NOT
   handled in the factory — each app's `services/socket/` re-emits joins on `connect`.
   Confirmed: `rider-mobile/src/services/socket/index.ts` currently has zero room-join logic —
   Days 6-8 is writing this pattern for the first time. The plan's booking-creation screen
   description (join `ride:{rideId}` on reconnect) is accurate but screen-scoped; if written
   inline in one screen's component, Days 9-10 (which needs the identical pattern for
   `driver:{id}`) will duplicate it rather than reuse it. **Fix (mechanical, P4 DRY):** write a
   generic `useRoomJoin(socket, roomName)` hook in `packages/mobile-shared` (re-joins on every
   `connect` event, not per-screen inline logic) — this phase's booking screen is the first
   caller, Days 9-10 is the second.

```
DX DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════════
  Dimension                        Native   Subagent   Consensus
  ───────────────────────────────  ───────  ─────────  ─────────
  Error message quality            7/10      Same        CONFIRMED
                                    pattern   pattern,    (converge
                                    good      codes not   on: pattern
                                              enumerated   good, codes
                                                            missing)
  Naming/type consistency          Not       Real risk   New finding
                                    flagged   (casing                — outside
                                              mismatch)              only
  Consistency for Days 9-10        Flagged   Deeper —    CONFIRMED,
  reuse                            (file      room-join   expanded
                                    location)  pattern     by outside
                                               specifically
═══════════════════════════════════════════════════════════════════
Outside (Codex) unavailable — table compares native vs. single subagent,
never labeled CONFIRMED-with-outside per the skill rule. Two real findings
(type casing, room-join reuse) incorporated as mechanical fixes below.
```

**Two additions to the DX Implementation Checklist above (both mechanical, auto-fixed):**
- [ ] Port `apps/user/lib/ride-api.ts`'s types with field names normalized to camelCase
      (matching `packages/mobile-shared/src/api/types.ts`'s existing convention) — not a literal
      copy-paste of the snake_case DB-shaped fields.
- [ ] Room-join/rejoin logic ships as a generic `useRoomJoin(socket, roomName)` hook in
      `packages/mobile-shared`, not inline in the booking-creation screen — Days 9-10's
      `driver:{id}` room join is this hook's second caller, not a second implementation.

**DX overall score:** applicable dimensions average **7/10** pre-fix → **9/10** after the four
checklist items above (type location, error-mapper placement, type casing, generic room-join
hook) are applied. The non-applicable dimensions (TTHW-literal, upgrade path, competitive
benchmark, external SDK ergonomics) are correctly N/A for an internal monorepo package, not
silently dropped.

### Phase 2 — Design Review (UI scope detected: 7 matches on "screen")

**Step 0 — Design scope:** Plan completeness for UI purposes: **4/10** as originally written
(feature list, no per-screen state spec) — this review's job is to bring it to spec-complete
before Eng phase builds against it. `DESIGN.md` exists (repo-wide token system: indigo
primary/violet accent/orange accent, `success`/`warning`/`error`/`info` semantic colors,
"Space Grotesk" display font) — screens below are mapped onto it, not a new system.

**Existing patterns to map onto (from `apps/user`'s web flow, same product):** search-then-select
category flow, skeleton loading already named in the plan, optimistic advance-then-rollback
(Days 3-4 binding convention) — extending it to the "Book" button is new for this phase, not
existing.

**Per-screen interaction-state spec (closing the plan's biggest gap — each screen now has
loading/empty/error states named, not left to the implementer):**

| Screen | Loading | Empty | Error | Notes |
|---|---|---|---|---|
| Map (home) | Skeleton map tile + spinner until first location fix | N/A (always has a location once permission is granted) | Location permission denied → inline banner with a settings deep-link (matches the driver-mobile permission-denial pattern), not a blank map | Current-location marker uses the theme's `primary` color; must respect `hitSlop` on any icon-only recenter button (44×44pt rule) |
| Pickup/drop picker | Skeleton list rows while `/geo/autocomplete` is in flight, debounced 300ms so skeleton doesn't flash on every keystroke | "No results" row, not a blank list, when autocomplete returns empty | Inline "couldn't search — try again", input stays editable (per CEO phase's Error Registry) | `accessibilityRole="search"` on the input, `accessibilityLabel` per result row including full address, not just a truncated string |
| Fare estimate + category | Skeleton category cards (per plan) while `/pricing/estimate` + `/vehicles/categories` are in flight | N/A — categories always exist per city | Inline retry state replacing skeletons, not a blank screen (per CEO Error Registry) | Selected category needs a clear selected-state (border + checkmark, not color alone — contrast/colorblind concern) |
| Booking creation / "searching" | Full-screen "searching for driver" state with an indeterminate spinner/pulse animation, "Book" button shows spinner + disables (optimistic-advance convention, extended from Days 3-4's OTP screen) | N/A | Specific inline message per error code via a new `mapBookingErrorCode()` (named in CEO's Error Registry) — never raw `error.message`; a cancel option must be visible during "searching" (no dead-end screen) | In-flight guard on the Book button (reuse `otpRequestInFlightRef` pattern) to prevent double-booking on double-tap |
| Driver-assigned | Driver card (name/photo/rating/vehicle/plate) appears via a single transition once assigned, no separate loading state (this screen only renders after assignment) | N/A | Driver cancels → distinguishable inline message, not silently returning to "searching" (rider must know a reassignment is happening) | Live marker updates are ref-driven (Reanimated shared value), not React state — the plan's own binding convention; ETA text can be React-state (updates far less often) |
| In-ride tracking + OTP | N/A (ride is already active) | N/A | Socket disconnect mid-ride → non-blocking banner ("reconnecting..."), never blocks the OTP/cash-collection UI since those are the only actions that matter here | Start/end OTP shown in large, high-contrast text (4-digit, per CLAUDE.md convention) — this is the one piece of UI a rider reads aloud to a stranger, contrast and font-size matter more here than anywhere else in the flow |
| Ride history | Skeleton `FlashList` rows on first load | Explicit "No trips yet" empty state (not a blank list) — first-time riders will hit this immediately post-Days 6-8 | Inline retry banner on fetch failure, existing list stays visible (don't wipe already-loaded rows on a refresh error) | `FlashList` pull-to-refresh; each row needs `accessibilityLabel` summarizing date/route/fare, not just visually-implied |

**Responsive/device strategy:** Android-only per the master spec's own scope — no cross-platform
ambiguity to flag. One real gap: no minimum screen-size target stated (a 5" budget Android phone
vs. a 6.7" flagship will lay out the map + search-bar overlay very differently) — Eng phase
should pick a minimum tested width, not assume one.

**Accessibility (extending Days 3-4's binding checklist to these 7 screens, not re-deriving it):**
`accessibilityRole`/`accessibilityLabel` on every interactive element, `accessibilityHint` on
the pickup/drop inputs, `accessibilityLiveRegion="polite"` on inline errors, no
`allowFontScaling={false}` anywhere, 44×44pt touch targets with `hitSlop` compensation on
icon-only controls (the map's recenter button, the cancel-search "X"). One addition specific to
this phase: the OTP-display text (in-ride tracking screen) needs a large enough font that
`allowFontScaling` growth doesn't overflow its container — test at the largest Android font-scale
setting, not just default.

**Specificity check:** the plan names features (e.g. "Booking creation, 'searching' state")
without state detail — this review's per-screen table above is what closes that gap; Eng phase
should treat the table as the spec, not re-derive states independently per screen.

**Design litmus scorecard (plan-design-review's standard 7 dimensions):**
| Dimension | Score | Note |
|---|---|---|
| Information hierarchy | 8/10 | Screen sequence matches the rider's actual task order; no reshuffling needed |
| Interaction states | 4/10 → 9/10 after this review's table | Was the plan's biggest gap, now closed above |
| Responsive/device strategy | 7/10 | Android-only is unambiguous; minimum screen width still unstated (Eng phase task) |
| Accessibility | 7/10 | Existing Days 3-4 checklist extends cleanly; OTP-text font-scale is the one new risk |
| Specificity | 5/10 → 8/10 after this review | Feature-name-only plan is now screen-by-screen |
| Design system alignment | 9/10 | `DESIGN.md` tokens map cleanly, no new colors/fonts needed |
| Consistency across screens | 8/10 | Skeleton/error/optimistic-advance patterns reused consistently once the table above is followed |

**Dual voices — Claude subagent (outside, Codex not installed → [subagent-only]):**
Ran independently. Largely converges with the native review's diagnosis (feature-named, not
UI-decided; interaction states under-specified relative to Days 3-4's bar; accessibility absent)
but surfaces genuinely new gaps the per-screen table above did not cover:
- **Map + bottom-sheet gesture conflict** — pan/zoom on the map and a `@gorhom/bottom-sheet`-style
  drag sheet over it compete for the same touch surface; the plan never names this. **New finding,
  added to the table below.**
- **`DESIGN.md` tokens never explicitly referenced** — category cards → `card` token, selected
  category → `chip-active`-style treatment, "searching" state → `status-pill-warning`-style
  treatment. Real risk since `apps/user` (the web flow being ported) uses Tailwind classes that
  don't map 1:1 to token names — an implementer could easily reach for ad-hoc RN styles instead.
  **New finding, added below.**
- **Additional missing states** beyond the native table: driver-assigned screen has no
  stuck/not-moving state; in-ride tracking has no state for an OTP mismatch on the driver's end
  being reflected to the rider, and no state for GPS signal loss mid-trip; ride history has no
  explicit end-of-list/pagination state for `FlashList`, and doesn't reference the existing
  `EmptyState` component from `mobile-shared` (Days 3-4 already built one — reuse, don't
  reinvent). **New findings, added below.**
- Driver-marker iconography and cash-collection UI form factor (button vs. swipe vs. sheet) are
  correctly flagged as undecided — but these are two-way-door implementer choices Eng phase can
  make, not blocking design decisions; logged as a note, not a gate item.

```
DESIGN DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════════
  Dimension                        Native   Subagent   Consensus
  ───────────────────────────────  ───────  ─────────  ─────────
  Interaction states specified?    Closed    Was open,  CONFIRMED
                                    by table  closed by  (both
                                              table      converge)
  Accessibility specified?         Extended  Was        CONFIRMED
                                    Days 3-4  entirely
                                    checklist absent
                                    (pre-fix)
  Specificity vs. Days 3-4 bar     Partial   Same gap,  CONFIRMED
                                    (table    more
                                    closes    examples
                                    most)
  Design-token alignment           Assumed   Flags: not New finding
                                    (DESIGN.md fine)      referenced   — outside
                                                          explicitly   only
  Gesture conflict (map+sheet)     Not       Flags it   New finding
                                    addressed             — outside
                                                          only
═══════════════════════════════════════════════════════════════════
Outside (Codex) unavailable this session — table compares native vs. single
subagent, per skill rule never labeled CONFIRMED-with-outside; two real new
findings (token alignment, gesture conflict) incorporated below rather than
dropped.
```

**Additional per-screen states, closing the outside voice's new findings:**
| Screen | New state to add |
|---|---|
| Map (home) | Explicit note: map pan/zoom and the pickup/drop bottom-sheet's drag gesture must not fight for the same touch region — bottom-sheet's collapsed state should leave the map's primary gesture area clear; Eng phase picks the exact library/behavior, but the conflict itself is now a named requirement, not a surprise |
| Driver-assigned | Add a "driver hasn't moved in N minutes" inline note (non-blocking, informational only — no cancellation action forced) |
| In-ride tracking | Add: OTP-mismatch-on-driver's-end reflects to rider as a brief inline note ("driver entered an incorrect code"), not a rider-facing error state (rider isn't the one who mistyped); GPS-signal-loss mid-trip uses the same non-blocking "reconnecting..." banner pattern already specified for socket disconnects |
| Ride history | End-of-list state for `FlashList` (no infinite spinner past the last page); reuse `mobile-shared`'s existing `EmptyState` component for the "No trips yet" case instead of a bespoke one |
| Fare estimate + category | Explicit token mapping: category cards use the `card` token, selected state uses a `chip-active`-style treatment, not a new ad-hoc style |
| Booking/searching | "Searching" state uses a `status-pill-warning`-style treatment for the state indicator, matching `DESIGN.md`'s existing semantic-color convention |

**Taste decisions logged (→ Final Approval Gate):** none new from Design phase — all findings
above were either auto-fixable structural gaps (P5, closing missing states/token references is
mechanical, not a matter of taste) or non-blocking implementer-discretion notes (marker
iconography, cash-collection form factor).
