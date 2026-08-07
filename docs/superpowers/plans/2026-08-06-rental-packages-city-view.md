# Rental Packages City-Scoped View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Rental Packages tab's flat, interleaved global/city-override table with a city switcher that shows one effective-pricing context at a time, using a clear Inherited-vs-Override row model so admins can tell at a glance what's global and what's city-specific.

**Architecture:** A new admin-scoped repository query resolves "effective pricing for context X" (global-only, or per-tier city-override-wins-else-global-fallback) instead of returning every row unfiltered. The Rental Packages tab is extracted into its own component file (mirroring the existing `drivers/shared.tsx` co-location convention) with a Radix `DropdownMenu` city switcher, a unified Actions column that branches between "+ Add override" (inherited rows) and "Edit + Delete" (real rows), and `framer-motion` polish matching the easing already used in `NotificationToast`/`SlideOver`.

**Tech Stack:** Express + TypeScript, raw `pg` queries, Next.js 16 admin app, Radix UI (`Dialog`, `DropdownMenu`), `framer-motion` (already installed), Tailwind design tokens already defined in this app (`pill-*`, `admin-card`, `data-table`, `shadow-hover`, `animate-fade-in`).

---

## Task 1: Backend — city-aware `listAdminRentalPackages` query

**Files:**
- Modify: `api/src/modules/admin/admin.repository.ts:1170-1183`

- [ ] **Step 1: Replace the unfiltered listing query with a context-aware one**

Current code:

```typescript
export async function listAdminRentalPackages() {
  const res = await pool.query(
    `SELECT rp.id, rp.category_id, vc.display_name AS category_name, vc.slug AS category_slug,
            rp.duration_minutes, rp.km_limit, rp.display_order,
            rp.package_fare::text, rp.extra_per_km::text, rp.extra_per_min::text,
            rp.is_active, rp.city_id, c.name AS city_name,
            rp.updated_by, rp.created_at, rp.updated_at
     FROM rental_packages rp
     JOIN vehicle_categories vc ON vc.id = rp.category_id
     LEFT JOIN cities c ON c.id = rp.city_id
     ORDER BY c.name NULLS FIRST, vc.display_name, rp.display_order, rp.duration_minutes`
  )
  return res.rows as AdminRentalPackage[]
}
```

Replace with:

```typescript
export async function listAdminRentalPackages(cityId: number | null) {
  if (cityId === null) {
    const res = await pool.query(
      `SELECT rp.id, rp.category_id, vc.display_name AS category_name, vc.slug AS category_slug,
              rp.duration_minutes, rp.km_limit, rp.display_order,
              rp.package_fare::text, rp.extra_per_km::text, rp.extra_per_min::text,
              rp.is_active, rp.city_id, c.name AS city_name,
              rp.updated_by, rp.created_at, rp.updated_at
       FROM rental_packages rp
       JOIN vehicle_categories vc ON vc.id = rp.category_id
       LEFT JOIN cities c ON c.id = rp.city_id
       WHERE rp.city_id IS NULL
       ORDER BY vc.display_name, rp.display_order, rp.duration_minutes`
    )
    return res.rows as AdminRentalPackage[]
  }

  const res = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (rp.category_id, rp.duration_minutes, rp.km_limit)
              rp.id, rp.category_id, vc.display_name AS category_name, vc.slug AS category_slug,
              rp.duration_minutes, rp.km_limit, rp.display_order,
              rp.package_fare::text, rp.extra_per_km::text, rp.extra_per_min::text,
              rp.is_active, rp.city_id, c.name AS city_name,
              rp.updated_by, rp.created_at, rp.updated_at
       FROM rental_packages rp
       JOIN vehicle_categories vc ON vc.id = rp.category_id
       LEFT JOIN cities c ON c.id = rp.city_id
       WHERE (rp.city_id = $1 OR rp.city_id IS NULL)
       ORDER BY rp.category_id, rp.duration_minutes, rp.km_limit, rp.city_id NULLS LAST
     ) t
     ORDER BY t.category_name, t.display_order, t.duration_minutes`,
    [cityId]
  )
  return res.rows as AdminRentalPackage[]
}
```

**Why this shape:** `cityId === null` means "Global Defaults" — only real global rows (`city_id IS NULL`), no fallback needed. `cityId` a number means "show me every tier's effective admin-managed row for this city" — for each `(category_id, duration_minutes, km_limit)` tier, `DISTINCT ON` keeps exactly one row: the city-specific one if it exists (a row with `city_id = $1` sorts before the global row under `city_id NULLS LAST`), otherwise the global row. **No `is_active` filter** — unlike the public rider-facing fallback query (`pricing.repository.ts`'s `getRentalPackagesByCategory`), this admin query must surface inactive rows too, since the Toggle control needs to manage them. A tier that has a city-only row (no global counterpart at all, e.g. a city-exclusive package) still resolves correctly: its `DISTINCT ON` group has exactly one candidate row, which wins trivially.

- [ ] **Step 2: Run the migration-free typecheck (no schema change in this task)**

Run: `cd api && npx tsc --noEmit`
Expected: new errors at every call site of `listAdminRentalPackages()` that doesn't pass an argument (there's exactly one, in `admin.service.ts` — fixed in Task 2). No other errors.

- [ ] **Step 3: Commit**

```bash
git add api/src/modules/admin/admin.repository.ts
git commit -m "feat(admin): city-aware effective-pricing query for rental package listing"
```

---

## Task 2: Backend — thread `city_id` through service and controller

**Files:**
- Modify: `api/src/modules/admin/admin.service.ts:420-422`
- Modify: `api/src/modules/admin/admin.controller.ts:575-579`

- [ ] **Step 1: Widen the service function**

Current code (`admin.service.ts`):

```typescript
export async function listAdminRentalPackages() {
  return repo.listAdminRentalPackages()
}
```

Replace with:

```typescript
export async function listAdminRentalPackages(cityId: number | null) {
  return repo.listAdminRentalPackages(cityId)
}
```

- [ ] **Step 2: Parse `city_id` in the controller, guarding malformed input**

Current code (`admin.controller.ts`):

```typescript
export async function getAdminRentalPackages(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listAdminRentalPackages())
  } catch (err) { next(err) }
}
```

Replace with:

```typescript
export async function getAdminRentalPackages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cityIdRaw = req.query['city_id']
    let cityId: number | null = null
    if (typeof cityIdRaw === 'string' && cityIdRaw !== '') {
      cityId = parseInt(cityIdRaw, 10)
      if (isNaN(cityId)) {
        res.status(400).json({ error: 'Invalid city_id', code: 'VALIDATION_ERROR' })
        return
      }
    }
    res.json(await service.listAdminRentalPackages(cityId))
  } catch (err) { next(err) }
}
```

This mirrors the exact guard already used in `pricing.controller.ts`'s `getRentalPackages` (added when the public rental-package listing endpoint gained the same optional `city_id` query param) — same absent/empty → `null`, malformed → `400`, valid → parsed number semantics.

- [ ] **Step 3: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors (this resolves the one call-site error from Task 1).

- [ ] **Step 4: Manual verification**

Run: `cd api && pnpm dev` (confirm `ocar_postgres` and Redis containers are up first via `docker ps`), then:

```bash
curl "http://localhost:4000/api/v1/admin/pricing/rental-packages"
```
Expected: 401 (no admin auth token) — confirms the route is still gated by `requireAdmin`, unchanged. This is enough to confirm the route wiring didn't break; full behavioral verification (global vs. city response shape) happens in Task 10 once the frontend can drive it with a real session.

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/admin/admin.service.ts api/src/modules/admin/admin.controller.ts
git commit -m "feat(admin): accept optional city_id on rental-package admin listing endpoint"
```

---

## Task 3: Frontend API client — `rentalPackageApi.list(cityId?)`

**Files:**
- Modify: `apps/admin/lib/pricing-api.ts:104-106`

- [ ] **Step 1: Accept an optional city filter**

Current code:

```typescript
export const rentalPackageApi = {
  list: (): Promise<RentalPackageAdmin[]> =>
    api.get('/api/v1/admin/pricing/rental-packages').then(r => r.data as RentalPackageAdmin[]),
```

Replace with:

```typescript
export const rentalPackageApi = {
  list: (cityId?: number | null): Promise<RentalPackageAdmin[]> =>
    api.get('/api/v1/admin/pricing/rental-packages', {
      params: cityId != null ? { city_id: cityId } : {},
    }).then(r => r.data as RentalPackageAdmin[]),
```

(`update`, `create`, `remove` are unchanged — leave them exactly as they are.)

- [ ] **Step 2: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no new errors (the only existing caller, `rate-cards/page.tsx`, calls `rentalPackageApi.list()` with zero args — still valid since `cityId` is optional).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/lib/pricing-api.ts
git commit -m "feat(admin): accept optional city filter in rental package API client"
```

---

## Task 4: Extract shared helpers into `rate-cards/shared.tsx`

**Files:**
- Create: `apps/admin/app/(dashboard)/config/rate-cards/shared.tsx`
- Modify: `apps/admin/app/(dashboard)/config/rate-cards/page.tsx`

The Rental Packages tab is about to move into its own file (Task 5). Several small helpers currently defined inline in `page.tsx` are used by both the Rate Cards tab (staying in `page.tsx`) and the Rental Packages tab (moving out) — extract them first into a shared module, following the exact pattern already established by `apps/admin/app/(dashboard)/drivers/shared.tsx` (plain named exports, no default export).

- [ ] **Step 1: Create the shared module**

```typescript
// apps/admin/app/(dashboard)/config/rate-cards/shared.tsx

export const CATEGORY_ORDER = ['hatchback', 'sedan', 'suv', 'luxury', 'van']

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} hr${h > 1 ? 's' : ''}` : `${h}h ${m}m`
}

export function numFmt(v: string): string {
  return `₹${parseFloat(v).toFixed(2)}`
}

export function SkeletonRows({ cols, n }: { cols: number; n: number }) {
  return <>{Array.from({ length: n }).map((_, i) => (
    <tr key={i} className="border-b border-border-light last:border-b-0">
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j} className="px-4 py-3.5">
          <div className="h-4 bg-surface-2 rounded animate-pulse" style={{ width: `${45 + (j * 20) % 45}%` }} />
        </td>
      ))}
    </tr>
  ))}</>
}

export const inputCls = 'w-full border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted'
export const labelCls = 'block text-xs font-semibold text-text-muted mb-1.5'
```

- [ ] **Step 2: Remove the now-duplicated definitions from `page.tsx`**

In `apps/admin/app/(dashboard)/config/rate-cards/page.tsx`, delete these five definitions (currently around lines 21-51):

```typescript
const CATEGORY_ORDER  = ['hatchback', 'sedan', 'suv', 'luxury', 'van']
```
```typescript
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} hr${h > 1 ? 's' : ''}` : `${h}h ${m}m`
}
```
```typescript
function numFmt(v: string): string {
  return `₹${parseFloat(v).toFixed(2)}`
}
```
```typescript
function SkeletonRows({ cols, n }: { cols: number; n: number }) {
  return <>{Array.from({ length: n }).map((_, i) => (
    <tr key={i} className="border-b border-border-light last:border-b-0">
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j} className="px-4 py-3.5">
          <div className="h-4 bg-surface-2 rounded animate-pulse" style={{ width: `${45 + (j * 20) % 45}%` }} />
        </td>
      ))}
    </tr>
  ))}</>
}
```
```typescript
const inputCls = 'w-full border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted'
const labelCls = 'block text-xs font-semibold text-text-muted mb-1.5'
```

Add this import near the top of `page.tsx` (after the existing `cityApi` import):

```typescript
import { CATEGORY_ORDER, formatDuration, numFmt, SkeletonRows, inputCls, labelCls } from './shared'
```

`page.tsx` still uses all five (Rate Cards tab's `SkeletonRows`, and `UpdateRateDialog`/`CreateRateCardDialog`/`CreateSurgeDialog` use `inputCls`/`labelCls`) — only the *definitions* move, every existing usage in `page.tsx` keeps working unchanged since the names are now imported instead of locally defined.

- [ ] **Step 3: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `cd apps/admin && pnpm dev`, load `/config/rate-cards` (Rate Cards tab, the default), confirm it renders identically to before (skeleton loaders, city dropdowns in dialogs, all still styled correctly) — this task is a pure extraction with zero behavior change, so nothing should look different yet.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/\(dashboard\)/config/rate-cards/shared.tsx apps/admin/app/\(dashboard\)/config/rate-cards/page.tsx
git commit -m "refactor(admin): extract rate-cards shared helpers into shared.tsx"
```

---

## Task 5: Extract `RentalPackagesTab.tsx` (pure move, no UX change yet)

**Files:**
- Create: `apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx`
- Modify: `apps/admin/app/(dashboard)/config/rate-cards/page.tsx`

Move every Rental-Packages-specific piece of `page.tsx` into its own component, unchanged in behavior — this is a refactor checkpoint before the redesign (Tasks 6-9) lands, so any regression here is caught in isolation.

- [ ] **Step 1: Create the new component file with everything moved verbatim**

```typescript
// apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx
'use client'
import { useState, useEffect, useCallback } from 'react'
import { Pencil, Package, Plus, Trash2 } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import Toggle from '@/components/ui/Toggle'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { rentalPackageApi, type RentalPackageAdmin } from '@/lib/pricing-api'
import { type AdminCity } from '@/lib/city-api'
import { CATEGORY_ORDER, formatDuration, numFmt, SkeletonRows, inputCls, labelCls } from './shared'

function EditRentalPackageDialog({ pkg, cities, onUpdated }: { pkg: RentalPackageAdmin; cities: AdminCity[]; onUpdated: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    city_id: pkg.city_id !== null ? String(pkg.city_id) : '',
    duration_minutes: String(pkg.duration_minutes),
    km_limit:      String(pkg.km_limit),
    display_order: String(pkg.display_order),
    package_fare:  pkg.package_fare,
    extra_per_km:  pkg.extra_per_km,
    extra_per_min: pkg.extra_per_min,
  })

  useEffect(() => {
    if (open) {
      setForm({
        city_id: pkg.city_id !== null ? String(pkg.city_id) : '',
        duration_minutes: String(pkg.duration_minutes),
        km_limit:      String(pkg.km_limit),
        display_order: String(pkg.display_order),
        package_fare: pkg.package_fare, extra_per_km: pkg.extra_per_km, extra_per_min: pkg.extra_per_min,
      })
      setError('')
    }
  }, [open, pkg])

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('')
    try {
      await rentalPackageApi.update(pkg.id, {
        city_id: form.city_id ? parseInt(form.city_id, 10) : null,
        duration_minutes: parseInt(form.duration_minutes, 10),
        km_limit:      parseInt(form.km_limit, 10),
        display_order: parseInt(form.display_order, 10),
        package_fare:  parseFloat(form.package_fare),
        extra_per_km:  parseFloat(form.extra_per_km),
        extra_per_min: parseFloat(form.extra_per_min),
      })
      setOpen(false); onUpdated()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Failed to update package.')
    } finally { setLoading(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="p-1.5 text-text-muted hover:text-primary hover:bg-primary-light rounded-lg transition-colors" title="Edit package" aria-label="Edit package">
          <Pencil size={13} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[420px] bg-surface rounded-2xl shadow-hover p-6 z-[60]">
          <Dialog.Title className="text-lg font-bold text-text-primary mb-1">
            Edit {pkg.category_name} · {formatDuration(pkg.duration_minutes)} / {pkg.km_limit} km
          </Dialog.Title>
          <p className="text-xs text-text-muted mb-5">Updates take effect on the next booking.</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={labelCls}>City</label>
              <select value={form.city_id} onChange={e => setForm(f => ({ ...f, city_id: e.target.value }))} className={inputCls}>
                <option value="">All Cities (Global Default)</option>
                {cities.filter(c => c.status === 'active').map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <p className="text-xs text-text-muted mt-1">
                {form.city_id ? 'Overrides this tier for the selected city only.' : 'Applies to any city without its own override for this tier.'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Duration (min) *</label>
                <input type="number" step="1" min="1" required value={form.duration_minutes}
                  onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))} className={inputCls} />
                <p className="text-xs text-text-muted mt-1">was {formatDuration(pkg.duration_minutes)}</p>
              </div>
              <div>
                <label className={labelCls}>KM Limit *</label>
                <input type="number" step="1" min="1" required value={form.km_limit}
                  onChange={e => setForm(f => ({ ...f, km_limit: e.target.value }))} className={inputCls} />
                <p className="text-xs text-text-muted mt-1">was {pkg.km_limit} km</p>
              </div>
              <div>
                <label className={labelCls}>Order</label>
                <input type="number" step="1" value={form.display_order}
                  onChange={e => setForm(f => ({ ...f, display_order: e.target.value }))} className={inputCls} />
                <p className="text-xs text-text-muted mt-1">lower shows first</p>
              </div>
            </div>
            <div>
              <label className={labelCls}>Package Fare (₹) *</label>
              <input type="number" step="0.01" min="0.01" required value={form.package_fare}
                onChange={e => setForm(f => ({ ...f, package_fare: e.target.value }))} className={inputCls} />
              <p className="text-xs text-text-muted mt-1">was {numFmt(pkg.package_fare)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Extra per KM (₹) *</label>
                <input type="number" step="0.01" min="0.01" required value={form.extra_per_km}
                  onChange={e => setForm(f => ({ ...f, extra_per_km: e.target.value }))} className={inputCls} />
                <p className="text-xs text-text-muted mt-1">was {numFmt(pkg.extra_per_km)}</p>
              </div>
              <div>
                <label className={labelCls}>Extra per Min (₹)</label>
                <input type="number" step="0.01" min="0" value={form.extra_per_min}
                  onChange={e => setForm(f => ({ ...f, extra_per_min: e.target.value }))} className={inputCls} />
                <p className="text-xs text-text-muted mt-1">was {numFmt(pkg.extra_per_min)}</p>
              </div>
            </div>
            {error && <p className="text-xs text-danger font-semibold">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary flex-1 justify-center">Cancel</button>
              </Dialog.Close>
              <button type="submit" disabled={loading}
                className="btn-primary flex-1 justify-center disabled:opacity-50 disabled:pointer-events-none">
                {loading ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CreateRentalPackageDialog({
  categories, cities,
  onCreated,
}: {
  categories: { id: number; display_name: string }[]
  cities: AdminCity[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    city_id: '', category_id: '', duration_minutes: '', km_limit: '', display_order: '',
    package_fare: '', extra_per_km: '', extra_per_min: '0',
  })

  useEffect(() => {
    if (open) {
      setForm({ city_id: '', category_id: '', duration_minutes: '', km_limit: '', display_order: '', package_fare: '', extra_per_km: '', extra_per_min: '0' })
      setError('')
    }
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('')
    try {
      await rentalPackageApi.create({
        city_id:           form.city_id ? parseInt(form.city_id, 10) : null,
        category_id:       parseInt(form.category_id, 10),
        duration_minutes:  parseInt(form.duration_minutes, 10),
        km_limit:          parseInt(form.km_limit, 10),
        package_fare:      parseFloat(form.package_fare),
        extra_per_km:      parseFloat(form.extra_per_km),
        extra_per_min:     parseFloat(form.extra_per_min),
        ...(form.display_order ? { display_order: parseInt(form.display_order, 10) } : {}),
      })
      setOpen(false); onCreated()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Failed to create package. A package with this duration, km limit, and city may already exist for this category.')
    } finally { setLoading(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-light border border-primary/20 text-primary text-sm font-semibold hover:bg-primary/10 transition-all duration-150">
          <Plus size={14} />New Package
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[440px] bg-surface rounded-2xl shadow-hover p-6 z-[60]">
          <Dialog.Title className="text-lg font-bold text-text-primary mb-1">Create Rental Package</Dialog.Title>
          <p className="text-xs text-text-muted mb-5">
            Set duration and km limit freely; they no longer have to follow a fixed ratio.
          </p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={labelCls}>City</label>
              <select value={form.city_id} onChange={e => setForm(f => ({ ...f, city_id: e.target.value }))} className={inputCls}>
                <option value="">All Cities (Global Default)</option>
                {cities.filter(c => c.status === 'active').map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Category *</label>
              <select required value={form.category_id}
                onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                className={inputCls}>
                <option value="">Select…</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Duration (min) *</label>
                <input type="number" step="1" min="1" required value={form.duration_minutes}
                  onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))}
                  className={inputCls} placeholder="e.g. 30" />
              </div>
              <div>
                <label className={labelCls}>KM Limit *</label>
                <input type="number" step="1" min="1" required value={form.km_limit}
                  onChange={e => setForm(f => ({ ...f, km_limit: e.target.value }))}
                  className={inputCls} placeholder="e.g. 10" />
              </div>
              <div>
                <label className={labelCls}>Order</label>
                <input type="number" step="1" value={form.display_order}
                  onChange={e => setForm(f => ({ ...f, display_order: e.target.value }))}
                  className={inputCls} placeholder="optional" />
              </div>
            </div>
            <p className="text-[11px] text-text-muted -mt-2">
              Lower order shows first · leave blank to append at the end
            </p>
            <div>
              <label className={labelCls}>Package Fare (₹) *</label>
              <input type="number" step="0.01" min="0.01" required value={form.package_fare}
                onChange={e => setForm(f => ({ ...f, package_fare: e.target.value }))}
                className={inputCls} placeholder="e.g. 350" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Extra per KM (₹) *</label>
                <input type="number" step="0.01" min="0.01" required value={form.extra_per_km}
                  onChange={e => setForm(f => ({ ...f, extra_per_km: e.target.value }))}
                  className={inputCls} placeholder="e.g. 12" />
              </div>
              <div>
                <label className={labelCls}>Extra per Min (₹)</label>
                <input type="number" step="0.01" min="0" value={form.extra_per_min}
                  onChange={e => setForm(f => ({ ...f, extra_per_min: e.target.value }))}
                  className={inputCls} placeholder="0" />
              </div>
            </div>
            {error && <p className="text-xs text-danger font-semibold">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary flex-1 justify-center">Cancel</button>
              </Dialog.Close>
              <button type="submit" disabled={loading}
                className="btn-primary flex-1 justify-center disabled:opacity-50 disabled:pointer-events-none">
                {loading ? 'Creating…' : 'Create Package'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function RentalPackagesTab({
  cities, categoryOptions,
}: {
  cities: AdminCity[]
  categoryOptions: { id: number; slug: string; display_name: string }[]
}) {
  const [rentalPkgs,    setRentalPkgs]    = useState<RentalPackageAdmin[]>([])
  const [rentalLoading, setRentalLoading] = useState(true)
  const [rentalError,   setRentalError]   = useState('')
  const [rentalRetry,   setRentalRetry]   = useState(0)
  const [toggling,      setToggling]      = useState<number | null>(null)
  const [deleting,      setDeleting]      = useState<number | null>(null)
  const [deleteError,   setDeleteError]   = useState('')
  const [deleteTarget,  setDeleteTarget]  = useState<RentalPackageAdmin | null>(null)

  const fetchRental = useCallback(async () => {
    setRentalLoading(true); setRentalError('')
    try { setRentalPkgs(await rentalPackageApi.list()) }
    catch { setRentalError('Failed to load rental packages.') }
    finally { setRentalLoading(false) }
  }, [])

  useEffect(() => { void fetchRental() }, [fetchRental, rentalRetry])

  async function toggleRentalPackage(pkg: RentalPackageAdmin) {
    setToggling(pkg.id)
    try {
      await rentalPackageApi.update(pkg.id, { is_active: !pkg.is_active })
      await fetchRental()
    } catch { /* silent, optimistic toggle failed, list stays stale */ }
    finally { setToggling(null) }
  }

  async function confirmDeleteRentalPackage() {
    const pkg = deleteTarget
    if (!pkg) return
    setDeleteTarget(null)
    setDeleting(pkg.id); setDeleteError('')
    try {
      await rentalPackageApi.remove(pkg.id)
      await fetchRental()
    } catch (err) {
      const status = (err as { response?: { status?: number; data?: { error?: string } } }).response
      setDeleteError(
        status?.status === 409
          ? (status.data?.error ?? 'This package has ride history and cannot be deleted. Deactivate it instead.')
          : 'Failed to delete the package.',
      )
    } finally { setDeleting(null) }
  }

  const rentalGrouped = CATEGORY_ORDER.reduce<Record<string, RentalPackageAdmin[]>>((acc, slug) => {
    acc[slug] = rentalPkgs.filter(p => p.category_slug === slug)
      .sort((a, b) => a.display_order - b.display_order || a.duration_minutes - b.duration_minutes)
    return acc
  }, {})
  const rentalCategories = [...new Map(rentalPkgs.map(p => [p.category_id, { id: p.category_id, display_name: p.category_name }])).values()]
    .concat(categoryOptions.filter(c => !rentalPkgs.some(p => p.category_id === c.id)).map(c => ({ id: c.id, display_name: c.display_name })))
  const activeRentalCount  = rentalPkgs.filter(p => p.is_active).length
  const inactiveRentalCount = rentalPkgs.filter(p => !p.is_active).length

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <CreateRentalPackageDialog categories={rentalCategories} cities={cities} onCreated={fetchRental} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="admin-card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center flex-shrink-0">
            <Package size={18} className="text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold text-text-primary">{rentalLoading ? '—' : rentalPkgs.length}</p>
            <p className="text-xs text-text-muted mt-0.5">Total packages</p>
          </div>
        </div>
        <div className="admin-card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center flex-shrink-0">
            <Package size={18} className="text-success" />
          </div>
          <div>
            <p className="text-2xl font-bold text-text-primary">{rentalLoading ? '—' : activeRentalCount}</p>
            <p className="text-xs text-text-muted mt-0.5">Active</p>
          </div>
        </div>
        <div className="admin-card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0">
            <Package size={18} className="text-text-muted" />
          </div>
          <div>
            <p className="text-2xl font-bold text-text-primary">{rentalLoading ? '—' : inactiveRentalCount}</p>
            <p className="text-xs text-text-muted mt-0.5">Inactive</p>
          </div>
        </div>
      </div>

      {deleteError && (
        <div className="admin-card !py-3 !px-4 flex items-center justify-between gap-3 border-warning/20 bg-warning-light">
          <p className="text-sm text-warning">{deleteError}</p>
          <button onClick={() => setDeleteError('')} className="text-xs text-warning underline flex-shrink-0">Dismiss</button>
        </div>
      )}

      {rentalError ? (
        <div className="admin-card text-center py-8">
          <p className="text-text-muted mb-3">{rentalError}</p>
          <button onClick={() => setRentalRetry(r => r + 1)} className="btn-secondary">Retry</button>
        </div>
      ) : rentalLoading ? (
        <div className="admin-card !p-0 overflow-hidden">
          <table className="data-table"><tbody><SkeletonRows cols={9} n={8} /></tbody></table>
        </div>
      ) : rentalPkgs.length === 0 ? (
        <div className="admin-card text-center py-12">
          <Package size={32} className="text-text-muted mx-auto mb-3" />
          <p className="font-semibold text-text-primary mb-1">No rental packages yet</p>
          <p className="text-sm text-text-muted">Create the first package using the button above.</p>
        </div>
      ) : (
        CATEGORY_ORDER.map(slug => {
          const rows = rentalGrouped[slug]
          if (!rows?.length) return null
          const catName = rows[0]?.category_name ?? slug
          return (
            <div key={slug} className="admin-card !p-0 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border bg-surface-2 flex items-center gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                <h3 className="text-sm font-semibold text-text-primary">{catName}</h3>
                <span className="ml-auto text-xs text-text-muted">
                  {rows.filter(r => r.is_active).length}/{rows.length} active
                </span>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Duration</th>
                    <th>City</th>
                    <th>KM Limit</th>
                    <th className="!text-right">Package Fare</th>
                    <th className="!text-right">Extra/km</th>
                    <th className="!text-right">Extra/min</th>
                    <th className="!text-center">Active</th>
                    <th className="!text-right">Edit</th>
                    <th className="!text-right">Delete</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(pkg => (
                    <tr key={pkg.id} className={`cursor-default ${!pkg.is_active ? 'opacity-50' : ''}`}>
                      <td className="font-semibold text-text-primary">
                        {formatDuration(pkg.duration_minutes)}
                      </td>
                      <td>
                        {pkg.city_name
                          ? <span className="pill-info">{pkg.city_name}</span>
                          : <span className="pill-muted">Global</span>}
                      </td>
                      <td className="text-text-secondary">{pkg.km_limit} km</td>
                      <td className="!text-right font-mono font-bold text-text-primary">{numFmt(pkg.package_fare)}</td>
                      <td className="!text-right font-mono text-text-secondary">{numFmt(pkg.extra_per_km)}</td>
                      <td className="!text-right font-mono text-text-muted">{numFmt(pkg.extra_per_min)}</td>
                      <td className="text-center">
                        <Toggle
                          checked={pkg.is_active}
                          onChange={() => void toggleRentalPackage(pkg)}
                          disabled={toggling === pkg.id}
                        />
                      </td>
                      <td className="!text-right">
                        <EditRentalPackageDialog pkg={pkg} cities={cities} onUpdated={fetchRental} />
                      </td>
                      <td className="!text-right">
                        <button
                          onClick={() => setDeleteTarget(pkg)}
                          disabled={deleting === pkg.id}
                          className="p-1.5 rounded-lg text-danger hover:bg-danger-light disabled:opacity-50 transition-colors"
                          title="Delete package"
                          aria-label="Delete package"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={v => { if (!v) setDeleteTarget(null) }}
        title="Delete rental package?"
        description={deleteTarget ? `Delete the ${formatDuration(deleteTarget.duration_minutes)} / ${deleteTarget.km_limit}km package for ${deleteTarget.category_name}? This cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void confirmDeleteRentalPackage()}
      />
    </div>
  )
}
```

Note: this step is a **verbatim move** — the table still shows the old flat "City" column with Global/city pills, exactly as before. The redesign happens in Tasks 6-9. Keeping this step behavior-identical makes it a safe, independently-verifiable checkpoint.

- [ ] **Step 2: Remove the moved code from `page.tsx` and render the new component**

In `apps/admin/app/(dashboard)/config/rate-cards/page.tsx`:

Remove the `EditRentalPackageDialog` and `CreateRentalPackageDialog` function definitions entirely (they now live in `RentalPackagesTab.tsx`).

Remove these rental-specific pieces from the `RateCardsPage` component body:
- State: `rentalPkgs`, `rentalLoading`, `rentalError`, `rentalRetry`, `toggling`, `deleting`, `deleteError`, `deleteTarget`
- The `fetchRental` callback and its `useEffect`
- `toggleRentalPackage` and `confirmDeleteRentalPackage` functions
- Derived values: `rentalGrouped`, `rentalCategories`, `activeRentalCount`, `inactiveRentalCount`
- The page-header rental button block:
  ```typescript
  {activeTab === 'rental' && (
    <CreateRentalPackageDialog
      categories={rentalCategories}
      cities={cities}
      onCreated={fetchRental}
    />
  )}
  ```
- The entire `{/* ── Rental Packages tab ───────────────────────────────────────── */}` JSX block
- The trailing `<ConfirmDialog ... />` block that was for rental package deletion (the one referencing `deleteTarget`/`confirmDeleteRentalPackage`)

Add the import at the top of `page.tsx`:

```typescript
import RentalPackagesTab from './RentalPackagesTab'
```

Replace the removed rental JSX block with:

```typescript
{activeTab === 'rental' && (
  <RentalPackagesTab cities={cities} categoryOptions={categoryOptions} />
)}
```

Place this where the old `{/* ── Rental Packages tab ── */}` block was (after the Surge Events tab block, before the final `<ConfirmDialog>` closing the component — note the Rate Cards tab's own `ConfirmDialog`-free structure is otherwise unaffected; there is no shared `ConfirmDialog` between tabs today, each tab that needs one renders its own).

Finally, check `page.tsx`'s `lucide-react` import line for icons that were only used by the code you just removed. `Trash2` was used exclusively by the rental delete button — remove it from the import list. `Pencil`, `Plus`, `Package`, `Zap`, `Tag`, `AlertTriangle`, `ChevronDown`, `ChevronUp`, `History` are all still used by the Rate Cards/Surge Events tabs or the TABS array (`Package` is the Rental Packages tab's own icon in the tab bar, `Tag`/`Zap` are the other tabs' icons) — leave those as they are.

- [ ] **Step 3: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors. `page.tsx` no longer references anything rental-specific; `RentalPackagesTab.tsx` is self-contained.

- [ ] **Step 4: Manual verification**

Run: `cd apps/admin && pnpm dev`, load `/config/rate-cards`, click the "Rental Packages" tab. Expected: renders **identically** to before this task — same stats row, same flat table with City column showing Global/city pills, same New Package/Edit/Delete/Toggle behavior. This is the checkpoint that the extraction introduced no regressions before any redesign work begins.

- [ ] **Step 5: Commit**

```bash
git add "apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx" "apps/admin/app/(dashboard)/config/rate-cards/page.tsx"
git commit -m "refactor(admin): extract Rental Packages tab into its own component"
```

---

## Task 6: City switcher — state, fetch wiring, header stat line

**Files:**
- Modify: `apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx`

- [ ] **Step 1: Add `rentalCityId` state and thread it into the fetch**

In `RentalPackagesTab`, replace:

```typescript
const fetchRental = useCallback(async () => {
  setRentalLoading(true); setRentalError('')
  try { setRentalPkgs(await rentalPackageApi.list()) }
  catch { setRentalError('Failed to load rental packages.') }
  finally { setRentalLoading(false) }
}, [])

useEffect(() => { void fetchRental() }, [fetchRental, rentalRetry])
```

with:

```typescript
const [rentalCityId, setRentalCityId] = useState<number | null>(null) // null = Global Defaults

const fetchRental = useCallback(async () => {
  setRentalLoading(true); setRentalError('')
  try { setRentalPkgs(await rentalPackageApi.list(rentalCityId)) }
  catch { setRentalError('Failed to load rental packages.') }
  finally { setRentalLoading(false) }
}, [rentalCityId])

useEffect(() => { void fetchRental() }, [fetchRental, rentalRetry])
```

(Place the `rentalCityId` state declaration alongside the other `useState` calls at the top of the component, not literally inside the callback — the diff above shows what changes; the state hook itself goes with the others.)

- [ ] **Step 2: Add the city switcher control and header stat line**

Add these imports at the top of `RentalPackagesTab.tsx`:

```typescript
import { ChevronDown, Globe } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
```

(Merge `ChevronDown`/`Globe` into the existing `lucide-react` import line rather than adding a second one.)

Add a `switcherOpen` state near the other `useState` calls:

```typescript
const [switcherOpen, setSwitcherOpen] = useState(false)
```

Add this derived value after `inactiveRentalCount`:

```typescript
const selectedCity = cities.find(c => c.id === rentalCityId) ?? null
const overriddenCount = rentalCityId !== null ? rentalPkgs.filter(p => p.city_id === rentalCityId).length : 0
```

Replace the top header row:

```typescript
<div className="flex items-center justify-end">
  <CreateRentalPackageDialog categories={rentalCategories} cities={cities} onCreated={fetchRental} />
</div>
```

with:

```typescript
<div className="flex items-center justify-between gap-3">
  <div>
    <DropdownMenu.Root open={switcherOpen} onOpenChange={setSwitcherOpen}>
      <DropdownMenu.Trigger asChild>
        <button className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-border bg-surface hover:bg-surface-2 transition-colors text-sm font-semibold text-text-primary">
          <Globe size={14} className="text-primary" />
          {selectedCity ? selectedCity.name : 'Global Defaults'}
          <ChevronDown size={14} className={`text-text-muted transition-transform ${switcherOpen ? 'rotate-180' : ''}`} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          className="z-50 bg-surface border border-border rounded-xl py-1 min-w-[220px] max-h-[320px] overflow-y-auto animate-fade-in"
        >
          <DropdownMenu.Item
            onSelect={() => setRentalCityId(null)}
            className={`px-3 py-2 text-sm font-medium cursor-pointer outline-none transition-colors rounded-lg mx-1 ${
              rentalCityId === null ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-surface-2'
            }`}
          >
            Global Defaults
          </DropdownMenu.Item>
          <div className="h-px bg-border-light my-1" />
          {cities.filter(c => c.status === 'active').map(c => (
            <DropdownMenu.Item
              key={c.id}
              onSelect={() => setRentalCityId(c.id)}
              className={`px-3 py-2 text-sm font-medium cursor-pointer outline-none transition-colors rounded-lg mx-1 ${
                rentalCityId === c.id ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-surface-2'
              }`}
            >
              {c.name}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    {rentalCityId !== null && !rentalLoading && (
      <p className="text-xs text-text-muted mt-1.5 ml-1">
        {overriddenCount} of {rentalPkgs.length} tier{rentalPkgs.length === 1 ? '' : 's'} overridden for {selectedCity?.name}
      </p>
    )}
  </div>
  <CreateRentalPackageDialog categories={rentalCategories} cities={cities} onCreated={fetchRental} defaultCityId={rentalCityId} />
</div>
```

(The `defaultCityId` prop on `CreateRentalPackageDialog` doesn't exist yet — that's Task 8. For this step, temporarily pass it anyway; TypeScript will flag it as an unknown prop until Task 8 adds it. If you want this task to typecheck cleanly on its own, skip passing `defaultCityId` here and add it in Task 8's edit instead — either order works, but **do not leave a half-wired prop**: if you defer it, the line here should just read `<CreateRentalPackageDialog categories={rentalCategories} cities={cities} onCreated={fetchRental} />` without `defaultCityId`, and Task 8 adds both the prop definition and this call site's usage together.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors (assuming you deferred `defaultCityId` per the note above).

- [ ] **Step 4: Manual verification**

Run: `cd apps/admin && pnpm dev`, open the Rental Packages tab. Expected: a "Global Defaults" switcher button with a globe icon appears top-left; clicking it opens a dropdown listing active cities; selecting a city re-fetches and the table still shows the (unchanged from Task 5) flat rows — but now scoped to that city's effective rows per tier instead of every row. The stat line ("N of M tiers overridden for X") appears under the switcher once a city is selected.

- [ ] **Step 5: Commit**

```bash
git add "apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx"
git commit -m "feat(admin): add city switcher to Rental Packages tab"
```

---

## Task 7: Inherited vs. Override row model — unified Actions column

**Files:**
- Modify: `apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx`

This is the core UX change: replace the flat "City" column + always-Edit+Delete pattern with a context-aware "Status" column and a single Actions column that shows **"+ Add override"** for inherited rows or **Edit + Delete** for real rows.

- [ ] **Step 1: Add the `AddOverrideDialog` component**

Add this new component in `RentalPackagesTab.tsx`, above the `RentalPackagesTab` default export (after `CreateRentalPackageDialog`):

```typescript
function AddOverrideDialog({ pkg, cityId, cityName, onCreated }: {
  pkg: RentalPackageAdmin; cityId: number; cityName: string; onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    package_fare: pkg.package_fare, extra_per_km: pkg.extra_per_km, extra_per_min: pkg.extra_per_min,
  })

  useEffect(() => {
    if (open) {
      setForm({ package_fare: pkg.package_fare, extra_per_km: pkg.extra_per_km, extra_per_min: pkg.extra_per_min })
      setError('')
    }
  }, [open, pkg])

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('')
    try {
      await rentalPackageApi.create({
        city_id: cityId,
        category_id: pkg.category_id,
        duration_minutes: pkg.duration_minutes,
        km_limit: pkg.km_limit,
        display_order: pkg.display_order,
        package_fare: parseFloat(form.package_fare),
        extra_per_km: parseFloat(form.extra_per_km),
        extra_per_min: parseFloat(form.extra_per_min),
      })
      setOpen(false); onCreated()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Failed to create override.')
    } finally { setLoading(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-success-light text-success text-xs font-semibold hover:bg-success/10 transition-colors">
          <Plus size={12} />Add override
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[420px] bg-surface rounded-2xl shadow-hover p-6 z-[60]">
          <Dialog.Title className="text-lg font-bold text-text-primary mb-1">
            Override for {cityName}
          </Dialog.Title>
          <p className="text-xs text-text-muted mb-5">
            {pkg.category_name} · {formatDuration(pkg.duration_minutes)} / {pkg.km_limit} km — pre-filled with today&rsquo;s global price. Saving creates a {cityName}-only price for this tier; the global default is unaffected.
          </p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={labelCls}>Package Fare (₹) *</label>
              <input type="number" step="0.01" min="0.01" required value={form.package_fare}
                onChange={e => setForm(f => ({ ...f, package_fare: e.target.value }))} className={inputCls} />
              <p className="text-xs text-text-muted mt-1">global is {numFmt(pkg.package_fare)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Extra per KM (₹) *</label>
                <input type="number" step="0.01" min="0.01" required value={form.extra_per_km}
                  onChange={e => setForm(f => ({ ...f, extra_per_km: e.target.value }))} className={inputCls} />
                <p className="text-xs text-text-muted mt-1">global is {numFmt(pkg.extra_per_km)}</p>
              </div>
              <div>
                <label className={labelCls}>Extra per Min (₹)</label>
                <input type="number" step="0.01" min="0" value={form.extra_per_min}
                  onChange={e => setForm(f => ({ ...f, extra_per_min: e.target.value }))} className={inputCls} />
                <p className="text-xs text-text-muted mt-1">global is {numFmt(pkg.extra_per_min)}</p>
              </div>
            </div>
            {error && <p className="text-xs text-danger font-semibold">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary flex-1 justify-center">Cancel</button>
              </Dialog.Close>
              <button type="submit" disabled={loading}
                className="flex-1 justify-center inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-success text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50 disabled:pointer-events-none transition-all duration-150">
                {loading ? 'Saving…' : `Save for ${cityName}`}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

- [ ] **Step 2: Replace the table header and body rendering**

Replace the `<table className="data-table">...</table>` block inside the category `.map()` (currently rendering `<th>Duration</th><th>City</th><th>KM Limit</th>...<th>Edit</th><th>Delete</th>` and the corresponding `<tbody>`) with:

```typescript
<table className="data-table">
  <thead>
    <tr>
      <th>Duration</th>
      {rentalCityId !== null && <th>Status</th>}
      <th>KM Limit</th>
      <th className="!text-right">Package Fare</th>
      <th className="!text-right">Extra/km</th>
      <th className="!text-right">Extra/min</th>
      <th className="!text-center">Active</th>
      <th className="!text-right">Actions</th>
    </tr>
  </thead>
  <tbody>
    {rows.map(pkg => {
      const isInherited = rentalCityId !== null && pkg.city_id === null
      const isOverride  = rentalCityId !== null && pkg.city_id !== null
      return (
        <tr key={pkg.id} className={`cursor-default ${!pkg.is_active ? 'opacity-50' : ''}`}>
          <td className="font-semibold text-text-primary">
            {formatDuration(pkg.duration_minutes)}
          </td>
          {rentalCityId !== null && (
            <td>
              {isOverride
                ? <span className="pill-info">{selectedCity?.name ?? 'City'} override</span>
                : <span className="pill-muted">Inherited</span>}
            </td>
          )}
          <td className="text-text-secondary">{pkg.km_limit} km</td>
          <td className="!text-right font-mono font-bold text-text-primary">{numFmt(pkg.package_fare)}</td>
          <td className="!text-right font-mono text-text-secondary">{numFmt(pkg.extra_per_km)}</td>
          <td className="!text-right font-mono text-text-muted">{numFmt(pkg.extra_per_min)}</td>
          <td className="text-center">
            {isInherited ? (
              <span className="text-text-muted text-xs">—</span>
            ) : (
              <Toggle
                checked={pkg.is_active}
                onChange={() => void toggleRentalPackage(pkg)}
                disabled={toggling === pkg.id}
              />
            )}
          </td>
          <td className="!text-right">
            <div className="inline-flex items-center justify-end gap-1.5">
              {isInherited && rentalCityId !== null && selectedCity ? (
                <AddOverrideDialog pkg={pkg} cityId={rentalCityId} cityName={selectedCity.name} onCreated={fetchRental} />
              ) : (
                <>
                  <EditRentalPackageDialog pkg={pkg} cities={cities} onUpdated={fetchRental} />
                  <button
                    onClick={() => setDeleteTarget(pkg)}
                    disabled={deleting === pkg.id}
                    className="p-1.5 rounded-lg text-danger hover:bg-danger-light disabled:opacity-50 transition-colors"
                    title="Delete package"
                    aria-label="Delete package"
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
          </td>
        </tr>
      )
    })}
  </tbody>
</table>
```

- [ ] **Step 3: Update the loading skeleton's column count**

Replace:

```typescript
<table className="data-table"><tbody><SkeletonRows cols={9} n={8} /></tbody></table>
```

with:

```typescript
<table className="data-table"><tbody><SkeletonRows cols={rentalCityId !== null ? 8 : 7} n={8} /></tbody></table>
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run: `cd apps/admin && pnpm dev`, open Rental Packages tab.
- With "Global Defaults" selected: table has no Status column; every row shows Edit + Delete (as before); Active toggle works.
- Select a city with no overrides yet: every row shows a muted "Inherited" pill and a single green "+ Add override" button (no Edit/Delete/Toggle for those rows).
- Click "+ Add override" on a row: dialog opens titled "Override for `<city>`", pre-filled with that tier's global fare/extra values, category/duration/km shown read-only in the subtitle (not editable fields). Submit it.
- After creating the override: that row now shows a `pill-info` "`<city>` override" pill, and Edit + Delete + Toggle are back for that specific row. The stat line increments ("1 of N tiers overridden").
- Click Delete on that override row, confirm: the row reverts to "Inherited" + "+ Add override", stat line decrements back.

- [ ] **Step 6: Commit**

```bash
git add "apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx"
git commit -m "feat(admin): Inherited/Override row model and unified Actions column"
```

---

## Task 8: Wire "New Package" dialog's default city

**Files:**
- Modify: `apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx`

**Prerequisite:** if Task 6 deferred passing `defaultCityId` to `CreateRentalPackageDialog`, this task adds both sides now.

- [ ] **Step 1: Add the `defaultCityId` prop to `CreateRentalPackageDialog`**

Replace the function signature and reset `useEffect`:

```typescript
function CreateRentalPackageDialog({
  categories, cities,
  onCreated,
}: {
  categories: { id: number; display_name: string }[]
  cities: AdminCity[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    city_id: '', category_id: '', duration_minutes: '', km_limit: '', display_order: '',
    package_fare: '', extra_per_km: '', extra_per_min: '0',
  })

  useEffect(() => {
    if (open) {
      setForm({ city_id: '', category_id: '', duration_minutes: '', km_limit: '', display_order: '', package_fare: '', extra_per_km: '', extra_per_min: '0' })
      setError('')
    }
  }, [open])
```

with:

```typescript
function CreateRentalPackageDialog({
  categories, cities, defaultCityId,
  onCreated,
}: {
  categories: { id: number; display_name: string }[]
  cities: AdminCity[]
  defaultCityId: number | null
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    city_id: defaultCityId !== null ? String(defaultCityId) : '',
    category_id: '', duration_minutes: '', km_limit: '', display_order: '',
    package_fare: '', extra_per_km: '', extra_per_min: '0',
  })

  useEffect(() => {
    if (open) {
      setForm({
        city_id: defaultCityId !== null ? String(defaultCityId) : '',
        category_id: '', duration_minutes: '', km_limit: '', display_order: '', package_fare: '', extra_per_km: '', extra_per_min: '0',
      })
      setError('')
    }
  }, [open, defaultCityId])
```

The rest of `CreateRentalPackageDialog` (its `submit`, its JSX including the City `<select>`) is unchanged — the admin can still change the city away from the default before submitting, exactly as requested (a default, not a lock).

- [ ] **Step 2: Ensure the call site passes it**

Confirm the `CreateRentalPackageDialog` usage in the `RentalPackagesTab` header reads:

```typescript
<CreateRentalPackageDialog categories={rentalCategories} cities={cities} onCreated={fetchRental} defaultCityId={rentalCityId} />
```

(If Task 6 already added this exact line, this step is a no-op — just verify it.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run: `cd apps/admin && pnpm dev`. With a city selected in the switcher, click "New Package" — the City field in the dialog should default to that same city (not blank). Switch to "Global Defaults" and click "New Package" again — the City field should default to "All Cities (Global Default)" (blank). In both cases, the admin can still change the dropdown before submitting.

- [ ] **Step 5: Commit**

```bash
git add "apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx"
git commit -m "feat(admin): default New Package dialog's city to the current switcher selection"
```

---

## Task 9: Animation polish

**Files:**
- Modify: `apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx`

Add the row entrance animation and city-switch crossfade, matching the easing already established in `NotificationToast.tsx`/`SlideOver.tsx` (`framer-motion`, `duration: 0.24`, `ease: [0.16, 1, 0.3, 1]`, `useReducedMotion()` guard) — no new animation library, no new easing curve invented.

- [ ] **Step 1: Add framer-motion imports**

Add to the top of `RentalPackagesTab.tsx`:

```typescript
import { motion, useReducedMotion } from 'framer-motion'
```

- [ ] **Step 2: Add the reduced-motion hook**

Inside `RentalPackagesTab`, alongside the other hooks at the top of the component:

```typescript
const prefersReducedMotion = useReducedMotion()
```

- [ ] **Step 3: Key the category-tables container by `rentalCityId` so it remounts cleanly on switch**

Find the block that maps over `CATEGORY_ORDER` to render each category's card+table (the `CATEGORY_ORDER.map(slug => { ... })` expression that returns each category's `<div key={slug} className="admin-card ...">`). Wrap the **entire results of that `.map()` call** in a single keyed container so switching `rentalCityId` fully remounts the rows (giving the stagger-in animation something to animate from on every switch, and giving the browser a clean paint boundary instead of a jarring in-place value flash).

Replace:

```typescript
) : (
  CATEGORY_ORDER.map(slug => {
    const rows = rentalGrouped[slug]
    if (!rows?.length) return null
    const catName = rows[0]?.category_name ?? slug
    return (
      <div key={slug} className="admin-card !p-0 overflow-hidden">
```

with:

```typescript
) : (
  <div key={rentalCityId ?? 'global'} className="space-y-5">
  {CATEGORY_ORDER.map(slug => {
    const rows = rentalGrouped[slug]
    if (!rows?.length) return null
    const catName = rows[0]?.category_name ?? slug
    return (
      <div key={slug} className="admin-card !p-0 overflow-hidden">
```

And close the new wrapping `<div>` right after the `.map()` call ends. Find:

```typescript
      </div>
    )
  })
)}
```

(the closing of the category `.map()`, right before the `<ConfirmDialog>` at the end of the component) and replace with:

```typescript
      </div>
    )
  })}
  </div>
)}
```

- [ ] **Step 4: Animate each row's entrance**

Change each row's `<tr>` to a `motion.tr` with a small index-based stagger. Replace:

```typescript
{rows.map(pkg => {
  const isInherited = rentalCityId !== null && pkg.city_id === null
  const isOverride  = rentalCityId !== null && pkg.city_id !== null
  return (
    <tr key={pkg.id} className={`cursor-default ${!pkg.is_active ? 'opacity-50' : ''}`}>
```

with:

```typescript
{rows.map((pkg, i) => {
  const isInherited = rentalCityId !== null && pkg.city_id === null
  const isOverride  = rentalCityId !== null && pkg.city_id !== null
  return (
    <motion.tr
      key={pkg.id}
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: prefersReducedMotion ? 0 : Math.min(i * 0.02, 0.2), ease: [0.16, 1, 0.3, 1] }}
      className={`cursor-default ${!pkg.is_active ? 'opacity-50' : ''}`}
    >
```

And change its matching closing tag from `</tr>` to `</motion.tr>` (the `return (...)` for each row currently ends with `</tr>\n        )\n      })}` — update just the tag name, not the surrounding structure).

- [ ] **Step 5: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `cd apps/admin && pnpm dev`, open Rental Packages tab. Switch between "Global Defaults" and a city a few times — rows should fade/slide in with a subtle stagger each time (top rows appear fractionally before lower ones, capped so it never feels sluggish even with many rows). Enable your OS's "reduce motion" setting (or use browser devtools to emulate `prefers-reduced-motion: reduce`) and switch again — rows should appear instantly with no motion, matching how `NotificationToast` already respects the same setting.

- [ ] **Step 7: Commit**

```bash
git add "apps/admin/app/(dashboard)/config/rate-cards/RentalPackagesTab.tsx"
git commit -m "feat(admin): animate row entrance on Rental Packages city switch"
```

---

## Task 10: Full-stack verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck everything**

```bash
cd api && npx tsc --noEmit
cd ../apps/admin && npx tsc --noEmit
```
Expected: no errors in either.

- [ ] **Step 2: Run the API's existing unit test suite as a regression check**

Run: `cd api && pnpm test`
Expected: all currently-passing tests still pass (this plan touches no code they cover directly, but confirms nothing else broke).

- [ ] **Step 3: End-to-end manual walkthrough in the browser**

Run `cd api && pnpm dev` and `cd apps/admin && pnpm dev` (confirm `ocar_postgres`/Redis containers are up first), log in as an admin, go to Pricing → Rental Packages.

Walk through:
1. **Global Defaults** (default view): table has no Status column, every row is Edit+Delete+Toggle as before. Note one tier's current global fare for a specific category (e.g. Hatchback, first tier).
2. Switch to a city with **no** overrides: every row shows "Inherited" + "+ Add override"; stat line reads "0 of N tiers overridden for `<city>`".
3. Click **"+ Add override"** on the tier you noted in step 1. Confirm the dialog pre-fills that tier's exact global fare/extra values. Change the fare to a clearly different number, save.
4. Confirm: that row now shows a `pill-info` "`<city>` override" badge with the new fare; Edit/Delete/Toggle are back for that row; stat line reads "1 of N tiers overridden for `<city>`".
5. Switch back to **Global Defaults**: confirm the same tier still shows the *original* global fare, unaffected by the override you just created.
6. Switch to a **different** city that has no override for that same tier: confirm it shows the original global fare too (not the first city's override — overrides don't leak across cities).
7. Switch back to the first city, click **Edit** on the override row, change the fare again, save — confirm the new value sticks.
8. Click **Delete** on that override row, confirm via the dialog — the row reverts to "Inherited" showing the global fare again; stat line decrements back to 0.
9. Click **"New Package"** while a city is selected — confirm its City field defaults to that city (not blank); cancel it and click **"New Package"** from Global Defaults — confirm it defaults to blank ("All Cities (Global Default)").
10. Toggle "reduce motion" in your OS/browser and switch cities once more — confirm rows appear without animation, no layout break.

- [ ] **Step 4: Report and clean up any test data**

If step 3 created any lasting override rows purely for testing (beyond the one intentionally left to demonstrate the feature), delete them via the UI's Delete button so the dev database isn't left with stray test pricing.

---

## Self-review notes

- **Spec coverage:** City switcher (spec §1) → Task 6. Row states/actions (spec §2) → Task 7. Create dialog default (spec §3) → Task 8. Visual polish (spec §4) → Task 9. Empty states (spec §5) → covered implicitly by Task 7's rendering (a city with zero overrides just shows all-Inherited rows, no special-case banner needed, matching the spec's explicit call that this needs no dedicated empty state). Data flow's admin query redesign (spec's Data Flow section, including the explicit note about the breaking change to the no-`city_id` response shape) → Tasks 1-2.
- **Placeholder scan:** no TBD/TODO; every step shows complete before/after code.
- **Type consistency:** `listAdminRentalPackages(cityId: number | null)` signature is consistent across `admin.repository.ts` (Task 1), `admin.service.ts` (Task 2), and the controller's derived `cityId` variable (Task 2) — same type all the way through. `rentalPackageApi.list(cityId?: number | null)` (Task 3) matches how `RentalPackagesTab` calls it (`rentalPackageApi.list(rentalCityId)`, Task 6) — `rentalCityId` is `number | null`, matching the parameter type exactly (not `number | undefined`, so no mismatch). `AddOverrideDialog`'s props (`pkg`, `cityId: number`, `cityName: string`, `onCreated`) are only ever instantiated at the one call site in Task 7, with `cityId={rentalCityId}` guarded by `rentalCityId !== null` immediately before use (so the `number | null` → `number` narrowing is sound, not just asserted).
