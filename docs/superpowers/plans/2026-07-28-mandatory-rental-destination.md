# Mandatory Destination for Rental ("City Ride") Bookings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make entering a drop-off destination mandatory when a user books an hourly rental ("city ride" in the client's terms), so the assigned driver always has a destination to navigate to.

**Architecture:** The client's "city ride" maps to this codebase's `rental` ride type (`apps/user/app/(main)/rental/page.tsx`), not `one_way`/`round_trip` (which already require a destination via the `/select-ride` guard). Enforce the requirement in exactly two places: the `canBook` gate on the rental page (frontend UX) and `createBooking` in the rides service (backend source of truth — the frontend gate alone is not enough since nothing currently validates `POST /rides` at all).

**Tech Stack:** Next.js (`apps/user`), Express + Vitest (`api`).

---

## File Structure

- Modify: `api/src/modules/rides/rides.service.ts` — reject rental bookings with no destination.
- Modify: `apps/user/app/(main)/rental/page.tsx` — require destination before enabling "Book".
- Test: `api/tests/unit/rides/rental-destination-required.test.ts`

---

### Task 1: Backend — reject rental bookings without a destination

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts:343` (insert point, right after the existing one_way/round_trip in-city check block that ends at line 343, before the `scheduledForDate` block at line 345)
- Test: `api/tests/unit/rides/rental-destination-required.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/unit/rides/rental-destination-required.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  createRide:             vi.fn(),
  logStatusHistory:       vi.fn(),
  createRideAssignment:   vi.fn(),
  getActiveRideIdForUser: vi.fn(),
}))

vi.mock('@/modules/pricing/pricing.service', () => ({
  getFareEstimate: vi.fn(),
  clampTripHours:  vi.fn((_rideType: string, hours: number | undefined) => hours ?? 0),
}))

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { broadcastNewRide: vi.fn(), notifyUserRideUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))

vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications' },
  gpsFlushQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@/lib/otp', () => ({ generateOtp: vi.fn(() => '1234'), hashOtp: vi.fn(() => 'hashed') }))

vi.mock('@/modules/payments/payments.service', () => ({
  createPaymentRecord: vi.fn(), deductCommission: vi.fn(), creditCashback: vi.fn(),
}))

import * as repo    from '@/modules/rides/rides.repository'
import * as pricing from '@/modules/pricing/pricing.service'
import { pool }      from '@/db/client'
import { createBooking } from '@/modules/rides/rides.service'

const USER_ID = BigInt(42)

const RENTAL_REQUEST = {
  categoryId:   2,
  rideType:     'rental' as const,
  originLat:    20.2961,
  originLng:    85.8245,
  originAddress: 'Bhubaneswar',
  distanceKm:   0,
  durationMin:  0,
  rentalPackageId: 1,
  originCityId: 1,
}

const FARE_STUB = {
  rate_card_id: 1, surge_event_id: null, surge_multiplier: 1.0, rental_hours: 4,
  breakdown: { base_fare: 500, distance_fare: 0, time_fare: 0, stop_fare: 0, hour_surcharge: 0, overage_fare: 0, surge_fare: 0, subtotal: 500, total: 500 },
}

describe('createBooking — rental destination required', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pricing.getFareEstimate).mockResolvedValue(FARE_STUB as never)
    vi.mocked(repo.createRide).mockResolvedValue({ id: BigInt(101), user_id: USER_ID, status: 'requested', ride_type: 'rental' } as never)
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(repo.getActiveRideIdForUser).mockResolvedValue(null)
  })

  it('rejects a rental booking with no destination', async () => {
    await expect(createBooking(USER_ID, { ...RENTAL_REQUEST })).rejects.toThrow(/drop-off/)
    expect(repo.createRide).not.toHaveBeenCalled()
  })

  it('accepts a rental booking with a destination', async () => {
    await createBooking(USER_ID, {
      ...RENTAL_REQUEST,
      destinationLat: 20.30,
      destinationLng: 85.83,
      destinationAddress: 'Patia',
    })
    expect(repo.createRide).toHaveBeenCalled()
  })

  it('does not require a destination for one_way rides', async () => {
    await createBooking(USER_ID, {
      ...RENTAL_REQUEST,
      rideType: 'one_way',
      destinationLat: undefined,
      destinationLng: undefined,
    })
    expect(repo.createRide).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/rides/rental-destination-required.test.ts`
Expected: FAIL on the first test — `createBooking` currently resolves instead of rejecting.

- [ ] **Step 3: Add the validation**

In `api/src/modules/rides/rides.service.ts`, right after the existing block that ends at line 343 (the one_way/round_trip in-city guard) and before `let scheduledForDate: Date | null = null` at line 345, insert:

```typescript
  if (data.rideType === 'rental' && (data.destinationLat === undefined || data.destinationLng === undefined)) {
    throw Object.assign(
      new Error('Please add a drop-off location before booking this rental'),
      { httpStatus: 422 }
    )
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/rides/rental-destination-required.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/tests/unit/rides/rental-destination-required.test.ts
git commit -m "fix(rides): require a destination for rental (city ride) bookings"
```

---

### Task 2: Frontend — require destination before "Book" is enabled on the rental page

**Files:**
- Modify: `apps/user/app/(main)/rental/page.tsx:231` (`canBook`)
- Modify: `apps/user/app/(main)/rental/page.tsx:339,361` (drop-off section copy)

- [ ] **Step 1: Gate the Book button on `hasDestination`**

`apps/user/app/(main)/rental/page.tsx:231` currently reads:

```typescript
  const canBook     = selectedPkgId !== null && estimate !== null && !estLoading && !isBooking
```

Change to:

```typescript
  const canBook     = selectedPkgId !== null && estimate !== null && !estLoading && !isBooking && hasDestination
```

(`hasDestination` is already computed at line 83 as `destAddress !== null` — this just wires the existing flag into the gate instead of leaving it purely cosmetic.)

- [ ] **Step 2: Update the "optional" copy to reflect the new requirement**

`apps/user/app/(main)/rental/page.tsx:339`:

```typescript
          {/* Drop-off (optional) */}
```

Change to:

```typescript
          {/* Drop-off (required) */}
```

`apps/user/app/(main)/rental/page.tsx:361`:

```typescript
                <span className="flex-1 text-[12px] font-medium text-slate-400">Add a drop-off (optional)</span>
```

Change to:

```typescript
                <span className="flex-1 text-[12px] font-medium text-slate-400">Add a drop-off</span>
```

- [ ] **Step 3: Manually verify in the browser**

Run: `cd apps/user && pnpm dev`, open the rental booking flow (Home → city ride → rental package), select a package without adding a drop-off — confirm the Book button stays disabled — then add a drop-off and confirm it enables. Confirm the "(optional)" wording is gone.

- [ ] **Step 4: Commit**

```bash
git add apps/user/app/\(main\)/rental/page.tsx
git commit -m "fix(user): require a drop-off before a rental (city ride) can be booked"
```

---

## Notes

- One-way and round-trip rides already require a destination (the `/select-ride` page redirects to `/home` if either coordinate pair is missing) — no change needed there.
- Two prior commits (`b1ff820`, `4d5de5d`) touched this area but neither made rental destinations mandatory — `4d5de5d` explicitly reverted an attempt to treat rentals as always-destination-optional-by-design. This plan is the first change that actually flips that default per the client's new ask.
