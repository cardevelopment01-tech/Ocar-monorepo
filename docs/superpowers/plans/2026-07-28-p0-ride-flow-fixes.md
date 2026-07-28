# P0 Ride-Flow Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three P0 findings from `docs/superpowers/research/2026-07-28-ride-flow-ux-audit.md`: the driver's "you keep ₹X" commission figure can silently mismatch the real ledger, a driver has no way to abort a trip once it's `in_progress`, and the two safety-critical navigation screens give no warning when GPS is lost.

**Architecture:** All three fixes reuse infrastructure that already exists rather than adding new schema or services:
- Commission: `payments.commission_amount`/`commission_percent` are already computed authoritatively server-side (`createPaymentRecord` in `payments.service.ts`) — they're just never sent to the client. We add them to the existing `GET /rides/:id` response and have `TripEnd.tsx` read the real number instead of hardcoding `fare * 0.15`.
- Mid-trip abort: `cancel_stage` already has an `'in_progress'` enum value nobody uses. We add a driver-only `end-early` action that recomputes a partial fare (same `calculateFare` call the round-trip early-termination path already makes) and routes through the existing `settleRideCompletionPayment` branching (cash/online/wallet) — no new tables, no new payment logic.
- GPS-loss banner: `useDriverLocation()` already returns `error`; `Home.tsx` already renders a banner for it. `NavigateToPickup.tsx` and `TripInProgress.tsx` just never destructure/render it — we copy the existing pattern over.

**Tech Stack:** Express 4 + TypeScript (api), Vite + React 19 + Zustand + React Router v6 + Framer Motion (apps/driver), Vitest for backend unit tests.

**Post-implementation note (added after final review, commit `6ac0e3b`):** Task 4/5's original design had the client (driver app) supply `actualDistanceKm`/`actualDurationMin` (via `POST /:id/end-early`) with no server-side bound — a final integration review caught this as a real overcharge exploit (a buggy or malicious driver client could inflate the numbers and the resulting fare would be auto-charged online/wallet, or shown as the cash-collection amount, before any dispute was possible). Fixed by capping the recalculated `finalFare` at the ride's original `fare_snapshots.total_estimated` (an early-ended trip can never cost more than the full quoted trip) plus input validation rejecting non-finite/negative values. Follow-up not done in this pass (tracked as a P2, not blocking): the admin rides page's "Flagged, possibly stuck" banner only renders for `status === 'in_progress'`, so `review_reason`/`review_flagged_at` set by an early-ended ride (`status = 'completed'`) currently has no admin-facing surface — ops can query it directly but there's no UI. Since the fare cap already removes the financial risk, this is now a monitoring/ops-visibility gap, not a security issue.

---

## Task 1: Backend — expose real commission on ride detail

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts:494-508` (add commission columns to `getRideById`'s SELECT)
- Modify: `api/src/modules/rides/rides.service.ts:314-322` (`maskRideContacts` — strip commission fields from non-driver/non-admin viewers)
- Test: `api/tests/unit/rides/mask-ride-contacts-commission.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/unit/rides/mask-ride-contacts-commission.test.ts
import { describe, it, expect } from 'vitest'
import { maskRideContacts } from '@/modules/rides/rides.service'

function baseRide() {
  return {
    user_phone: '9999999999',
    rider_phone: '9999999999',
    driver_phone: '8888888888',
    commission_percent: '15.00',
    commission_amount: '72.00',
    driver_earning: '408.00',
  }
}

describe('maskRideContacts — commission visibility', () => {
  it('strips commission fields for the rider viewer', () => {
    const masked = maskRideContacts(baseRide(), 'user')
    expect(masked.commission_percent).toBeUndefined()
    expect(masked.commission_amount).toBeUndefined()
    expect(masked.driver_earning).toBeUndefined()
  })

  it('keeps commission fields for the driver viewer', () => {
    const masked = maskRideContacts(baseRide(), 'driver')
    expect(masked.commission_percent).toBe('15.00')
    expect(masked.commission_amount).toBe('72.00')
    expect(masked.driver_earning).toBe('408.00')
  })

  it('keeps commission fields for the admin viewer', () => {
    const masked = maskRideContacts(baseRide(), 'admin')
    expect(masked.commission_amount).toBe('72.00')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/rides/mask-ride-contacts-commission.test.ts`
Expected: FAIL — rider viewer still has `commission_percent: '15.00'` (nothing strips it yet).

- [ ] **Step 3: Add the commission columns to `getRideById`**

In `api/src/modules/rides/rides.repository.ts`, the SELECT list at lines 494-508 currently ends with:

```typescript
       ST_Y(dls.location::geometry) AS driver_current_lat,
       ST_X(dls.location::geometry) AS driver_current_lng,
       p.status AS payment_status
     FROM rides r
```

Change it to:

```typescript
       ST_Y(dls.location::geometry) AS driver_current_lat,
       ST_X(dls.location::geometry) AS driver_current_lng,
       p.status AS payment_status,
       p.commission_percent, p.commission_amount, p.driver_earning
     FROM rides r
```

(`payments p` is already `LEFT JOIN`ed on `p.ride_id = r.id` a few lines below — no join changes needed. These columns are `NULL` until `createPaymentRecord` has run for the ride, which is expected and handled client-side in Task 2.)

- [ ] **Step 4: Strip commission fields for non-driver/non-admin viewers**

In `api/src/modules/rides/rides.service.ts`, replace:

```typescript
export function maskRideContacts<T extends {
  user_phone?: string | null
  rider_phone?: string | null
  driver_phone?: string | null
}>(ride: T, viewer: 'user' | 'driver' | 'admin'): T {
  if (viewer === 'admin') return ride
  if (viewer === 'user')  return { ...ride, driver_phone: null }
  return { ...ride, user_phone: null, rider_phone: null }
}
```

with:

```typescript
export function maskRideContacts<T extends {
  user_phone?: string | null
  rider_phone?: string | null
  driver_phone?: string | null
  commission_percent?: string | null
  commission_amount?: string | null
  driver_earning?: string | null
}>(ride: T, viewer: 'user' | 'driver' | 'admin'): T {
  if (viewer === 'admin') return ride
  if (viewer === 'user') {
    // Commission/earning are the driver's business, not the rider's — strip
    // them here rather than gating in every route handler that calls this.
    return { ...ride, driver_phone: null, commission_percent: null, commission_amount: null, driver_earning: null }
  }
  return { ...ride, user_phone: null, rider_phone: null }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/rides/mask-ride-contacts-commission.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Add the fields to the driver app's `RideDetail` type**

In `apps/driver/src/lib/ride-api.ts`, the `RideDetail` type (lines 26-48) currently ends:

```typescript
  payment_channel: 'cash' | 'online' | 'wallet'
  cash_collected_at: string | null
}
```

Change to:

```typescript
  payment_channel: 'cash' | 'online' | 'wallet'
  cash_collected_at: string | null
  commission_percent: string | null
  commission_amount: string | null
  driver_earning: string | null
}
```

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts api/src/modules/rides/rides.service.ts apps/driver/src/lib/ride-api.ts api/tests/unit/rides/mask-ride-contacts-commission.test.ts
git commit -m "fix(rides): expose real per-ride commission to the driver, mask it from riders"
```

---

## Task 2: Frontend — TripEnd shows the real commission, not a hardcoded 15%

**Files:**
- Modify: `apps/driver/src/pages/ActiveRide/TripEnd.tsx`

**Why polling, not a single fetch:** `settleRideCompletionPayment` (the function that calls `createPaymentRecord`, which is what actually writes `commission_amount`) runs via `void settleRideCompletionPayment(...)` — fired-and-forgotten *after* `verifyEndOTP` already responds to the driver. `TripEnd` can mount before that write lands. A short poll with a capped retry count closes that race without adding a websocket event.

- [ ] **Step 1: Add a fetched-commission state and poll effect**

In `apps/driver/src/pages/ActiveRide/TripEnd.tsx`, add the import and replace the hardcoded commission math:

```typescript
import { driverRideApi } from '@/lib/ride-api'
```

Replace:

```typescript
  const fare        = activeRide?.fare ?? 0
  const commission  = Math.round(fare * 0.15)
  const net         = parseFloat((fare - commission).toFixed(2))
```

with:

```typescript
  const fare = activeRide?.fare ?? 0
  const [realCommission, setRealCommission] = useState<number | null>(null)
  const [realEarning,    setRealEarning]    = useState<number | null>(null)

  // settleRideCompletionPayment (which writes commission_amount) runs async,
  // fired after verifyEndOTP already responded — poll briefly rather than
  // block this screen on it. Falls back to the estimate below if it never lands.
  useEffect(() => {
    if (!activeRide?.id) return
    let cancelled = false
    let attempts = 0
    const poll = async () => {
      attempts += 1
      try {
        const ride = await driverRideApi.getRide(activeRide.id)
        if (cancelled) return
        if (ride.commission_amount != null) {
          setRealCommission(parseFloat(ride.commission_amount))
          setRealEarning(ride.driver_earning != null ? parseFloat(ride.driver_earning) : null)
          return
        }
      } catch { /* keep polling, fall back to estimate on timeout */ }
      if (attempts < 5 && !cancelled) setTimeout(poll, 1200)
    }
    void poll()
    return () => { cancelled = true }
  }, [activeRide?.id])

  const commissionIsEstimate = realCommission === null
  const commission = realCommission ?? Math.round(fare * 0.15)
  const net         = realEarning ?? parseFloat((fare - commission).toFixed(2))
```

- [ ] **Step 2: Update the earnings card copy to drop "(est.)" once the real value has landed**

Replace:

```typescript
            <span className="text-text-secondary">
              {isCash ? 'Commission (deducted from wallet, est.)' : 'Platform commission (est.)'}
            </span>
```

with:

```typescript
            <span className="text-text-secondary">
              {isCash
                ? `Commission (deducted from wallet${commissionIsEstimate ? ', est.' : ''})`
                : `Platform commission${commissionIsEstimate ? ' (est.)' : ''}`}
            </span>
```

- [ ] **Step 3: Manual verification (no test framework exists in apps/driver)**

Run: `cd apps/driver && pnpm dev`, complete a test ride end-to-end to the `TripEnd` screen.
Expected: the commission line briefly shows "(est.)" then updates in place (no flash/jump) to the real `commission_amount` within ~1-2s, matching whatever `commission_percent` is configured in `system_config` (not necessarily 15%). Confirm by checking the `payments` row for that ride: `docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT commission_percent, commission_amount, driver_earning FROM payments WHERE ride_id = <id>;"` — the number on screen must match `driver_earning` exactly.

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/pages/ActiveRide/TripEnd.tsx
git commit -m "fix(driver): TripEnd reads the real settled commission instead of a hardcoded 15%"
```

---

## Task 3: Frontend — GPS-loss warning on the two active-ride navigation screens

**Files:**
- Modify: `apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx`
- Modify: `apps/driver/src/pages/ActiveRide/TripInProgress.tsx`

Both screens already call `useDriverLocation(...)` and already import `LocateOff` is not yet imported — `Home.tsx`'s existing banner (lines 361-381) is the pattern to copy exactly (same copy, same three GPS error codes), just repositioned under each screen's SOS row instead of under its header.

- [ ] **Step 1: `NavigateToPickup.tsx` — destructure the hook's `error` and render the banner**

Replace:

```typescript
  const { position, heading: selfHeading } = useDriverLocation({
```

with:

```typescript
  const { position, heading: selfHeading, error: gpsError } = useDriverLocation({
```

Add `LocateOff` to the lucide-react import at the top:

```typescript
import { Navigation, Phone, RotateCcw, Clock, X, Star, Check, Locate, LocateOff } from 'lucide-react'
```

Then, immediately after the SOS row (after the closing `</div>` of the `flex justify-end mt-3` block, still inside the top `absolute top-0 left-0 right-0 px-4` container, before that container's own closing `</div>`), add:

```tsx
        {/* GPS-loss warning — safety-critical here (mid-navigation), not just
            informational like the Home screen's version of this banner. */}
        {gpsError && (
          <div className="flex items-center gap-2.5 rounded-2xl px-4 py-3 mt-3" style={GLASS}>
            <LocateOff size={14} className="text-red-500 flex-shrink-0" />
            <span className="text-red-600 text-[12px] font-semibold">
              {gpsError.code === 1
                ? 'Location access denied. Allow it in browser settings'
                : gpsError.code === 2
                ? 'GPS signal unavailable. Check device location settings'
                : 'Location timed out. Ensure GPS is enabled'}
            </span>
          </div>
        )}
```

- [ ] **Step 2: `TripInProgress.tsx` — same change**

Replace:

```typescript
  const { position, heading: selfHeading, speedKmph } = useDriverLocation({
```

with:

```typescript
  const { position, heading: selfHeading, speedKmph, error: gpsError } = useDriverLocation({
```

Add `LocateOff` to the lucide-react import:

```typescript
import { Clock, X, RotateCcw, Flag, CheckCircle2, Navigation, Locate, Check, LocateOff } from 'lucide-react'
```

Add the identical banner block (same JSX as Step 1) right after this file's SOS row (`<div className="flex justify-end mt-3">...</div>`), inside the same top instruction-card container.

- [ ] **Step 3: Manual verification**

Run: `cd apps/driver && pnpm dev`. With browser devtools, deny location permission (or toggle airplane mode on a real device) while on `NavigateToPickup` and `TripInProgress`.
Expected: the red "Location access denied" / "GPS signal unavailable" banner appears below the SOS button on both screens (previously only appeared on Home). Re-enable location and confirm the banner disappears once `useDriverLocation` clears the error.

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx apps/driver/src/pages/ActiveRide/TripInProgress.tsx
git commit -m "fix(driver): surface GPS-loss warning during active navigation, not just on Home"
```

---

## Task 4: Backend — mid-trip "end ride early" with partial-fare settlement

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts` (new `endRideEarlyAsDriver` function, near `cancelRideAsDriver`)
- Modify: `api/src/modules/rides/rides.routes.ts` (new route, near `/:id/cancel-driver`)
- Test: `api/tests/unit/rides/end-ride-early.test.ts`

**Design:** no schema changes. The ride is marked `completed` (a real, partially-driven trip was billed — this is not a no-fare cancellation), with the existing `review_reason`/`review_flagged_at` columns used to flag it for ops instead of a new column. Partial fare reuses the same `calculateFare` call the round-trip early-termination path already makes (treated as `one_way` pricing — no hour surcharge — matching that existing precedent), then falls through to the same `settleRideCompletionPayment` used by a normal completion, so cash/online/wallet all settle exactly as they do today.

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/unit/rides/end-ride-early.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { del: vi.fn() } }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById: vi.fn(),
  logStatusHistory: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn().mockResolvedValue(undefined),
  deductCommission:    vi.fn().mockResolvedValue(undefined),
  creditCashback:      vi.fn().mockResolvedValue(undefined),
  confirmRidePayment:  vi.fn().mockResolvedValue(true),
  payFromUserWallet:   vi.fn().mockResolvedValue(true),
  createRidePaymentOrder: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('true') }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyRidePaymentFailed: vi.fn().mockResolvedValue(undefined),
  notifyAllAdmins:         vi.fn().mockResolvedValue(undefined),
}))

import * as repo from '@/modules/rides/rides.repository'
import { pool } from '@/db/client'
import { endRideEarlyAsDriver } from '@/modules/rides/rides.service'

function baseRide(over: Record<string, unknown> = {}) {
  return {
    id: BigInt(202), user_id: 42, driver_id: 9, status: 'in_progress',
    ride_type: 'one_way', payment_channel: 'cash',
    origin_lat: 20.2961, origin_lng: 85.8245,
    started_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    ...over,
  }
}

describe('endRideEarlyAsDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockImplementation((sql: unknown) => {
      const s = sql as string
      if (/ST_Distance/.test(s)) return { rows: [{ metres: '3000' }], rowCount: 1 } as never
      if (/FROM fare_snapshots fs\s+JOIN rate_cards/.test(s)) {
        return {
          rows: [{
            surge_multiplier: '1', stop_fare: '0', is_return_cab: false,
            rate_per_km: '12', rate_per_min: '1.5', min_fare: '60', return_rate_per_km: null,
          }],
          rowCount: 1,
        } as never
      }
      return { rows: [], rowCount: 1 } as never
    })
  })

  it('rejects a ride that is not in_progress', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide({ status: 'accepted' }) as never)
    await expect(endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 20.30, 85.82))
      .rejects.toMatchObject({ httpStatus: 409 })
  })

  it('rejects a non-owner driver', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide({ driver_id: 999 }) as never)
    await expect(endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 20.30, 85.82))
      .rejects.toMatchObject({ httpStatus: 403 })
  })

  it('computes a partial fare and marks the ride completed', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide() as never)
    const result = await endRideEarlyAsDriver(BigInt(9), BigInt(202), 'vehicle_breakdown', 20.30, 85.82)
    expect(result.success).toBe(true)
    expect(result.finalFare).toBeGreaterThan(0)
    expect(repo.logStatusHistory).toHaveBeenCalledWith(
      expect.objectContaining({ rideId: BigInt(202), fromStatus: 'in_progress', toStatus: 'completed', actor: 'driver' })
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/rides/end-ride-early.test.ts`
Expected: FAIL — `endRideEarlyAsDriver` is not exported yet.

- [ ] **Step 3: Implement `endRideEarlyAsDriver`**

In `api/src/modules/rides/rides.service.ts`, add this function right after `cancelRideAsDriver` (after the closing `}` at what is currently line 1049):

```typescript
// ── Mid-trip abort with partial-fare settlement ────────────────
// Distinct from cancelRideAsDriver: that function only ever runs pre-pickup
// (accepted/driver_arrived), where no fare is owed. Once in_progress, real
// distance has been driven and must be billed — so this marks the ride
// `completed` (not `cancelled`) and reuses the exact same partial-fare
// recalculation the round-trip early-termination path already performs,
// then falls through to the normal completion settlement pipeline.
// ponytail: the "why it ended early" reason lives in rides.review_reason
// (existing column) rather than a new ride_cancellations row — if ops needs
// richer reporting on this later (rate, by-reason breakdown), promote it to
// a dedicated table then.
export async function endRideEarlyAsDriver(
  driverId: bigint,
  rideId: bigint,
  reasonCode: string,
  currentLat: number,
  currentLng: number,
) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (!ride.driver_id || BigInt(ride.driver_id) !== driverId) {
    throw Object.assign(new Error('Forbidden'), { httpStatus: 403 })
  }
  if (ride.status !== 'in_progress') {
    throw Object.assign(new Error('Ride is not in progress'), { httpStatus: 409 })
  }

  const distRes = await pool.query<{ metres: string }>(
    `SELECT ST_Distance(
       ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography,
       ST_SetSRID(ST_MakePoint($3::float8, $4::float8), 4326)::geography
     ) AS metres`,
    [currentLng, currentLat, ride.origin_lng, ride.origin_lat]
  )
  const actualDistanceKm = parseFloat(distRes.rows[0]?.metres ?? '0') / 1000
  const actualDurationMin = Math.max(1, Math.round(
    (Date.now() - Date.parse(ride.started_at)) / 60_000
  ))

  const snapRes = await pool.query<{
    surge_multiplier: string
    stop_fare: string
    is_return_cab: boolean
    rate_per_km: string
    rate_per_min: string
    min_fare: string
    return_rate_per_km: string | null
  }>(
    `SELECT fs.surge_multiplier, fs.stop_fare, fs.is_return_cab,
            rc.rate_per_km, rc.rate_per_min, rc.min_fare, rc.return_rate_per_km
     FROM fare_snapshots fs
     JOIN rate_cards rc ON rc.id = fs.rate_card_id
     WHERE fs.ride_id = $1`,
    [rideId]
  )
  const snap = snapRes.rows[0]

  let finalFare: number | null = null
  if (snap) {
    const recalc = calculateFare({
      rate_card: {
        rate_per_km:        parseFloat(snap.rate_per_km),
        rate_per_min:       parseFloat(snap.rate_per_min),
        min_fare:           parseFloat(snap.min_fare),
        return_rate_per_km: snap.return_rate_per_km != null ? parseFloat(snap.return_rate_per_km) : null,
      },
      ride_type:        'one_way', // no hour_surcharge on an aborted trip
      is_return_cab:    snap.is_return_cab,
      estimated_km:     actualDistanceKm,
      estimated_min:    actualDurationMin,
      stop_count:       0, // stop fares for reached stops are already baked into snap.stop_fare
      charge_per_stop:  0,
      trip_hours:       0,
      surge_multiplier: parseFloat(snap.surge_multiplier),
    })
    const stopFare = parseFloat(snap.stop_fare ?? '0')
    finalFare = Math.round((recalc.total + stopFare) * 100) / 100

    await pool.query(
      `UPDATE fare_snapshots
       SET actual_km = $2, actual_min = $3, total_final = $4,
           status = 'final', finalised_at = now()
       WHERE ride_id = $1`,
      [rideId, actualDistanceKm, actualDurationMin, finalFare]
    )
  }

  const completedAt = new Date().toISOString()
  await repo.updateRideStatus(rideId, 'completed', {
    completed_at:      completedAt,
    review_flagged_at: completedAt,
    review_reason:     `Ended early by driver: ${reasonCode}`,
  })
  await repo.logStatusHistory({
    rideId, fromStatus: 'in_progress', toStatus: 'completed', actor: 'driver',
  })

  await pool.query(
    `UPDATE driver_sessions SET status = 'online', trips_completed = trips_completed + 1
     WHERE driver_id = $1 AND status = 'on_trip'`,
    [driverId]
  )
  await pool.query(
    `UPDATE driver_location_snapshots SET is_available = true WHERE driver_id = $1`,
    [driverId]
  )

  const statusPayload: Record<string, unknown> = { status: 'completed', completedAt, endedEarly: true }
  if (finalFare !== null) statusPayload['finalFare'] = finalFare
  socketEvents.sendRideStatusUpdate(rideId.toString(), statusPayload)

  void settleRideCompletionPayment(rideId, driverId).catch((err: unknown) => {
    console.error(`Payment post-processing failed for early-ended ride ${rideId}:`, err)
  })

  return { success: true, rideId: rideId.toString(), ...(finalFare !== null ? { finalFare } : {}) }
}
```

- [ ] **Step 4: Add the route**

In `api/src/modules/rides/rides.routes.ts`, add right after the `/:id/cancel-driver` route:

```typescript
router.post('/:id/end-early', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const body = req.body as { reasonCode?: string; currentLat?: number; currentLng?: number }
    if (!body.reasonCode || typeof body.currentLat !== 'number' || typeof body.currentLng !== 'number') {
      res.status(400).json({ error: 'reasonCode, currentLat, currentLng are required' }); return
    }
    const result = await service.endRideEarlyAsDriver(
      driverId, BigInt(req.params['id']!), body.reasonCode, body.currentLat, body.currentLng
    )
    res.json(result)
  } catch (err) { next(err) }
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/rides/end-ride-early.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full rides test suite to check nothing broke**

Run: `cd api && npx vitest run tests/unit/rides`
Expected: PASS (all existing + new tests)

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/src/modules/rides/rides.routes.ts api/tests/unit/rides/end-ride-early.test.ts
git commit -m "feat(rides): allow a driver to end an in-progress trip early with partial-fare settlement"
```

---

## Task 5: Frontend — "End trip early" affordance in TripInProgress

**Files:**
- Modify: `apps/driver/src/lib/ride-api.ts` (add `endRideEarly` to `driverRideApi`)
- Modify: `apps/driver/src/pages/ActiveRide/TripInProgress.tsx` (reason sheet + wiring)

- [ ] **Step 1: Add the API call**

In `apps/driver/src/lib/ride-api.ts`, add to `driverRideApi` (right after `cancelRideAsDriver`):

```typescript
  endRideEarly: async (
    rideId: string,
    reasonCode: string,
    currentLat: number,
    currentLng: number,
  ): Promise<{ success: boolean; rideId: string; finalFare?: number }> => {
    const res = await api.post(`/api/v1/rides/${rideId}/end-early`, { reasonCode, currentLat, currentLng })
    return res.data as { success: boolean; rideId: string; finalFare?: number }
  },
```

- [ ] **Step 2: Add state + reason sheet to `TripInProgress.tsx`**

Add to the imports:

```typescript
import { Clock, X, RotateCcw, Flag, CheckCircle2, Navigation, Locate, Check, LocateOff, AlertTriangle } from 'lucide-react'
```

Add state near the other `useState` declarations (after `stopActionPending`):

```typescript
  const [showEndEarlySheet, setShowEndEarlySheet] = useState(false)
  const [endEarlyReason,    setEndEarlyReason]    = useState<string | null>(null)
  const [endingEarly,       setEndingEarly]       = useState(false)
  const [endEarlyError,     setEndEarlyError]     = useState<string | null>(null)
```

Add the handler, near `handleCompleteTrip`:

```typescript
  const handleEndEarly = async () => {
    if (!activeRide || !endEarlyReason || endingEarly) return
    setEndingEarly(true)
    setEndEarlyError(null)
    try {
      const [lat, lng] = position ?? [activeRide.pickupLat, activeRide.pickupLng]
      const result = await driverRideApi.endRideEarly(activeRide.id, endEarlyReason, lat, lng)
      if (result.finalFare !== undefined) setFare(result.finalFare)
      updateRideStatus('completed')
      navigate(activeRide.paymentChannel === 'cash' ? '/ride/collect-cash' : '/ride/end', { replace: true })
    } catch {
      setEndEarlyError('Could not end the trip. Check your connection and try again.')
      setEndingEarly(false)
    }
  }
```

Add the "End trip early" text button below the stop itinerary and above the drop-off row (right after the closing `</div>` of the stop itinerary checklist block, before the "Primary advance for the current stop" swipe block):

```tsx
            {!currentStop && (
              <button
                onClick={() => setShowEndEarlySheet(true)}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium text-red-400 active:opacity-70 transition-opacity"
              >
                <AlertTriangle size={14} strokeWidth={2} />
                End trip early
              </button>
            )}
```

(Gated on `!currentStop` — ending early mid-detour to a pending stop is confusing; the driver should skip/reach remaining stops first, or this stays available once they're on the final leg.)

Add the reason sheet at the end of the component, right before the closing `</div>` of the root element (after the existing `AnimatePresence` for the end-OTP sheet, before `<HindiVoiceHint .../>`):

```tsx
      <AnimatePresence>
        {showEndEarlySheet && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-end"
          >
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => { if (!endingEarly) setShowEndEarlySheet(false) }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 350 }}
              className="relative w-full rounded-t-3xl px-5 pt-5 bg-surface"
              style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}
            >
              <div className="w-10 h-1 rounded-full bg-surface-3 mx-auto mb-4" />
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-black text-text-primary">End this trip early?</h3>
                <button
                  onClick={() => setShowEndEarlySheet(false)}
                  disabled={endingEarly}
                  className="w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center active:scale-95 transition-transform"
                >
                  <X size={15} className="text-text-secondary" />
                </button>
              </div>
              <p className="text-text-muted text-xs mb-3">
                The rider will be billed for the distance covered so far. Only end early for a genuine issue.
              </p>
              <p className="text-[11px] font-bold text-text-muted uppercase tracking-wider mb-2.5">Why are you ending early?</p>
              <div className="space-y-2 mb-5">
                {[
                  { code: 'vehicle_breakdown',  label: 'Vehicle breakdown' },
                  { code: 'passenger_emergency', label: 'Passenger emergency' },
                  { code: 'safety_concern',      label: 'Safety concern' },
                  { code: 'other',               label: 'Other reason' },
                ].map(r => (
                  <button
                    key={r.code}
                    onClick={() => setEndEarlyReason(r.code)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left active:scale-[0.98] transition-transform ${
                      endEarlyReason === r.code ? '' : 'bg-surface-2'
                    }`}
                    style={endEarlyReason === r.code
                      ? { background: 'rgba(239,68,68,0.07)', border: '1.5px solid rgba(239,68,68,0.40)' }
                      : { border: '1.5px solid #E2E8F0' }
                    }
                  >
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={endEarlyReason === r.code
                        ? { border: '5px solid #EF4444' }
                        : { border: '2px solid #CBD5E1' }
                      }
                    />
                    <span className={`text-sm font-medium ${endEarlyReason === r.code ? 'text-accent-red' : 'text-text-secondary'}`}>
                      {r.label}
                    </span>
                  </button>
                ))}
              </div>
              {endEarlyError && <p className="text-status-error text-xs text-center mb-3">{endEarlyError}</p>}
              <button
                onClick={() => void handleEndEarly()}
                disabled={!endEarlyReason || endingEarly}
                className="w-full py-3.5 rounded-2xl text-sm font-bold text-text-inverse mb-2.5 disabled:opacity-40 active:scale-[0.98] transition-transform"
                style={{ background: '#EF4444' }}
              >
                {endingEarly ? 'Ending trip…' : 'End trip now'}
              </button>
              <button
                onClick={() => setShowEndEarlySheet(false)}
                disabled={endingEarly}
                className="w-full py-3 rounded-2xl text-sm font-semibold text-text-secondary disabled:opacity-50 active:scale-[0.98] transition-transform bg-surface-2 border border-border"
              >
                Continue trip
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
```

- [ ] **Step 3: Manual verification**

Run: `cd apps/driver && pnpm dev`. Start a trip, advance past any stops, tap "End trip early", pick a reason, confirm.
Expected: navigates to `/ride/collect-cash` (cash ride) or `/ride/end` (online/wallet ride) with a non-zero partial fare, matching `actual_distance_km`/`fare_snapshots.total_final` in the DB for that ride. Confirm the ride's `status` is `completed` and `review_reason` contains `"Ended early by driver: <code>"`:
`docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT status, review_reason, review_flagged_at FROM rides WHERE id = <id>;"`

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/lib/ride-api.ts apps/driver/src/pages/ActiveRide/TripInProgress.tsx
git commit -m "feat(driver): add End Trip Early with reason sheet, wired to partial-fare settlement"
```

---

## Task 6: Update the audit doc

**Files:**
- Modify: `docs/superpowers/research/2026-07-28-ride-flow-ux-audit.md`

- [ ] **Step 1: Check off the three P0 items**

Change all three P0 checkboxes from `⬜` to `✅` in the "P0 — fix first" section.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/research/2026-07-28-ride-flow-ux-audit.md
git commit -m "docs: mark P0 ride-flow findings as fixed"
```

---

## Self-Review Notes

- **Spec coverage:** all three P0 findings from the audit doc are covered — commission mismatch (Tasks 1-2), no mid-trip abort (Tasks 4-5), no GPS-loss warning (Task 3).
- **Type consistency:** `RideDetail.commission_amount`/`driver_earning` (Task 1, frontend type) match the field names read in Task 2's `TripEnd.tsx` poll. `endRideEarlyAsDriver`'s params (`driverId, rideId, reasonCode, currentLat, currentLng`) match the route handler's call in Task 4 and the frontend's `endRideEarly(rideId, reasonCode, lat, lng)` call in Task 5.
- **No placeholders:** every step has runnable code; the one deliberate scope cut (no new `ride_cancellations`-style table for early-end reasons, reusing `review_reason` instead) is marked with a `ponytail:` comment naming the upgrade path.
