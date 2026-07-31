# Admin: Edit Driver Vehicle Details

## Problem
Admin panel has no way to correct a driver's vehicle details (category, plate, etc.) after onboarding. If a driver picks the wrong category or mistypes a plate, there's no fix except direct DB editing.

## Pattern
Mirror the existing driver-identity-correction feature exactly — same shape, same safeguards:
- `updateDriverProfile` in `api/src/modules/admin/admin.service.ts:92`
- `updateDriverProfile` repo fn in `api/src/modules/admin/admin.repository.ts:384`
- Identity edit UI in `apps/admin/app/(dashboard)/drivers/[id]/page.tsx` (`editingIdentity` block)

## Editable fields
`category_id`, `brand_id`, `model_id`, `vehicle_name`, `number_plate`, `model_year`, `color`, `fuel_type`, `seating_capacity`, `luggage_capacity`, `ac_availability` — exactly what the Vehicle tab already displays.

Out of scope: vehicle document file replacement (stays on existing approve/reject flow).

## Backend

- Route: `PATCH /api/v1/admin/drivers/:id/vehicle`, `requireAdmin('super_admin', 'ops_admin')`, added in `admin.routes.ts` next to `/drivers/:id/profile`.
- Controller: `updateDriverVehicle(req, res, next)` in `admin.controller.ts`, same shape as `updateDriverProfile`.
- Service: `updateDriverVehicle(driverId, adminId, fields, reason, ipAddress)` in `admin.service.ts`.
  - Requires `reason` (trimmed, min 10 chars) — same validation message pattern as profile correction.
  - Rejects empty field set.
  - If `category_id`/`brand_id`/`model_id` provided, validate they exist in their lookup table (reuse existing `repo.listAdminCategories`/`listAdminBrands`/`listAdminModels` or a lightweight existence check — no new lookup endpoints).
- Repository: `updateDriverVehicle(driverId, adminId, fields, reason, ipAddress)` in `admin.repository.ts`.
  - Looks up the driver's vehicle row by `driver_id` (one primary vehicle per driver per existing constraint).
  - Same whitelist-column `SET` builder + `BEGIN` / `SELECT ... FOR UPDATE` / `UPDATE` / `COMMIT` transaction as `updateDriverProfile`.
  - `recordAuditLog({ action: 'vehicles.profile_correction', targetTable: 'driver_vehicles', targetId: vehicleId, beforeState, afterState, reason, ipAddress })`.
  - `number_plate` has a DB unique constraint — catch the unique-violation error (Postgres code `23505`) and surface a clean validation error (no raw `error.message`, per security rules).
- After successful update: `notifyOwner({ ownerType: 'driver', ownerId: driverId, type: 'vehicle_corrected', title: 'Vehicle details updated', body: 'Your vehicle details were updated by Ocar support.', payload: { route: 'vehicle' } })`.
- Types: add `UpdateDriverVehiclePayload` to `admin.types.ts` alongside `UpdateDriverProfilePayload`.

## Frontend

- `apps/admin/lib/admin-api.ts`: add `adminDriverApi.updateVehicle(driverId, fields, reason)`.
- Vehicle tab (`apps/admin/app/(dashboard)/drivers/[id]/page.tsx`, `activeTab === 'vehicle'` block):
  - Add an edit pencil icon next to "Vehicle Details" heading, same visual pattern as the Identity block's pencil.
  - Toggles inline edit mode on the same card (no modal).
  - `category_id` / `brand_id` / `model_id` render as `<select>` dropdowns sourced from the existing admin vehicle lookup APIs already used on `/vehicles` page (`vehicleCategoryApi`, brand/model list calls) — fetched once when edit mode opens.
  - Other fields: `vehicle_name` (text), `number_plate` (text), `model_year` (number), `color` (text), `fuel_type` (text or select if an enum exists — check `vehicles.types.ts`), `seating_capacity` / `luggage_capacity` (number), `ac_availability` (checkbox).
  - Reason textarea (min 10 chars), Save/Cancel buttons — same styling as the identity edit form.
  - On save: call `adminDriverApi.updateVehicle`, refetch driver detail, close edit mode. On error: show inline message, same as `saveIdentity`.
- No changes needed to the History tab — it already renders arbitrary before/after diffs from the audit log generically.

## Verification
- `cd api && npx tsc --noEmit`
- Manual: open a driver with a vehicle in admin, edit category + plate with a reason, verify it saves, appears correctly in Vehicle tab, and shows up in History tab's audit trail with correct before/after values.
- Manual: attempt save with reason < 10 chars → rejected client-side and server-side.
- Manual: attempt to set a plate number already used by another vehicle → clean error, not a raw DB message.
