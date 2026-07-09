# Ride Flows Audit — One-Way / Round-Trip / Rental

> Audited by: Fable (claude-fable-5) · Date: 2026-07-03
> Scope: Backend (`api/`), User frontend (`apps/user/`), Driver frontend (`apps/driver/`)
> Flows covered: one_way · round_trip · rental

---

## Table of Contents

1. [Critical Issues](#1-critical-issues-fix-before-production)
2. [Logical Flow Issues](#2-logical-flow-issues)
3. [Performance Issues](#3-performance-issues)
4. [Security Gaps](#4-security-gaps)
5. [Code Quality / Best Practices](#5-code-quality--best-practices)
6. [Scalability Improvements](#6-scalability-improvements)
7. [Priority Fix Order](#7-priority-fix-order)

---

## 1. Critical Issues (fix before production)

---

### 1.1 Any driver can hijack any ride — no ownership checks

**Severity:** Critical  
**Files:**
- `api/src/modules/rides/rides.service.ts` — `markArrived` (L331), `verifyStartOTP` (L365), `verifyEndOTP` (L503)

**What's wrong:**  
None of these three functions verify `ride.driver_id === driverId` before acting. Any authenticated driver can call `POST /rides/:id/arrived` on a ride assigned to a completely different driver. This lets them:
- Regenerate and overwrite `start_otp_hash` on another driver's ride
- Verify OTPs and collect commission for a trip they didn't drive
- Corrupt the state machine (e.g. calling `markArrived` on a `completed` ride — no status precondition exists)

`verifyEndOTP` also increments the *caller's* `trips_completed` (L555-561) and runs commission against the caller, so the legitimate driver loses credit and earnings.

**Fix:**
```typescript
// In markArrived, verifyStartOTP, verifyEndOTP — load ride first
const ride = await ridesRepo.getRideById(rideId);
if (!ride) throw notFound('Ride not found');
if (BigInt(ride.driver_id) !== driverId) throw forbidden('Not your ride');
if (ride.status !== expectedStatus) throw conflict(`Ride is not in ${expectedStatus} state`);
```
Also make `updateRideStatus` atomic:
```sql
UPDATE rides SET status = $new, ... WHERE id = $id AND status = $expected RETURNING *
```
If zero rows returned → status was already changed by a concurrent request → throw 409.

---

### 1.2 OTP mechanism is theatre — hashes are brute-forceable

**Severity:** Critical  
**Files:**
- `api/src/modules/rides/rides.service.ts` — `markArrived` (L348-351, L362)
- `api/src/websocket/socket.server.ts` — `sendRideStatusUpdate`
- `api/src/modules/rides/rides.routes.ts` — `GET /rides/:id` (L134-150)
- `api/src/modules/rides/rides.types.ts` — L53-54

**What's wrong:**  
Three separate leaks make the OTP system ineffective:

1. `markArrived` returns `{ startOtp }` directly in the driver's HTTP response (L362) — the driver doesn't need to ask the passenger for the code at all.
2. `sendRideStatusUpdate(rideId, { status: 'driver_arrived', startOtp })` emits to the **ride room** — which contains both user and driver sockets. The end OTP at L399-403 likewise reaches the driver's socket.
3. `GET /rides/:id` returns the raw `start_otp_hash` and `end_otp_hash` columns. A 6-digit numeric OTP hashed with **unsalted SHA-256** is brute-forced offline against 10⁶ candidates in under one second.

**Fix:**
- Never return `startOtp`/`endOtp` in driver HTTP responses
- Introduce a `user:{userId}` private socket room; emit OTPs only to that room (not the shared ride room)
- Strip `start_otp_hash` and `end_otp_hash` from all API responses — these columns should never leave the database
- Use a per-user OTP recovery endpoint (`GET /rides/:id/otp`, gated to `ride.user_id === req.user.id`) that re-derives a safe display value if needed

---

### 1.3 Fare is computed entirely from client-supplied numbers

**Severity:** Critical  
**Files:**
- `api/src/modules/rides/rides.service.ts` — `createBooking` (L169-186)
- `api/src/modules/rides/rides.routes.ts` — L100-106
- `api/src/modules/rides/rides.validator.ts` — (1 line, effectively empty)
- `apps/user/app/(main)/select-ride/page.tsx` — L45-46

**What's wrong:**  
`distanceKm`, `durationMin`, `stopCount`, and `tripHours` all come straight from `req.body` with zero server-side validation. The user frontend carries these values in **URL query parameters**, so tampering is trivially easy via the address bar or browser devtools. A user can POST `distanceKm: 0.1, durationMin: 1` for a Bhubaneswar→Puri run and pay only the minimum fare.

**Fix:**
```typescript
// rides.validator.ts
export const bookingSchema = z.object({
  pickupLat: z.number().min(-90).max(90),
  pickupLng: z.number().min(-180).max(180),
  dropLat: z.number().min(-90).max(90).optional(),
  dropLng: z.number().min(-180).max(180).optional(),
  categoryId: z.number().int().positive(),
  rideType: z.enum(['one_way', 'round_trip', 'rental']),
  rentalPackageId: z.number().int().positive().optional(),
  scheduledFor: z.string().datetime().optional(),
  // Never trust these from client — recompute server-side:
  // distanceKm, durationMin removed entirely
});
```
Recompute `distanceKm`/`durationMin` from coordinates via the existing routing endpoint (`/api/v1/geo/route`), or at minimum cross-check the client value against a known corridor distance within ±30% tolerance.

---

### 1.4 Rental overage is never charged — `total_final` always equals estimate

**Severity:** Critical  
**Files:**
- `api/src/modules/rides/rides.service.ts` — `verifyEndOTP` (L542-553)
- `api/src/lib/fare.ts` — L57-73
- `apps/user/app/(main)/rental/page.tsx` — L328

**What's wrong:**  
`total_final = total_estimated` is set unconditionally in `verifyEndOTP`. The `calculateFare` function in `fare.ts` already supports `overage_km` and `overage_min` parameters but nothing ever calls it at trip completion. The rental UI explicitly shows "Overage charged at end of trip" — a promise the code never keeps. A driver completing an 8h/80km rental package after driving 300km earns exactly the package rate with no overage revenue.

Round-trip actual-hours reconciliation is also absent (billed hours vs driven hours never compared).

**Fix:**
```typescript
// In verifyEndOTP, before createPaymentRecord:
let totalFinal = ride.total_estimated;

if (ride.ride_type === 'rental' && ride.rental_package_id) {
  const pkg = await rentalPackageRepo.getById(ride.rental_package_id);
  const actualKm = computeActualDistance(ride.id); // from gps_tracks
  const actualMin = (Date.now() - ride.started_at.getTime()) / 60000;
  const overageKm = Math.max(actualKm - pkg.km_limit, 0);
  const overageMin = Math.max(actualMin - pkg.duration_hours * 60, 0);
  const fareResult = calculateFare({ ...rateCard, overageKm, overageMin, pkg });
  totalFinal = fareResult.total;
}

await ridesRepo.updateRideStatus(rideId, 'completed', { total_final: totalFinal });
```
Run this **before** `createPaymentRecord` (payments.service reads `total_final ?? total_estimated`).

---

### 1.5 Rental "start time" silently discarded — dispatches immediately

**Severity:** High  
**Files:**
- `apps/user/app/(main)/rental/page.tsx` — L74, L128-150
- `api/src/modules/rides/rides.service.ts` — `createBooking`
- `api/src/modules/rides/rides.repository.ts` — L216

**What's wrong:**  
The rental page has a `startAt` state variable and a time picker, but `handleBook` never includes `scheduledFor` in the API payload. The backend `createRide` in the repository already has the `scheduledFor` column, but `BookingRequest` doesn't declare the field. A user who books a rental for tomorrow 9am gets a driver dispatched immediately.

**Fix:**
1. Add `scheduledFor?: string` to `BookingRequest` type and Zod schema
2. Pass it through `createBooking` → `ridesRepo.createRide`
3. In `broadcastRide` job processor: check `ride.scheduled_for`; if in the future, enqueue a delayed BullMQ job (`delay: scheduledFor.getTime() - Date.now()`) rather than broadcasting immediately
4. Wire `startAt` from picker into the booking payload in `rental/page.tsx`

---

### 1.6 No OTP brute-force protection

**Severity:** High  
**Files:**
- `api/src/modules/rides/rides.service.ts` — `verifyStartOTP` (L377), `verifyEndOTP` (L521)

**What's wrong:**  
`attempt_number: 1` is hardcoded in both functions — attempts are never counted and never rate-limited. A 6-digit numeric OTP with unlimited 422 retries is guessable online with a simple script in under 2 minutes (max 1,000,000 attempts).

**Fix:**
```typescript
// In verifyStartOTP and verifyEndOTP:
const attemptCount = await db.query(
  `SELECT COUNT(*) FROM ride_otp_events
   WHERE ride_id = $1 AND otp_type = $2 AND success = false`,
  [rideId, 'trip_start']
);
if (Number(attemptCount.rows[0].count) >= 5) {
  throw new AppError('OTP_LOCKED', 'Too many failed attempts', 429);
}
```
The `ride_otp_events` table already exists — use it.

---

### 1.7 `authenticate()` doesn't enforce role per route

**Severity:** High  
**Files:**
- `api/src/middleware/auth.middleware.ts`
- `api/src/modules/rides/rides.routes.ts`
- `api/src/websocket/socket.server.ts` — L117-121

**What's wrong:**  
The middleware sets exactly one of `req.user`, `req.driver`, or `req.admin`. Every rides route then directly accesses `req.user!.id` or `req.driver!.id` without verifying which was set. A driver token hitting `POST /rides` crashes on `req.user!.id` (TypeError → 500). Worse: `cancelRide` checks `BigInt(ride.user_id) !== userId` — if driver #42 calls it with a driver token, `userId` reads `req.user!.id` (undefined → crash) or could coincide with a user ID.

In the socket handler, `join:ride` checks `ride.user_id === callerSub || ride.driver_id === callerSub` without checking the role — driver #42 can join the ride room for user #42's completely unrelated ride.

**Fix:**
```typescript
// auth.middleware.ts
export function authenticate(role: 'user' | 'driver' | 'admin') {
  return (req: Request, res: Response, next: NextFunction) => {
    // ... verify JWT ...
    if (payload.role !== role) {
      return res.status(403).json({ error: 'WRONG_ROLE' });
    }
    // set req[role] = payload
    next();
  };
}

// rides.routes.ts
router.post('/', authenticate('user'), createBookingHandler);
router.post('/:id/accept', authenticate('driver'), acceptRideHandler);

// socket.server.ts join:ride
if (payload.role === 'user' && BigInt(ride.user_id) !== BigInt(payload.sub)) return;
if (payload.role === 'driver' && BigInt(ride.driver_id) !== BigInt(payload.sub)) return;
```

---

## 2. Logical Flow Issues

---

### 2.1 "Actual distance" is fake

**File:** `apps/driver/src/components/TripInProgress.tsx` — L137-147

Actual distance at trip end is computed as haversine(pickup, drop) × 1.3 — a straight-line estimate with a fudge factor. This ignores:
- The actual driven path, which exists in `gps_tracks`
- Round-trip has two legs driven but only one billed distance
- Rental drops (`dropLat` null) result in `undefined` — the backend `verifyEndOTP` never receives a valid actual distance and can't compute overage

**Fix:** Add a server-side `GET /rides/:id/actual-distance` endpoint that aggregates `gps_tracks` for the ride's session, or compute inside `verifyEndOTP` directly from `gps_tracks` using PostGIS `ST_Length(ST_MakeLine(...))`.

---

### 2.2 User cannot cancel after driver accepts; driver cannot cancel at all

**Files:**
- `api/src/modules/rides/rides.service.ts` — `cancelRide` (L422)
- `apps/user/app/(main)/ride/[id]/page.tsx` — L324

`cancelRide` only allows `status === 'requested'`. Once a driver accepts, the UI hides the cancel button and there's no backend path to cancel. The `ride_cancellations` table has fee/penalty fields suggesting the flow was designed but never built. Driver-side cancellation is entirely absent.

**Fix:**
1. Allow user cancellation in `accepted` and `driver_arrived` states with a configurable penalty fee
2. Implement driver cancellation path (penalizes driver, re-broadcasts ride or marks as `cancelled`)
3. Add cancel button back in the UI conditionally (no penalty before arrival, penalty after)
4. Insert into `ride_cancellations` with correct `cancelled_by`, `reason`, and computed `cancellation_fee`

---

### 2.3 Round-trip estimate calls have a race condition

**File:** `apps/user/app/(main)/select-ride/page.tsx` — `loadEstimates` (L115-144)

Return-cab availability check + a second estimate call run inside the same `Promise.allSettled` map. If the user toggles ride type mid-flight, stale `setEstimates` from the previous invocation overwrites fresh results. The polyline fetches have a cancellation guard but `loadEstimates` does not.

**Fix:**
```typescript
const estimateSeq = useRef(0);

async function loadEstimates() {
  const seq = ++estimateSeq.current;
  const results = await Promise.allSettled([...]);
  if (seq !== estimateSeq.current) return; // stale, discard
  setEstimates(...);
}
```

---

### 2.4 OTP lost on user page reload

**Files:**
- `apps/user/app/(main)/ride/[id]/page.tsx` — L83-86
- `api/src/modules/rides/rides.service.ts` — M10 SMS stub

Start and end OTPs arrive only via socket event (`ride:status_update`) and are stored in component state. If the user reloads the page during `driver_arrived` state, the OTP is gone — `loadRide` cannot recover it because only the SHA-256 hash is in the database. The SMS processor (M10) is an unbuilt stub, so no out-of-band delivery exists.

**Fix (short term):** Persist OTP in `sessionStorage` keyed by `rideId` on receipt.  
**Fix (proper):** Add `GET /rides/:id/otp` endpoint (user-only, returns plain OTP re-derived from a server-stored intermediate, or encrypted). Alternatively, include `startOtp` in the `GET /rides/:id` response when `status === 'driver_arrived'` and caller is the ride's user.

---

### 2.5 Driver session state flip can be bypassed on accept

**File:** `api/src/modules/rides/rides.service.ts` — `acceptAssignment` (L411-424)

If the driver's session isn't `'online'` at accept time (e.g. grace-period race marked it offline), `sessionId` is undefined and the function doesn't flip session to `'on_trip'`. The driver then remains eligible for new broadcasts while already on a trip. Additionally, `rides.session_id` and `rides.vehicle_id` are never written on accept — trip history can't link a ride to the vehicle that served it.

**Fix:**
1. Fetch session explicitly; if not `'online'`, reject the accept with a clear error
2. `UPDATE rides SET session_id = $sessionId, vehicle_id = $vehicleId WHERE id = $rideId` inside the accept transaction

---

### 2.6 Concurrent `verifyEndOTP` double-charges commission

**File:** `api/src/modules/rides/rides.service.ts` — `verifyEndOTP`

`createPaymentRecord` is protected by `ON CONFLICT (ride_id) DO NOTHING` (good), but `deductCommission` is not idempotent — two concurrent requests that both pass the `status = 'in_progress'` check will both deduct commission from the driver's wallet.

**Fix:** Use the CAS `WHERE status = $expected` update pattern so only one request can advance the state machine. The second concurrent call gets zero rows returned and throws 409 before reaching commission logic.

---

### 2.7 One user can spam concurrent bookings

**Files:**
- `api/src/modules/rides/rides.service.ts` — `createBooking`
- Database schema — `rides` table

No check for an existing active ride in `createBooking`. No unique partial index prevents it at the DB level. Each spurious booking fires 3 broadcast rounds × up to 5 drivers × ack-check retries — a single double-tap generates ~30 BullMQ jobs.

**Fix:**
```sql
-- Migration: add partial unique index
CREATE UNIQUE INDEX rides_active_user_idx
  ON rides (user_id)
  WHERE status IN ('requested', 'accepted', 'driver_arrived', 'in_progress');
```
```typescript
// In createBooking:
const existing = await db.query(
  `SELECT id FROM rides WHERE user_id = $1 AND status IN ('requested','accepted','driver_arrived','in_progress') LIMIT 1`,
  [userId]
);
if (existing.rows.length) throw conflict('You already have an active ride');
```

---

### 2.8 Rental without a package is silently allowed (min-fare loophole)

**File:** `api/src/modules/rides/rides.service.ts` — `createBooking`

Backend accepts `rideType: 'rental'` with no `rentalPackageId`. Without a package, `package_fare` stays null, the standard pricing path runs with client-supplied `distanceKm/durationMin` (often 0 from the rental page), and the user pays only minimum fare for unlimited time.

**Fix:** In the Zod schema:
```typescript
bookingSchema.refine(
  (d) => d.rideType !== 'rental' || d.rentalPackageId != null,
  { message: 'rentalPackageId required for rental rides', path: ['rentalPackageId'] }
)
```

---

### 2.9 Commission wallet underflow is silently forgiven

**File:** `api/src/modules/payments/payments.service.ts` — `deductCommission` (L110-117)

`deductCommission` clamps the wallet balance at 0 when commission exceeds what's available, but `lifetime_commission` keeps incrementing as if the full amount was collected. At scale this creates invisible revenue gaps with no receivable ledger to track who owes what.

**Fix:** If `balance < commissionAmount`, store the shortfall in a `driver_commission_debt` column or ledger entry, and deduct from future earnings before crediting the driver.

---

### 2.10 `TripEnd` commission percentage is hardcoded client-side

**File:** `apps/driver/src/components/TripEnd.tsx` — L18

Commission is hardcoded at 20% for display. The real rate comes from `system_config` (`getCommissionPercent`). If the rate changes, the driver's earnings card shows the wrong number.

**Fix:** Include `commissionPercent` in the `verifyEndOTP` response payload, or expose it via a config endpoint the driver app fetches on load.

---

## 3. Performance Issues

---

### 3.1 Full rides query on every GPS ping

**File:** `api/src/modules/rides/rides.service.ts` — `updateLocation` (L141-144)

Every GPS ping (every 30s per driver) triggers a full `SELECT` on the `rides` table to look up the active ride. At 1,000 concurrent drivers this is ~33 qps of reads that could be avoided.

**Fix:** Cache `driverId → activeRideId` in Redis on ride accept; clear on complete/cancel. `updateLocation` reads from Redis first:
```typescript
const activeRideId = await redis.get(`driver:${driverId}:active_ride`);
```
Also add a composite index if not present:
```sql
CREATE INDEX rides_driver_status_idx ON rides (driver_id, status);
```

---

### 3.2 Breadcrumb array copied on every location event

**File:** `apps/user/app/(main)/ride/[id]/page.tsx` — L147-155

Every `driver:location` socket event spreads the entire breadcrumb array into a new array. A 2-hour rental at one ping every 2 seconds accumulates 3,600 points — each event triggers a full array copy + re-render of the map component.

**Fix:**
```typescript
// Keep at most 500 points, decimate older ones
setBreadcrumbs(prev => {
  const next = [...prev, newPoint];
  return next.length > 500 ? next.slice(next.length - 500) : next;
});
```
Also consider using `useRef` for breadcrumbs and only triggering re-render on meaningful position deltas.

---

### 3.3 Booking screen fires up to 12 API calls

**File:** `apps/user/app/(main)/select-ride/page.tsx` — `loadEstimates` (L115-144)

Per estimate refresh: 4 fare estimates + 4 return-cab availability checks + up to 4 return-cab estimates = 12 sequential/concurrent API calls, each triggering N×4 database queries.

**Fix:** Add a batch endpoint:
```
POST /api/v1/pricing/estimate-all
Body: { pickupLat, pickupLng, dropLat, dropLng, rideType, stopCount, tripHours }
Response: { estimates: [{ categoryId, fare, returnCabAvailable, returnFare }] }
```
This collapses the load to 1 HTTP request + 2 DB queries (one per rate card + one aggregated lookup).

---

### 3.4 Fare calculation is 3-4 sequential queries × 4 categories

**File:** `api/src/modules/pricing/pricing.service.ts` — `getFareEstimate` (L18-47)

Rate card, stop charges, surge check, and rental package are separate sequential queries — none are cached. Rate cards and stop charges change rarely (insert-only versioning by design), so they are ideal cache candidates.

**Fix:** Cache rate cards and stop charges in Redis with a short TTL (5 minutes):
```typescript
const cacheKey = `rate_card:${categoryId}:${rideType}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);
const card = await db.query(...);
await redis.setex(cacheKey, 300, JSON.stringify(card.rows[0]));
```

---

### 3.5 Nearby-driver polling every 8 seconds

**File:** `apps/user/app/(main)/select-ride/page.tsx` — L76-83

The select-ride page polls `/rides/nearby-drivers` every 8 seconds while the user browses. This endpoint is unauthenticated and hits a PostGIS `ST_DWithin` query on every call.

**Fix (medium term):** Push driver availability counts via socket broadcast when drivers go online/offline near a city zone. The select-ride page subscribes to `geo:{cityId}:availability` and updates reactively. Eliminate the poll.

---

## 4. Security Gaps

---

### 4.1 Fleet location exposed to unauthenticated callers

**File:** `api/src/modules/rides/rides.routes.ts` — L108 (`/return-cab-available`), L123 (`/nearby-drivers`)

Both endpoints return precise `driver_id` + lat/lng to any caller with no authentication. Anyone can scrape live locations of the entire fleet, track individual drivers by ID across time, and build movement profiles.

**Fix:**
- Add `authenticate('user')` to both routes
- Drop `driver_id` from the response (return aggregate count only, or anonymized cluster)
- Fuzz coordinates to ~500m precision for the count display

---

### 4.2 Any driver can accept any ride — no assignment check

**File:** `api/src/modules/rides/rides.service.ts` — `acceptAssignment`

`acceptRide` only checks `status = 'requested'`. No verification exists that the calling driver was broadcast this ride (i.e. has a row in `ride_assignments`). A driver monitoring the network can accept rides they were never offered.

**Fix:** Inside the accept transaction:
```sql
SELECT id FROM ride_assignments
WHERE ride_id = $1 AND driver_id = $2 AND status = 'offered' AND expires_at > NOW()
FOR UPDATE
```
If no row: reject with 403. Update `ride_assignments.status = 'accepted'` in the same transaction.

---

### 4.3 `goOnline` doesn't verify vehicle ownership or state

**File:** `api/src/modules/rides/rides.service.ts` — L18-39

`vehicleId` and `categoryId` from the request body are inserted into `driver_sessions` without verifying:
- The vehicle belongs to the calling driver
- The vehicle `status = 'active'` (not blacklisted or inactive)
- The category matches the vehicle's actual class (driver could claim a higher-rate category)

**Fix:**
```sql
SELECT dv.id FROM driver_vehicles dv
WHERE dv.driver_id = $driverId AND dv.vehicle_id = $vehicleId
  AND dv.status = 'active'
  AND v.category_id = $categoryId  -- join vehicles
```

---

### 4.4 `updateLocation` trusts body `sessionId`

**File:** `api/src/modules/rides/rides.service.ts` — location update handler

`sessionId` comes from the request body unchecked. A driver can supply another driver's `sessionId` and write location snapshots against their session, poisoning the `findNearbyDrivers` geo query (which joins via `dls.session_id`).

**Fix:**
```sql
SELECT id FROM driver_sessions
WHERE id = $sessionId AND driver_id = $callerDriverId AND status IN ('online','on_trip')
```
Reject if no row found.

---

### 4.5 `pending_docs` drivers can accept rides

**File:** `api/src/middleware/auth.middleware.ts`

`authenticate()` only blocks `banned` drivers. A driver with `status = 'pending_docs'` or `pending_approval` has a valid JWT and can call all driver ride routes including `acceptRide`, `markArrived`, and OTP verification.

**Fix:** On driver ride routes, add:
```typescript
if (req.driver!.status !== 'active') {
  return res.status(403).json({ error: 'DRIVER_NOT_ACTIVE' });
}
```
Or handle inside `authenticate('driver')` with a `requireActive` option.

---

### 4.6 Driver app persists OTPs in localStorage

**File:** `apps/driver/src/store/useRideStore.ts` — `partialize`

`startOtp` and `endOtp` are included in the Zustand persisted slice, meaning they're written to `localStorage`. Any XSS in the driver app can read them. This is moot once issue 1.2 is fixed (OTPs should never reach the driver at all), but clean it up regardless.

**Fix:** Exclude OTP fields from `partialize`:
```typescript
partialize: (state) => {
  const { startOtp, endOtp, ...rest } = state;
  return rest;
}
```

---

## 5. Code Quality / Best Practices

---

### 5.1 No request validation in the entire rides module

`rides.validator.ts` is effectively empty. Every money-critical route does `req.body as BookingRequest` raw casting. The auth module and drivers module both have validators — the rides module is the highest-value path and has none.

**Priority:** Add a Zod schema for every `POST`/`PATCH` body in `rides.routes.ts` before any other rides work. Gate all handler entry behind `validate(schema)(req, res, next)`.

---

### 5.2 `updateRideStatus` has no expected-status guard — all transitions are racy

`rides.repository.ts` `updateRideStatus` does a blind `UPDATE rides SET status = $new`. Every service function does a read-then-write: load ride, check current status in JS, then update. This is a classic TOCTOU race — two concurrent requests (e.g. two OTP verification calls) both pass the JS check and both write.

**Fix:** All status transitions should use:
```sql
UPDATE rides SET status = $new, updated_at = NOW(), ...extras
WHERE id = $id AND status = $expected
RETURNING *
```
Zero rows returned = race lost = throw 409 Conflict.

---

### 5.3 No `AppError` class — error creation is ad-hoc

Errors are created with `Object.assign(new Error('msg'), { statusCode: 4xx })` throughout. The error-handling middleware can't distinguish operational errors (known, safe to show client) from programmer errors (unknown, should alert).

**Fix:**
```typescript
// lib/errors.ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (msg = 'Not found') => new AppError('NOT_FOUND', msg, 404);
export const forbidden = (msg = 'Forbidden') => new AppError('FORBIDDEN', msg, 403);
export const conflict = (msg: string) => new AppError('CONFLICT', msg, 409);
```

---

### 5.4 `FALLBACK_CATEGORIES` hardcoded with DB seed IDs

**Files:**
- `apps/user/app/(main)/select-ride/page.tsx` — L17-22
- `apps/user/app/(main)/rental/page.tsx` — L20-25

Both pages hardcode category IDs 1-4 as fallbacks, assuming the seed inserts them in that exact order. A fresh migration or reordered seed silently books the wrong vehicle class.

**Fix:** Remove the fallback constants. Fetch categories from `GET /api/v1/vehicles/categories` and handle the loading state explicitly. Cache the result in a React context or SWR.

---

### 5.5 Driver rating and vehicle type hardcoded in tracking page

**File:** `apps/user/app/(main)/ride/[id]/page.tsx` — L430-432

```tsx
<span>4.8 ★</span>
<span>Sedan</span>
```

Both are static strings. The assigned driver's actual rating and vehicle category are available from the ride/driver data.

**Fix:** Read from the ride object: `ride.driver?.rating` and `ride.vehicle?.category_name`.

---

### 5.6 `returnAt` is a dead field — round-trip UI never sets it

The backend accepts `returnAt` end-to-end in the ride object. The `/round-trip` page previously had a picker but it was replaced by hour chips that only set `tripHours`. `returnAt` is stored in the database but never populated from the UI.

**Fix:** Decide: either wire `returnAt = new Date(Date.now() + tripHours * 3600000).toISOString()` on booking, or drop the column entirely. Leaving it half-implemented creates confusion.

---

### 5.7 `clampTripHours` silently changes price from what UI showed

If a user manipulates the URL to pass `tripHours=1`, the server clamps to 4h minimum and charges the 4h price — but the confirmation screen showed the 1h estimate. The user gets an unexpected charge with no explanation.

**Fix:** Return a `tripHours` field in the fare estimate response reflecting the clamped value. The frontend should display the clamped duration before the user confirms booking.

---

## 6. Scalability Improvements

---

### 6.1 Move dispatch/driver state to Redis

Currently all driver state lives in Postgres (`driver_sessions`, `driver_location_snapshots`). At 1k+ concurrent drivers:
- `UPDATE driver_location_snapshots` per 30s ping = write-heavy hot table
- `ST_DWithin` on every broadcast round = compute-heavy geo queries on Postgres

**Architecture:**
- Store `driverId → { lat, lng, sessionId, status, cityId }` in Redis Hash + Redis GEO set per city
- `driver:{driverId}:active_ride` key for the current ride (set on accept, del on complete/cancel)
- `findNearbyDrivers` becomes `GEORADIUS ocar:drivers:{cityId} lng lat 5 km` — microseconds vs milliseconds
- `gps_tracks` remains the durable append-only log (flushed via BullMQ batch, already implemented)
- `driver_location_snapshots` becomes a Redis cache with Postgres as backup, not primary

---

### 6.2 Make all ride state transitions CAS operations

Already partly described in 5.2 and 1.1. Consistent use of `WHERE status = $expected RETURNING *` across all repositories:
- Eliminates explicit transactions for simple state changes
- Makes every transition idempotent under retries
- Makes concurrent calls safe without application-level locking
- Returns 409 cleanly instead of 500 on races

---

### 6.3 Outbox pattern for socket emits — required for multi-instance deploy

**File:** `api/src/websocket/socket.server.ts` — `pendingOffline` Map (L21)

The `pendingOffline` Map is per-process memory. With >1 API instance behind a load balancer:
- A driver connecting to instance B after being on instance A won't cancel the offline grace timer on A
- Socket.io Redis adapter routes messages cross-instance, but grace timer is local

**Architecture:**
- Replace `pendingOffline` Map with Redis keys: `driver:{id}:offline_timer` with a TTL
- Use Redis keyspace notifications or a delayed BullMQ job for the grace-period expiry
- Socket.io Redis adapter already needed for multi-instance; ensure it's in `socket.server.ts` init

---

### 6.4 Batch fare estimate endpoint + rate-card cache

Covered in 3.3 and 3.4. At scale, the booking screen accounting for ~12 API calls per user session is the first thing that will visibly degrade.

**Target:** 1 HTTP request / 2-3 DB queries for all estimates on the booking screen.

---

### 6.5 Make broadcast a cancellable state-machine job

Currently broadcast is 3 pre-scheduled BullMQ jobs per booking (rounds at T+0, T+90s, T+180s). On cancel/accept:
- The queued round-2/3 jobs still run and hit the DB, get `status !== 'requested'` and exit — harmless but wasteful
- Tuning broadcast radius requires redeployment

**Architecture:**
```typescript
// Store job IDs on the ride
await ridesRepo.updateBroadcastJobs(rideId, [round1JobId, round2JobId, round3JobId]);

// On accept or cancel:
const jobs = await ridesRepo.getBroadcastJobs(rideId);
await Promise.all(jobs.map(id => broadcastQueue.remove(id)));
```
This also enables per-city radius config from `system_config` without code changes.

---

### 6.6 Partition `ride_assignments` and `ride_otp_events`

Like `gps_tracks`, both tables are:
- Insert-heavy (write on every broadcast attempt, every OTP try)
- Only queried hot for minutes (during a ride's lifespan)
- Analytically useful for months but rarely queried after completion

```sql
-- ride_assignments by month (partition on created_at)
CREATE TABLE ride_assignments (...)
PARTITION BY RANGE (created_at);

CREATE TABLE ride_assignments_2026_07
PARTITION OF ride_assignments
FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
```
Add a monthly partition creation job to the BullMQ scheduler.

---

## 7. Priority Fix Order

| Priority | # | Finding | Effort |
|---|---|---|---|
| 🔴 P0 | 1.1 | Driver ownership check + status precondition on all ride actions | Low |
| 🔴 P0 | 1.2 | Stop leaking OTPs to driver (HTTP response, ride-room socket, GET endpoint) | Medium |
| 🔴 P0 | 1.3 | Zod validation + server-side distance verification in `createBooking` | Medium |
| 🔴 P0 | 4.2 | `acceptRide` must require a valid `ride_assignments` row | Low |
| 🔴 P0 | 4.5 | Block `pending_docs`/`pending_approval` drivers from ride routes | Low |
| 🔴 P1 | 1.4 | Rental overage / actual `total_final` before payment record | Medium |
| 🔴 P1 | 1.7 | Role-scoped `authenticate(role)` + role-aware `join:ride` | Medium |
| 🟠 P2 | 1.6 | OTP brute-force limit (5 attempts via `ride_otp_events`) | Low |
| 🟠 P2 | 2.7 | Concurrent booking guard (partial unique index + `createBooking` check) | Low |
| 🟠 P2 | 2.6 | CAS `WHERE status = $expected` on all state transitions | Medium |
| 🟠 P2 | 4.3 | `goOnline` vehicle ownership + state validation | Low |
| 🟠 P2 | 4.4 | `updateLocation` session ownership check | Low |
| 🟠 P2 | 4.1 | Auth + coordinate fuzzing on `/nearby-drivers` and `/return-cab-available` | Low |
| 🟡 P3 | 1.5 | `scheduledFor` wired through rental booking → delayed dispatch | High |
| 🟡 P3 | 2.2 | Post-accept cancellation flow for user + driver | High |
| 🟡 P3 | 2.1 | Actual distance from `gps_tracks` at trip end | Medium |
| 🟡 P3 | 2.4 | OTP recovery on page reload (sessionStorage or `/rides/:id/otp`) | Low |
| 🟡 P3 | 2.5 | Driver session state guard in `acceptAssignment` | Low |
| 🟡 P3 | 5.1 | Add Zod schemas for all rides routes (separate from 1.3 — covers non-booking routes) | Medium |
| 🟡 P3 | 5.3 | `AppError` class + consistent error factory | Low |
| 🟢 P4 | 3.1 | Redis cache for `driverId → activeRideId` to skip rides query per ping | Medium |
| 🟢 P4 | 3.3 | Batch fare estimate endpoint | Medium |
| 🟢 P4 | 3.4 | Rate-card Redis cache | Low |
| 🟢 P4 | 3.2 | Cap breadcrumb array at 500 points | Low |
| 🟢 P4 | 5.4 | Fetch categories from API; remove hardcoded fallback IDs | Low |
| 🟢 P4 | 5.6 | Decide and clean up `returnAt` — wire or drop | Low |
| 🟢 P4 | 6.1 | Redis-backed driver geo state (multi-instance prerequisite) | High |
| 🟢 P4 | 6.3 | Outbox pattern for socket emits (multi-instance prerequisite) | High |
| 🟢 P4 | 6.5 | Cancellable broadcast jobs | Medium |
| 🟢 P5 | 6.6 | Partition `ride_assignments` and `ride_otp_events` | Medium |

---

*End of audit. Total findings: 7 critical · 10 logical · 5 performance · 6 security · 7 code quality · 6 scalability.*
