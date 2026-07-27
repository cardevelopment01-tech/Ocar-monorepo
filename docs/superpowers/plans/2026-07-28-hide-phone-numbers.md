# Hide Driver/User Phone Numbers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the raw mobile numbers of the driver and the rider from ever reaching the *other* party's app or socket stream.

**Architecture:** Add one pure helper, `maskRideContacts`, that strips the other party's phone field from a `Ride` row based on who is viewing it (user / driver / admin). Apply it at the two REST endpoints that currently leak raw numbers, and delete the one socket payload field that leaks the driver's number to the user in real time. Admin views are untouched (ops need the real numbers). No new calling infrastructure — the "Call driver" / call-rider UI elements in both apps already render conditionally on the phone field being truthy, so once the backend sends `null` those buttons disappear on their own; no frontend edits needed.

**Tech Stack:** Express routes (`api/src/modules/rides`), Vitest for the unit test.

---

## File Structure

- Modify: `api/src/modules/rides/rides.service.ts` — add `maskRideContacts()`; remove `driverPhone` from the `sendDriverAssigned` socket payload.
- Modify: `api/src/modules/rides/rides.routes.ts` — apply `maskRideContacts()` in the `/me/active` (driver) and `/:id` (user/driver/admin) handlers.
- Test: `api/tests/unit/rides/phone-masking.test.ts`

---

### Task 1: `maskRideContacts` helper + unit test

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts`
- Test: `api/tests/unit/rides/phone-masking.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/unit/rides/phone-masking.test.ts
import { describe, it, expect } from 'vitest'
import { maskRideContacts } from '@/modules/rides/rides.service'

const RIDE = {
  user_phone: '+919876543210',
  rider_phone: '+919876500000',
  driver_phone: '+919876511111',
}

describe('maskRideContacts', () => {
  it('strips the driver phone when the viewer is the rider', () => {
    const masked = maskRideContacts(RIDE, 'user')
    expect(masked.driver_phone).toBeNull()
    expect(masked.user_phone).toBe('+919876543210')
  })

  it('strips the user/rider phone when the viewer is the driver', () => {
    const masked = maskRideContacts(RIDE, 'driver')
    expect(masked.user_phone).toBeNull()
    expect(masked.rider_phone).toBeNull()
    expect(masked.driver_phone).toBe('+919876511111')
  })

  it('leaves both numbers untouched for an admin viewer', () => {
    const masked = maskRideContacts(RIDE, 'admin')
    expect(masked.user_phone).toBe('+919876543210')
    expect(masked.driver_phone).toBe('+919876511111')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/rides/phone-masking.test.ts`
Expected: FAIL — `maskRideContacts is not exported`

- [ ] **Step 3: Add the helper**

In `api/src/modules/rides/rides.service.ts`, add near the other small pure validators (`validateRider`, `validateStops`, just above `// ── Ride booking ──` at line 309):

```typescript
// Strips the *other* party's raw phone number before a ride row leaves the
// API — the rider must never see the driver's number and vice versa (admin
// ops views are exempt). Applied at the route boundary, not the repository,
// so the numbers are still available server-side for SMS/notification jobs.
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/rides/phone-masking.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/rides/rides.service.ts api/tests/unit/rides/phone-masking.test.ts
git commit -m "feat(rides): add maskRideContacts helper to strip the other party's phone number"
```

---

### Task 2: Apply masking on the two REST endpoints that leak numbers

**Files:**
- Modify: `api/src/modules/rides/rides.routes.ts:80-88` (driver's `/me/active`)
- Modify: `api/src/modules/rides/rides.routes.ts:161-193` (`/:id`, shared by user/driver/admin)

- [ ] **Step 1: Mask the driver's own active-ride response**

`rides.routes.ts:80-88` currently reads:

```typescript
router.get('/me/active', authenticate(), async (req, res, next) => {
  try {
    const driverId = req.driver!.id
    const ride = await repo.getActiveRideForDriver(driverId)
    if (!ride) { res.status(404).json({ error: 'No active ride' }); return }
    const stops = await repo.getRideStops(BigInt(ride.id))
    res.json({ ...ride, stops })
  } catch (err) { next(err) }
})
```

Change the last two lines to:

```typescript
    const stops = await repo.getRideStops(BigInt(ride.id))
    res.json({ ...service.maskRideContacts(ride, 'driver'), stops })
```

- [ ] **Step 2: Mask the shared `/:id` response**

`rides.routes.ts:161-193` currently ends with:

```typescript
    res.json({ ...ride, stops, driver_photo: driverPhoto, startOtp: startOtp ?? undefined, endOtp: endOtp ?? undefined })
```

Replace it with (using the `isRider` flag already computed at line 178, plus the existing `req.admin` check):

```typescript
    const viewer = req.admin ? 'admin' : isRider ? 'user' : 'driver'
    const maskedRide = service.maskRideContacts(ride, viewer)
    res.json({ ...maskedRide, stops, driver_photo: driverPhoto, startOtp: startOtp ?? undefined, endOtp: endOtp ?? undefined })
```

- [ ] **Step 3: Confirm `service` is imported**

`rides.routes.ts` already imports the rides service module for other routes (e.g. `service.createBooking` at line 129) — no new import needed. Run `cd api && npx tsc --noEmit` and confirm no errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/rides/rides.routes.ts
git commit -m "fix(rides): mask the other party's phone number on ride API responses"
```

---

### Task 3: Stop leaking the driver's number over the ride-accepted socket event

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts:588-601`

- [ ] **Step 1: Remove the `driverPhone` field from the socket payload**

Current code:

```typescript
  socketEvents.sendDriverAssigned(rideId.toString(), {
    rideId:             rideId.toString(),
    status:             'accepted',
    driverId:           driverId.toString(),
    driverName:         ride?.driver_name ?? null,
    driverPhone:        ride?.driver_phone ?? null,
    driverRating:       ride?.driver_rating ?? null,
    driverPhoto:        driverPhoto,
    vehicleModel:       ride?.vehicle_model ?? null,
    vehicleBrand:       ride?.vehicle_brand ?? null,
    vehicleColor:       ride?.vehicle_color ?? null,
    vehicleName:        ride?.vehicle_name ?? null,
    vehicleNumberPlate: ride?.vehicle_number_plate ?? null,
  })
```

Delete the `driverPhone:` line. This event is broadcast to the `ride:{rideId}` room (both parties), and the rider's app reads `data.driverPhone` straight into `ride.driver_phone` on live acceptance — the exact real-time leak. The rider's initial `GET /rides/:id` load already goes through the masked route from Task 2, so removing it here just closes the live-update gap.

- [ ] **Step 2: Verify no other consumer breaks**

`apps/user/app/(main)/ride/[id]/page.tsx`'s `onDriverAssigned` handler reads `data.driverPhone ?? prev.driver_phone` — with the field gone it falls back to `prev.driver_phone`, which is already `null` from the masked REST load. The "Call driver" button (`ride?.driver_phone && ...`) simply won't render. No frontend change required.

- [ ] **Step 3: Run the full masking test file plus typecheck**

Run: `cd api && npx vitest run tests/unit/rides/phone-masking.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/rides/rides.service.ts
git commit -m "fix(rides): stop broadcasting the driver's raw phone number on ride acceptance"
```

---

### Task 4: Stop the `ride_accepted` SMS from including the driver's raw number

Found during code review of Task 3: the `ride_accepted` SMS sent to the rider embeds the driver's raw phone number in plain text, independent of the app/socket leaks Tasks 1-3 closed.

**Files:**
- Modify: `api/src/jobs/workers/notifications.worker.ts` (the `ride_accepted` SMS branch, around the `driverPhoneSuffix` line)
- Create: `api/src/db/migrations/065_ride_accepted_sms_no_phone.sql`

- [ ] **Step 1: Stop passing the phone number into the SMS template context**

`api/src/jobs/workers/notifications.worker.ts` (in the `ride_accepted` job branch) currently has:

```typescript
        const { body: message } = await renderTemplate('ride_accepted', 'sms', {
          driverName,
          driverPhoneSuffix: data.driverPhone ? ` (${data.driverPhone})` : '',
        })
```

Change to:

```typescript
        const { body: message } = await renderTemplate('ride_accepted', 'sms', {
          driverName,
        })
```

- [ ] **Step 2: Migration to drop `{{driverPhoneSuffix}}` from the template**

The seed template (`api/src/db/migrations/036_notification_templates.sql:69-71`) hardcodes:

```sql
  ('ride_accepted', 'Ride accepted (SMS to rider)', 'sms', NULL,
   'Ocar: {{driverName}}{{driverPhoneSuffix}} has accepted your ride and is on the way to pick you up.',
   '{"required": ["driverName"], "optional": ["driverPhoneSuffix"]}'),
```

Create `api/src/db/migrations/065_ride_accepted_sms_no_phone.sql` (or the next free number after whatever the billing-notification plan's `065_ride_completed_push_fare.sql` claimed, if that's landed first — check `api/src/db/migrations/` for the actual next free number before naming this file):

```sql
-- The ride_accepted SMS embedded the driver's raw phone number in plain text
-- (via {{driverPhoneSuffix}}), leaking it to the rider independent of the
-- app/socket masking fixed elsewhere in this plan.
UPDATE notification_templates
SET body = 'Ocar: {{driverName}} has accepted your ride and is on the way to pick you up.',
    variables_schema = '{"required": ["driverName"], "optional": []}',
    version = version + 1
WHERE slug = 'ride_accepted' AND channel = 'sms' AND is_active;
```

- [ ] **Step 3: Run the migration and typecheck**

Run: `cd api && pnpm migrate && npx tsc --noEmit`
Expected: migration applied, no type errors.

- [ ] **Step 4: Manually verify**

Accept a ride as a driver, check the SMS the rider receives (or the logged `notification_logs` row in dev if SMS isn't wired to a real provider) — confirm it no longer contains a phone number.

- [ ] **Step 5: Commit**

```bash
git add api/src/jobs/workers/notifications.worker.ts api/src/db/migrations/065_ride_accepted_sms_no_phone.sql
git commit -m "fix(notifications): stop including the driver's raw phone number in the ride-accepted SMS"
```

## Manual verification (after implementation)

1. Book a one-way ride as a user, accept it as a driver on a second device/tab.
2. On the user's ride-tracking screen: confirm no "Call driver" button appears and no phone number is shown.
3. On the driver's active-ride screen: confirm no rider phone number/call button appears.
4. Confirm the admin `rides` page still shows both numbers (unaffected — `req.admin` path is exempt).
5. `GET /api/v1/rides/:id` as the rider via curl/Postman: confirm `driver_phone` is `null` in the JSON; as the driver: confirm `user_phone`/`rider_phone` are `null`.

**Deferred (out of scope for this plan):** any actual masked/proxy calling capability between driver and rider — the client explicitly chose "just hide the number for now" over building a telephony-proxy or in-app VoIP integration. Revisit if the client asks to restore calling.
