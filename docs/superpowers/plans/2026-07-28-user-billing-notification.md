# Show Final Billing Amount to the Rider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a ride ends, the rider should see the actual final fare and get a notification that mentions the amount — today only the driver sees it (from their own end-OTP API response); the rider's app silently drops the same data.

**Architecture:** The backend already computes and broadcasts the final fare on ride completion (`finalFare` in the `ride:status_update` socket payload, and `total_final` in `GET /rides/:id`) — the leak is entirely on the consuming side. Fix three independent drops: (1) the rider's socket handler ignores `data.finalFare`, (2) the rider's fare display reads `total_estimated` instead of `total_final`, (3) the push/in-app notification template has no fare variable (only the SMS template does).

**Tech Stack:** Next.js (`apps/user`), Express (`api`), SQL migration.

---

## File Structure

- Modify: `apps/user/app/(main)/ride/[id]/page.tsx` — read `finalFare` off the socket payload; display `total_final` when present.
- Create: `api/src/db/migrations/065_ride_completed_push_fare.sql` — add `{{fareStr}}` to the push template.
- Modify: `api/src/jobs/workers/notifications.worker.ts:172` — pass `fareStr` into the push render call.

---

### Task 1: User app — apply the final fare the backend already sends

**Files:**
- Modify: `apps/user/app/(main)/ride/[id]/page.tsx:391-405` (socket handler)
- Modify: `apps/user/app/(main)/ride/[id]/page.tsx:665` (fare display)

- [ ] **Step 1: Read `finalFare` off the status-update payload**

`apps/user/app/(main)/ride/[id]/page.tsx:391-397` currently types the handler as:

```typescript
    const onStatusUpdate = (data: {
      status: string; startOtp?: string; endOtp?: string
      fareDrift?: { previousFare: number; currentFare: number }
      paymentChannel?: string
      razorpayOrderId?: string
      razorpayKey?: string
      amount?: number
    }) => {
```

Add `finalFare?: number` to the type:

```typescript
    const onStatusUpdate = (data: {
      status: string; startOtp?: string; endOtp?: string
      fareDrift?: { previousFare: number; currentFare: number }
      paymentChannel?: string
      razorpayOrderId?: string
      razorpayKey?: string
      amount?: number
      finalFare?: number
    }) => {
```

Then, right after the existing `setRideStatus(data.status)` line inside the same handler (line 399), add:

```typescript
      if (typeof data.finalFare === 'number') {
        setRide(prev => prev ? { ...prev, total_final: String(data.finalFare) } : prev)
      }
```

- [ ] **Step 2: Display the final fare once it exists**

`apps/user/app/(main)/ride/[id]/page.tsx:665` currently reads:

```typescript
  const fare = ride?.total_estimated != null ? `₹${Math.round(parseFloat(ride.total_estimated))}` : null
```

Change to:

```typescript
  const fare = ride?.total_final != null
    ? `₹${Math.round(parseFloat(ride.total_final))}`
    : ride?.total_estimated != null ? `₹${Math.round(parseFloat(ride.total_estimated))}` : null
```

(`RideDetail.total_final` already exists as a field in `apps/user/lib/ride-api.ts:68` and `GET /rides/:id` already selects `fs.total_final` — this is purely "read the field that was already there.")

- [ ] **Step 3: Manually verify**

Run `cd apps/user && pnpm dev` and `cd api && pnpm dev`. Complete a one-way ride end-to-end (start OTP → end OTP as driver). On the rider's tracking screen, confirm the fare shown updates to the settled amount the instant the driver verifies the end OTP (before the 2-second auto-redirect to `/rate`), and confirm it still shows correctly after a manual page reload.

- [ ] **Step 4: Commit**

```bash
git add apps/user/app/\(main\)/ride/\[id\]/page.tsx
git commit -m "fix(user): show the settled final fare instead of the pre-trip estimate"
```

---

### Task 2: Backend — put the fare amount in the push/in-app notification

**Files:**
- Create: `api/src/db/migrations/065_ride_completed_push_fare.sql`
- Modify: `api/src/jobs/workers/notifications.worker.ts:172`

`notifications.worker.ts` registers its job handler as one large anonymous function passed straight into `new Worker(...)` (no per-job-name export exists, and no other job branch in this file has a dedicated unit test — see `api/tests/unit/notifications/notify-ride-payment-failed.test.ts`, which tests the separately-exported `notifyRidePaymentFailed` service function instead). Extracting this branch into a testable unit is a larger refactor than this two-line fix warrants; verify this one by hand (Step 3) instead of adding a test harness around the whole worker.

- [ ] **Step 1: Pass `fareStr` into the push render call**

`api/src/jobs/workers/notifications.worker.ts:146-183` already computes `fareStr` for the SMS branch (line 162: `const fareStr = fare != null && fare > 0 ? \` Total fare: ₹${fare}.\` : ''`). The push branch at line 172 currently ignores it:

```typescript
      try {
        const { subject, body } = await renderTemplate('ride_completed', 'push', {})
```

Change to:

```typescript
      try {
        const { subject, body } = await renderTemplate('ride_completed', 'push', { fareStr })
```

- [ ] **Step 2: Add the migration to give the push template a `{{fareStr}}` placeholder**

The seed template (`api/src/db/migrations/036_notification_templates.sql:81-83`) hardcodes:

```sql
  ('ride_completed', 'push', 'Ride Complete',
   'Your ride is complete. Thank you for riding with Ocar!',
   ...
```

Rather than editing an already-applied migration, add a new one. Create `api/src/db/migrations/065_ride_completed_push_fare.sql`:

```sql
-- The ride_completed push template never carried the settled fare amount,
-- unlike its SMS sibling (which already has {{fareStr}}) — this is why the
-- rider's push/in-app notification never mentioned the billed amount.
UPDATE notification_templates
SET body = 'Your ride is complete.{{fareStr}} Thank you for riding with Ocar!',
    variables_schema = '{"required": [], "optional": ["fareStr"]}',
    version = version + 1
WHERE slug = 'ride_completed' AND channel = 'push' AND is_active;
```

- [ ] **Step 3: Run the migration and verify by hand**

Run: `cd api && pnpm migrate`
Expected: migration `065_ride_completed_push_fare` applied.

Complete a ride end-to-end (start OTP → end OTP as driver, cash or online payment) and check the rider's in-app notification feed (`/notifications`) and push notification body — confirm it now reads "Your ride is complete. Total fare: ₹NNN. Thank you for riding with Ocar!" instead of the amount-less version.

- [ ] **Step 4: Commit**

```bash
git add api/src/jobs/workers/notifications.worker.ts api/src/db/migrations/065_ride_completed_push_fare.sql
git commit -m "fix(notifications): include the settled fare in the ride-completed push/in-app message"
```

---

## Notes

- The driver side needs no changes — it already reads `finalFare` correctly from its own end-OTP API response (`apps/driver/src/pages/ActiveRide/TripInProgress.tsx:366`).
- The auto-redirect to `/rate` 2 seconds after completion (`ride/[id]/page.tsx:514-518`) is left as-is — the client asked for a notification of the billed amount, not a slower rating flow. If the client later says 2 seconds is too fast to read the fare, that's a one-line timeout bump, not addressed here.
