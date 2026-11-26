# Advance bookings: reserving a driver ahead of time (pre-claim)

> Design, 23 Nov 2026. Nothing here is built. Companion to `docs/ADVANCE_BOOKING_PLAN.md` (§0 chose Ola-style buffer dispatch and left
> "optional driver pre-claim" as a phase-2 extension point; this is that extension). Every claim about current behaviour was checked
> against the code named beside it.

## 1. The problem

An advance booking sits in `scheduled` until `pickup - 15 min`, then `processDispatchScheduled` flips it to `requested` and broadcasts to nearby
drivers (`api/src/jobs/processors/dispatch-scheduled.processor.ts`). Ops often know better than the broadcast: "Ravi has done this airport run
for this rider before", "the 5:30 am flight needs a reliable driver, not whoever is awake". Today the only tool is the admin **assign** action, and
for an advance booking it does the wrong thing (`adminAssignDriver`, `rides.service.ts`):

| Today's assign on a scheduled ride | Why it fails the intent |
|---|---|
| Flips `scheduled -> requested` immediately | Dispatches hours early; the 15-minute buffer is bypassed |
| Needs the driver **online right now** (`is_online` is a hard gate, 422 otherwise) | A driver who will be on shift at 5 am is offline at 11 pm, so cannot be chosen |
| Book mode sets `accepted`, `driver_sessions.status = 'on_trip'`, `is_available = false` | The driver is blocked from every other ride, for hours |
| Book mode's grace check (`FORCE_ASSIGN_GRACE_MINUTES = 4`) reverts the ride if the driver shows no GPS activity | A driver 6 h from pickup has no activity, so it reverts and broadcasts to everyone: the assignment silently undoes itself |

So advance bookings cannot be pre-assigned at all. The Dispatch desk (PR #361) now warns about this; this document is the fix.

## 2. Goal and non-goals

**Goal.** Ops can **reserve** a specific driver for an advance booking without changing the ride's state. At dispatch time that driver is offered
the ride **first**, with a short exclusive window, and everyone else only afterwards. If the reserved driver cannot take it, the ride falls back to
the normal broadcast with no delay beyond that window, and ops is told.

**Non-goals (phase 1).** No new rider-facing promise ("your driver is Ravi" is not shown until a driver has confirmed, phase 2). No penalties or
payouts for no-shows (needs a policy decision, section 10). No driver self-claim. No change to pricing, fare re-quote, OTP, payment, or settlement.

## 3. Design in one paragraph

A reservation is a **soft hold**, stored as two columns that already exist on `ride_advance_meta` (`claimed_by_driver_id`, `claimed_at`; migration
032, unused today). The ride stays `scheduled` with `rides.driver_id = NULL`, so none of the live-ride machinery (unique-live-ride indexes, driver
session state, billing snapshot, driver ride lists, force-assign grace) is touched. The only place that reads the hold is the dispatch processor,
which, when a hold exists, offers the ride to that driver first using the same "manual offer then fallback broadcast" mechanism the admin **Ask the
driver** button already uses.

## 4. State model

```
                         reserve(driver)                         release / driver unavailable / rider cancels
   scheduled ─────────────────────────────▶ scheduled + hold ───────────────────────────────────────────────▶ scheduled (no hold)
       │                                          │
       │ T-15 min (dispatch)                      │ T-15 min (dispatch)
       ▼                                          ▼
   requested ── broadcast rounds 1,2,3     requested ── offer to held driver (exclusive W seconds)
                                                          ├─ accepts ──▶ accepted        (normal accept path, unchanged)
                                                          └─ declines / no answer / not eligible ──▶ broadcast rounds, ops alerted
```

`ride_advance_meta.status` stays `pending_driver` while a hold exists in phase 1. `driver_confirmed` (already in the enum) is reserved for phase 2,
when the driver has confirmed in the app. That keeps "ops asked for a driver" and "the driver agreed" distinguishable.

## 5. Data model (expand-only, backward compatible)

One small migration (`NNN_advance_claims.sql`, must pass `.github/scripts/migration_check.py`):

```sql
ALTER TABLE ride_advance_meta
  ADD COLUMN IF NOT EXISTS claimed_by_admin_id BIGINT NULL REFERENCES admins(id),   -- who reserved it (audit; nullable: phase 2 driver claims)
  ADD COLUMN IF NOT EXISTS claim_note          TEXT   NULL;                                -- why ("regular airport driver for this rider")

-- "What is this driver already holding?" for conflict checks and for releasing on suspension. Tiny: only rows with a live hold.
CREATE INDEX IF NOT EXISTS ride_advance_meta_claimed_idx
  ON ride_advance_meta (claimed_by_driver_id)
  WHERE claimed_by_driver_id IS NOT NULL AND status IN ('pending_driver', 'driver_confirmed');
```

No change to `rides`, no new table, no enum change. The outcome of a hold (accepted, declined, expired, unavailable) is **derived** from the
`ride_assignments` row for that driver (broadcast_round 0) and `ride_status_history`, not stored a second time, so it cannot disagree with them.

## 6. API

All under `/api/v1/admin`, `requireAdmin('super_admin', 'ops_admin')`, behind the `advance_claims_enabled` system_config flag (default `false`).

**`POST /rides/:id/reserve`** `{ driverId, note? }`

In one transaction, with `SELECT ... FOR UPDATE` on the ride row and `pg_advisory_xact_lock(driverId)` so two admins cannot reserve overlapping
rides for the same driver at the same moment:

1. Ride is `scheduled` and has an advance-meta row in `pending_driver` (else 409 "already dispatching: use Assign").
2. Pickup is at least `DISPATCH_BUFFER + 10 min` away (else 409: too close, use Assign).
3. Driver is `active`, in the ride's origin city, and their vehicle category is eligible for the ride's category (the same `getEligibleDriverCategoryIds`
   rule the assign candidates use). **Not** required: online now, wallet funded now (both re-checked at dispatch; wallet shown as a warning).
4. **No overlap.** The driver holds no other reservation, and has no ride, whose window intersects this one. A window is
   `[pickup - 15 min, pickup + trip duration + 30 min]`; duration comes from the fare snapshot (`estimated_min`, or `trip_hours` for hourly round trips;
   rental package duration for rentals). Overlap is a conflict (409 with the conflicting ride id) unless `force: true` is sent with a reason.
5. Replacing an existing hold on this ride is allowed (the previous driver is released and told).
6. Write `claimed_by_driver_id/at/admin_id/note`; add a `ride_status_history` row (`scheduled -> scheduled`, actor `admin`, note
   `Reserved driver {id}: {note}`); write the admin audit entry (`admin-audit`).
7. After commit: notify the driver (section 8) and, if replaced, the previous driver.

**`DELETE /rides/:id/reserve`** `{ reason }` clears the hold (same history and audit rows) and notifies the driver. A hold can never be released silently.

**`GET /rides/:id/reserve-candidates?q=&limit=`** like `assign-candidates` but built for advance bookings: it does **not** require online, ranks by what matters
a day ahead (city, category fit, wallet OK, fewest holds that day, recent completion rate) instead of live distance, and returns for each driver their
holds in the surrounding 24 h so the admin sees the conflict before choosing. Server-side search by name or phone, capped at 50, one indexed lookup per
returned driver for holds (`ride_advance_meta_claimed_idx`).

**Dispatch desk additions** (`GET /dispatch/queue`): each row gains `claimed_driver_id` and `claimed_driver_name` (a `LEFT JOIN` for the 25 rows on the page, never
for the whole lane). The summary gains **`unreserved_next_24h`**: scheduled rides with pickup inside 24 h and no hold, the number ops actually wants to drive to zero.

## 7. Dispatch-time behaviour (the only change to the live pipeline)

In `processDispatchScheduled`, after the existing `scheduled -> requested` CAS, history row and fare re-quote, and before queueing the broadcast rounds:

```
claim = repo.getAdvanceMeta(rideId).claimed_by_driver_id
if no claim                         -> existing behaviour, byte for byte (rounds at 0 / 25 / 50 s)
else
  c = getAssignCandidates({ driverId: claim })          // exact lookup by id, added in PR #361 (needs that merged first)
  if c is online, standard mode, category ok, wallet ok, and the driver has no live ride:
      createRideAssignment(round 0, expires = now + W)  // the same row an admin "Ask the driver" creates
      send ride request socket event + push, { assignedByOps: true, reserved: true }
      queue rounds at  W+2 / W+27 / W+52 s              // the fallback; processBroadcast already no-ops once the ride is accepted
  else
      queue rounds at  0 / 25 / 50 s                    // no delay for a driver who cannot take it
      notifyAllAdmins('reserved_driver_unavailable', ride, driver, reason)
      notify the driver ("your reserved ride was offered to others: you were offline")
```

* **W = 60 s**, from a new `system_config` key `advance_claim_priority_seconds` (bounds 20 to 180). Dispatch is 15 minutes before pickup, so a 60 s head start
  costs the fallback at most one extra minute.
* The accept path is **unchanged** (`acceptAssignment`): the driver accepts the offer like any other. Sessions go `on_trip` only then, never at reservation.
* The reserved driver's offer does not displace other drivers' open offers on other rides: it uses the same offered-row rules as any manual offer.
* If the same driver holds two rides whose dispatch times fall within W of each other, the second is offered when the first is resolved, or falls back
  (section 9, "back-to-back"). The overlap rule in `reserve` makes this rare.
* Idempotent: the processor is already safe to fire twice (CAS on `scheduled`); the offer insert is `ON CONFLICT DO NOTHING`.

## 8. Notifications (phase 1 needs no driver-app release)

* **At reservation:** `notifyOwner` to the driver, new template `advance_ride_reserved` (migration adds the `notification_templates` row): "Ocar has reserved you for a
  pickup on {day}, {time} from {place}. Keep the app online from {dispatch time}: you will get the request first." It lands in the existing in-app feed and push.
* **At dispatch:** the existing ride-request card, plus `reserved: true`, which current app versions simply ignore.
* **On release, rider cancel, or fallback:** a short notice to the driver, so nobody waits for a ride that is gone.
* **Ops:** `notifyAllAdmins` for `reserved_driver_unavailable` and for a reserved driver who declined or let the window lapse.
* The rider hears nothing about a reservation in phase 1.

## 9. Edge cases

| Case | Behaviour |
|---|---|
| Rider cancels before dispatch | Existing `before_dispatch` path sets advance meta `cancelled`; add: clear the hold and notify the driver. Free, as today. |
| Reserve and dispatch race | `reserve` locks the ride row and requires `scheduled`; dispatch flips status with a CAS and reads the hold **after** flipping. They serialise on the row, so a hold is either seen by dispatch or refused with 409. |
| Driver is suspended, banned, deleted, or leaves the city | The admin driver-status change calls `releaseClaimsForDriver(driverId, reason)`: clears every hold (indexed lookup), notifies ops with the list of rides now unreserved. Dispatch re-checks status anyway, so a missed release only costs the head start. |
| Driver offline or on another trip at dispatch | Falls back at once, ops alerted (section 7). No head start is wasted on someone who cannot answer. |
| Driver declines or ignores the offer | Window lapses, rounds run, ride is offered to all. Counted in a metric; repeated declines show up on the driver. |
| Back-to-back holds | The overlap rule blocks overlapping windows at reservation; if one slips through (a `force`), the second offer follows the first's resolution or falls back. |
| Rider reschedules | There is **no reschedule endpoint today** (verified). If one is added it must re-run the overlap check and re-notify, or drop the hold. Called out so it is not forgotten. |
| Fare re-quote shows drift | Unchanged; the drift disclosure to the rider still fires at dispatch. |
| Two admins reserve different drivers for one ride | Row lock: last write wins, the earlier driver is released and told, both are in history. |
| Admin uses **Assign now** on a ride that has a hold | Allowed (explicit early dispatch). Dispatch is already done by then, so the hold is moot: the assign clears it and says so in history. |
| Redis or queue outage at dispatch | The sweep (`sweep_scheduled_rides`) is the source of truth and runs the same function; the hold is in Postgres, not in the queue. |

## 10. Scale and performance

* `reserve` touches one ride row, one driver advisory lock, one indexed lookup of that driver's holds (`ride_advance_meta_claimed_idx`, a partial index over live
  holds only) and one overlap query bounded by that driver. Cost is independent of fleet size and of how many rides exist.
* `reserve-candidates` is capped at 50 and searched server-side; hold lookups are per returned driver, not a join across the lane.
* The dispatch processor adds **one** extra indexed read (the advance-meta row it already loads) and, only when a hold exists, one exact driver lookup. Rides
  without a hold take the existing path unchanged.
* The Dispatch desk list adds a `LEFT JOIN drivers` for the 25 paged rows, after paging, as the other joins do. `unreserved_next_24h` is a count over
  `rides_scheduled_idx` (rare status, range-bounded) joined to advance meta; capped like the other counts.
* No new background job, no polling, no new table.

## 11. Admin UI (Dispatch desk)

* For a `scheduled` ride the panel's primary action becomes **Reserve a driver** (candidates without the online requirement, conflicts shown inline, a note
  field, a confirmation that says exactly what will happen: "{Driver} will be offered this ride first at {dispatch time}, for 60 seconds. They are not blocked
  from other rides until then."). **Assign now (dispatch early)** stays, as a secondary action with today's warning.
* The queue row shows a **Reserved: {name}** pill, or **No driver reserved** for rides inside 24 h; the lane gets an **Unreserved** quick filter.
* New tile **"Unreserved, next 24 h"**. The **Overdue** tile is unchanged.
* After dispatch, the ride's dispatch history (already shown) labels the first offer **Reserved driver**, so "why did Ravi not get it" is answerable.
* Release has its own button with a required reason. Support admins see holds but cannot change them.

## 12. Phase 2 (separate decision, needs a driver-app release)

Driver-side confirmation, which is what makes it a commitment rather than a head start:

* An **Upcoming** tab in the driver app (it has no scheduled-ride UI today; verified) listing holds, with **Confirm** and **Decline**. Confirm sets `driver_confirmed`;
  Decline releases the hold and alerts ops immediately, hours ahead instead of at dispatch.
* Reminders at T-24 h and T-1 h (the `reminder_24h_sent_at` / `reminder_1h_sent_at` columns already exist, unused).
* At dispatch, a confirmed driver is **auto-accepted** (no offer to race for) when online and free.
* Matching excludes a confirmed driver from other rides overlapping their window, so they are not double-booked by the broadcast.
* Rider copy ("Your driver: Ravi") once confirmed.
* Requires owner decisions: no-show consequence for the driver, compensation to the rider, and wallet or package balance rules when the ride is confirmed days ahead.

## 13. Rollout

1. Migration (additive), `system_config` keys `advance_claims_enabled=false`, `advance_claim_priority_seconds=60`, notification template. Deploy API.
2. Reserve/release endpoints, dispatch-time offer, release hooks (cancel, suspend). Flag off: the dispatch path is byte-identical to today.
3. Admin UI behind the flag. Enable in one city first; compare the accept rate of reserved offers against ordinary offers.
4. Observe, then enable everywhere.

Rollback is the flag. Holds already written are ignored when it is off, and the migration is backward compatible (the previous release ignores the new columns).

**Metrics:** `advance_claims_total{event=reserved|released|offered|accepted|declined|expired|unavailable}`; `unreserved_next_24h` as a gauge;
alert if a reserved ride's priority offer is not created within 60 s of dispatch.

## 14. Tests

* Unit: overlap rule (touching windows, trip-duration edges, hourly and rental durations); reserve refuses non-scheduled, too-close, wrong-city, wrong-category,
  inactive driver; release requires a reason; replacing a hold notifies both drivers.
* Dispatch processor: no hold is byte-identical to today; hold plus eligible driver creates the round-0 offer and delays the rounds by W; hold plus offline,
  on-trip, suspended or wallet-failed driver broadcasts immediately and alerts ops; double fire does not double-offer.
* Concurrency: reserve versus dispatch (both orderings), two admins reserving one driver for overlapping rides.
* Hooks: rider cancel clears the hold; driver suspension clears all that driver's holds and alerts ops.
* Real PostGIS run of the new queries with temporary rows (as done for the Dispatch desk), plus an integration test of reserve then dispatch.
* Admin: panel shows conflicts, confirmation text, pill, tile, and the early-assign path still warns.

## 15. Risks

| Risk | Mitigation |
|---|---|
| A hold that never produces an offer (processor bug) | Metric and alert for "hold present, no round-0 offer 60 s after dispatch"; fallback broadcast is queued in the same step, so the ride is never stranded |
| Ops over-reserve a few favourite drivers | The overlap rule, a per-driver hold count shown in the picker, and per-driver reserved-offer accept rate in the metrics |
| Head start delays the fallback | Bounded by W (60 s) against a 15-minute buffer; a driver who cannot answer gets no delay |
| Phase 1 is only a head start, not a commitment | Said so in the UI and in the driver's notice; phase 2 is the commitment |
| Reservation forgotten when a rescheduling feature is added | Section 9 names it; the reschedule change must re-run the overlap check |

## 16. Decisions needed before building

1. **Phase 1 only first** (recommended; API and admin, no driver-app release) or go straight to phase 2?
2. **Priority window** 60 s: right? (Configurable, 20 to 180.)
3. **Overlap window**: pickup minus 15 min to pickup plus trip duration plus 30 min. Is 30 min of slack right for this region?
4. **Who can reserve**: super and ops admins (as assign today)?
5. **Wallet rule**: warn at reservation and enforce at dispatch (proposed), or refuse reservation for an underfunded driver?
6. **Phase 2 policy**: driver no-show consequence and rider compensation (blocks phase 2 only).

---

## As built (migration 164): reserve a driver without locking them

The first design above held the ride for the driver. What shipped does not lock the driver at all:

- **Reserve** (`POST /admin/dispatch/rides/:id/reserve`, `DELETE` to release): the ride stays `scheduled`, `ride_advance_meta.claimed_by_driver_id` holds the driver. Checks: active driver, same city, vehicle category (from the vehicle on file, so an offline driver works), wallet, no overlapping booking (override available).
- **Overlap-aware offers** (`reservation.service.ts`): a driver with a reservation is only offered, or may only accept, a ride that fits before it: drive to the pickup (25 km/h) + the ride + `RESERVATION_BUFFER_MIN` (20). Applied in the broadcast processor, `acceptRide` and admin assignment (override with `overrideEligibility`). Fails open on a lookup error.
- **Driver app**: Upcoming bookings screen + home card, confirm ("I will be there") or give back. Reminders at 60 min (confirm) and 30 min (be ready) from the 60 s sweep; the offer card shows the booked time.
- **At dispatch time** the booking goes straight to the reserved driver through `acceptRide`. Offline or still on a ride: reservation released, recorded (`driver_reservation_events`), driver and ops told, normal search runs.
- **Late hand-backs** (inside 60 min) are a warning for ops (count on the ride panel and the driver picker), not a penalty.
- Rider copy is unchanged on purpose: "booked" until the driver is assigned; no driver name for a reservation.
