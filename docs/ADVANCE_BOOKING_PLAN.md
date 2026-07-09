# Advance Booking: Implementation Plan
## One Way · Round Trip · Rental

> **Status note (July 2026):** §1's claim that the backend is unwired is stale; it shipped and is
> fully wired. §0 research and §5–§8 edge-case reasoning remain valid. The trigger/picker UI design
> covered here was superseded by `docs/ADVANCE_BOOKING_UX_AUDIT.md`, which has since been
> implemented (`PickupTimeChip` + `SchedulePickerSheet`).

> Drafted July 2026. Scope: schedule any ride type ahead of time (30 min – 30 days out).
> Ground truth verified against current schema/code. Every claim below was checked against
> `api/src/db/migrations/*.sql` and `api/src/modules/rides/*` before writing it down.

---

## 0. What Uber/Ola actually do (research summary)

**Uber Reserve**: rider picks a pickup time 30 min–90 days out. The scheduling layer is a thin
shell around the same real-time dispatch engine (DISCO): it holds the future request in its own
store, then re-invokes the normal matching pipeline (nearby-driver lookup → ETA ranking → offer →
accept) at a computed time close to pickup, not at booking time. Uber explicitly tells riders a
driver match is **not guaranteed** at booking time, and fare/surge **can change** between booking
and pickup. For select high-value trips (mostly airport/long-distance), Uber lets drivers
proactively claim a scheduled trip hours ahead for a small guarantee bonus, but this is the
exception, not the default path.

**Ola** and most Indian aggregators dispatch **close to pickup time** (typically 10–20 min before),
because the regional driver pool is too shallow for reliable multi-hour-ahead pre-commitment:
drivers who accept 6 hours in advance frequently go offline, change plans, or get poached by
surge elsewhere in the meantime. Committing supply too early against a shallow pool produces more
last-minute cancellations, not fewer.

**Regulatory context (India, 2025 Maharashtra Aggregator Policy):** driver-side cancellation of a
confirmed ride now carries a rider-payable penalty from the platform, and surge is capped at 1.5×
base fare. Relevant because a scheduled ride that gets no driver at dispatch time, or whose driver
cancels late, needs a defined compensation/refund path, not silent failure.

**Common edge cases called out across every writeup:**
- No driver available when the scheduled window arrives → notify rider, don't fail silently.
- Rider changes pickup time/location after booking → must reflow through the same validation as a
  fresh booking (in-city reclassification, fare re-estimate).
- Price at dispatch may differ from price at booking (surge, rate card version) → must be
  disclosed, not silently charged.
- Scheduling must not be allowed to create infinite low-effort spam bookings (no-show risk) →
  cap concurrent scheduled bookings per user, charge a no-show/late-cancel fee.

Sources: [System Design of Uber (DISCO)](https://ramendraparmar.substack.com/p/system-design-of-uber-real-time-location) · [Uber Reserve](https://www.uber.com/us/en/ride/how-it-works/reserve/) · [Uber Help: Scheduling in advance](https://help.uber.com/en/riders/article/scheduling-a-ride-in-advance?nodeId=63165ec1-0910-409e-972f-0b8d8df1a605) · [Maharashtra 2025 Aggregator Policy coverage](https://www.cartoq.com/car-news/maharashtra-introduces-new-ride-hailing-policy-driver-cancellation-penalties-and-surge-price-caps/) · [Design Uber Dispatch walkthrough](https://systemdr.systemdrd.com/p/design-uber-dispatch-the-senior-walkthrough)

**Decision this plan makes:** follow the Ola-style buffer-dispatch model as the default (matches
our shallow regional fleet, Bhubaneswar/Cuttack/Puri, not SF/NYC density), with an **optional**
driver-pre-claim path left as a phase-2 extension point, because the schema already has an unused
enum shaped exactly for it (see §1).

---

## 1. What's already sitting in the codebase, unused

This is the most important finding of this audit: **advance booking was designed for, then
abandoned mid-migration.** Building on these pieces instead of inventing new ones keeps the change
surface small.

| Artifact | Location | Current state |
|---|---|---|
| `rides.scheduled_for TIMESTAMPTZ NULL` | `api/src/db/migrations/007_m5_booking.sql:156` | Column exists, never written by any code path |
| `rides_scheduled_idx` (`WHERE scheduled_for IS NOT NULL AND status='requested'`) | `007_m5_booking.sql:192-194` | Index exists, nothing queries it |
| `advance_booking_status` enum (`pending_driver, driver_confirmed, dispatched, completed, cancelled`) | `api/src/db/migrations/002_enums.sql:78-80` | Created, **zero tables reference it** |
| `ADVANCE_BOOKING_DISPATCH_BUFFER_MINUTES = 15` | `api/src/constants/limits.ts:33` | Defined, never imported anywhere |
| `BookingRequest.returnAt` / `rides.return_at` | `rides.types.ts:97`, `026_round_trip_return_at.sql` | **Not this feature.** Reserved for round-trip's old (wrong) date picker per `docs/RIDE_TYPES_PLAN.md`. Do not conflate with `scheduled_for`. |
| `rides_active_idx` partial index | `007_m5_booking.sql:187-189` | Only covers `requested/accepted/driver_arrived/in_progress`. A new `scheduled` status must NOT be added to this index (see §3) |
| `RIDE_FLOWS_AUDIT.md` finding 1.5 | `docs/RIDE_FLOWS_AUDIT.md:145-161` | Already documents that rental's `scheduledFor` is silently dropped by the frontend. This plan fixes that as part of a unified fix, not a one-off patch |

The `advance_booking_status` enum's four non-terminal states (`pending_driver → driver_confirmed →
dispatched`) are exactly the phase-2 driver-pre-claim shape described in §0. That confirms the
original spec intended this feature; it just never got wired up.

---

## 2. Mental model

Advance booking is **not a fourth ride type.** `ride_type` stays `one_way | round_trip | rental`.
Advance booking is an orthogonal *when* dimension that applies to all three:

```
[User books]
     │
     ├─ scheduledFor absent/now  → existing immediate flow (unchanged)
     │
     └─ scheduledFor = future    → NEW: ride row created in 'scheduled' status,
                                    sits idle until T-minus-buffer,
                                    then flips to 'requested' and enters the
                                    EXISTING broadcast pipeline unchanged.
```

The entire value of this design: **the matching/broadcast/OTP/payment machinery is untouched.**
A scheduled ride becomes a completely ordinary `requested` ride at dispatch time. All the work is
in (a) holding it safely until then, (b) firing the transition exactly once, exactly on time, and
(c) the edge cases around holding a future promise (reschedule, cancel, no-show, price drift).

---

## 3. Schema changes

### 3.1 New ride status: `scheduled`

```sql
-- 031_advance_booking.sql
ALTER TYPE ride_status ADD VALUE 'scheduled' BEFORE 'requested';
```

`scheduled` is deliberately **excluded** from `rides_active_idx` (dispatch queue) and from the
future "one active ride per user" unique partial index (audit finding 2.7): a user can hold
several future scheduled rides while having zero or one *live* ride in flight. It **is** included
in a dedicated concurrency guard (§6.6).

### 3.2 New table: `ride_advance_meta`

One-to-one with any ride where `scheduled_for IS NOT NULL`. Kept separate from `rides` (rather than
bolting more nullable columns onto the hottest table in the schema); mirrors the existing
`ride_cancellations` / `ride_status_history` pattern of side-tables for lifecycle metadata.

```sql
CREATE TABLE ride_advance_meta (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id               BIGINT NOT NULL UNIQUE REFERENCES rides(id),
  status                advance_booking_status NOT NULL DEFAULT 'pending_driver',
  dispatch_buffer_minutes SMALLINT NOT NULL DEFAULT 15,
  dispatch_job_id       TEXT NULL,          -- BullMQ job id, for cancel-on-reschedule
  claimed_by_driver_id  BIGINT NULL REFERENCES drivers(id),   -- phase 2 only
  claimed_at            TIMESTAMPTZ NULL,                     -- phase 2 only
  reminder_24h_sent_at  TIMESTAMPTZ NULL,
  reminder_1h_sent_at   TIMESTAMPTZ NULL,
  rate_card_id_at_booking BIGINT NULL REFERENCES rate_cards(id),  -- see §7 fare-lock discussion
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ride_advance_meta_pending_idx
  ON ride_advance_meta (status)
  WHERE status IN ('pending_driver', 'driver_confirmed');

CREATE TRIGGER trg_ride_advance_meta_updated_at
  BEFORE UPDATE ON ride_advance_meta
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();  -- existing function, per CLAUDE.md invariant
```

### 3.3 Fix `rides_scheduled_idx` predicate

The existing index (`007_m5_booking.sql:192-194`) filters `status = 'requested'`, which was written
for a status that never gets set while scheduled. Repoint it at the new status:

```sql
DROP INDEX rides_scheduled_idx;
CREATE INDEX rides_scheduled_idx
  ON rides (scheduled_for)
  WHERE scheduled_for IS NOT NULL AND status = 'scheduled';
```

This index is what both the crash-recovery sweep (§4.3) and the admin "upcoming rides" view (§9)
will scan.

### 3.4 `cancel_stage` needs one more value

`cancel_stage` currently has `before_acceptance | after_acceptance | after_arrival | in_progress`
(`002_enums.sql:75-77`), and none of these fit "cancelled while still scheduled, driver not even
searched for yet." Add:

```sql
ALTER TYPE cancel_stage ADD VALUE 'before_dispatch';
```

Used for the cancellation-fee tiering in §8.

---

## 4. Backend architecture

### 4.1 Booking-time (`createBooking`, `rides.service.ts:178`)

Add `scheduledFor?: string` to `BookingRequest` (`rides.types.ts:80-98`), **distinct from the
existing `returnAt` field; do not merge them.** Validation (new, since `rides.validator.ts` is
currently near-empty per audit 5.1; build this validation as part of that broader fix, not
separately):

```typescript
scheduledFor: z.string().datetime().optional()
  .refine(v => !v || new Date(v).getTime() - Date.now() >= MIN_ADVANCE_BOOKING_MINUTES * 60_000,
    { message: `Must be at least ${MIN_ADVANCE_BOOKING_MINUTES} minutes from now` })
  .refine(v => !v || new Date(v).getTime() - Date.now() <= MAX_ADVANCE_BOOKING_DAYS * 86_400_000,
    { message: `Cannot schedule more than ${MAX_ADVANCE_BOOKING_DAYS} days ahead` }),
```

New constants in `limits.ts` alongside the existing `ADVANCE_BOOKING_DISPATCH_BUFFER_MINUTES`:
```typescript
export const MIN_ADVANCE_BOOKING_MINUTES = 60      // matches industry floor (Uber: 30, Ola: ~60)
export const MAX_ADVANCE_BOOKING_DAYS = 7           // start conservative for a regional fleet; Uber allows 90
export const MAX_CONCURRENT_SCHEDULED_BOOKINGS = 3  // per user, spam/no-show guard
```

In `createBooking`, when `data.scheduledFor` is present:
1. Run the existing in-city classification / fare estimate exactly as today (unchanged); this
   still catches the "book an in-city trip as one-way" case from `040964cb` at booking time.
2. Insert the ride with `status = 'scheduled'`, `scheduled_for = data.scheduledFor`, **skipping** the
   `logStatusHistory('requested')` call and **skipping** enqueueing `BroadcastJobData` entirely. This
   is the one meaningful branch in the function; everything else is shared.
3. Insert `ride_advance_meta` row.
4. Enqueue **one** delayed BullMQ job on `SCHEDULER` queue (already declared, unused, in
   `jobs/queues/index.ts:9,35`):
   ```typescript
   const dispatchAt = new Date(scheduledFor).getTime()
     - ADVANCE_BOOKING_DISPATCH_BUFFER_MINUTES * 60_000
   const job = await queues[QUEUE_NAMES.SCHEDULER].add(
     'dispatch_scheduled_ride',
     { rideId: ride.id.toString() },
     { delay: Math.max(dispatchAt - Date.now(), 0), attempts: 3, backoff: { type: 'fixed', delay: 30_000 } }
   )
   await repo.setAdvanceMetaJobId(ride.id, job.id)
   ```
5. Return the ride to the user with the **estimated** fare, clearly flagged as an estimate (see §7).

### 4.2 New processor: `dispatch-scheduled.processor.ts`

```typescript
export async function processDispatchScheduled({ rideId }: { rideId: string }) {
  const id = BigInt(rideId)
  // CAS: exactly the pattern audit 5.2/6.2 already recommends everywhere else.
  const ride = await repo.updateRideStatusCAS(id, 'scheduled', 'requested')
  if (!ride) return  // already dispatched, cancelled, or rescheduled: nothing to do

  await repo.logStatusHistory({ rideId: id, fromStatus: 'scheduled', toStatus: 'requested', actor: 'system' })
  await repo.updateAdvanceMetaStatus(id, 'dispatched')

  // Re-run fare estimate at CURRENT rate card / surge (see §7 for why this must NOT reuse
  // the booking-time estimate), then hand off to the existing broadcast pipeline unchanged.
  const jobData: BroadcastJobData = { /* built from `ride`, broadcastRound: 1, ... */ }
  await queues[QUEUE_NAMES.NOTIFICATIONS].add('broadcast_ride', jobData, { attempts: 1 })

  socketEvents.sendToUser(ride.user_id.toString(), 'ride:dispatch_started', { rideId })
}
```

Register in the BullMQ worker bootstrap alongside the existing `broadcast_ride_ack_check` /
`partition-creator` / etc. processors (`api/src/jobs/processors/index.ts`; confirm the actual
worker-registration file name before wiring, since it wasn't read in this pass).

### 4.3 Crash-recovery sweep (belt-and-suspenders)

BullMQ delayed jobs survive a Redis restart *if* the Redis instance itself is durable (AOF/RDB),
but the existing audit (§6.3, `pendingOffline` Map issue) already flags that this codebase isn't
yet safe for multi-instance deploys, and Redis data loss is not a theoretical risk during dev/ops.
Add a **repeatable** BullMQ job (every 2 minutes, `SCHEDULER` queue) that is the actual source of
truth, with the delayed job as an optimization, not the only trigger:

```typescript
// repeatable job, registered once at boot
await queues[QUEUE_NAMES.SCHEDULER].add('sweep_scheduled_rides', {}, {
  repeat: { every: 120_000 }, jobId: 'sweep_scheduled_rides_repeat',
})

export async function processSweep() {
  const due = await repo.getDueScheduledRides(ADVANCE_BOOKING_DISPATCH_BUFFER_MINUTES)
  // uses rides_scheduled_idx (§3.3): WHERE scheduled_for <= now() + buffer AND status='scheduled'
  for (const ride of due) await processDispatchScheduled({ rideId: ride.id.toString() })
}
```

This makes the delayed job purely a latency optimization: if it's lost, the sweep catches the
ride within 2 minutes of its buffer window instead of exactly on time. Never worse than "slightly
late," never "silently never dispatched."

### 4.4 Reminders

`docs/RIDE_FLOWS_AUDIT.md` already notes M10 (notifications/SMS/push) is an unbuilt stub. This
plan **does not** block on building push infrastructure; reminders degrade gracefully to
in-app/socket notification only until M10 exists:
- T-24h and T-1h: emit `ride:reminder` via socket if the user is connected (best-effort; most users
  won't have the app open 24h ahead. This is explicitly a placeholder for the future SMS/push path,
  flag it as such in code, and don't pretend it's a real reminder channel yet).
- Track `reminder_24h_sent_at` / `reminder_1h_sent_at` on `ride_advance_meta` so the sweep doesn't
  double-send once M10 lands.

---

## 5. Frontend changes (all three ride types, one shared component)

Per `docs/RIDE_TYPES_PLAN.md`, Round Trip's hour-selector and Rental's package-selector are
separate screens; One Way is a third. Advance booking should be **one shared bottom-sheet
component** (`ScheduleRideSheet.tsx`) mounted identically on all three booking screens, not three
separate implementations:

- Trigger: a "Now / Schedule" toggle above the vehicle-selection CTA (matches the "clock icon"
  pattern from Uber's own UI, per §0 research).
- Date/time picker constrained to `[now + MIN_ADVANCE_BOOKING_MINUTES, now + MAX_ADVANCE_BOOKING_DAYS]`.
- On confirm: sets `scheduledFor` in the query params carried into `select-ride`, exactly the way
  `tripHours`/`rentalPackageId` already flow today.
- **This directly fixes `RIDE_FLOWS_AUDIT.md` §1.5**: the rental page's dead `startAt` picker
  either becomes this shared component (preferred; delete the bespoke one) or is left dead and
  explicitly superseded. Don't maintain two competing time-pickers.
- Confirmation screen must show: "Estimated fare, final fare may differ slightly if pricing
  changes before pickup" (see §7) and the dispatch buffer disclosure: "We'll start looking for
  your driver at {scheduledFor − 15min}."
- Post-booking: ride lands in a **"Upcoming rides"** list (new; currently the app only has "My
  Trip" singular per `CLAUDE.md`'s bottom-nav caveat), separate from the live single-active-ride
  tracking screen, since a `scheduled` ride has no driver/OTP/map to show yet.

Driver app: no changes required for the default (buffer-dispatch) model; a scheduled ride is
invisible to drivers until it becomes a normal `requested` broadcast. Phase 2 (pre-claim) would
add an "Upcoming rides" board to the driver app; **not in this phase's scope.**

---

## 6. Edge cases

### 6.1 User reschedules (changes `scheduledFor`) before dispatch
Treat as cancel + rebook, not a mutate-in-place: cancel the existing BullMQ job
(`queues[SCHEDULER].getJob(dispatch_job_id).remove()`), set old ride to `cancelled` with
`cancel_stage='before_dispatch'`, `fee_applicable=false`, then run the normal `createBooking` path
for the new time. Simpler than trying to reschedule a BullMQ delayed job in place, and gives a
clean audit trail. Reject the API request if `< MIN_ADVANCE_BOOKING_MINUTES` remains on the old job's dispatch buffer (i.e. dispatch already fired or is about to); instruct the user to cancel and rebook only if genuinely still ahead of dispatch.

### 6.2 User cancels before dispatch
Free cancellation while `status='scheduled'` and no driver work has happened yet; this is
`cancel_stage='before_dispatch'`, `fee_applicable=false` always. No broadcast rounds ran, no driver
was inconvenienced. Cancel the pending BullMQ job on cancellation to avoid a zombie dispatch racing
the cancel (CAS on `updateRideStatusCAS(id, 'scheduled', 'cancelled')` handles the race even if the
job removal itself fails; the dispatch processor's own CAS in §4.2 will then no-op).

### 6.3 No driver found at dispatch time
This reuses the **existing, already-built** `no_drivers` status and 3-round broadcast exhaustion
logic (`broadcast.processor.ts:87-99`) completely unchanged: a scheduled ride that fails to find
a driver ends up in exactly the same `no_drivers` state a same-day ride would. The only addition:
notify the user proactively (`ride:no_drivers` socket + reminder-channel best-effort) since, unlike
an immediate booking, the user may not be watching the app at that moment. Per §0 research, this
must be disclosed as a real possibility at booking time, not treated as a bug.

### 6.4 Driver cancels shortly after being dispatched (post-buffer)
No new logic; this is the ordinary post-`accepted` cancellation path (`RIDE_FLOWS_AUDIT.md` §2.2,
itself still unbuilt but tracked separately). Advance booking doesn't change what happens after a
ride reaches `requested`; it only changes how it gets there.

### 6.5 Rate card changes between booking and dispatch
Rate cards are already insert-only/versioned (`CLAUDE.md` invariant: `effective_to IS NULL` =
current). The dispatch processor (§4.2) deliberately **re-fetches the fare estimate at dispatch
time**, not at booking time. `ride_advance_meta.rate_card_id_at_booking` is stored only for
analytics/dispute resolution ("what did we quote you"), never used to compute the charged fare.
This matches Uber's explicit disclosure model from §0 rather than silently either honoring a stale
quote or silently upcharging. Surface the delta to the user post-dispatch if it exceeds a threshold
(e.g. >10%) via the existing `ride:status_update` socket channel used for other ride events.

### 6.6 Concurrent scheduled-booking spam / no-show risk
Enforce `MAX_CONCURRENT_SCHEDULED_BOOKINGS` (3) per user via a partial count query in
`createBooking`, mirroring the not-yet-built-but-recommended pattern from audit 2.7:
```sql
SELECT COUNT(*) FROM rides WHERE user_id = $1 AND status = 'scheduled'
```
This is a **separate** guard from the "one active live ride" unique index audit 2.7 proposes:
scheduled and live are different pools, checked independently. A user can have 1 live ride +
3 scheduled rides simultaneously, but not 4 live rides.

### 6.7 In-city / outstation reclassification drift
`classifyTrip` runs at booking time (unchanged, `createBooking:184-192`). Geography doesn't move
between booking and dispatch, so no re-check is needed here; this is different from fare, which
does need re-checking (§6.5).

### 6.8 Rental-specific: scheduled start + city-boundary monitoring interaction
Per `RIDE_TYPES_PLAN.md` Phase 5 (boundary alerts, still a TODO itself), a scheduled rental's
boundary monitoring only activates once the ride actually reaches `in_progress`; dispatch timing
has no interaction with that feature. Called out here only to confirm there's no hidden coupling.

### 6.9 Round-trip-specific: `scheduled_for` vs `trip_hours` vs `return_at`
Three distinct time-shaped fields will coexist on the same row once this ships:
- `scheduled_for`: when the driver should arrive (this feature).
- `trip_hours`: how long the driver is hired for once the trip starts (existing, correct per
  `RIDE_TYPES_PLAN.md`).
- `return_at`: dead/reserved column, must stay `NULL` always (per that same doc). **Do not let
  this feature accidentally populate `return_at`**: it was scoped out specifically because early
  code conflated "advance booking" with "round trip return time," which is the exact confusion
  `RIDE_TYPES_PLAN.md` fixed. Add a code comment at the `createRide` call site making this explicit.

### 6.10 Payment/wallet interaction
No charge or hold at scheduling time, consistent with the platform's existing post-trip
cash/wallet settlement model (no pre-auth infrastructure exists; don't introduce one for this
feature alone). A late-cancellation fee (§8) is charged the same way existing cancellation fees
are, via `ride_cancellations.fee_amount`, settled against the wallet on the next transaction,
not a separate payment gateway call.

### 6.11 Timezone / DST
`scheduled_for` is `TIMESTAMPTZ` already (correct); client must send full ISO-8601 with offset.
No DST concerns for this region (India, UTC+5:30 fixed, no DST) but keep the column type as-is
regardless for correctness/portability.

### 6.12 Multi-instance dispatch race
If the API scales to >1 instance (flagged as a prerequisite gap in audit §6.3/6.1), both the
delayed BullMQ job and the repeatable sweep could fire near-simultaneously from different workers.
The CAS update in `updateRideStatusCAS(id, 'scheduled', 'requested')` (§4.2) is what makes this
safe: whichever fires first wins, and the second gets zero rows back and no-ops. This is the same
guarantee pattern the audit already recommends project-wide (§5.2/6.2 in `RIDE_FLOWS_AUDIT.md`),
applied here rather than invented fresh.

### 6.13 Admin cancels/edits a scheduled ride
Admin-initiated cancellation (e.g. a fleet emergency) should go through the same CAS + job-removal
path as §6.2, with `cancel_actor='admin'`. Not a new mechanism; reuses `cancel_stage` +
`cancelled_by_admin_id`, already modeled in `ride_cancellations`.

---

## 7. Fare handling: explicit decision

**Do not lock the fare at booking time.** Show an estimate, recompute for real at dispatch (§4.2,
§6.5). Reasons:
- Rate cards are versioned by design (`CLAUDE.md` invariant) specifically so prices can change,
  and locking a quote for up to 7 days would mean carrying "V1 pricing debt" against future rate cards,
  with no ledger built for that (payments audit finding 2.9 already shows unhandled financial edge
  cases exist; don't add another).
- Matches the disclosed industry behavior from §0: riders are told advance pricing is an estimate.
- If product later wants a genuine price-lock guarantee (a paid add-on, e.g. "lock this fare for
  ₹20"), that's a clean phase-2 addition on top of `rate_card_id_at_booking`, which this plan
  already stores for exactly that future option.

---

## 8. Cancellation fee tiering

| Stage | `cancel_stage` | Fee |
|---|---|---|
| Cancelled while `scheduled`, dispatch hasn't fired | `before_dispatch` (new, §3.4) | None |
| Cancelled after dispatch, before driver accepts | `before_acceptance` (existing) | None (unchanged) |
| Cancelled after driver accepts | `after_acceptance` / `after_arrival` (existing) | Existing policy, unbuilt per audit §2.2; advance booking doesn't change this, just feeds into it |

No new fee logic invented; advance booking only adds the free `before_dispatch` tier, since that's
the one stage that literally cannot exist in the current immediate-booking flow.

---

## 9. Admin visibility

`live-map` and `analytics` are both TODO stubs (`CLAUDE.md` module table). Out of scope to build
either fully here, but the minimum viable addition for ops:
- A read-only "Upcoming rides" table on the existing rides admin page, querying
  `ride_advance_meta` joined to `rides` where `status IN ('scheduled')`, sorted by `scheduled_for`.
- Surfaces stuck bookings (e.g. `pending_driver` past its `scheduled_for` time, meaning the sweep failed) so
  ops can manually intervene, given this is a new failure mode that doesn't exist today.

---

## 10. Build sequence

```
Phase 1: Schema + core dispatch loop (backend only, no UI)
  1.1  Migration 031: ride_status 'scheduled', ride_advance_meta table,
       cancel_stage 'before_dispatch', fixed rides_scheduled_idx
  1.2  BookingRequest.scheduledFor + Zod validation + createBooking branch
  1.3  dispatch-scheduled.processor.ts + SCHEDULER queue wiring
  1.4  Crash-recovery sweep (repeatable job)
  1.5  updateRideStatusCAS helper (shared; also unblocks audit 5.2/6.2 elsewhere)

Phase 2: Frontend (shared component across all 3 ride types)
  2.1  ScheduleRideSheet.tsx shared bottom sheet
  2.2  Wire into one-way / round-trip / rental booking screens
  2.3  "Upcoming rides" list screen (user app)
  2.4  Reschedule + cancel actions on upcoming-ride detail

Phase 3: Edge-case hardening
  3.1  Concurrent scheduled-booking cap (§6.6)
  3.2  Fare-drift disclosure on dispatch (§6.5)
  3.3  Admin "upcoming rides" visibility (§9)

Phase 4: Deferred / explicitly out of scope for v1
  4.1  Driver pre-claim flow (driver_confirmed state; enum supports it, not built)
  4.2  Paid fare-lock guarantee add-on
  4.3  Real push/SMS reminders (blocked on M10)
```

---

## 11. Files touched (expected)

| Area | Files |
|---|---|
| Migration | `api/src/db/migrations/031_advance_booking.sql` (new) |
| Types/validation | `api/src/modules/rides/rides.types.ts`, `rides.validator.ts` |
| Service/repo | `api/src/modules/rides/rides.service.ts` (`createBooking`), `rides.repository.ts` (new: `updateRideStatusCAS`, `getDueScheduledRides`, `setAdvanceMetaJobId`, `updateAdvanceMetaStatus`) |
| Jobs | `api/src/jobs/processors/dispatch-scheduled.processor.ts` (new), `api/src/jobs/queues/index.ts` (wire `SCHEDULER` usage), worker registration file |
| Constants | `api/src/constants/limits.ts` (add `MIN_ADVANCE_BOOKING_MINUTES`, `MAX_ADVANCE_BOOKING_DAYS`, `MAX_CONCURRENT_SCHEDULED_BOOKINGS`) |
| Frontend (user) | New `ScheduleRideSheet.tsx`; edits to `select-ride/page.tsx`, `round-trip/page.tsx`, `rental/page.tsx`; new "Upcoming rides" screen |
| Admin | New section on existing rides admin page |

---

*This plan intentionally reuses `scheduled_for`, `advance_booking_status`, and
`ADVANCE_BOOKING_DISPATCH_BUFFER_MINUTES`, all already present in the schema/constants but
unwired, rather than introducing parallel new fields. It also deliberately does not touch
`return_at`, which is reserved for a different (currently dead) concept per `RIDE_TYPES_PLAN.md`.*
