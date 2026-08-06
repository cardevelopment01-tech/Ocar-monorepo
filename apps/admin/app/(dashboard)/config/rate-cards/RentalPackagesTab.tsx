'use client'
import { useState, useEffect, useCallback } from 'react'
import { Pencil, Package, Plus, Trash2, ChevronDown, Globe } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
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
            {pkg.category_name} · {formatDuration(pkg.duration_minutes)} / {pkg.km_limit} km
          </Dialog.Title>
          <p className="text-xs text-text-muted mb-5">
            Override for <span className="font-semibold text-text-secondary">{cityName}</span> — pre-filled with today&rsquo;s global price. Saving creates a {cityName}-only price for this tier; the global default is unaffected.
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
  const [rentalCityId, setRentalCityId]  = useState<number | null>(null) // null = Global Defaults
  const [switcherOpen,  setSwitcherOpen]  = useState(false)

  const fetchRental = useCallback(async () => {
    setRentalLoading(true); setRentalError('')
    try { setRentalPkgs(await rentalPackageApi.list(rentalCityId)) }
    catch { setRentalError('Failed to load rental packages.') }
    finally { setRentalLoading(false) }
  }, [rentalCityId])

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
  const selectedCity = cities.find(c => c.id === rentalCityId) ?? null
  const overriddenCount = rentalCityId !== null ? rentalPkgs.filter(p => p.city_id === rentalCityId).length : 0

  return (
    <div className="space-y-5">
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
          <table className="data-table"><tbody><SkeletonRows cols={rentalCityId !== null ? 8 : 7} n={8} /></tbody></table>
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
                            {isInherited && selectedCity ? (
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
