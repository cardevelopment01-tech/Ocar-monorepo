# Admin Vehicle Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin correct a driver's vehicle details (category, brand, model, plate, year, color, fuel type, seats, luggage, AC) from the admin panel's Vehicle tab, with a required reason and a full audit trail.

**Architecture:** Mirror the existing driver-identity-correction feature exactly: a whitelist-column repo function wrapped in a `SELECT ... FOR UPDATE` transaction, a service layer that requires a reason and converts wire-format FK strings to `bigint`, a controller that whitelists request-body fields, and an inline edit form in the Vehicle tab matching the existing Identity edit block. `category_id`/`brand_id`/`model_id` already have DB foreign-key constraints (`004_m2_vehicles.sql`) and `number_plate` already has a unique constraint — invalid values surface through the *already-existing* global `23503`/`23505` handling in `error.middleware.ts`, so no new validation-existence-check code is needed.

**Tech Stack:** Express + TypeScript (api), pg, vitest (api unit tests), Next.js 16 + React 19 (apps/admin), axios.

Spec: `docs/superpowers/specs/2026-07-31-admin-vehicle-edit-design.md`

---

### Task 1: Backend types

**Files:**
- Modify: `api/src/modules/admin/admin.types.ts`

- [ ] **Step 1: Add `category_id`/`brand_id`/`model_id` to `AdminDriverDetail.vehicle`**

In `api/src/modules/admin/admin.types.ts`, find the `AdminDriverDetail` interface's `vehicle` field (currently starts around line 42):

```typescript
  vehicle: {
    id: string
    number_plate: string
    vehicle_name: string
    model_year: number
    color: string
    fuel_type: string
    seating_capacity: number
    luggage_capacity: number
    ac_availability: boolean
    category: string
    brand: string
  } | null
```

Replace with:

```typescript
  vehicle: {
    id: string
    number_plate: string
    vehicle_name: string
    model_year: number
    color: string
    fuel_type: string
    seating_capacity: number
    luggage_capacity: number
    ac_availability: boolean
    category: string
    brand: string
    category_id: string | null
    brand_id: string | null
    model_id: string | null
  } | null
```

- [ ] **Step 2: Add `UpdateDriverVehiclePayload`**

Directly below the existing `UpdateDriverProfilePayload` interface, add:

```typescript
// Vehicle spec fields an admin can correct after a driver mistake at
// onboarding (wrong category, plate typo, etc). category_id/brand_id/model_id
// are wire-format strings (bigint-as-string, like everywhere else in this
// file) — the service layer converts them to bigint before the repo call.
export interface UpdateDriverVehiclePayload {
  category_id?: string
  brand_id?: string
  model_id?: string | null
  vehicle_name?: string
  number_plate?: string
  model_year?: number
  color?: string
  fuel_type?: string
  seating_capacity?: number
  luggage_capacity?: number
  ac_availability?: boolean
  reason: string
}
```

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/admin/admin.types.ts
git commit -m "feat(admin-types): add UpdateDriverVehiclePayload and vehicle FK ids"
```

---

### Task 2: Backend repository — fetch FK ids + update function

**Files:**
- Modify: `api/src/modules/admin/admin.repository.ts:129-145` (`getDriverById` query)
- Modify: `api/src/modules/admin/admin.repository.ts:227-238` (`getDriverById` mapping)
- Modify: `api/src/modules/admin/admin.repository.ts` (add `updateDriverVehicle`, near `updateDriverProfile` at line 384)

- [ ] **Step 1: Add FK columns to the `getDriverById` query**

Find the query at the top of `getDriverById` (around line 130-144):

```typescript
  const driverRes = await pool.query(
    `SELECT
       d.*,
       v.id AS vehicle_id, v.number_plate, v.vehicle_name, v.model_year,
       v.color, v.fuel_type, v.seating_capacity, v.luggage_capacity, v.ac_availability,
       vc.display_name AS vehicle_category,
       vb.name AS vehicle_brand,
       dw.balance AS wallet_balance, dw.is_frozen AS wallet_is_frozen
     FROM drivers d
     LEFT JOIN driver_vehicles v ON v.driver_id = d.id
     LEFT JOIN vehicle_categories vc ON vc.id = v.category_id
     LEFT JOIN vehicle_brands vb ON vb.id = v.brand_id
     LEFT JOIN driver_wallets dw ON dw.driver_id = d.id
     WHERE d.id = $1`,
    [id]
  )
```

Replace with (adds `v.category_id, v.brand_id, v.model_id`):

```typescript
  const driverRes = await pool.query(
    `SELECT
       d.*,
       v.id AS vehicle_id, v.number_plate, v.vehicle_name, v.model_year,
       v.color, v.fuel_type, v.seating_capacity, v.luggage_capacity, v.ac_availability,
       v.category_id, v.brand_id, v.model_id,
       vc.display_name AS vehicle_category,
       vb.name AS vehicle_brand,
       dw.balance AS wallet_balance, dw.is_frozen AS wallet_is_frozen
     FROM drivers d
     LEFT JOIN driver_vehicles v ON v.driver_id = d.id
     LEFT JOIN vehicle_categories vc ON vc.id = v.category_id
     LEFT JOIN vehicle_brands vb ON vb.id = v.brand_id
     LEFT JOIN driver_wallets dw ON dw.driver_id = d.id
     WHERE d.id = $1`,
    [id]
  )
```

- [ ] **Step 2: Map the new columns in the return value**

Find the `vehicle:` block in the return statement (around line 227-238):

```typescript
    vehicle: r.vehicle_id ? {
      id: String(r.vehicle_id),
      number_plate: r.number_plate as string,
      vehicle_name: r.vehicle_name as string,
      model_year: r.model_year as number,
      color: r.color as string,
      fuel_type: r.fuel_type as string,
      seating_capacity: r.seating_capacity as number,
      luggage_capacity: r.luggage_capacity as number,
      ac_availability: r.ac_availability as boolean,
      category: r.vehicle_category as string,
```

Add three fields after `ac_availability` (keep the rest, including `brand:` on the next line, unchanged):

```typescript
    vehicle: r.vehicle_id ? {
      id: String(r.vehicle_id),
      number_plate: r.number_plate as string,
      vehicle_name: r.vehicle_name as string,
      model_year: r.model_year as number,
      color: r.color as string,
      fuel_type: r.fuel_type as string,
      seating_capacity: r.seating_capacity as number,
      luggage_capacity: r.luggage_capacity as number,
      ac_availability: r.ac_availability as boolean,
      category_id: r.category_id ? String(r.category_id) : null,
      brand_id: r.brand_id ? String(r.brand_id) : null,
      model_id: r.model_id ? String(r.model_id) : null,
      category: r.vehicle_category as string,
```

- [ ] **Step 3: Add the whitelist + `updateDriverVehicle` repository function**

Just below the `PROFILE_EDITABLE_COLUMNS` constant near the top of the file (around line 18), add:

```typescript
// Hardcoded whitelist, never built from request keys — same rationale as
// PROFILE_EDITABLE_COLUMNS above.
const VEHICLE_EDITABLE_COLUMNS = [
  'category_id', 'brand_id', 'model_id', 'vehicle_name', 'number_plate',
  'model_year', 'color', 'fuel_type', 'seating_capacity', 'luggage_capacity',
  'ac_availability',
] as const
```

Directly below `updateDriverProfile` (ends around line 438, right before the `// ─── Vehicle categories ───` comment), add:

```typescript
// Corrects vehicle spec fields to match the real vehicle (wrong category
// picked at onboarding, plate typo, etc) — a trusted admin override, same
// shape as updateDriverProfile above. category_id/brand_id/model_id and
// number_plate are DB-constrained (FK / UNIQUE) — invalid values surface as
// a clean 409 via the existing global 23503/23505 handling in
// error.middleware.ts, so no extra existence/uniqueness checks needed here.
export async function updateDriverVehicle(
  vehicleId: bigint,
  adminId: bigint,
  fields: {
    category_id?: bigint
    brand_id?: bigint
    model_id?: bigint | null
    vehicle_name?: string
    number_plate?: string
    model_year?: number
    color?: string
    fuel_type?: string
    seating_capacity?: number
    luggage_capacity?: number
    ac_availability?: boolean
  },
  reason: string,
  ipAddress: string | null
): Promise<void> {
  const setClauses: string[] = []
  const values: unknown[] = []
  for (const col of VEHICLE_EDITABLE_COLUMNS) {
    if (fields[col] !== undefined) {
      values.push(fields[col])
      setClauses.push(`${col} = $${values.length}`)
    }
  }

  const client = await pool.connect()
  let beforeState: Record<string, unknown> | null = null
  let afterState: Record<string, unknown> | null = null
  try {
    await client.query('BEGIN')

    const beforeRes = await client.query('SELECT * FROM driver_vehicles WHERE id = $1 FOR UPDATE', [vehicleId])
    beforeState = beforeRes.rows[0] ?? null

    if (setClauses.length > 0) {
      values.push(vehicleId)
      await client.query(
        `UPDATE driver_vehicles SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length}`,
        values
      )
    }

    const afterRes = await client.query('SELECT * FROM driver_vehicles WHERE id = $1', [vehicleId])
    afterState = afterRes.rows[0] ?? null

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  await recordAuditLog({
    adminId,
    action: 'vehicles.profile_correction',
    targetTable: 'driver_vehicles',
    targetId: vehicleId,
    beforeState,
    afterState,
    reason,
    ipAddress,
  })
}
```

- [ ] **Step 4: Type-check**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/admin/admin.repository.ts
git commit -m "feat(admin-repo): add updateDriverVehicle and expose vehicle FK ids"
```

---

### Task 3: Backend service — validation + notify

**Files:**
- Modify: `api/src/modules/admin/admin.service.ts`
- Create: `api/tests/unit/admin/driver-vehicle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/admin/driver-vehicle.test.ts` (mirrors `api/tests/unit/admin/driver-profile.test.ts`):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/admin/admin.repository', () => ({
  updateDriverVehicle: vi.fn(),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(),
}))

import * as repo from '@/modules/admin/admin.repository'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { updateDriverVehicle } from '@/modules/admin/admin.service'

const ADMIN_ID   = BigInt(1)
const DRIVER_ID  = BigInt(42)
const VEHICLE_ID = BigInt(7)
const VALID_REASON = 'Driver picked the wrong category at onboarding, corrected to match the RC'

describe('updateDriverVehicle', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('rejects a missing reason', async () => {
    await expect(updateDriverVehicle(DRIVER_ID, VEHICLE_ID, ADMIN_ID, { vehicle_name: 'Swift' } as never, null))
      .rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.updateDriverVehicle).not.toHaveBeenCalled()
  })

  it('rejects a reason shorter than 10 characters', async () => {
    await expect(updateDriverVehicle(DRIVER_ID, VEHICLE_ID, ADMIN_ID, { vehicle_name: 'Swift', reason: 'too short' }, null))
      .rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.updateDriverVehicle).not.toHaveBeenCalled()
  })

  it('rejects a request with no fields to change', async () => {
    await expect(updateDriverVehicle(DRIVER_ID, VEHICLE_ID, ADMIN_ID, { reason: VALID_REASON }, null))
      .rejects.toBeTruthy()
    expect(repo.updateDriverVehicle).not.toHaveBeenCalled()
  })

  it('converts category_id/brand_id/model_id from string to bigint before calling the repo', async () => {
    await updateDriverVehicle(
      DRIVER_ID, VEHICLE_ID, ADMIN_ID,
      { category_id: '3', brand_id: '5', model_id: '9', reason: VALID_REASON },
      '1.2.3.4'
    )
    expect(repo.updateDriverVehicle).toHaveBeenCalledWith(
      VEHICLE_ID, ADMIN_ID,
      { category_id: BigInt(3), brand_id: BigInt(5), model_id: BigInt(9) },
      VALID_REASON, '1.2.3.4'
    )
  })

  it('passes model_id: null through as null (clearing the model), not as undefined', async () => {
    await updateDriverVehicle(DRIVER_ID, VEHICLE_ID, ADMIN_ID, { model_id: null, reason: VALID_REASON }, null)
    expect(repo.updateDriverVehicle).toHaveBeenCalledWith(
      VEHICLE_ID, ADMIN_ID, { model_id: null }, VALID_REASON, null
    )
  })

  it('passes non-FK fields through unchanged and notifies the driver', async () => {
    await updateDriverVehicle(
      DRIVER_ID, VEHICLE_ID, ADMIN_ID,
      { number_plate: 'OD-02-AB-1234', seating_capacity: 4, ac_availability: true, reason: VALID_REASON },
      null
    )
    expect(repo.updateDriverVehicle).toHaveBeenCalledWith(
      VEHICLE_ID, ADMIN_ID,
      { number_plate: 'OD-02-AB-1234', seating_capacity: 4, ac_availability: true },
      VALID_REASON, null
    )
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'driver', ownerId: DRIVER_ID }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/admin/driver-vehicle.test.ts`
Expected: FAIL — `updateDriverVehicle` is not exported from `admin.service`.

- [ ] **Step 3: Implement `updateDriverVehicle` in the service**

In `api/src/modules/admin/admin.service.ts`, the import line near the top currently reads:

```typescript
import type { DriverStatus, UpdateDriverStatusPayload, UpdateDriverProfilePayload } from './admin.types'
```

Change to:

```typescript
import type { DriverStatus, UpdateDriverStatusPayload, UpdateDriverProfilePayload, UpdateDriverVehiclePayload } from './admin.types'
```

Directly below the existing `updateDriverProfile` function (ends around line 124, right before `// ─── Admin accounts ───`), add:

```typescript
export async function updateDriverVehicle(
  driverId: bigint,
  vehicleId: bigint,
  adminId: bigint,
  payload: UpdateDriverVehiclePayload,
  ipAddress: string | null
) {
  if (!payload.reason || payload.reason.trim().length < 10) {
    throw httpError(422, 'A reason (at least 10 characters) is required to correct vehicle details', AppErrors.VALIDATION_ERROR.code)
  }
  const { reason, category_id, brand_id, model_id, ...rest } = payload

  const fields: Parameters<typeof repo.updateDriverVehicle>[2] = { ...rest }
  if (category_id !== undefined) fields.category_id = BigInt(category_id)
  if (brand_id !== undefined) fields.brand_id = BigInt(brand_id)
  if (model_id !== undefined) fields.model_id = model_id ? BigInt(model_id) : null

  if (Object.keys(fields).length === 0) {
    throw createHttpError(AppErrors.VALIDATION_ERROR)
  }

  await repo.updateDriverVehicle(vehicleId, adminId, fields, reason, ipAddress)

  await notifyOwner({
    ownerType: 'driver',
    ownerId: driverId,
    type: 'vehicle_corrected',
    title: 'Vehicle details updated',
    body: 'Your vehicle details were updated by Ocar support to match your registration.',
    payload: { route: 'vehicle' },
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/admin/driver-vehicle.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/admin/admin.service.ts api/tests/unit/admin/driver-vehicle.test.ts
git commit -m "feat(admin-service): add updateDriverVehicle with tests"
```

---

### Task 4: Backend controller + route

**Files:**
- Modify: `api/src/modules/admin/admin.controller.ts`
- Modify: `api/src/modules/admin/admin.routes.ts:25`

- [ ] **Step 1: Add the controller function**

In `api/src/modules/admin/admin.controller.ts`, the type import at the top currently reads:

```typescript
import type { DriverStatus, UpdateDriverProfilePayload } from './admin.types'
```

Change to:

```typescript
import type { DriverStatus, UpdateDriverProfilePayload, UpdateDriverVehiclePayload } from './admin.types'
```

Directly below the existing `updateDriverProfile` controller function (ends around line 73), add:

```typescript
const VEHICLE_STRING_FIELDS = ['category_id', 'brand_id', 'vehicle_name', 'number_plate', 'color', 'fuel_type'] as const
const VEHICLE_NUMBER_FIELDS = ['model_year', 'seating_capacity', 'luggage_capacity'] as const

export async function updateDriverVehicle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const driverId = BigInt(req.params['id']!)
    const adminId  = req.admin!.id
    const driver = await service.getDriver(driverId)
    if (!driver.vehicle) throw Object.assign(new Error('Driver has no vehicle registered'), { httpStatus: 404 })

    const body = req.body as Record<string, unknown>
    const payload: UpdateDriverVehiclePayload = { reason: String(body['reason'] ?? '') }

    for (const field of VEHICLE_STRING_FIELDS) {
      if (body[field] !== undefined) payload[field] = String(body[field])
    }
    for (const field of VEHICLE_NUMBER_FIELDS) {
      if (body[field] !== undefined) {
        const n = Number(body[field])
        if (isNaN(n)) throw Object.assign(new Error(`${field} must be a number`), { httpStatus: 400 })
        payload[field] = n
      }
    }
    if (body['ac_availability'] !== undefined) payload.ac_availability = Boolean(body['ac_availability'])
    if ('model_id' in body) payload.model_id = body['model_id'] ? String(body['model_id']) : null

    await service.updateDriverVehicle(driverId, BigInt(driver.vehicle.id), adminId, payload, req.ip ?? null)
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}
```

- [ ] **Step 2: Wire the route**

In `api/src/modules/admin/admin.routes.ts`, line 25 currently reads:

```typescript
router.patch('/drivers/:id/profile', requireAdmin('super_admin', 'ops_admin'), controller.updateDriverProfile)
```

Add directly below it:

```typescript
router.patch('/drivers/:id/vehicle',  requireAdmin('super_admin', 'ops_admin'), controller.updateDriverVehicle)
```

- [ ] **Step 3: Type-check**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full unit test suite**

Run: `cd api && pnpm test`
Expected: all tests pass, including the new `driver-vehicle.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/admin/admin.controller.ts api/src/modules/admin/admin.routes.ts
git commit -m "feat(admin-api): wire PATCH /drivers/:id/vehicle route"
```

---

### Task 5: Frontend API client

**Files:**
- Modify: `apps/admin/lib/admin-api.ts`

- [ ] **Step 1: Extend `DriverDetail.vehicle` with FK ids**

In `apps/admin/lib/admin-api.ts`, the `DriverDetail.vehicle` field (lines 44-56) currently reads:

```typescript
  vehicle: {
    id: string
    number_plate: string
    vehicle_name: string
    model_year: number
    color: string
    fuel_type: string
    seating_capacity: number
    luggage_capacity: number
    ac_availability: boolean
    category: string
    brand: string
  } | null
```

Replace with:

```typescript
  vehicle: {
    id: string
    number_plate: string
    vehicle_name: string
    model_year: number
    color: string
    fuel_type: string
    seating_capacity: number
    luggage_capacity: number
    ac_availability: boolean
    category: string
    brand: string
    category_id: string | null
    brand_id: string | null
    model_id: string | null
  } | null
```

- [ ] **Step 2: Add `updateVehicle` to `adminDriverApi`**

Directly below the existing `updateProfile` method (ends around line 155, right before `rides:`), add:

```typescript
  updateVehicle: async (
    id: string,
    fields: Partial<{
      category_id: string; brand_id: string; model_id: string | null
      vehicle_name: string; number_plate: string; model_year: number
      color: string; fuel_type: string; seating_capacity: number
      luggage_capacity: number; ac_availability: boolean
    }>,
    reason: string
  ): Promise<void> => {
    await api.patch(`/api/v1/admin/drivers/${id}/vehicle`, { ...fields, reason })
  },
```

- [ ] **Step 3: Type-check**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/lib/admin-api.ts
git commit -m "feat(admin-ui): add updateVehicle client and vehicle FK ids to DriverDetail"
```

---

### Task 6: Vehicle tab edit UI

**Files:**
- Modify: `apps/admin/app/(dashboard)/drivers/[id]/page.tsx`

This mirrors the existing Identity edit block (`editingIdentity`/`identityForm`/`saveIdentity`, lines 100-197 and 425-487) exactly, but for the Vehicle tab. Category/brand/model become dropdowns sourced from the existing `/vehicles` admin page's lookup APIs — fetched flat (no brand→model cascading filter) since this is a correction tool, not the onboarding flow.

- [ ] **Step 1: Import the lookup APIs**

At the top of `apps/admin/app/(dashboard)/drivers/[id]/page.tsx`, the imports currently include:

```typescript
import {
  adminDriverApi, type DriverDetail, type DriverPaymentRow, type DriverAuditLogEntry,
} from '@/lib/admin-api'
```

Add below it:

```typescript
import { vehicleCategoryApi, vehicleBrandApi, vehicleModelApi, type VehicleCategory, type VehicleBrand, type VehicleModel } from '@/lib/vehicle-api'
```

- [ ] **Step 2: Add vehicle-edit state**

Directly below the existing identity-edit state block (currently lines 100-104):

```typescript
  // Identity correction (name/Aadhaar/licence typos vs. the real documents)
  const [editingIdentity, setEditingIdentity] = useState(false)
  const [identityForm, setIdentityForm] = useState({ full_name: '', aadhaar_number: '', license_number: '', reason: '' })
  const [savingIdentity, setSavingIdentity] = useState(false)
  const [identityError, setIdentityError]   = useState('')
```

Add:

```typescript
  // Vehicle correction (wrong category/plate/etc. from onboarding)
  const [editingVehicle, setEditingVehicle] = useState(false)
  const [vehicleForm, setVehicleForm] = useState({
    category_id: '', brand_id: '', model_id: '', vehicle_name: '', number_plate: '',
    model_year: '', color: '', fuel_type: '', seating_capacity: '', luggage_capacity: '',
    ac_availability: true, reason: '',
  })
  const [savingVehicle, setSavingVehicle] = useState(false)
  const [vehicleError, setVehicleError]   = useState('')
  const [vehicleCategories, setVehicleCategories] = useState<VehicleCategory[]>([])
  const [vehicleBrands, setVehicleBrands]         = useState<VehicleBrand[]>([])
  const [vehicleModels, setVehicleModels]         = useState<VehicleModel[]>([])
```

- [ ] **Step 3: Add start/save handlers and the lookup-fetch effect**

Directly below the existing `saveIdentity` function (ends around line 197):

```typescript
  async function saveIdentity() {
    if (!detail) return
    if (identityForm.reason.trim().length < 10) {
      setIdentityError('A reason (at least 10 characters) is required.')
      return
    }
    setSavingIdentity(true); setIdentityError('')
    try {
      const fields: Parameters<typeof adminDriverApi.updateProfile>[1] = {
        full_name: identityForm.full_name,
        license_number: identityForm.license_number,
      }
      if (identityForm.aadhaar_number.trim() !== '') fields.aadhaar_number = identityForm.aadhaar_number.trim()
      await adminDriverApi.updateProfile(detail.id, fields, identityForm.reason.trim())
      await fetchDetail()
      setEditingIdentity(false)
    } catch { setIdentityError('Could not save changes. Please try again.') }
    finally { setSavingIdentity(false) }
  }
```

Add:

```typescript
  function startEditVehicle() {
    if (!detail?.vehicle) return
    const v = detail.vehicle
    setVehicleForm({
      category_id: v.category_id ?? '', brand_id: v.brand_id ?? '', model_id: v.model_id ?? '',
      vehicle_name: v.vehicle_name, number_plate: v.number_plate, model_year: String(v.model_year),
      color: v.color, fuel_type: v.fuel_type, seating_capacity: String(v.seating_capacity),
      luggage_capacity: String(v.luggage_capacity), ac_availability: v.ac_availability, reason: '',
    })
    setVehicleError('')
    setEditingVehicle(true)
    if (vehicleCategories.length === 0) vehicleCategoryApi.list().then(setVehicleCategories)
    if (vehicleBrands.length === 0) vehicleBrandApi.list().then(setVehicleBrands)
    if (vehicleModels.length === 0) vehicleModelApi.list().then(setVehicleModels)
  }
  async function saveVehicle() {
    if (!detail) return
    if (vehicleForm.reason.trim().length < 10) {
      setVehicleError('A reason (at least 10 characters) is required.')
      return
    }
    setSavingVehicle(true); setVehicleError('')
    try {
      await adminDriverApi.updateVehicle(detail.id, {
        category_id: vehicleForm.category_id || undefined,
        brand_id: vehicleForm.brand_id || undefined,
        model_id: vehicleForm.model_id || null,
        vehicle_name: vehicleForm.vehicle_name,
        number_plate: vehicleForm.number_plate,
        model_year: Number(vehicleForm.model_year),
        color: vehicleForm.color,
        fuel_type: vehicleForm.fuel_type,
        seating_capacity: Number(vehicleForm.seating_capacity),
        luggage_capacity: Number(vehicleForm.luggage_capacity),
        ac_availability: vehicleForm.ac_availability,
      }, vehicleForm.reason.trim())
      await fetchDetail()
      setEditingVehicle(false)
    } catch { setVehicleError('Could not save changes. Please try again.') }
    finally { setSavingVehicle(false) }
  }
```

- [ ] **Step 4: Replace the read-only Vehicle tab body with an edit-aware version**

The current Vehicle tab block (around lines 533-555):

```typescript
          {activeTab === 'vehicle' && (
            <div>
              {!d.vehicle ? (
                <p className="text-sm text-text-muted text-center py-8">No vehicle registered yet</p>
              ) : (
                <div className="bg-surface-2 rounded-xl p-4 border border-border-light">
                  <p className="text-xs font-semibold text-text-secondary mb-3">Vehicle Details</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <span className="text-text-muted">Name</span>     <span className="font-medium text-text-primary">{d.vehicle.vehicle_name}</span>
                    <span className="text-text-muted">Brand</span>    <span className="font-medium text-text-primary">{d.vehicle.brand}</span>
                    <span className="text-text-muted">Plate</span>    <span className="font-mono font-bold text-text-primary">{d.vehicle.number_plate}</span>
                    <span className="text-text-muted">Category</span> <span className="font-medium text-text-primary">{d.vehicle.category}</span>
                    <span className="text-text-muted">Year</span>     <span className="font-medium text-text-primary">{d.vehicle.model_year}</span>
                    <span className="text-text-muted">Color</span>    <span className="font-medium text-text-primary capitalize">{d.vehicle.color}</span>
                    <span className="text-text-muted">Fuel</span>     <span className="font-medium text-text-primary capitalize">{d.vehicle.fuel_type}</span>
                    <span className="text-text-muted">Seats</span>    <span className="font-medium text-text-primary">{d.vehicle.seating_capacity}</span>
                    <span className="text-text-muted">Luggage</span>  <span className="font-medium text-text-primary">{d.vehicle.luggage_capacity}</span>
                    <span className="text-text-muted">AC</span>       <span className="font-medium text-text-primary">{d.vehicle.ac_availability ? 'Yes' : 'No'}</span>
                  </div>
                </div>
              )}
            </div>
          )}
```

Replace with:

```typescript
          {activeTab === 'vehicle' && (
            <div>
              {!d.vehicle ? (
                <p className="text-sm text-text-muted text-center py-8">No vehicle registered yet</p>
              ) : (
                <div className="bg-surface-2 rounded-xl p-4 border border-border-light">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold text-text-secondary">Vehicle Details</p>
                    {!editingVehicle && (
                      <button onClick={startEditVehicle} className="text-text-muted hover:text-primary transition-colors" aria-label="Edit vehicle details">
                        <Pencil size={12} />
                      </button>
                    )}
                  </div>

                  {editingVehicle ? (
                    <div className="space-y-2.5">
                      <div className="grid grid-cols-2 gap-2">
                        <select value={vehicleForm.category_id} onChange={e => setVehicleForm(f => ({ ...f, category_id: e.target.value }))}
                          className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30">
                          <option value="">Category…</option>
                          {vehicleCategories.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
                        </select>
                        <select value={vehicleForm.brand_id} onChange={e => setVehicleForm(f => ({ ...f, brand_id: e.target.value }))}
                          className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30">
                          <option value="">Brand…</option>
                          {vehicleBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                      </div>
                      <select value={vehicleForm.model_id} onChange={e => setVehicleForm(f => ({ ...f, model_id: e.target.value }))}
                        className="w-full text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30">
                        <option value="">Model (optional)…</option>
                        {vehicleModels.map(m => <option key={m.id} value={m.id}>{m.brand_name} · {m.name}</option>)}
                      </select>
                      <div className="grid grid-cols-2 gap-2">
                        <input value={vehicleForm.vehicle_name} onChange={e => setVehicleForm(f => ({ ...f, vehicle_name: e.target.value }))}
                          placeholder="Vehicle name" className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        <input value={vehicleForm.number_plate} onChange={e => setVehicleForm(f => ({ ...f, number_plate: e.target.value }))}
                          placeholder="Plate number" className="text-sm font-mono bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="number" value={vehicleForm.model_year} onChange={e => setVehicleForm(f => ({ ...f, model_year: e.target.value }))}
                          placeholder="Year" className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        <input value={vehicleForm.color} onChange={e => setVehicleForm(f => ({ ...f, color: e.target.value }))}
                          placeholder="Color" className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        <select value={vehicleForm.fuel_type} onChange={e => setVehicleForm(f => ({ ...f, fuel_type: e.target.value }))}
                          className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30">
                          <option value="petrol">Petrol</option>
                          <option value="diesel">Diesel</option>
                          <option value="cng">CNG</option>
                          <option value="electric">EV</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-3 gap-2 items-center">
                        <input type="number" value={vehicleForm.seating_capacity} onChange={e => setVehicleForm(f => ({ ...f, seating_capacity: e.target.value }))}
                          placeholder="Seats" className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        <input type="number" value={vehicleForm.luggage_capacity} onChange={e => setVehicleForm(f => ({ ...f, luggage_capacity: e.target.value }))}
                          placeholder="Luggage" className="text-sm bg-surface border border-border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                          <input type="checkbox" checked={vehicleForm.ac_availability} onChange={e => setVehicleForm(f => ({ ...f, ac_availability: e.target.checked }))} />
                          AC
                        </label>
                      </div>
                      <textarea
                        value={vehicleForm.reason}
                        onChange={e => setVehicleForm(f => ({ ...f, reason: e.target.value }))}
                        placeholder="Reason for this correction (min 10 characters)…"
                        rows={2}
                        className="w-full text-xs text-text-primary bg-surface border border-border rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted"
                      />
                      {vehicleError && <p className="text-xs text-danger">{vehicleError}</p>}
                      <div className="flex gap-2 pt-0.5">
                        <button onClick={saveVehicle} disabled={savingVehicle} className="px-3 py-1 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors">
                          {savingVehicle ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingVehicle(false)} disabled={savingVehicle} className="px-3 py-1 text-xs font-semibold text-text-secondary border border-border rounded-lg hover:bg-surface-2 transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      <span className="text-text-muted">Name</span>     <span className="font-medium text-text-primary">{d.vehicle.vehicle_name}</span>
                      <span className="text-text-muted">Brand</span>    <span className="font-medium text-text-primary">{d.vehicle.brand}</span>
                      <span className="text-text-muted">Plate</span>    <span className="font-mono font-bold text-text-primary">{d.vehicle.number_plate}</span>
                      <span className="text-text-muted">Category</span> <span className="font-medium text-text-primary">{d.vehicle.category}</span>
                      <span className="text-text-muted">Year</span>     <span className="font-medium text-text-primary">{d.vehicle.model_year}</span>
                      <span className="text-text-muted">Color</span>    <span className="font-medium text-text-primary capitalize">{d.vehicle.color}</span>
                      <span className="text-text-muted">Fuel</span>     <span className="font-medium text-text-primary capitalize">{d.vehicle.fuel_type}</span>
                      <span className="text-text-muted">Seats</span>    <span className="font-medium text-text-primary">{d.vehicle.seating_capacity}</span>
                      <span className="text-text-muted">Luggage</span>  <span className="font-medium text-text-primary">{d.vehicle.luggage_capacity}</span>
                      <span className="text-text-muted">AC</span>       <span className="font-medium text-text-primary">{d.vehicle.ac_availability ? 'Yes' : 'No'}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 5: Type-check**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `cd api && pnpm dev` (in one terminal) and `cd apps/admin && pnpm dev` (in another).

In the browser at the admin portal:
1. Open a driver that has a vehicle registered → Vehicle tab.
2. Click the edit pencil, change category and plate number, leave reason blank → Save → expect an inline "reason required" error, no request sent.
3. Fill in a reason (10+ chars) → Save → expect the card to update with new values.
4. Switch to the History tab → expect a new `vehicles.profile_correction` entry with correct before/after diff for the changed fields.
5. Try setting the plate to one already used by another vehicle (check `/vehicles` fleet tab for an existing plate) → expect a clean error toast/message, not a raw stack trace or DB error string.

- [ ] **Step 7: Commit**

```bash
git add "apps/admin/app/(dashboard)/drivers/[id]/page.tsx"
git commit -m "feat(admin-ui): add inline vehicle-details edit to driver Vehicle tab"
```
