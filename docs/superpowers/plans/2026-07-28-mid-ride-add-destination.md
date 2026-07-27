# Add-a-Stop After Booking / During an Ongoing Ride Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a rider add a destination/stop to a ride that has already been booked and is on the way (`accepted`, `driver_arrived`, or `in_progress`) — today this is 100% impossible; the multi-stop machinery (`ride_stops`, `AddStopSheet`) only runs pre-booking.

**Architecture:** Reuse the existing `ride_stops` table and the existing `AddStopSheet` picker component — the gap is purely "no endpoint/UI wires them together after a ride exists." Add one repository insert function, one service function with the same status/ownership guard style as `markStopArrived`, one route, and wire `AddStopSheet` into the active-ride tracking screen on the user side. Notify the driver over the existing `ride:{rideId}` socket room plus the existing in-app/push notification pipeline so the driver's app can react without a full rebuild of driver-side map UI.

**Tech Stack:** Express + PostGIS (`api`), Next.js (`apps/user`), Vite/Zustand (`apps/driver`), Vitest.

---

## File Structure

- Modify: `api/src/modules/rides/rides.repository.ts` — `appendRideStop()`.
- Modify: `api/src/modules/rides/rides.service.ts` — `addRideStop()`.
- Modify: `api/src/modules/rides/rides.routes.ts` — `POST /:id/stops`.
- Modify: `api/src/websocket/socket.server.ts` — `sendStopAdded()`.
- Modify: `apps/user/lib/ride-api.ts` — `addStop()`.
- Modify: `apps/user/app/(main)/ride/[id]/page.tsx` — "Add stop" button + `AddStopSheet` wiring + `stop:added` socket handler.
- Modify: `apps/driver/src/store/useRideStore.ts` — `addStop()` store action.
- Modify: `apps/driver/src/App.tsx` — `stop:added` socket handler.
- Test: `api/tests/unit/rides/add-mid-ride-stop.test.ts`

---

### Task 1: Backend — repository insert for a stop on an existing ride

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts` (add after `getRideStops`, which ends at line 324)

- [ ] **Step 1: Add `appendRideStop`**

```typescript
// Inserts one stop onto a ride that already exists (post-booking add), taking
// the next sequence number. Distinct from insertRideStops (pre-booking, bulk,
// caller-supplied sequence via array index) because this must be safe to call
// while other stops already exist and are mid-flight.
export async function appendRideStop(
  rideId: bigint,
  stop: StopInput & { chargeApplied: number }
): Promise<RideStop> {
  const res = await pool.query<RideStop>(
    `INSERT INTO ride_stops (ride_id, sequence, location, address, stop_charge_applied)
     VALUES (
       $1,
       COALESCE((SELECT MAX(sequence) FROM ride_stops WHERE ride_id = $1), 0) + 1,
       ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326)::geography,
       $4, $5
     )
     RETURNING id, ride_id, sequence,
       ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
       address, status, arrived_at, reached_at, stop_charge_applied, wait_charge`,
    [rideId, stop.lat, stop.lng, stop.address ?? null, stop.chargeApplied]
  )
  return res.rows[0]!
}
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors (uses the existing `StopInput`/`RideStop` types already imported at the top of this file).

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts
git commit -m "feat(rides): add appendRideStop for adding a stop to an existing ride"
```

---

### Task 2: Backend — service function with ownership/status guard

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts` (add near `markStopArrived`/`markStopStatus`, after line 777)
- Test: `api/tests/unit/rides/add-mid-ride-stop.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/unit/rides/add-mid-ride-stop.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById:     vi.fn(),
  appendRideStop:  vi.fn(),
}))

vi.mock('@/modules/pricing/pricing.repository', () => ({
  getStopCharge: vi.fn().mockResolvedValue(30),
}))

vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendStopAdded: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))

import * as repo from '@/modules/rides/rides.repository'
import { socketEvents } from '@/websocket/socket.server'
import { addRideStop } from '@/modules/rides/rides.service'

const USER_ID = BigInt(7)
const RIDE_ID = BigInt(101)
const STOP = { lat: 20.30, lng: 85.83, address: 'Patia' }

describe('addRideStop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.appendRideStop).mockResolvedValue({
      id: BigInt(9), ride_id: RIDE_ID, sequence: 2, lat: 20.30, lng: 85.83,
      address: 'Patia', status: 'pending', arrived_at: null, reached_at: null,
      stop_charge_applied: '0', wait_charge: '0',
    } as never)
  })

  it('rejects when the ride does not belong to the caller', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: RIDE_ID, user_id: BigInt(999), status: 'in_progress', ride_type: 'one_way', category_id: BigInt(1),
    } as never)

    await expect(addRideStop(USER_ID, RIDE_ID, STOP)).rejects.toThrow(/Forbidden/)
    expect(repo.appendRideStop).not.toHaveBeenCalled()
  })

  it('rejects once the ride has completed', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'completed', ride_type: 'one_way', category_id: BigInt(1),
    } as never)

    await expect(addRideStop(USER_ID, RIDE_ID, STOP)).rejects.toThrow(/on the way/)
    expect(repo.appendRideStop).not.toHaveBeenCalled()
  })

  it('adds a stop with no charge for a one_way ride in progress', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'in_progress', ride_type: 'one_way', category_id: BigInt(1),
    } as never)

    await addRideStop(USER_ID, RIDE_ID, STOP)

    expect(repo.appendRideStop).toHaveBeenCalledWith(RIDE_ID, { ...STOP, chargeApplied: 0 })
    expect(socketEvents.sendStopAdded).toHaveBeenCalledWith(RIDE_ID.toString(), expect.any(Object))
  })

  it('applies the flat stop charge for a round_trip ride', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({
      id: RIDE_ID, user_id: USER_ID, status: 'accepted', ride_type: 'round_trip', category_id: BigInt(3),
    } as never)

    await addRideStop(USER_ID, RIDE_ID, STOP)

    expect(repo.appendRideStop).toHaveBeenCalledWith(RIDE_ID, { ...STOP, chargeApplied: 30 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/rides/add-mid-ride-stop.test.ts`
Expected: FAIL — `addRideStop is not exported`

- [ ] **Step 3: Implement `addRideStop`**

Add after `markStopStatus` (which ends at line 777) in `api/src/modules/rides/rides.service.ts`:

```typescript
const STOP_ADDABLE_STATUSES = new Set(['accepted', 'driver_arrived', 'in_progress'])

// Lets the rider add a stop to a ride that's already been accepted/is on the
// way. Mirrors createBooking's stop pricing rule: only round_trip levies the
// flat per-stop charge (one_way prices the detour through distance instead;
// rental stops are a free itinerary) — see validateStops/createBooking §Task
// comment for why. Existing stops/ride_stops rows are untouched.
export async function addRideStop(
  userId: bigint,
  rideId: bigint,
  stop: StopInput
) {
  const ride = await repo.getRideById(rideId)
  if (!ride) throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  if (BigInt(ride.user_id) !== userId) {
    throw Object.assign(new Error('Forbidden'), { httpStatus: 403 })
  }
  if (!STOP_ADDABLE_STATUSES.has(ride.status)) {
    throw Object.assign(new Error('Stops can only be added while the ride is on the way'), { httpStatus: 409 })
  }

  const chargeApplied = ride.ride_type === 'round_trip'
    ? await getStopCharge(Number(ride.category_id))
    : 0
  const newStop = await repo.appendRideStop(rideId, { ...stop, chargeApplied })

  socketEvents.sendStopAdded(rideId.toString(), {
    rideId: rideId.toString(),
    stop: newStop,
  })

  return newStop
}
```

`StopInput` and `getStopCharge` are already imported at the top of this file (used by `createBooking`/`validateStops`) — no new imports needed. `socketEvents.sendStopAdded` is added in Task 3 below; this file will fail to typecheck until that task lands, which is expected mid-plan.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/rides/add-mid-ride-stop.test.ts` (after Task 3's `sendStopAdded` export exists)
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/tests/unit/rides/add-mid-ride-stop.test.ts
git commit -m "feat(rides): add addRideStop service for adding a stop to an in-flight ride"
```

---

### Task 3: Backend — socket emitter + route

**Files:**
- Modify: `api/src/websocket/socket.server.ts:229-231` (add `sendStopAdded` next to `sendStopUpdated`)
- Modify: `api/src/modules/rides/rides.routes.ts:312` (add `POST /:id/stops` right before the existing `PATCH /:id/stops/:sequence` at line 313)

- [ ] **Step 1: Add the socket emitter**

`api/src/websocket/socket.server.ts:229-231` currently reads:

```typescript
  sendStopUpdated: (rideId: string, data: object) => {
    getIO().to(`ride:${rideId}`).emit('stop:updated', data)
  },
```

Add immediately after it:

```typescript
  sendStopAdded: (rideId: string, data: object) => {
    getIO().to(`ride:${rideId}`).emit('stop:added', data)
  },
```

- [ ] **Step 2: Add the route**

In `api/src/modules/rides/rides.routes.ts`, insert right before the `PATCH /:id/stops/:sequence` route (line 313):

```typescript
router.post('/:id/stops', authenticate(), async (req, res, next) => {
  try {
    const userId = req.user!.id
    const stop = req.body as import('./rides.types').StopInput
    const newStop = await service.addRideStop(userId, BigInt(req.params['id']!), stop)
    res.status(201).json(newStop)
  } catch (err) { next(err) }
})

```

- [ ] **Step 3: Typecheck + rerun Task 2's test**

Run: `cd api && npx tsc --noEmit && npx vitest run tests/unit/rides/add-mid-ride-stop.test.ts`
Expected: no errors, 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add api/src/websocket/socket.server.ts api/src/modules/rides/rides.routes.ts
git commit -m "feat(rides): expose POST /:id/stops and broadcast stop:added"
```

---

### Task 4: User app — "Add stop" on the active-ride screen

**Files:**
- Modify: `apps/user/lib/ride-api.ts` (add `addStop`, next to `cancelRide` around line 269-274)
- Modify: `apps/user/app/(main)/ride/[id]/page.tsx` — import, state, button, socket handler

- [ ] **Step 1: Add the API call**

In `apps/user/lib/ride-api.ts`, add next to the other ride mutations (near `cancelRide`, line 269-274):

```typescript
  addStop: async (rideId: string, stop: { lat: number; lng: number; address: string }): Promise<RideStop> => {
    const res = await api.post(`/api/v1/rides/${rideId}/stops`, stop)
    return res.data
  },
```

(`RideStop` is already exported from this file per the existing `import { rideApi, type RideDetail, type RideStop }` in the tracking page.)

- [ ] **Step 2: Wire `AddStopSheet` into the tracking page**

In `apps/user/app/(main)/ride/[id]/page.tsx`:

Add to the imports (near `CancelSheet`/`SOSButton`, lines 18-19):

```typescript
import AddStopSheet, { type PickedStop } from '@/components/route/AddStopSheet'
```

Add a state near the other sheet-open flags (wherever `CancelSheet`'s open state is declared):

```typescript
  const [addStopOpen, setAddStopOpen] = useState(false)
```

Add a handler near `handleBook`-style mutation handlers:

```typescript
  async function handleAddStop(stop: PickedStop) {
    setAddStopOpen(false)
    try {
      const newStop = await rideApi.addStop(rideId, stop)
      setRide(prev => prev ? { ...prev, stops: [...prev.stops, newStop] } : prev)
    } catch {
      // Best-effort — the driver-side socket/notification still lands even if
      // this optimistic local update fails; a reload picks up the real state.
    }
  }
```

Render the sheet once near the other sheets (`CancelSheet`, `SOSButton`):

```tsx
      <AddStopSheet
        open={addStopOpen}
        onClose={() => setAddStopOpen(false)}
        onSelect={handleAddStop}
        title="Add a stop"
      />
```

Add the trigger button, gated on the ride actually being on the way (reuse the existing `hasDriver`/status check, e.g. near the SOS button):

```tsx
      {(rideStatus === 'accepted' || rideStatus === 'driver_arrived' || rideStatus === 'in_progress') && (
        <button
          onClick={() => setAddStopOpen(true)}
          className="..." // match the surrounding action-button styling
        >
          Add stop
        </button>
      )}
```

- [ ] **Step 3: Handle the `stop:added` socket event (in case the rider has two tabs/devices open)**

Add a handler alongside `onStopUpdated` (line 471-478):

```typescript
    const onStopAdded = (data: { stop: RideStop }) => {
      setRide(prev => prev && !prev.stops.some(s => s.sequence === data.stop.sequence)
        ? { ...prev, stops: [...prev.stops, data.stop] }
        : prev)
    }
```

Register/unregister it next to `onStopUpdated` (lines 487 and the matching `off` block):

```typescript
    socket.on('stop:added', onStopAdded)
```

```typescript
      socket.off('stop:added', onStopAdded)
```

- [ ] **Step 4: Manually verify**

Run: `cd apps/user && pnpm dev` and `cd api && pnpm dev`. Book a ride, accept it as a driver (second tab/app), then on the user's tracking screen tap "Add stop", pick a place, confirm it appears in the stop list without a page reload.

- [ ] **Step 5: Commit**

```bash
git add apps/user/lib/ride-api.ts apps/user/app/\(main\)/ride/\[id\]/page.tsx
git commit -m "feat(user): let a rider add a stop while a ride is on the way"
```

---

### Task 5: Driver app — see the new stop without a manual refresh

**Files:**
- Modify: `apps/driver/src/store/useRideStore.ts` — `addStop` action
- Modify: `apps/driver/src/App.tsx` — `stop:added` socket handler

- [ ] **Step 1: Add the store action**

In `apps/driver/src/store/useRideStore.ts`, add to the `RideState` interface (near `updateStop` at line 64):

```typescript
  addStop: (stop: RideStop) => void
```

Add the implementation next to `updateStop` (after line 110):

```typescript
      addStop: (stop) =>
        set((s) => ({
          activeRide: s.activeRide ? {
            ...s.activeRide,
            stops: [...(s.activeRide.stops ?? []), stop],
          } : null,
        })),
```

- [ ] **Step 2: Handle the socket event**

In `apps/driver/src/App.tsx`, add alongside the existing `onStopUpdated` handler (lines 277-279):

```typescript
    const onStopAdded = (data: { stop: RideStop }) => {
      addStop({ ...data.stop, id: String(data.stop.id) })
    }
```

Register/unregister next to `stop:updated` (line 282 and its matching `off`):

```typescript
    socket.on('stop:added', onStopAdded)
```

```typescript
      socket.off('stop:added', onStopAdded)
```

Destructure `addStop` from `useRideStore` alongside the existing `updateStop` destructure at the top of the component.

- [ ] **Step 3: Manually verify**

With the driver app's active-ride screen open, add a stop from the user app and confirm it appears in the driver's stop list live (via `TripInProgress.tsx`'s existing stop-itinerary UI, which already renders `activeRide.stops`).

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/store/useRideStore.ts apps/driver/src/App.tsx
git commit -m "feat(driver): show a rider-added stop live on the active-ride screen"
```

---

## Scope decisions (explicitly deferred)

- **No fare re-quote when a stop is added.** One-way/rental stops don't affect the fare model today (detour distance / free itinerary respectively); round-trip gets the same flat per-stop charge `createBooking` already applies for pre-booking stops. If the client later wants a live fare bump warning on add, that's a separate, larger change (needs a distance re-estimate call) — not needed to close this ticket.
- **No live map re-route on the driver's turn-by-turn view.** The driver's stop list updates live (Task 5); redrawing the actual navigation polyline through the new stop is out of scope here — the existing "Plan your stops" flow for pre-booking has the same limitation (stops are waypoints in the UI, not fed into turn-by-turn).
