# Backend Production-Readiness — Security & Correctness Hardening — Design

**Date:** 2026-08-24
**Status:** Design — not yet implemented
**Scope:** Every finding from the 2026-08-24 four-track backend audit (payments/wallet/commission,
driver document verification, disputes/SOS, ride lifecycle/fare), categorized, root-caused, and
given a best-practice fix. TOTP bypass is explicitly out of scope (tracked separately, intentional).

This is a design document, not a task-by-task implementation plan. Each section is sized to become
its own implementation plan (via `superpowers:writing-plans`) when picked up — they touch disjoint
files and can ship independently, in the priority order given in §00.

---

## 00. Priority order

| # | Issue | Severity | Exploitable by |
|---|---|---|---|
| 1 | [§01.1](#011-ride-otp-brute-force) Ride OTP has no brute-force protection | Critical | Any driver, on any ride |
| 2 | [§01.2](#012-driver-action-idor) Driver ride-action endpoints missing ownership check | High | Any online driver |
| 3 | [§02.1](#021-doc-gate-not-continuously-enforced) Doc rejection/expiry doesn't end an active session | Critical | Any driver already online |
| 4 | [§02.2](#022-self-reported-expiry) Document expiry is self-reported, never admin-verified | Critical | Any driver at onboarding |
| 5 | [§03.1](#031-safety-idor) SOS/dispute creation has no ride-ownership check | High | Any authenticated user |
| 6 | [§03.2](#032-sos-flood) No rate limit on SOS creation | High | Any authenticated user (worse combined with #5) |
| 7 | [§04.1](#041-negative-balance) Driver minimum-balance floor disabled + no debt recovery | High | Any commission driver |
| 8 | [§04.2](#042-non-atomic-settlement) Ride settlement not atomic across ledger writes | High | Crash/restart during settlement |
| 9 | [§05.1](#051-client-trusted-fare) Booking fare trusts client distance with no server bound | High | Any rider |
| 10 | [§03.3](#033-warnings-dead) Driver warnings never written, no escalation | High | N/A — silent feature gap |
| 11 | [§03.4](#034-sla-no-sweep) No SOS/dispute SLA escalation sweep | Medium | N/A — silent feature gap |
| 12 | [§05.2](#052-cancellation-fee-inert) Cancellation fee computed but never charged | Medium | Any rider |
| 13 | [§05.3](#053-gps-distance-unclamped) Round-trip GPS distance has no plausibility ceiling | Medium | Any rider/driver with a noisy GPS trail |
| 14 | [§02.3](#023-toctou-reupload) TOCTOU: re-upload between admin review and approve | Medium | Any driver |
| 15 | [§04.3](#043-refund-cap) Refunds have no cap against original payment | Medium | Admin resolving a dispute (data-integrity, not attacker) |
| 16 | [§04.4](#044-error-leakage) Gateway error bodies persisted and returned to admin API | Low | N/A — info leak, admin-only |

---

## 01. Ride lifecycle: OTP & authorization

### 01.1 Ride OTP brute force {#011-ride-otp-brute-force}

**Where:** `api/src/modules/rides/rides.service.ts:814` (`verifyStartOTP`), `:1669` (`verifyEndOTP`).

**Problem:** Ride OTPs are 4 digits (10,000 combinations, per `RIDE_OTP_LENGTH` in
`api/src/constants/limits.ts` — intentionally shorter than login OTP). Verification is a bare
`hashOtp(otp) === ride.*_otp_hash` with no attempt counter and no lockout. The audit trail
(`ride_otp_events`) even hardcodes `attempt_number: 1` on every insert, so a sweep leaves no
detectable signature. The only rate limit in front is the *global* 600 req/min/principal cap in
`app.ts:163`, which permits ~17 minutes to exhaust the entire keyspace.

**Why the codebase already knows the right shape:** login OTP (`api/src/lib/otp.ts`,
`consumeOtp()`) already implements `OTP_MAX_ATTEMPTS` with Redis-backed attempt tracking. Ride OTP
never adopted the same primitive because it verifies against a DB column, not a Redis TTL entry —
but attempt-limiting doesn't require the OTP to live in Redis, only the *counter* does.

**Fix — Redis attempt counter, independent of where the OTP itself is stored:**

```typescript
// api/src/lib/otp.ts — new export, alongside existing consumeOtp()
const RIDE_OTP_MAX_ATTEMPTS = 5
const RIDE_OTP_LOCKOUT_SECONDS = 15 * 60

export async function checkRideOtpAttempts(rideId: bigint, otpType: 'start' | 'end'): Promise<void> {
  const key = `ride:otp:attempts:${rideId}:${otpType}`
  const attempts = await redis.incr(key)
  if (attempts === 1) await redis.expire(key, RIDE_OTP_LOCKOUT_SECONDS)
  if (attempts > RIDE_OTP_MAX_ATTEMPTS) {
    throw new AppError('RIDE_OTP_LOCKED', 429, 'Too many incorrect attempts. Try again later.')
  }
}

export async function clearRideOtpAttempts(rideId: bigint, otpType: 'start' | 'end'): Promise<void> {
  await redis.del(`ride:otp:attempts:${rideId}:${otpType}`)
}
```

Call `checkRideOtpAttempts` before the hash comparison in both `verifyStartOTP` and `verifyEndOTP`;
call `clearRideOtpAttempts` on success. This is the same fixed-window-counter shape as
`consumeOtp`, so there's one mental model for "OTP attempt limiting" in the codebase, not two.

**Also fix while touching this code:** replace the hardcoded `attempt_number: 1` in the
`ride_otp_events` insert with `SELECT COUNT(*) + 1 FROM ride_otp_events WHERE ride_id = $1 AND otp_type = $2`
(or read `attempts` off the Redis counter above — cheaper, already fetched) so the audit trail is
truthful independent of the new lockout.

**Scalability note:** Redis INCR+EXPIRE is O(1) and this is a per-ride key with a bounded TTL — no
cleanup job needed, keys self-expire. Fits the existing Redis usage pattern (`api/src/db/redis.ts`)
with no new infrastructure.

### 01.2 Driver ride-action endpoints missing ownership check (IDOR) {#012-driver-action-idor}

**Where:** `markArrived` (`rides.service.ts:745`), `verifyStartOTP` (`:814`), `verifyEndOTP`
(`:1669`). All three validate `ride.status` but never `ride.driver_id === driverId`. Sibling
endpoints in the same file — `startReturn` (`:787`), `cancelRideAsDriver` (`:1139`),
`endRideEarlyAsDriver` (`:1227`), `collectCash` (`:2042`) — already do this correctly, which is
what makes the gap a straightforward regression risk, not a design ambiguity.

**Root cause:** the ownership check is duplicated ad hoc at the top of each service function
instead of being structurally impossible to omit.

**Fix — two layers, don't rely on developer memory alone:**

1. **Immediate, minimal:** add the same guard the other four functions already use, at the top of
   all three functions:

```typescript
if (ride.driver_id !== driverId) {
  throw new AppError('RIDE_NOT_ASSIGNED', 403, 'This ride is not assigned to you.')
}
```

2. **Structural, prevents recurrence:** change the repository fetch these functions call from
   "fetch by `ride_id`, then check" to "fetch scoped by `(ride_id, driver_id)` — no ride, no
   ownership, same NULL result." e.g.:

```typescript
// rides.repository.ts — new export, used by every driver-scoped ride action
export async function getRideForDriverAction(rideId: bigint, driverId: bigint): Promise<Ride | null> {
  const result = await pool.query(
    `SELECT * FROM rides WHERE id = $1 AND driver_id = $2`,
    [rideId, driverId]
  )
  return result.rows[0] ?? null
}
```

Every driver-facing ride-action service function calls this instead of a bare `getRideById`, so a
missing ownership check becomes a missing row (caught by the existing "ride not found" error path)
rather than a silent authorization bypass. This is the same "fail closed by construction" principle
`acceptAssignment`'s atomic `UPDATE ... WHERE status='requested'` already uses for the race
condition it guards against (verified sound in the audit) — apply the same idea to authorization.

**Scalability note:** this is a net negative line count (one shared repository function replaces
five duplicated ownership checks) and removes an entire class of future omission, so it's strictly
cheaper to maintain than the status quo.

---

## 02. Driver document verification

### 02.1 Doc rejection/expiry doesn't end an active session {#021-doc-gate-not-continuously-enforced}

**Where:** `goOnline()` (`rides.service.ts:143`) gates on `hasApprovedRequiredDocs` once, at the
moment of going online. The candidate-matching query for ride broadcast
(`rides.repository.ts:140-176`) filters on `driver_sessions.status = 'online'` + wallet + category +
city — never on live document eligibility. `acceptRide()` (`:641`) has no check either.
`syncDriverStatusAfterDocChange` (`admin.repository.ts`) flips `drivers.status` to
`'docs_rejected'` on admin rejection but never ends the driver's session.

**Root cause:** document eligibility was implemented as a *gate at entry* (goOnline) instead of an
*invariant of being online* (continuously true while in the broadcast pool). Any state change after
entry — admin rejection, midnight expiry — has no path to re-assert the invariant.

**Fix — make the broadcast pool query itself doc-aware, and force-offline on revocation:**

1. **Continuous enforcement in the read path** — add the eligibility check to the candidate query
   itself, so there is no window where an ineligible driver is reachable:

```sql
-- rides.repository.ts, candidate-matching query — add to the existing WHERE clause
AND NOT EXISTS (
  SELECT 1 FROM driver_documents dd
  WHERE dd.driver_id = ds.driver_id
    AND dd.is_required = true
    AND (dd.status != 'approved' OR dd.valid_until < CURRENT_DATE)
)
```

   (Exact join shape depends on which table already carries "required doc types" — reuse whatever
   `hasApprovedRequiredDocs` already queries; do not duplicate that logic, extract it into a shared
   SQL fragment or a repository function both call.)

2. **Force-offline on revocation** — `syncDriverStatusAfterDocChange` already runs inside a
   `SELECT ... FOR UPDATE` transaction (confirmed sound in the audit). Extend it to also end any
   active session when the outcome is `docs_rejected` or an expiry sweep fires:

```typescript
// admin.repository.ts — inside syncDriverStatusAfterDocChange, after the drivers.status update
if (newStatus === 'docs_rejected') {
  await client.query(
    `UPDATE driver_sessions SET status = 'offline', ended_at = now()
     WHERE driver_id = $1 AND status = 'online'`,
    [driverId]
  )
  // reuse the existing session-end socket/notification path here (socketEvents), not a new one
}
```

**Why both layers, not just one:** the read-path fix alone still lets an ineligible driver keep a
live `online` session (misleading ops dashboards, and a re-check race if #1's query has a bug);
the force-offline alone still has a window between rejection and the next broadcast tick if the
driver was mid-ride-assignment. Both together make the invariant true continuously, not
eventually.

### 02.2 Document expiry is self-reported, never admin-verified {#022-self-reported-expiry}

**Where:** `valid_from`/`valid_until` are taken directly from the driver's upload request body
(`drivers.service.ts:242-255`) and stored verbatim. Admin approval never sets or overwrites them.

**Root cause:** the schema conflates "what the driver claims the document says" with "what the
platform has verified" into one column, so approval only confirms document *authenticity*, not
document *validity period*.

**Fix — separate claimed vs. verified expiry, require the latter to be set at approval:**

```sql
-- new migration, e.g. 083_verified_doc_expiry.sql
ALTER TABLE driver_documents RENAME COLUMN valid_until TO claimed_valid_until;
ALTER TABLE driver_documents ADD COLUMN verified_valid_until DATE;
-- same two columns on driver_vehicle_documents
```

`hasApprovedRequiredDocs` and the new broadcast-query check in §02.1 both read
`verified_valid_until`, never `claimed_valid_until` — the claimed value becomes informational only
(shown to the admin reviewer as a cross-check, never trusted for gating). The approve endpoint
requires `verified_valid_until` as a request parameter and rejects approval without it:

```typescript
// admin.service.ts — approveDriverDoc
if (!input.verifiedValidUntil) {
  throw new AppError('VALIDATION_ERROR', 400, 'Verified expiry date is required to approve a document.')
}
```

This mirrors how `daily_verifications` already separates a driver's self-check from an
authoritative record — the same pattern, applied one layer earlier.

**Maintainability note:** this is a rename + one new column + one new required parameter — no new
subsystem, and it closes the gap for every document type through the same approval code path
instead of a doc-type-specific patch.

### 02.3 TOCTOU: re-upload between admin review and approve {#023-toctou-reupload}

**Where:** `upsertDriverDocument`/`upsertVehicleDocument` (`drivers.repository.ts:288-294,
320-326`) overwrite `file_url` and reset `status='pending'` on the same row id via
`ON CONFLICT`. `approveDriverDoc` approves by `docId` with no version guard, so an approval issued
against the row an admin reviewed can land on content re-uploaded afterward.

**Fix — optimistic concurrency on the approve write, standard pattern for this exact race:**

```typescript
// admin.service.ts — approveDriverDoc(docId, adminId, seenUpdatedAt, ...)
const result = await pool.query(
  `UPDATE driver_documents
   SET status = 'approved', verified_valid_until = $1, reviewed_by = $2, reviewed_at = now()
   WHERE id = $3 AND updated_at = $4
   RETURNING id`,
  [verifiedValidUntil, adminId, docId, seenUpdatedAt]
)
if (result.rowCount === 0) {
  throw new AppError('DOC_CHANGED', 409, 'This document was modified since you last viewed it. Refresh and try again.')
}
```

The admin API response for a pending document already includes `updated_at`
(it's a plain column) — the admin frontend passes it back unmodified on approve/reject, same
shape as an HTTP `If-Match` / ETag check. No new column, no new table.

---

## 03. Safety module (SOS, disputes, ratings)

### 03.1 SOS/dispute creation has no ride-ownership check (IDOR) {#031-safety-idor}

**Where:** `sos.service.ts:10-29` (`triggerSos`), `disputes.service.ts:6-28` (`createDispute`).
Both load the ride but never assert the caller is that ride's rider or driver.
`ratings.service.ts:23-33` already does this correctly (`rateeId` derived from the ride row, not
client input, and caller identity checked against `ride.user_id`/`ride.driver_id`) — same file
family, inconsistent enforcement.

**Fix — extract the check ratings already has into a shared guard, apply it in both places:**

```typescript
// api/src/modules/safety/safety.guards.ts (new file — small, shared by sos/disputes/ratings)
export function assertRideParticipant(ride: Ride, principal: { role: 'user' | 'driver'; id: bigint }): void {
  const isParticipant =
    (principal.role === 'user' && ride.user_id === principal.id) ||
    (principal.role === 'driver' && ride.driver_id === principal.id)
  if (!isParticipant) {
    throw new AppError('NOT_RIDE_PARTICIPANT', 403, 'You are not a participant on this ride.')
  }
}
```

Call at the top of `triggerSos` and `createDispute`, right after the ride is fetched. Refactor
`ratings.service.ts` to call the same guard instead of its inline equivalent — one authorization
rule for "is this caller party to this ride," used by every safety endpoint, instead of three
independent implementations that can drift.

### 03.2 No rate limit on SOS creation {#032-sos-flood}

**Where:** `sos.service.ts` + `safety.routes.ts:10` — no throttle, no dedup.

**Fix — two-part, because SOS is safety-critical and a hard block on a genuine repeat press is
worse than the flood it prevents:**

1. **Dedup, not block, within a short window** — collapse repeated SOS presses on the *same ride*
   within 30 seconds into the existing alert (update `last_triggered_at`, don't insert a new row,
   don't re-page):

```typescript
const existing = await getActiveSosForRide(rideId) // status = 'triggered', created in last 30s
if (existing) {
  await touchSosAlert(existing.id) // bump last_triggered_at, no new notification
  return existing
}
```

2. **Per-user hourly cap, not per-ride** — this is what stops #03.1-enabled flooding across many
   rides, since dedup alone only protects one ride at a time:

```typescript
const key = `sos:hourly:${principal.role}:${principal.id}`
const count = await redis.incr(key)
if (count === 1) await redis.expire(key, 3600)
if (count > 5) {
  throw new AppError('SOS_RATE_LIMITED', 429, 'Too many safety alerts. Contact support directly if this is urgent.')
}
```

Five real SOS events from one person in an hour is already an extreme edge case worth a human
follow-up regardless — the cap doesn't suppress genuine emergencies, it stops scripted abuse.

### 03.3 Driver warnings never written, no escalation (dead feature) {#033-warnings-dead}

**Where:** zero inserts into `driver_warnings` anywhere in `api/`. `resolveDispute`
(`disputes.service.ts:65-119`) records outcome strings `driver_warned`/`driver_suspended` but never
writes a warning row or changes `drivers.status`.

**Fix — wire the outcome enum to actual consequences, reusing the driver status state machine that
already exists:**

```typescript
// disputes.service.ts — resolveDispute, after the outcome is persisted
if (outcome === 'driver_warned' && dispute.driver_id) {
  await insertDriverWarning(dispute.driver_id, {
    disputeId: dispute.id,
    reason: resolutionNotes,
    issuedBy: adminId,
  })
  const recentWarnings = await countDriverWarnings(dispute.driver_id, { sinceDays: 90 })
  if (recentWarnings >= 3) {
    await syncDriverStatusAfterDocChange /* or a sibling function */ (dispute.driver_id, 'suspended', {
      reason: '3+ warnings in 90 days',
      auto: true,
    })
    // reuse the existing driver-status-change notification path — do not build a new one
  }
} else if (outcome === 'driver_suspended' && dispute.driver_id) {
  await updateDriverStatus(dispute.driver_id, 'suspended', { reason: resolutionNotes, adminId })
}
```

`3 warnings / 90 days → auto-suspend` is a reasonable default threshold, not a magic requirement —
flag it as configurable via `system_config` (same mechanism already used for
`driver_minimum_balance`) rather than hardcoding it, since this is exactly the kind of policy value
ops will want to tune without a deploy:

```sql
INSERT INTO system_config (key, value, description) VALUES
  ('driver_warning_suspend_threshold', '3', 'Warnings within the rolling window that trigger auto-suspension'),
  ('driver_warning_window_days', '90', 'Rolling window for warning-count escalation');
```

### 03.4 No SOS/dispute SLA escalation sweep {#034-sla-no-sweep}

**Where:** `sos_alerts.status` and `disputes.sla_due_at` are computed and indexed
(`sos_alerts_status_idx`, built for exactly this) but nothing ever sweeps them. Real-time delivery
(`getIO().to('admin:ops').emit(...)`) is wrapped in a swallow-all `try/catch` and is lost if no
admin socket is connected; SMS goes to a single `ADMIN_PHONE` and is skipped if unset.

**Fix — a BullMQ repeatable job, same shape as the existing `scheduler.worker.ts` doc-expiry
sweep, not a new job system:**

```typescript
// api/src/jobs/workers/scheduler.worker.ts — add alongside the existing doc-expiry sweep
async function sweepStaleSosAlerts(): Promise<void> {
  const stale = await getStaleSosAlerts({ olderThanMinutes: 5 }) // status='triggered', not yet escalated
  for (const alert of stale) {
    await notifyAllAdmins({
      type: 'sos_unacknowledged',
      title: 'SOS alert unacknowledged for 5+ minutes',
      body: `Ride ${alert.rideId} — triggered ${alert.createdAt}`,
    }) // reuse the existing notifyOwner/notifyAllAdmins path, not a new notification channel
    await markSosEscalated(alert.id) // prevents re-notifying every sweep tick
  }
}

async function sweepBreachedDisputeSlas(): Promise<void> {
  const breached = await getBreachedDisputes() // sla_due_at < now(), status not resolved, not yet escalated
  for (const dispute of breached) {
    await notifyAllAdmins({ type: 'dispute_sla_breached', title: 'Dispute SLA breached', body: `Dispute ${dispute.id}` })
    await markDisputeSlaEscalated(dispute.id)
  }
}
```

Register both on the same repeatable-job cron the doc-expiry sweep already uses (e.g. every 5
minutes) — this is additive to an existing worker file, not a new piece of infrastructure.
`markSosEscalated`/`markDisputeSlaEscalated` need one new boolean column each
(`escalated_at TIMESTAMPTZ`) so the sweep is idempotent and doesn't re-page on every tick.

---

## 04. Payments, wallet, commission

### 04.1 Driver minimum-balance floor disabled + no debt recovery {#041-negative-balance}

**Where:** `system_config.driver_minimum_balance` is currently `-999999` (documented in
`CLAUDE.md` as intentional, temporary, for client testing) and migration 064 dropped the DB-level
`balance >= 0` CHECK entirely — not just relaxed it.

**This one is primarily an ops action, already tracked in CLAUDE.md's "Pending Ops Actions" — the
SQL to flip it back to `500` is already written there.** The design gap worth closing alongside
that flip is that even at `500`, there's currently no mechanism for a driver who *does* go negative
(e.g. from a disputed refund debit) to recover other than a manual admin wallet top-up.

**Fix — debt-first allocation on wallet top-up, standard pattern for any ledger with a credit
floor:**

```typescript
// payments.service.ts — topUpDriverWallet, before crediting the requested amount
const wallet = await getDriverWalletForUpdate(driverId, client) // existing FOR UPDATE pattern
if (wallet.balance < 0) {
  const debtCleared = Math.min(topUpAmount, Math.abs(wallet.balance))
  // debtCleared goes to zeroing the balance; only the remainder becomes spendable/withdrawable
}
```

This closes the "unlimited uncollectable dues" failure mode structurally — a driver can't build up
negative balance *and* keep withdrawing new top-ups around it — without needing the minimum-balance
gate to be perfectly tuned as the only line of defense.

### 04.2 Ride settlement not atomic across ledger writes {#042-non-atomic-settlement}

**Where:** `payments.service.ts:239-278` (`confirmRidePayment`) and `rides.service.ts:2080-2086`
(`collectCash`). Status flip commits first; `deductCommission`, `accrueDriverEarning`,
`creditCashback` each run as separate transactions after. Already flagged in-code with a
`ponytail:` comment as a deferred gap — no reconciliation exists.

**Fix — wrap the whole settlement in one transaction, since every step here belongs to a single
business event ("this ride's payment is settled") and none of them has a reason to survive
independently:**

```typescript
// payments.service.ts — confirmRidePayment, restructured
const client = await pool.connect()
try {
  await client.query('BEGIN')
  await markRideSettled(rideId, client)          // was: separate commit
  await deductCommission(rideId, client)          // was: separate commit
  await accrueDriverEarning(rideId, client)       // was: separate commit
  await creditCashback(rideId, client)            // was: separate commit
  await client.query('COMMIT')
} catch (err) {
  await client.query('ROLLBACK')
  throw err
} finally {
  client.release()
}
```

A crash mid-transaction now rolls back everything — the ride re-enters the settlement flow on
retry with `status` still `pending`/`cash_collected_at` still `NULL`, so the existing idempotency
guards (`WHERE status = 'pending'`) work correctly on the next attempt instead of no-opping past
already-partially-applied state. This is the smallest fix that closes the gap: no outbox, no new
queue, no eventual-consistency reasoning — a single business transaction becomes one database
transaction, which is what it should have been. Reach for an outbox/saga pattern only if a future
step in this chain needs to call an external, non-transactional system (e.g. an actual RazorpayX
payout call) — none of the four current steps do.

### 04.3 Refunds have no cap against original payment {#043-refund-cap}

**Where:** `disputes.service.ts:87-108`. `input.refundAmount` inserted verbatim into `refunds`, no
check against `payments.amount`, no uniqueness constraint. Currently low-risk only because nothing
calls Razorpay's refund API yet (rows sit `status='requested'` for manual processing) — this
becomes a real money-loss bug the moment auto-refund disbursement ships.

**Fix — validate before insert, and make it structurally impossible at the DB layer too:**

```typescript
// disputes.service.ts — before inserting the refund row
const payment = await getPaymentById(dispute.paymentId)
const alreadyRefunded = await getSumOfRefunds(dispute.paymentId) // SUM(amount) WHERE payment_id = $1
if (input.refundAmount > payment.amount - alreadyRefunded) {
  throw new AppError('REFUND_EXCEEDS_PAYMENT', 400, 'Refund amount exceeds the remaining refundable balance.')
}
```

```sql
-- new migration: defense in depth, catches any future code path that skips the app-level check
ALTER TABLE refunds ADD CONSTRAINT refund_amount_positive CHECK (amount > 0);
-- (the cross-row SUM <= payment.amount constraint can't be a CHECK; enforce via the app-level
-- guard above plus a serializable transaction around the insert, same FOR UPDATE pattern used
-- elsewhere in payments.service.ts)
```

Build this validation now, before the auto-refund disbursement worker exists — it's a much smaller
diff to add a guard than to retrofit one after a real overpayment.

### 04.4 Gateway error bodies persisted and returned to admin API {#044-error-leakage}

**Where:** `settlements.service.ts:364,378` stores the raw RazorpayX HTTP error body in
`settlements.failure_reason`; admin endpoints return that field verbatim.

**Fix — same code/message split the codebase's `error.message` rule already implies elsewhere:**

```typescript
// settlements.service.ts
const FAILURE_CODE_MAP: Record<string, string> = {
  invalid_account_number: 'PAYOUT_INVALID_ACCOUNT',
  insufficient_balance: 'PAYOUT_INSUFFICIENT_PLATFORM_BALANCE',
  // extend as real RazorpayX error codes are observed in logs
}
const code = FAILURE_CODE_MAP[razorpayError.code] ?? 'PAYOUT_FAILED'
await updateSettlementFailure(settlementId, { failureCode: code }) // new column, replaces failure_reason text
logger.error({ settlementId, razorpayError }, 'Settlement payout failed') // full detail stays in Pino/Loki only
```

Admin UI shows the mapped code (human-readable via a static lookup on the frontend); full detail is
still available to whoever has Grafana/Loki access via the existing observability stack, not
deleted — just moved off the API response.

---

## 05. Fare & cancellation integrity

### 05.1 Booking fare trusts client distance with no server bound {#051-client-trusted-fare}

**Where:** `createBooking` (`rides.service.ts:386`) passes client-supplied `distanceKm`/`durationMin`
straight into `getFareEstimate` and persists them to `fare_snapshots`. For one-way/rental,
`total_final = total_estimated` at completion (`verifyEndOTP:1872`) — the client-supplied
booking-time number **is** the bill. `getRoute` (geo module, backs the existing Google Routes
integration already used for ETA) is available but unused for fare validation.

**Fix — reuse the existing routing integration as a bound, not a new dependency:**

```typescript
// rides.service.ts — createBooking, before persisting the fare snapshot
const serverRoute = await getRoute(pickup, dropoff, waypoints) // existing geo.service.ts function
const tolerance = 0.15 // 15% — accommodates real routing variance, not a tight equality check
const withinBounds =
  data.distanceKm <= serverRoute.distanceKm * (1 + tolerance) &&
  data.distanceKm >= serverRoute.distanceKm * (1 - tolerance)

if (!withinBounds) {
  logger.warn({ rideId, clientDistance: data.distanceKm, serverDistance: serverRoute.distanceKm }, 'Booking distance outside server tolerance')
  data.distanceKm = serverRoute.distanceKm // server value wins, don't just reject the booking
  data.durationMin = serverRoute.durationMin
}
```

Correcting to the server value (rather than hard-rejecting the booking) keeps the rider experience
intact for the common case of minor client-side rounding/staleness, while removing the ability to
lowball fare through the client input entirely — the server number is authoritative either way.
This reuses `getRoute`, which the codebase already calls for ETA instrumentation on the same
request path — no new external API integration.

### 05.2 Cancellation fee computed but never charged {#052-cancellation-fee-inert}

**Where:** `cancelRide` (`:1038`) / `cancelRideAsDriver` (`:1131`) compute `feeApplicable` but
always insert `fee_amount = 0, fee_waived = false`.

**Fix — charge the fee through the existing wallet-debit path, don't build a new payment flow:**

```typescript
// rides.service.ts — cancelRide, where feeApplicable is currently computed but discarded
if (feeApplicable) {
  const fee = await getCancellationFee(ride.city_id, ride.ride_type) // rate-card-driven, not hardcoded
  await debitUserWallet(ride.user_id, fee, { reason: 'cancellation_fee', rideId: ride.id }) // existing wallet debit function
  await creditDriverCompensation(ride.driver_id, fee * DRIVER_COMPENSATION_SHARE, { rideId: ride.id })
  feeAmount = fee
}
```

Source the fee amount from `rate_cards` (already city/category-scoped per the versioning
convention in CLAUDE.md) rather than a hardcoded constant — cancellation fees plausibly vary by
city same as base fares, and this avoids a second place fare-like numbers are configured.

**Also add a per-user cancellation-rate cap**, same Redis-counter shape as §01.1/§03.2 (there's now
a consistent pattern for "N of X per window" across this codebase — reuse it instead of inventing a
fourth variant):

```typescript
const key = `cancel:daily:user:${userId}`
const count = await redis.incr(key)
if (count === 1) await redis.expire(key, 86400)
if (count > 5) {
  // don't block the cancellation itself — flag for admin review / apply a higher fee tier
  await flagExcessiveCancellations(userId, count)
}
```

### 05.3 Round-trip GPS distance has no plausibility ceiling {#053-gps-distance-unclamped}

**Where:** `getGpsTrackedDistanceKm` (`rides.repository.ts:1446`) is a bare
`ST_Length(ST_MakeLine(... ORDER BY recorded_at))` with no upper bound, used directly in
`verifyEndOTP:1842` for overage billing.

**Fix — clamp against the booked route distance, same tolerance-band idea as §05.1, applied to the
other end of the same problem (untrusted distance signal):**

```typescript
// rides.repository.ts — getGpsTrackedDistanceKm, after computing rawDistanceKm
const maxPlausibleKm = booking.distanceKm * 2.5 // generous ceiling for legitimate detours/traffic reroutes
if (rawDistanceKm > maxPlausibleKm) {
  logger.warn({ rideId, rawDistanceKm, maxPlausibleKm }, 'GPS-tracked distance implausible, falling back to booked estimate')
  return null // triggers the existing client-estimate fallback path, same as the <2-GPS-points case
}
return rawDistanceKm
```

Returning `null` reuses the fallback path that already exists for sparse GPS data
(`verifyEndOTP:1859`, "flagged for review, still charged") — no new code path, just a second
trigger for the one that's already there. `endRideEarlyAsDriver` already applies
`Math.min(finalFare, totalEstimated)` discipline (confirmed sound in the audit) — this brings
`verifyEndOTP`'s overage path to the same standard.

---

## 06. What's explicitly deferred, and why

- **Subscription-based driver billing** — the audit found no subscription tier exists at all
  (only commission and prepaid-package). Not a bug to fix here; it's a product decision (does Ocar
  want a subscription tier?) that needs its own spec if the answer is yes. Flagged, not designed.
- **Participant-facing dispute chat** — `dispute_actions` is admin-only internal notes; there is no
  rider↔driver two-way thread. Same category as above: a feature gap, not a hardening fix, and out
  of scope for this document.
- **Document file-content validation (magic-byte check)** — S3 enforces the signed `Content-Type`
  header, not actual payload bytes. Rated low in the audit (stored-XSS risk is already mitigated by
  the stored content-type on presigned GET). Worth a follow-up if a real incident traces back to it;
  not proposed here to keep this document scoped to the confirmed exploitable findings.

---

## 07. Cross-cutting patterns established by this document

A few fixes above intentionally reuse the same primitive rather than inventing a new one per
issue — worth naming explicitly so future hardening work extends these instead of adding a fifth
variant:

1. **Fixed-window Redis counter** (`INCR` + `EXPIRE` on first increment) — used for ride OTP
   lockout (§01.1), SOS rate limiting (§03.2), and cancellation-rate flagging (§05.2). One
   mental model, three call sites.
2. **Fetch-scoped-by-owner instead of fetch-then-check** — `getRideForDriverAction(rideId, driverId)`
   (§01.2) and `assertRideParticipant` (§03.1) are the same idea applied to two different auth
   shapes (row-scoped query vs. explicit guard function). Prefer the row-scoped form when the
   repository call is already being written or touched; use the guard-function form when retrofitting
   an existing fetch that many callers share.
3. **Claimed vs. verified fields at a trust boundary** — driver-declared doc expiry (§02.2) is the
   first instance; the same split (accept client input, store it, but never gate on it until an
   authoritative party confirms it) applies anywhere else a client claims a fact used for a
   gating decision.
4. **`system_config`-driven policy thresholds** — warning-escalation threshold (§03.3) joins
   `driver_minimum_balance`/`driver_payouts_enabled` as an ops-tunable value read live, no deploy
   required. Reach for this instead of a hardcoded constant whenever the "right" value is a policy
   decision rather than a technical one.
