# Sedan/SUV Category Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the category fallback data (Luxury must never absorb SUV overflow) and surface the existing Sedan↔Hatchback / SUV↔Sedan fallback to riders and drivers so nobody is confused when a different-category car shows up at the same price.

**Architecture:** One data-only migration fixes `category_fallback_rules`. `getRideById` gains two joins so both the booked and assigned category names are queryable in one round trip. Those names flow through the existing `ride:driver_assigned` socket event and `ride_accepted` notification job — no new events, no new tables. The user app reads the two names it already has and renders a badge + one-time toast when they differ; the driver app shows static copy under the category selector.

**Tech Stack:** PostgreSQL migrations, Express + TypeScript (api), Next.js/React (apps/user), Vite/React (apps/driver), Vitest.

Spec: `docs/superpowers/specs/2026-08-10-sedan-suv-category-fallback-design.md`

---

### Task 1: Fix the fallback data — remove Luxury absorbing SUV

**Files:**
- Create: `api/src/db/migrations/086_remove_luxury_suv_fallback.sql`

- [ ] **Step 1: Write the migration**

```sql
-- The fallback ladder was originally modeled as a uniform chain
-- (hatchback→sedan→suv→luxury), but the client's spec makes Luxury a hard
-- boundary: Hatchback, Luxury, and Van never participate in fallback, in
-- either direction. Only sedan←hatchback and suv←sedan should remain.
DELETE FROM category_fallback_rules
WHERE category_id = (SELECT id FROM vehicle_categories WHERE slug = 'luxury')
  AND accepts_category_id = (SELECT id FROM vehicle_categories WHERE slug = 'suv');
```

- [ ] **Step 2: Run the migration**

Run: `cd api && pnpm migrate`
Expected: output lists `086_remove_luxury_suv_fallback.sql` as applied, no errors.

- [ ] **Step 3: Verify the table contents directly**

Run: `docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT s.slug AS category, h.slug AS accepts FROM category_fallback_rules cfr JOIN vehicle_categories s ON s.id = cfr.category_id JOIN vehicle_categories h ON h.id = cfr.accepts_category_id ORDER BY 1;"`
Expected: exactly two rows — `sedan | hatchback` and `suv | sedan`. No `luxury` row.

- [ ] **Step 4: Commit**

```bash
git add api/src/db/migrations/086_remove_luxury_suv_fallback.sql
git commit -m "fix(rides): remove Luxury-absorbs-SUV fallback rule, Luxury stays isolated"
```

---

### Task 2: Expose booked/assigned category names on a ride

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts:533-579` (`getRideById`)
- Modify: `api/src/modules/rides/rides.types.ts:33-90` (`Ride` interface)
- Test: `api/src/modules/rides/rides.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `api/src/modules/rides/rides.repository.test.ts` (new `describe` block, after the existing `getCategoryDisplayName` block):

```typescript
describe('getRideById', () => {
  beforeEach(() => { mockQuery.mockReset() })

  it('joins vehicle_categories for both booked and assigned category names', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1' }] })

    await getRideById(1n)

    const [sql] = mockQuery.mock.calls[0] as [string]
    expect(sql).toContain('booked_category_name')
    expect(sql).toContain('assigned_category_name')
  })
})
```

Also update the import line at the top of the file:

```typescript
import { getEligibleDriverCategoryIds, findNearbyDrivers, findReturnCabDrivers, getCategoryDisplayName, getRideById } from './rides.repository'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run rides.repository.test.ts -t "joins vehicle_categories"`
Expected: FAIL — SQL string doesn't contain `booked_category_name`/`assigned_category_name` yet.

- [ ] **Step 3: Add the two joins in `getRideById`**

In `api/src/modules/rides/rides.repository.ts`, in the `getRideById` SELECT list, add two columns right after the existing `vb.name AS vehicle_brand,` line:

```typescript
       dv.number_plate  AS vehicle_number_plate,
       dv.color         AS vehicle_color,
       dv.vehicle_name  AS vehicle_name,
       vm.name          AS vehicle_model,
       vb.name          AS vehicle_brand,
       bvc.display_name AS booked_category_name,
       avc.display_name AS assigned_category_name,
```

And add two joins right after the existing `LEFT JOIN vehicle_brands vb ON vb.id = dv.brand_id` line:

```typescript
     LEFT JOIN vehicle_brands vb   ON vb.id = dv.brand_id
     LEFT JOIN vehicle_categories bvc ON bvc.id = r.category_id
     LEFT JOIN vehicle_categories avc ON avc.id = dv.category_id
```

- [ ] **Step 4: Add the two fields to the `Ride` type**

In `api/src/modules/rides/rides.types.ts`, in the `Ride` interface, add after `vehicle_brand: string | null`:

```typescript
  vehicle_brand: string | null
  booked_category_name: string | null
  assigned_category_name: string | null
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && npx vitest run rides.repository.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 6: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add api/src/modules/rides/rides.repository.ts api/src/modules/rides/rides.types.ts api/src/modules/rides/rides.repository.test.ts
git commit -m "feat(rides): expose booked and assigned category names on getRideById"
```

---

### Task 3: Carry category names through the driver-assigned socket event and notification job

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts:678-711`

- [ ] **Step 1: Add the two fields to the `sendDriverAssigned` payload**

In `api/src/modules/rides/rides.service.ts`, in the `acceptRide` function, update the `socketEvents.sendDriverAssigned` call:

```typescript
  socketEvents.sendDriverAssigned(rideId.toString(), {
    rideId:             rideId.toString(),
    status:             'accepted',
    driverId:           driverId.toString(),
    driverName:         ride?.driver_name ?? null,
    driverRating:       ride?.driver_rating ?? null,
    driverPhoto:        driverPhoto,
    vehicleModel:       ride?.vehicle_model ?? null,
    vehicleBrand:       ride?.vehicle_brand ?? null,
    vehicleColor:       ride?.vehicle_color ?? null,
    vehicleName:        ride?.vehicle_name ?? null,
    vehicleNumberPlate: ride?.vehicle_number_plate ?? null,
    bookedCategoryName:   ride?.booked_category_name ?? null,
    assignedCategoryName: ride?.assigned_category_name ?? null,
  })
```

(`sendDriverAssigned`'s second parameter is typed `data: object` in `api/src/websocket/socket.server.ts:265` — no type change needed there.)

- [ ] **Step 2: Pass category names into the `ride_accepted` notification job**

In the same function, update the `queues[QUEUE_NAMES.NOTIFICATIONS].add('ride_accepted', ...)` call:

```typescript
  if (ride?.user_phone) {
    void queues[QUEUE_NAMES.NOTIFICATIONS].add('ride_accepted', {
      rideId:      rideId.toString(),
      userId:      ride.user_id.toString(),
      userPhone:   ride.user_phone,
      driverName:  ride.driver_name ?? null,
      driverPhone: ride.driver_phone ?? null,
      bookedCategoryName:   ride.booked_category_name ?? null,
      assignedCategoryName: ride.assigned_category_name ?? null,
    }, { attempts: 2, removeOnComplete: 50, removeOnFail: 20 }).catch(() => {})
  }
```

- [ ] **Step 3: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/rides/rides.service.ts
git commit -m "feat(rides): carry booked/assigned category names to socket event and notification job"
```

---

### Task 4: Add the upgrade line to the ride-accepted push notification

**Files:**
- Create: `api/src/db/migrations/087_ride_accepted_upgrade_note.sql`
- Modify: `api/src/jobs/workers/notifications.worker.ts:112-146`

- [ ] **Step 1: Write the migration to update the push template**

```sql
-- Appends an optional {{upgradeNote}} placeholder to the ride_accepted push
-- body. The worker always supplies upgradeNote (empty string when the
-- assigned vehicle matches the booked category, or a one-line note when it
-- doesn't) — see notifications.worker.ts's ride_accepted handler.
UPDATE notification_templates
SET body = '{{driverName}} has accepted your ride and is on the way.{{upgradeNote}}',
    variables_schema = '{"required": ["driverName"], "optional": ["upgradeNote"]}',
    version = version + 1
WHERE slug = 'ride_accepted' AND channel = 'push' AND is_active;
```

- [ ] **Step 2: Run the migration**

Run: `cd api && pnpm migrate`
Expected: `087_ride_accepted_upgrade_note.sql` applied, no errors.

- [ ] **Step 3: Build `upgradeNote` in the worker and pass it to `renderTemplate`**

In `api/src/jobs/workers/notifications.worker.ts`, in the `ride_accepted` branch, update the job data type and the push-template call:

```typescript
    } else if (job.name === 'ride_accepted') {
      const data = job.data as {
        rideId:      string
        userId:      string
        userPhone:   string
        driverName:  string | null
        driverPhone: string | null
        bookedCategoryName:   string | null
        assignedCategoryName: string | null
      }
      const lp: LogParams = { jobName: job.name, recipientPhone: data.userPhone, payload: data as Record<string, unknown> }
      const logId = await notifService.logNotification(lp)
      const driverName = data.driverName ?? 'Your driver'
      const upgradeNote =
        data.bookedCategoryName && data.assignedCategoryName && data.bookedCategoryName !== data.assignedCategoryName
          ? ` You've been upgraded to ${data.assignedCategoryName} at no extra cost.`
          : ''
      try {
        const { body: message } = await renderTemplate('ride_accepted', 'sms', {
          driverName,
        })
        await sendSms(data.userPhone, message)
        await notifService.markSent(logId)
      } catch (err) {
        await notifService.markFailed(logId, err instanceof Error ? err.message : String(err))
        throw err
      }

      try {
        const { subject, body } = await renderTemplate('ride_accepted', 'push', { driverName, upgradeNote })
        await notifService.notifyOwner({
          ownerType: 'user',
          ownerId: BigInt(data.userId),
          type: 'ride_accepted',
          title: subject ?? 'Driver on the way',
          body,
          rideId: BigInt(data.rideId),
        })
      } catch (err) {
        log.error({ err }, 'notify failed for ride_accepted')
      }
```

(The SMS template is untouched — it stays short; the upgrade note is push-only, matching the spec's rider-facing surfaces.)

- [ ] **Step 4: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `docker exec ocar_postgres psql -U postgres -d ocar -c "SELECT body, version FROM notification_templates WHERE slug='ride_accepted' AND channel='push';"`
Expected: body contains `{{upgradeNote}}`, version incremented by 1 from before.

- [ ] **Step 6: Commit**

```bash
git add api/src/db/migrations/087_ride_accepted_upgrade_note.sql api/src/jobs/workers/notifications.worker.ts
git commit -m "feat(notifications): add upgrade note to ride_accepted push when category changes"
```

---

### Task 5: Rider UX — upgrade toast + persistent badge

**Files:**
- Modify: `apps/user/lib/ride-api.ts:44-99` (`RideDetail` type)
- Modify: `apps/user/app/(main)/ride/[id]/page.tsx`

- [ ] **Step 1: Add the two fields to `RideDetail`**

In `apps/user/lib/ride-api.ts`, add to the `RideDetail` type after `vehicle_brand: string | null`:

```typescript
  vehicle_brand: string | null
  booked_category_name: string | null
  assigned_category_name: string | null
```

- [ ] **Step 2: Carry the two fields through the socket handler**

In `apps/user/app/(main)/ride/[id]/page.tsx`, update the `onDriverAssigned` handler (around line 512-532):

```typescript
    const onDriverAssigned = (data: {
      driverName?: string | null; driverPhone?: string | null
      driverRating?: string | null; driverPhoto?: string | null
      vehicleModel?: string | null; vehicleBrand?: string | null
      vehicleColor?: string | null; vehicleName?: string | null
      vehicleNumberPlate?: string | null
      bookedCategoryName?: string | null; assignedCategoryName?: string | null
    }) => {
      setRideStatus('accepted')
      setRide(prev => prev ? {
        ...prev,
        driver_name:          data.driverName          ?? prev.driver_name,
        driver_phone:         data.driverPhone         ?? prev.driver_phone,
        driver_rating:        data.driverRating        ?? prev.driver_rating,
        driver_photo:         data.driverPhoto         ?? prev.driver_photo,
        vehicle_model:        data.vehicleModel        ?? prev.vehicle_model,
        vehicle_brand:        data.vehicleBrand        ?? prev.vehicle_brand,
        vehicle_color:        data.vehicleColor        ?? prev.vehicle_color,
        vehicle_name:         data.vehicleName         ?? prev.vehicle_name,
        vehicle_number_plate: data.vehicleNumberPlate  ?? prev.vehicle_number_plate,
        booked_category_name:   data.bookedCategoryName   ?? prev.booked_category_name,
        assigned_category_name: data.assignedCategoryName ?? prev.assigned_category_name,
      } : prev)
      if (data.bookedCategoryName && data.assignedCategoryName && data.bookedCategoryName !== data.assignedCategoryName) {
        setShowUpgradeToast(true)
        setTimeout(() => setShowUpgradeToast(false), 4000)
      }
    }
```

- [ ] **Step 3: Add the `showUpgradeToast` state**

Near the other `useState` declarations in the component (close to where `rideStatus`/`ride` state is declared — search for `const [rideStatus`), add:

```typescript
  const [showUpgradeToast, setShowUpgradeToast] = useState(false)
```

- [ ] **Step 4: Render the toast above the driver row**

In the JSX, right before the `{hasDriver && (` block (around line 1007), add:

```typescript
          <AnimatePresence>
            {showUpgradeToast && ride?.assigned_category_name && (
              <motion.div
                initial={{ opacity: 0, y: -10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22, ease: EASE }}
                className="mx-4 mb-2 px-3 py-2 rounded-xl text-[12px] font-semibold"
                style={{ background: '#D1FAE5', color: '#059669' }}
              >
                You've been upgraded to {ride.assigned_category_name} — same fare, more room.
              </motion.div>
            )}
          </AnimatePresence>

```

(`#D1FAE5` / `#059669` are the existing `money-light` / `money` tokens from `tailwind.config.ts`; `AnimatePresence` and `motion` are already imported at the top of the file.)

- [ ] **Step 5: Add the persistent "Upgraded" badge to `DriverMiniRow`**

In `DriverMiniRow` (around line 194), update the vehicle-plate row to include the badge when categories differ:

```typescript
          {ride?.vehicle_number_plate && (
            <>
              <span className="text-[10px]" style={{ color: '#E8EEFF' }}>·</span>
              <span className="text-[11px] font-semibold tracking-wide truncate" style={{ color: '#475569' }}>{ride.vehicle_number_plate}</span>
            </>
          )}
          {ride?.booked_category_name && ride?.assigned_category_name && ride.booked_category_name !== ride.assigned_category_name && (
            <>
              <span className="text-[10px]" style={{ color: '#E8EEFF' }}>·</span>
              <span
                title={`You booked ${ride.booked_category_name} — upgraded to ${ride.assigned_category_name} at no extra cost.`}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: '#D1FAE5', color: '#059669' }}
              >
                Upgraded
              </span>
            </>
          )}
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/user && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run: `cd apps/user && pnpm dev`, then walk through an active ride in the browser (or with a seeded fallback-matched ride) and confirm: the toast appears once and auto-dismisses after ~4s, the "Upgraded" badge persists in the driver row, and its `title` tooltip shows the explanation on hover/tap. Confirm an exact-category-match ride shows neither.

- [ ] **Step 8: Commit**

```bash
git add apps/user/lib/ride-api.ts "apps/user/app/(main)/ride/[id]/page.tsx"
git commit -m "feat(user): show upgrade toast and badge when assigned vehicle category differs from booked"
```

---

### Task 6: Driver UX — explanatory note on category selection

**Files:**
- Modify: `apps/driver/src/pages/Onboarding/VehicleRegistration.tsx:226-235`
- Modify: `apps/driver/src/pages/Settings/VehicleDetails.tsx:203-212`

- [ ] **Step 1: Add a fallback-copy lookup and render it in `VehicleRegistration.tsx`**

In `apps/driver/src/pages/Onboarding/VehicleRegistration.tsx`, add near the other top-level constants (after `FUEL_TYPES`):

```typescript
const CATEGORY_FALLBACK_NOTE: Record<string, string> = {
  sedan: 'Sedan drivers also receive Hatchback requests when Hatchbacks are scarce nearby, paid at Sedan fare.',
  suv:   'SUV drivers also receive Sedan requests when Sedans are scarce nearby, paid at SUV fare.',
}
```

Then update the Category field (around line 226-235):

```typescript
        {/* Category */}
        <Field label="Vehicle Category">
          <div className="grid grid-cols-2 gap-2">
            {categories.map(c => (
              <button key={c.id} onClick={() => setCategoryId(Number(c.id))}
                className={`py-3 rounded-xl border-2 font-semibold text-sm transition-all ${categoryId === Number(c.id) ? 'border-primary text-primary bg-primary/10' : 'border-border text-text-secondary bg-surface-2'}`}>
                {c.display_name}
              </button>
            ))}
          </div>
          {(() => {
            const slug = categories.find(c => Number(c.id) === categoryId)?.slug
            const note = slug ? CATEGORY_FALLBACK_NOTE[slug] : undefined
            return note ? <p className="text-text-muted text-xs mt-2">{note}</p> : null
          })()}
        </Field>
```

- [ ] **Step 2: Mirror the same change in `VehicleDetails.tsx`**

In `apps/driver/src/pages/Settings/VehicleDetails.tsx`, add the same `CATEGORY_FALLBACK_NOTE` constant near its top-level constants, and apply the identical note block after its category grid (around line 203-212):

```typescript
          {/* Category */}
          <Field label="Vehicle Category">
            <div className="grid grid-cols-2 gap-2">
              {categories.map(c => (
                <button key={c.id} onClick={() => setCategoryId(Number(c.id))}
                  className={`py-3 rounded-xl border-2 font-semibold text-sm transition-all ${categoryId === Number(c.id) ? 'border-primary text-primary bg-primary/10' : 'border-border text-text-secondary bg-surface-2'}`}>
                  {c.display_name}
                </button>
              ))}
            </div>
            {(() => {
              const slug = categories.find(c => Number(c.id) === categoryId)?.slug
              const note = slug ? CATEGORY_FALLBACK_NOTE[slug] : undefined
              return note ? <p className="text-text-muted text-xs mt-2">{note}</p> : null
            })()}
          </Field>
```

(Check the exact JSX indentation/wrapper at that call site before pasting — `VehicleDetails.tsx`'s field may be nested one level deeper than `VehicleRegistration.tsx`'s; match whatever indentation already surrounds its category `Field` block.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `cd apps/driver && pnpm dev`, open vehicle registration (or Settings → Vehicle Details), select Sedan → confirm the Sedan note appears; select SUV → confirm the SUV note appears; select Hatchback/Luxury/Van → confirm no note appears.

- [ ] **Step 5: Commit**

```bash
git add apps/driver/src/pages/Onboarding/VehicleRegistration.tsx apps/driver/src/pages/Settings/VehicleDetails.tsx
git commit -m "feat(driver): explain Sedan/SUV fallback bookings at category selection"
```

---

### Task 7: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full backend test suite**

Run: `cd api && pnpm test`
Expected: all unit tests pass, including the new `getRideById` test from Task 2.

- [ ] **Step 2: All typechecks**

Run: `cd api && npx tsc --noEmit && cd ../apps/user && npx tsc --noEmit && cd ../driver && npx tsc --noEmit && cd ../admin && npx tsc --noEmit`
Expected: no errors in any of the four.

- [ ] **Step 3: Manual fallback-matching smoke test**

With `api`, `apps/user`, and `apps/driver` all running (`pnpm dev` in each):
1. Put one Sedan driver online, zero Hatchback drivers online, in the same city.
2. Book a Hatchback ride from the user app.
3. Confirm the Sedan driver receives the request (only after round 1 exhausts — expect a short delay before it reaches them), accepts it, and the rider sees the "Upgraded to Sedan" toast + badge, plus a push notification with the upgrade line.
4. Confirm the fare charged is the Hatchback rate, not Sedan (check the fare shown to the rider against the Hatchback rate card).
5. Repeat for Sedan booking → SUV driver.
6. Put only a Luxury driver online, book an SUV ride, confirm the Luxury driver does **not** receive it (no fallback rule permits this) and the ride eventually reports no drivers available.
