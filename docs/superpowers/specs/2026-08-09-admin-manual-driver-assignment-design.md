# Admin Manual Driver Assignment — Design

## Problem

Client request: for a requested/advance (scheduled) ride, an admin should be able to manually assign a specific driver instead of relying solely on the automatic broadcast-matching pipeline.

Today, admins can only view a ride (`GET /admin/rides/:id`) and force-complete/force-cancel it (`POST /admin/rides/:id/force-resolve`). There is no manual-assign capability anywhere in `api/src/modules/rides` or `api/src/modules/admin`. Advance (scheduled) bookings are already fully built — `rides.scheduled_for`, `status='scheduled'`, auto-dispatch into broadcast at T-minus-buffer via `dispatch-scheduled.processor.ts` — the gap is purely the admin override action.

## Scope

Manual assign is available on **any ride not yet accepted** — `scheduled`, `requested`, or `no_drivers` status. Not limited to a "rescue" case; admin can use it any time.

## Admin UX

### Entry point
An **"Assign"** button appears inline on any unassigned ride row in the admin rides table (`apps/admin/app/(dashboard)/rides/page.tsx`). No need to open the ride detail drawer first — fastest path for triaging multiple stuck rides.

### Driver picker
Clicking "Assign" opens a **slide-over drawer** (reusing the existing ride-detail-drawer pattern — no new modal component; product-register guidance treats a fresh modal as the lazy default to avoid).

- Scoped to the ride's city, drivers sorted by distance from pickup.
- Search by name/phone.
- Eligible drivers (online, correct/fallback category, active city, wallet/package balance ok — the same gates `findNearbyDrivers` already encodes) listed normally with existing status-pill components (`success` pill = online, `muted` pill = offline, `warning` pill = wrong category — no emoji).
- Ineligible drivers stay visible but greyed out with a reason tag. Selecting one expands an inline confirm row ("Anil is offline — assign anyway?") via progressive disclosure (200ms height/opacity), not a stacked confirm modal.
- Selecting an eligible row gives immediate feedback: 150ms background transition to Indigo Subtle (`#EEF2FF`).

### Mode toggle
A segmented control (existing chip-active/chip-inactive component) with two modes:
- **"Send as Request"** (default) — driver gets an accept/decline offer, same mechanics as broadcast.
- **"Force Assign"** — commits the ride to the driver immediately, no accept step. For urgent cases.

## Driver UX

### Request mode
Reuses the existing broadcast request-card shell (no new card design). Differentiated only by an `info` pill ("Assigned by Ops", `#0EA5E9` / `#E0F2FE` — the existing informational-status color, not a new one) and a longer response timer (~30s vs. ~15-20s for broadcast) since the driver was deliberately picked and deserves a beat to check the trip. Accept/Decline as usual.

### Force-assign mode
Ride appears directly as an active assigned ride — no accept step. See the grace-period safety net below for the case where the driver is actually unreachable.

### Delivery
Reuses `notifyOwner()` — push (FCM) + socket emit + persisted in-app notification feed row. No new channel. If push is missed, the driver still sees it in their feed / active-ride screen next time the app is open.

## Backend flow

### New endpoint
`POST /admin/rides/:id/assign` — body: `{ driverId, mode: 'request' | 'force', overrideEligibility?: boolean }`.

### Eligibility
Validates the target driver against the same gates `findNearbyDrivers` uses (online session, category match/fallback, active city, wallet/package balance), minus the geo-radius check (admin is intentionally picking outside auto-match range). `overrideEligibility: true` is required to assign a driver failing a soft gate (matches the "select anyway" confirm in the UI) — hard-blocks (e.g. driver already on another active ride) can never be overridden.

### Overlap with auto-broadcast
The instant admin sends a request or force-assign, all other pending `ride_assignments` offers for that ride are cancelled via the existing `cancelAllAssignments(rideId)`. No two drivers ever see a live offer for the same ride.

### Request-mode transition
Creates a `ride_assignments` row (`status='offered'`) for the chosen driver, same ack/timer infra as broadcast. On accept: same `acceptAssignment` CAS as today (`WHERE status IN ('scheduled','requested')`), guards against a race with independent broadcast acceptance.

### Request-mode decline/timeout
Ride falls back into normal auto-broadcast (broadcast job re-enqueued), and the admin rides table surfaces a "declined/timed out" notice on that row via the existing notification pipeline, so it's never silently stuck. Admin can manually re-assign again at any time.

### Force-assign transition
Same CAS (`WHERE status IN ('scheduled','requested') → 'accepted'`), `driver_id` set immediately, driver session flips to `on_trip`.

**Grace-period safety net**: if the driver's app shows no activity (no location ping / ride screen opened) within 3–5 minutes of force-assign, the ride auto-reverts to unassigned (`driver_id` cleared, status back to `requested`) and the admin is flagged via the existing notification/toast pipeline. Implemented as a delayed BullMQ job scheduled at force-assign time, cancelled if a GPS ping or ride-screen-open event lands first (reuses the same "gps_tracks has ≥1 row for this ride" signal already used elsewhere for round-trip GPS reconciliation).

### Audit trail
Every admin action logs a `ride_status_history` row with `transition_actor='admin'` (enum already supports this) — no schema change needed for the audit trail itself.

### Schema changes needed
- No new enum values (`transition_actor='admin'` already exists).
- `ride_assignments` needs no new columns — a manual assign is just another row in the same table, distinguished by how it was created (could add an `initiated_by` / `source` column of `'broadcast' | 'admin'` if the analytics need to distinguish them later; not required for the feature to function, so deferred — YAGNI unless reporting needs it).
- New: a way to track the grace-period revert job per ride. Reuse the `ride_advance_meta`-style pattern or a lightweight new small table/column (e.g. `rides.force_assign_grace_job_id`) — exact shape decided in the implementation plan, not here.

## Motion & visual system alignment

SaaS ops dashboard context → Emil-primary (restrained, fast, functional) with Jakub-secondary polish on the one moment that earns it (driver's distinct assigned-card). Concretely:
- Drawer slide-in: 220ms, ease-out-quart.
- List filtering/search: instant, no animation (frequent/typing-driven action).
- Row-select feedback: 150ms background transition.
- Inline "select anyway" confirm: 200ms height/opacity expand.
- All of the above get a `prefers-reduced-motion` crossfade/instant fallback.
- No new colors introduced — violet stays reserved for the logomark/splash, orange stays reserved for driver/admin operational-only contexts it's already used in, info-blue carries the "assigned by ops" signal.

## Out of scope / deferred

- Distinguishing manual vs. broadcast assignments in analytics (no `initiated_by` column unless reporting needs it later).
- Any change to the existing broadcast/auto-match algorithm itself.
- Bulk-assign (assigning multiple stuck rides at once) — not requested, single-ride flow only.
