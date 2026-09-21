# Post-Day-10 Ride Flow Hardening — Design

## Context

The 15-day Android-first mobile spec (`docs/superpowers/plans/2026-09-15-react-native-expo-mobile-android-first-spec.md`)
formally covered Days 1-10 (scaffold, auth, background-location spike, rider
booking, driver booking) — each reviewed via `/autoplan`. Everything since
(`c3c5faf`..`HEAD`, ~27 commits) has been ad-hoc UI-parity and feature work
with no plan doc, and the original spec's Day-15 exit gate (Play Console
internal-testing upload, full physical-device P0 walkthrough, zero open P0
bugs) was never attempted.

A code audit of the current ride flow (request → completion) on both mobile
apps, compared against the web apps (`apps/user`, `apps/driver`) and the
backend's actual capabilities, found driver-mobile meaningfully behind
rider-mobile — it only fully supports a plain one-way ride's happy path.

## Confirmed findings (evidence, not speculation)

**Driver-mobile:**
- **No cancellation capability once a ride is accepted.** Nothing in
  `active-ride/[id].tsx` or `features/active-ride/*`. Web driver
  (`NavigateToPickup.tsx` etc.) has it; rider-mobile has full support
  (`CancelSheet.tsx`, `DriverCancelledBanner.tsx`).
- **Zero ride-type branching.** `features/active-ride/reducer.ts` types
  `RideStatus` as only `'accepted'|'driver_arrived'|'in_progress'|'completed'`
  — missing `'returning'` (present in rider-mobile's
  `statusConfig.ts`/`useRideTracking.ts`) and never distinguishes
  `one_way`/`round_trip`/`rental`. Web `TripInProgress.tsx` has ~10
  `rideType`-conditional branches (route label, rental "Flexible route",
  round-trip `returnAt`, rental `tripHours`). A driver on a round-trip or
  rental ride currently sees the same UI as a one-way ride — no return-leg
  state, no package-hours/km, no driver-allowance surfaced.
- **No multi-stop UI.** Rider-mobile has `AddStopSheet.tsx`/`StopTimeline.tsx`
  and calls `addStop`; driver-mobile has nothing — can't see or react to
  stops a rider adds mid-ride.
- **No speed-alert surfacing.** Web driver has `useSpeedAlert.ts` wired to
  `speed_alert_log`; driver-mobile has zero references.
- **Return-cab active-ride wiring unconfirmed.** `go-online/return-cab.tsx`
  handles opt-in only; nothing in the active-ride code references
  `return_cab` — unknown whether a matched return-cab ride is handled
  correctly or silently falls through as generic one-way.

**Both apps:**
- **No SOS access during an active ride**, at any stage — a safety-critical
  gap versus web, which has it wired into `NavigateToPickup.tsx`,
  `OTPVerify.tsx`, `RideChat.tsx`, and `TripInProgress.tsx`.

**Already solid:** driver-mobile's reducer/optimistic-update pattern
(`reducer.ts`, `useActiveRide.ts`) — single confirmed-status + optimistic
overlay, proper revert-on-rejection, OTP invalid-vs-generic-error
distinction, socket room-rejoin-triggers-refetch via `useRoomJoin`.
Rider-mobile's ride-tracking is comparatively mature across the board.

**Visual/premium polish** was not independently assessed in the audit (code
capability only) — user feedback in this session confirmed the UI at every
stage is under-wired and not up to the bar of the already-shipped
onboarding/home premium visual language (`gradientPrimary`, glassmorphism,
press-feedback scale).

## Goal

Bring driver-mobile to full functional parity with rider-mobile/web across
the entire ride flow, and bring both apps' ride-flow UI up to the same
premium visual bar already established elsewhere in the apps — going stage
by stage, each stage reaching full parity + polish before the next starts.

## Explicitly out of scope

- In-app notification feed (bell/history) for either mobile app — backlog.
- Driver-mobile in-ride chat — backlog.
- Day-15 exit gate (Play Console upload, AAB submission) — not attempted as
  part of this plan; may follow once ride-flow hardening is done.
- No backend changes — every confirmed gap is a mobile-side wiring/UI gap
  against endpoints that already exist.

## Stage sequence

**Stage 0 (new, added during `/plan-eng-review`): shared infrastructure, built once.**
Stages 2/4/5 all depend on the same cross-cutting pieces (SOSButton,
CancelSheet, the reducer widening, the GPS position store below) — framing
them as stage-local would mean building shared infra piecemeal and
re-touching the reducer more than once. Stage 0 builds and tests all of it
up front, matching this project's own precedent (Day 2 built shared
foundations before Days 3-10 consumed them):
- jest-expo + React Native Testing Library setup, both apps.
- `packages/mobile-shared/src/ui/SOSButton.tsx` and `CancelSheet.tsx`.
- `features/active-ride/reducer.ts` widened (`returning` status, `rideType`
  threaded from the already-populated `RideDetail.rideType`).
- Driver-position store (see "Live position" below) fed by `backgroundTask.ts`.
- A short backend-contract spike confirming the sockets/endpoints each new
  piece depends on — done during this review: `POST /:id/cancel-driver`
  (`rides.routes.ts:223`), the `returning` status's socket push
  (`rides.service.ts:860`), and `stop:added` (`socket.server.ts:280`) are
  all already live. Still open: whether `speed_alert_log` is pushed over
  the socket at all, or only ever fetched by REST poll on web — no
  `speed_alert` socket emit was found; resolve this at the top of whichever
  stage first needs it (stage 4).

Stages 1-5 below then only wire this already-built infra into each screen
plus do that stage's wiring-audit and visual-polish work — each stage still
brought to full parity + polish before the next starts, with a live
on-device walkthrough (rigor scaled to the stage's known risk — heavy for
2/4/5, light for 1/3 which the audit found mostly solid already).

1. **Request & broadcast.** Driver's Uber-style incoming-request alert
   (mostly built, `a88cbdc`); rider's "finding your driver" wait state.
   Check: cancellation before a driver is matched, timeout/re-broadcast UX.
2. **En route to pickup.** Driver navigating in, rider watching driver
   approach. Confirmed gaps: driver-mobile has no cancellation here at all;
   SOS missing both sides.
3. **OTP verification at pickup.** Smallest stage, audit found this mostly
   solid on both sides — primarily a polish pass plus the wiring
   re-verification described below.
4. **Trip in progress.** The largest stage: ride-type branching
   (one_way/round_trip/rental), multi-stop visibility, speed alerts,
   return-cab handling, live tracking, SOS during the ride, mid-ride
   cancellation.
5. **Trip completion.** OTP end, cash collection/payment confirmation, fare
   breakdown, handoff into the already-built rating flow.

## Wiring audit discipline (applies at every stage)

Before writing any UI for a stage, re-verify its existing screens actually
do what they appear to — every button/action fires the correct API call,
every socket event updates the correct state, every loading/error/empty
state is real rather than a static placeholder. The audit already caught
driver-mobile silently missing cancellation and ride-type branching entirely
without any visible sign in the UI; treat that as a signal there may be more
per-stage, not as an exhaustive list.

## Cross-cutting components (built once in Stage 0, reused, not rebuilt per stage)

- **`packages/mobile-shared/src/ui/SOSButton.tsx`** (new) — persistent
  floating trigger. Takes an injected `onTrigger` callback prop; each app
  wires its own `features/*/safety-api.ts` call at the call site (matches
  the existing `createApiClient`/`createSocket` injected-callback
  convention — this project's own established pattern, not a new one). On
  failure: one automatic retry, then a persistent "SOS not sent — tap to
  retry" state that stays until success or dismissal, **plus a one-tap
  "Call emergency contact/number" `tel:` dialer fallback** shown alongside
  the failure state — a device-native call needs no backend work and
  closes the worst case (extended total network loss) without building a
  full offline-queue system, which is out of scope for this plan. The
  fallback button checks telephony capability first
  (`Linking.canOpenURL('tel:...')` or `expo-device`) and hides itself when
  the device can't place a call (no SIM, tablet, VoIP-only) — the failure
  state then shows retry only, never a dead button. Reused unmodified
  across stages 2, 4, and 5, both apps.

  **Visual spec (locked during `/plan-design-review`, all values from
  `packages/mobile-shared/src/theme/tokens.ts`, no hardcoded hex):**
  size `56x56`, `radii.full` (circular), `colors.error` fill, `colors.inkInverse`
  icon, `shadows.buttonPrimary` (teal-tinted per the app's existing shadow
  convention, even though the button itself is red). Placement:
  `position: absolute; bottom: spacing.xl + insets.bottom; right: spacing.md;
  zIndex: 10` — above map content, below `CancelSheet`; offset to
  `right: 16, bottom: 96` on screens where map controls already occupy
  bottom-right. Press feedback: scale to `0.96` over `120ms`; at-rest a subtle
  breathing scale `1 → 1.02` every 3s, only while `status === 'in_progress'`
  (not an infinite pulse). Failure state renders as a separate anchored pill
  (not inside the circle): `background: colors.errorLight, border: colors.error,
  label: typography.caption` for the message, `typography.label` (semibold)
  for the retry tap target. The `tel:` fallback is a secondary pill below it
  (`colors.surface` background, `colors.border` stroke, `typography.label`) —
  when hidden by the capability check, the failure pill expands to fill the
  space rather than leaving a gap.
  **Accessibility:** `hitSlop: 8`, `accessible: true`,
  `accessibilityLabel: "Emergency SOS, double tap to send alert"`,
  `accessibilityRole: "button"`.

- **`packages/mobile-shared/src/ui/CancelSheet.tsx`** (new) — a shared
  UI-only shell: renders a `reasons` prop (each app supplies its own
  role-correct list — driver: `passenger_no_show`, `vehicle_breakdown`,
  `rider_requested`, etc. confirmed at `apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx:691-698`;
  rider: existing `BEFORE_REASONS`/`AFTER_REASONS`), collects the choice,
  and calls the right endpoint (`POST /:id/cancel` or `POST
  /:id/cancel-driver` — confirmed as separate existing backend endpoints,
  `rides.routes.ts:214,223`). It deliberately does NOT know about fees,
  penalties, re-broadcast, or ride-stage differences — `cancelRide`/
  `cancelRideAsDriver` already apply the correct policy server-side, the
  same client/server split the rest of the app uses (fare calculation is
  never client-side either). The client shows whatever the server's
  response says. Reused at every stage after request/broadcast, both apps.

  **Visual spec (locked during `/plan-design-review`; the doc's own
  "glassmorphism vs. solid" open item is now resolved as solid):**
  container `background: colors.surface`,
  `borderTopLeftRadius/borderTopRightRadius: radii.xl`; handle
  `width: 32, height: 4, background: colors.border, borderRadius: radii.full,
  marginVertical: spacing.sm/spacing.md`. Backdrop: `rgba(15,23,42,0.4)`,
  fade `opacity 0 → 1` over `200ms`, **solid, not glass** — a blur over a live
  map during a cancellation (already a stressful moment) risks a
  vibrancy/contrast failure exactly when legibility matters most. Reason
  rows: `spacing.md` apart, `minHeight: 48, borderRadius: radii.md, border:
  colors.borderLight`; selected: `border: colors.primary, background:
  colors.primarySubtle`. Text: `typography.body` (reason),
  `typography.caption` (helper). CTA: `height: 48`, `gradientPrimary` fill via
  `expo-linear-gradient`, `borderRadius: buttonRadius` (the per-app shape
  difference — rider gets the `9999` pill, driver gets `16`),
  `typography.body` semibold in `colors.inkInverse`, `shadows.buttonPrimary`.
  **Loading state:** on submit, the confirm button swaps its label for an
  inline spinner; the sheet stays open and the backdrop becomes
  non-dismissible until the server responds — prevents a double-submit on a
  slow connection. **Timeout (locked during follow-up `/plan-eng-review`):**
  a client-side ~10s timeout re-enables dismiss and shows "Taking longer
  than expected — try again" (keeping the selected reason) rather than
  leaving the sheet non-dismissible indefinitely if the request hangs
  without a clean error.
  **Accessibility:** reason rows use `accessibilityRole: "radio"` with the
  selected state announced; bottom content padding is
  `Math.max(spacing.lg, insets.bottom + spacing.sm)` to clear the Android
  gesture bar.
  Tokens import is mandatory in both components:
  `import { colors, gradientPrimary, buttonRadius, radii, spacing,
  typography, shadows } from '@ocar/mobile-shared'` — no hardcoded hex in
  either file.

## Driver-mobile structural changes

- **`features/active-ride/reducer.ts`** — widen `RideStatus` to include
  `returning`; thread `ride_type` through state the way rider-mobile's
  `useRideTracking.ts` already does. This is the prerequisite everything
  else in stage 4 depends on.
- **`features/active-ride/`** — new stop-visibility component, ported from
  rider-mobile's `AddStopSheet.tsx`/`StopTimeline.tsx` 1:1 (kept as a full
  port per explicit decision during `/plan-eng-review`, despite the outside
  voice's suggestion that a read-only viewer could be a simpler plain list —
  user chose to keep parity with the web/rider-mobile shape rather than
  reduce scope here) and a speed-alert surface (adapted from web driver's
  `useSpeedAlert.ts` — delivery mechanism, socket push vs. REST poll, to be
  confirmed at the top of Stage 4 per the Stage 0 note above).
- **Driver-position store (new, Stage 0)** — `backgroundTask.ts` currently
  only calls `emitLocationTick(...)` (`backgroundTask.ts:32`), a one-way
  push to the server with no local state. Rather than each map screen
  opening its own second `watchPositionAsync` subscription (which would run
  concurrently with the existing background task — two GPS subscribers,
  doubled wakeups, and Android foreground/background throttling conflicts,
  per the outside voice), `backgroundTask.ts` also writes each position tick
  into a small store (matching the existing `useDriverSessionStore`
  pattern); stage 2/4 map screens subscribe to that store instead of
  opening their own GPS stream. One GPS subscription total.
  **Stale-signal state (locked during `/plan-design-review`):** if no
  position update lands for ~15s, the driver marker fades to reduced opacity
  with a small "Last seen Xs ago" label rather than continuing to render as
  if live — a frozen marker that looks current is more misleading than one
  that visibly says so. **Implementation (locked during follow-up
  `/plan-eng-review`):** the staleness check lives inside the store itself
  (one interval, flips a derived `isStale` flag) rather than each
  subscribing screen computing it independently — avoids N duplicate timers
  across stages 2 and 4's map screens.

- **Stop-visibility component:** empty state collapses to nothing
  (doesn't render at all) when a round-trip/rental ride has zero stops
  added yet — matches the plan's own minimal-chrome direction, and
  driver-mobile's version is read-only anyway so an "add a stop" prompt
  would be the wrong copy for that app. Overflow: caps at ~3 visible rows,
  scrolling within a fixed-height container beyond that, so a long stop
  list never pushes other Stage 4 chrome (map, SOS button) off-screen on
  smaller devices.

## Premium UI bar

Extend the visual language already shipped in onboarding/home
(`gradientPrimary`, glassmorphism blur, press-feedback scale, brand splash)
onto ride-flow screens that were originally built functional-first and never
got the same design pass — not a new visual direction.

**Token mapping (locked during `/plan-design-review` — the single reference
every stage's screens pull from, so polish stops being ad-hoc per screen):**

| Element | Token |
|---|---|
| Screen background | `colors.bg` (driver `#F5F8FF`, rider `#F5F7FF`) — never `colors.surface` |
| Primary action | `gradientPrimary` fill, `buttonRadius` shape, `shadows.buttonPrimary` |
| Secondary action | `colors.surface` fill + `colors.border` stroke |
| Success state (OTP verified, ride completed) | `colors.success` + `colors.successLight` |
| Error state | `colors.error` + `colors.errorLight` only |
| Headline typography | `typography.headline` — driver only (Space Grotesk); rider uses `typography.title`/bold body (no Space Grotesk, per the existing per-app font rule) |
| Body/label/caption | `typography.body`/`label`/`caption`, spacing always from the `spacing` scale — never a bare numeric margin |

**Per-stage headline copy (locked during `/plan-design-review` —
`'returning'` existed only as a backend status string before this):**

| Stage/status | User-facing headline |
|---|---|
| En route (`driver_arrived` pending) | "Driver is on the way" |
| Trip in progress (`in_progress`) | "On your trip" |
| Returning (`returning`) | "Heading back" |

**Stage 4 stacking priority (locked during `/plan-design-review` — 5
concurrent surfaces now have a defined order instead of an implicit
per-implementer choice):**
1. `SOSButton` — always top-most, persistent (safety overrides everything)
2. Active modal/sheet (`CancelSheet`, OTP entry)
3. Transient toast (speed alert — auto-dismissing)
4. Persistent chrome (ride-type banner, stop-visibility list — collapsible)

**Speed alerts are driver-facing only, never surfaced to the rider**
(locked during `/plan-design-review`) — `speed_alert_log` already feeds the
admin ops/SOS pipeline; showing a rider "your driver is speeding" mid-ride
creates anxiety with no action beyond the SOS control that already exists
for that purpose.

## Testing / exit criteria per stage

Matching the discipline established in the Days 6-8/8-10 plans and this
session's onboarding bugfix pass:
1. `npx tsc --noEmit` clean on both apps after each stage's changes.
2. Live on-device walkthrough on the physical test device (RMX3381), rigor
   scaled to stage risk.
3. Server-request-log-first debugging for any release-build failure (release
   builds don't forward JS console/errors to `adb logcat`).
4. Each stage's wiring audit findings and fixes noted before moving to the
   next stage.

## Diagrams

Stage 0 dependency graph and the reducer's widened state-transition diagram
(added during `/plan-eng-review`) — the second belongs as a code comment
above `RideStatus` in `reducer.ts` once implemented, alongside that file's
existing design-intent header:

```
                    ┌──────────────────────────┐
                    │  Stage 0: shared infra    │
                    │  (built once)             │
                    ├──────────────────────────┤
                    │ SOSButton + tel: fallback │
                    │ CancelSheet (UI-only)     │
                    │ reducer widening          │
                    │ driver-position store     │
                    │ jest-expo + RTL setup     │
                    └──┬────────┬────────┬──────┘
                       │        │        │
           ┌───────────┘        │        └───────────┐
           ▼                    ▼                     ▼
   ┌───────────────┐   ┌────────────────┐    ┌────────────────┐
   │ Stage 2:        │   │ Stage 4:        │    │ Stage 5:        │
   │ en route        │   │ trip in progress│    │ trip completion │
   │ uses: SOSButton,│   │ uses: SOSButton,│    │ uses: SOSButton,│
   │ CancelSheet,    │   │ CancelSheet,    │    │ position store  │
   │ position store  │   │ reducer, stop-  │    │ (final marker), │
   └───────────────┘   │ visibility,      │    │ cash collection  │
                         │ speed-alert,     │    └────────────────┘
                         │ position store   │
                         └────────────────┘
   Stage 1 (request/broadcast) and Stage 3 (OTP verify) don't consume
   Stage 0's infra — audit found them mostly solid, polish-only.
```

```
   accepted ──markArrived──▶ driver_arrived ──startOtp──▶ in_progress
                                                                │
                                        ┌───────────────────────┤
                                        │ one_way/rental          │ round_trip
                                        ▼                        ▼
                                   endOtp                    returning ──endOtp──▶ completed
                                        │
                                        ▼
                                   completed

   optimistic_advance → pendingOptimisticStatus set
   confirmed           → pendingOptimisticStatus cleared, confirmedStatus updated
   reverted            → pendingOptimisticStatus cleared, confirmedStatus unchanged
   (unchanged from today — the widening only adds the 'returning' node/edge above)
```

## Failure modes (Stage 0 infra)

| Codepath | Failure scenario | Test coverage | Error handling | User experience |
|---|---|---|---|---|
| `SOSButton` trigger | Network drops mid-request | Stage 0 unit test | Retry + persistent failure state + `tel:` fallback | Clear — never silent |
| `SOSButton` `tel:` fallback | Device has no telephony | Stage 0 unit test | Capability-checked, button hides itself when unavailable | Clear — no dead button |
| `CancelSheet` submit | Ride completes server-side same moment as cancel submit (race) | Stage 0 unit test, happy path only | Server 4xx presumed; exact response handling TBD at implementation | To be defined at implementation |
| Reducer `'returning'` widening | Old cached app state (pre-update) has no handling for `'returning'` on reconnect | Regression test (IRON RULE — mandatory) | TypeScript union type forces exhaustive handling at compile time | N/A if regression test passes |
| Driver-position store | `backgroundTask.ts` write races a screen's read during rapid GPS ticks | Not addressed — low risk (simple atomic assignment) | N/A | Low risk, not flagged as critical |

## Open items for the implementation plan

- Exact `SOSButton`/`CancelSheet` visual design (glassmorphism sheet vs.
  solid) — decide during implementation, not blocking this design.
- Whether return-cab active-ride wiring is confirmed broken or confirmed
  fine needs a live-data check as the first task of stage 4, since the
  audit could not confirm either way from static reading alone.
- `CancelSheet` submit-race response handling (table above) — defined at
  implementation time, not blocking this design.
