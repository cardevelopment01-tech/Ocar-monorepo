'use client'
import { useState, useEffect, useCallback } from 'react'
import { Tag, Pencil, Zap, AlertTriangle, ChevronDown, ChevronUp, History, Package, Plus, Trash2 } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import Toggle from '@/components/ui/Toggle'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { pricingApi, rentalPackageApi, type RateCard, type SurgeEvent, type RentalPackageAdmin } from '@/lib/pricing-api'
import { cityApi, type AdminCity } from '@/lib/city-api'

// ── Shared helpers ─────────────────────────────────────────────────────────────

const RIDE_TYPE_LABEL: Record<string, string> = {
  one_way: 'One Way', round_trip: 'Round Trip', rental: 'Rental',
}

const SURGE_STATUS_CLS: Record<string, string> = {
  scheduled: 'pill-info', active: 'pill-warning',
  expired:   'pill-muted', cancelled: 'pill-danger',
}

const CATEGORY_ORDER  = ['hatchback', 'sedan', 'suv', 'luxury', 'van']

function fmt(v: string | null): string {
  return v ? `₹${parseFloat(v).toFixed(2)}` : '—'
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} hr${h > 1 ? 's' : ''}` : `${h}h ${m}m`
}

function numFmt(v: string): string {
  return `₹${parseFloat(v).toFixed(2)}`
}

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

const inputCls = 'w-full border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted'
const labelCls = 'block text-xs font-semibold text-text-muted mb-1.5'

// ── Rate card dialog ───────────────────────────────────────────────────────────

function UpdateRateDialog({ card, cities, onUpdated }: { card: RateCard; cities: AdminCity[]; onUpdated: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    city_id: card.city_id !== null ? String(card.city_id) : '',
    rate_per_km: card.rate_per_km, rate_per_min: card.rate_per_min, min_fare: card.min_fare,
    return_rate_per_km: card.return_rate_per_km ?? '', hour_rate: card.hour_rate ?? '',
    km_per_day: card.km_per_day ?? '', driver_allowance_per_day: card.driver_allowance_per_day ?? '', notes: '',
  })

  useEffect(() => {
    if (open) {
      setForm({
        city_id: card.city_id !== null ? String(card.city_id) : '',
        rate_per_km: card.rate_per_km, rate_per_min: card.rate_per_min, min_fare: card.min_fare,
        return_rate_per_km: card.return_rate_per_km ?? '', hour_rate: card.hour_rate ?? '',
        km_per_day: card.km_per_day ?? '', driver_allowance_per_day: card.driver_allowance_per_day ?? '', notes: '',
      })
      setError('')
    }
  }, [open, card])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.notes.trim()) { setError('Change reason is required'); return }
    setLoading(true); setError('')
    try {
      await pricingApi.createRateCard({
        category_id: card.category_id, ride_type: card.ride_type,
        city_id: form.city_id ? parseInt(form.city_id, 10) : null,
        rate_per_km: parseFloat(form.rate_per_km), rate_per_min: parseFloat(form.rate_per_min),
        min_fare: parseFloat(form.min_fare),
        return_rate_per_km: form.return_rate_per_km ? parseFloat(form.return_rate_per_km) : null,
        hour_rate: form.hour_rate ? parseFloat(form.hour_rate) : null,
        km_per_day: form.km_per_day ? parseFloat(form.km_per_day) : null,
        driver_allowance_per_day: form.driver_allowance_per_day !== '' ? parseFloat(form.driver_allowance_per_day) : null,
        notes: form.notes,
      })
      setOpen(false); onUpdated()
    } catch { setError('Failed to update rate card.') }
    finally { setLoading(false) }
  }

  const originalCityId = card.city_id !== null ? String(card.city_id) : ''
  const cityChanged = form.city_id !== originalCityId
  const originalCityName = card.city_name ?? 'Global'
  const selectedCityName = form.city_id ? (cities.find(c => String(c.id) === form.city_id)?.name ?? 'the selected city') : 'the global default'

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="p-1.5 text-text-muted hover:text-primary hover:bg-primary-light rounded-lg transition-colors" title="Update rate" aria-label="Update rate">
          <Pencil size={13} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[480px] max-h-[90vh] overflow-y-auto bg-surface rounded-2xl shadow-hover p-6 z-[60]">
          <Dialog.Title className="text-lg font-bold text-text-primary mb-1">
            Update {card.category_name} · {RIDE_TYPE_LABEL[card.ride_type]}
          </Dialog.Title>
          <p className="text-xs text-warning bg-warning-light border border-warning/20 rounded-xl px-3 py-2 mb-5">
            {cityChanged
              ? `You're creating/updating ${selectedCityName}'s rate. ${originalCityName}'s current rate for this row is unaffected.`
              : 'Creates a new rate card and expires the current one. All future rides use the new rate.'}
          </p>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className={labelCls}>City</label>
              <select value={form.city_id} onChange={e => setForm(f => ({ ...f, city_id: e.target.value }))} className={inputCls}>
                <option value="">All Cities (Global Default)</option>
                {cities.filter(c => c.status === 'active').map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <p className="text-xs text-text-muted mt-1">
                {form.city_id ? 'Creates/updates an override for this city only.' : 'Applies to any city without its own override.'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Per KM (₹)</label>
                <input type="number" step="0.01" value={form.rate_per_km}
                  onChange={e => setForm(f => ({ ...f, rate_per_km: e.target.value }))} className={inputCls} />
                <p className="text-xs text-text-muted mt-1">was {fmt(card.rate_per_km)}</p>
              </div>
              <div>
                <label className={labelCls}>Per Min (₹)</label>
                <input type="number" step="0.01" value={form.rate_per_min}
                  onChange={e => setForm(f => ({ ...f, rate_per_min: e.target.value }))} className={inputCls} />
                <p className="text-xs text-text-muted mt-1">was {fmt(card.rate_per_min)}</p>
              </div>
              <div>
                <label className={labelCls}>Min Fare (₹)</label>
                <input type="number" step="0.01" value={form.min_fare}
                  onChange={e => setForm(f => ({ ...f, min_fare: e.target.value }))} className={inputCls} />
                <p className="text-xs text-text-muted mt-1">was {fmt(card.min_fare)}</p>
              </div>
            </div>
            {card.ride_type === 'one_way' && (
              <div>
                <label className={labelCls}>Return Cab Rate /km (₹)</label>
                <input type="number" step="0.01" value={form.return_rate_per_km}
                  onChange={e => setForm(f => ({ ...f, return_rate_per_km: e.target.value }))}
                  className="w-40 border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted"
                  placeholder="optional" />
                <p className="text-xs text-text-muted mt-1">was {fmt(card.return_rate_per_km)}</p>
              </div>
            )}
            {card.ride_type === 'round_trip' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Package KM/day</label>
                  <input type="number" step="1" value={form.km_per_day}
                    onChange={e => setForm(f => ({ ...f, km_per_day: e.target.value }))}
                    className={inputCls} placeholder="e.g. 250" />
                  <p className="text-xs text-text-muted mt-1">was {card.km_per_day ?? '—'}</p>
                </div>
                <div>
                  <label className={labelCls}>Driver Allowance/day (₹)</label>
                  <input type="number" step="0.01" value={form.driver_allowance_per_day}
                    onChange={e => setForm(f => ({ ...f, driver_allowance_per_day: e.target.value }))}
                    className={inputCls} placeholder="e.g. 300" />
                  <p className="text-xs text-text-muted mt-1">was {fmt(card.driver_allowance_per_day)}</p>
                </div>
              </div>
            )}
            <div>
              <label className={labelCls}>Change Reason *</label>
              <textarea rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className={`${inputCls} resize-none`} placeholder="e.g. Fuel price increase" />
            </div>
            {error && <p className="text-xs text-danger font-semibold">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary flex-1 justify-center">Cancel</button>
              </Dialog.Close>
              <button type="submit" disabled={loading}
                className="btn-primary flex-1 justify-center disabled:opacity-50 disabled:pointer-events-none">
                {loading ? 'Saving…' : cityChanged ? `Save to ${selectedCityName}` : 'Update Rate'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Surge dialog ───────────────────────────────────────────────────────────────

function CreateSurgeDialog({
  cities, categories, onCreated,
}: {
  cities: AdminCity[]
  categories: { id: number; slug: string; display_name: string }[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ city_id: '', category_id: '', multiplier: '1.5', reason: '', starts_at: '', ends_at: '' })

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }
  const mult = parseFloat(form.multiplier) || 1
  const pct  = Math.round((mult - 1) * 100)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('')
    try {
      await pricingApi.createSurgeEvent({
        city_id:     parseInt(form.city_id, 10),
        category_id: form.category_id ? parseInt(form.category_id, 10) : null,
        multiplier:  mult,
        reason:      form.reason || undefined,
        starts_at:   form.starts_at,
        ends_at:     form.ends_at,
      })
      setOpen(false)
      setForm({ city_id: '', category_id: '', multiplier: '1.5', reason: '', starts_at: '', ends_at: '' })
      onCreated()
    } catch { setError('Failed to create surge event.') }
    finally { setLoading(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-warning-light border border-warning/20 text-warning text-sm font-semibold hover:bg-warning/10 transition-all duration-150">
          <Zap size={14} />Schedule Surge
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[480px] max-h-[90vh] overflow-y-auto bg-surface rounded-2xl shadow-hover p-6 z-[60]">
          <Dialog.Title className="text-lg font-bold text-text-primary mb-5">Schedule Surge Event</Dialog.Title>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={labelCls}>City *</label>
              <select value={form.city_id} onChange={e => set('city_id', e.target.value)} required className={inputCls}>
                <option value="">Select city…</option>
                {cities.filter(c => c.status === 'active').map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Category</label>
              <select value={form.category_id} onChange={e => set('category_id', e.target.value)} className={inputCls}>
                <option value="">All categories</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>
                Multiplier:{' '}
                <span className="text-warning font-semibold">{mult.toFixed(2)}× · fares {pct}% higher</span>
              </label>
              <div className="flex items-center gap-3">
                <input type="range" min="1.0" max="5.0" step="0.1" value={form.multiplier}
                  onChange={e => set('multiplier', e.target.value)} className="flex-1 accent-warning" />
                <input type="number" min="1.0" max="5.0" step="0.1" value={form.multiplier}
                  onChange={e => set('multiplier', e.target.value)}
                  className="w-20 border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 text-center focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            </div>
            <div>
              <label className={labelCls}>Reason</label>
              <input value={form.reason} onChange={e => set('reason', e.target.value)}
                className={inputCls} placeholder="e.g. Festival surge, Heavy rain" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Starts At *</label>
                <input type="datetime-local" value={form.starts_at} onChange={e => set('starts_at', e.target.value)} required className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Ends At *</label>
                <input type="datetime-local" value={form.ends_at} onChange={e => set('ends_at', e.target.value)} required className={inputCls} />
              </div>
            </div>
            {error && <p className="text-xs text-danger font-semibold">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary flex-1 justify-center">Cancel</button>
              </Dialog.Close>
              <button type="submit" disabled={loading}
                className="inline-flex items-center justify-center gap-2 flex-1 px-4 py-2 rounded-xl bg-warning text-white text-sm font-semibold hover:bg-amber-600 disabled:opacity-50 disabled:pointer-events-none transition-all duration-150">
                {loading ? 'Scheduling…' : 'Schedule Surge'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Rental package dialogs ─────────────────────────────────────────────────────

function EditRentalPackageDialog({ pkg, onUpdated }: { pkg: RentalPackageAdmin; onUpdated: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
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
  categories,
  onCreated,
}: {
  categories: { id: number; display_name: string }[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    category_id: '', duration_minutes: '', km_limit: '', display_order: '',
    package_fare: '', extra_per_km: '', extra_per_min: '0',
  })

  useEffect(() => {
    if (open) {
      setForm({ category_id: '', duration_minutes: '', km_limit: '', display_order: '', package_fare: '', extra_per_km: '', extra_per_min: '0' })
      setError('')
    }
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('')
    try {
      await rentalPackageApi.create({
        category_id:      parseInt(form.category_id, 10),
        duration_minutes: parseInt(form.duration_minutes, 10),
        km_limit:         parseInt(form.km_limit, 10),
        package_fare:     parseFloat(form.package_fare),
        extra_per_km:     parseFloat(form.extra_per_km),
        extra_per_min:    parseFloat(form.extra_per_min),
        ...(form.display_order ? { display_order: parseInt(form.display_order, 10) } : {}),
      })
      setOpen(false); onCreated()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Failed to create package. A package with this duration and km limit may already exist for this category.')
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

// ── Inline ride-type badge ─────────────────────────────────────────────────────

function StatusPillRideType({ type }: { type: string }) {
  const cls = type === 'one_way' ? 'pill-info' : type === 'round_trip' ? 'pill-purple' : 'pill-muted'
  return <span className={cls}>{RIDE_TYPE_LABEL[type] ?? type}</span>
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = 'rate_cards' | 'surge' | 'rental'

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { key: 'rate_cards', label: 'Rate Cards',       icon: Tag     },
  { key: 'surge',      label: 'Surge Events',     icon: Zap     },
  { key: 'rental',     label: 'Rental Packages',  icon: Package },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RateCardsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('rate_cards')

  // Rate cards + surge data
  const [cards,   setCards]   = useState<RateCard[]>([])
  const [surges,  setSurges]  = useState<SurgeEvent[]>([])
  const [cities,  setCities]  = useState<AdminCity[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [retry,   setRetry]   = useState(0)
  const [cityFilter,     setCityFilter]     = useState('') // '' = all, 'global' = global default only, else city id
  const [historyOpen,    setHistoryOpen]    = useState(false)
  const [history,        setHistory]        = useState<{ id: number; category_name: string; ride_type: string; rate_per_km: string; change_reason: string | null; created_at: string }[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Rental packages data
  const [rentalPkgs,    setRentalPkgs]    = useState<RentalPackageAdmin[]>([])
  const [rentalLoading, setRentalLoading] = useState(true)
  const [rentalError,   setRentalError]   = useState('')
  const [rentalRetry,   setRentalRetry]   = useState(0)
  const [toggling,      setToggling]      = useState<number | null>(null)
  const [deleting,      setDeleting]      = useState<number | null>(null)
  const [deleteError,   setDeleteError]   = useState('')
  const [deleteTarget,  setDeleteTarget]  = useState<RentalPackageAdmin | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [c, s, ci] = await Promise.all([pricingApi.getRateCards(), pricingApi.getSurgeEvents(), cityApi.list()])
      setCards(c); setSurges(s); setCities(ci)
    } catch { setError('Failed to load pricing data.') }
    finally { setLoading(false) }
  }, [])

  const fetchRental = useCallback(async () => {
    setRentalLoading(true); setRentalError('')
    try { setRentalPkgs(await rentalPackageApi.list()) }
    catch { setRentalError('Failed to load rental packages.') }
    finally { setRentalLoading(false) }
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll, retry])
  useEffect(() => { void fetchRental() }, [fetchRental, rentalRetry])

  async function loadHistory() {
    if (historyLoading) return
    setHistoryLoading(true)
    try { setHistory(await pricingApi.getRateCardHistory()) }
    finally { setHistoryLoading(false) }
  }

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

  async function cancelSurge(id: number) {
    try { await pricingApi.cancelSurgeEvent(id); void fetchAll() }
    catch { /* silent */ }
  }

  // Derived data
  const CATEGORY_ORDER_ITEMS = ['hatchback', 'sedan', 'suv', 'luxury', 'van']
  const RIDE_TYPE_ORDER = ['one_way', 'round_trip', 'rental']

  const filteredCards = cityFilter === '' ? cards
    : cityFilter === 'global' ? cards.filter(c => c.city_id === null)
    : cards.filter(c => c.city_id === parseInt(cityFilter, 10))

  const grouped = CATEGORY_ORDER_ITEMS.reduce<Record<string, RateCard[]>>((acc, slug) => {
    acc[slug] = filteredCards.filter(c => c.category_slug === slug)
      // global default rows first (city_name NULLS FIRST, mirroring the backend ordering), then by city name, then ride type
      .sort((a, b) =>
        (a.city_name ?? '').localeCompare(b.city_name ?? '')
          || RIDE_TYPE_ORDER.indexOf(a.ride_type) - RIDE_TYPE_ORDER.indexOf(b.ride_type))
    return acc
  }, {})

  const categoryOptions = [...new Map(cards.map(c => [c.category_id, { id: c.category_id, slug: c.category_slug, display_name: c.category_name }])).values()]
  const activeSurges = surges.filter(s => s.status === 'active')
  const configuredCategories = new Set(cards.map(c => c.category_id)).size

  // Rental derived
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
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
            <Tag size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="page-title">Pricing</h1>
            <p className="page-subtitle">Rate cards, surge events, and rental packages</p>
          </div>
        </div>
        {activeTab === 'surge' && (
          <CreateSurgeDialog cities={cities} categories={categoryOptions} onCreated={fetchAll} />
        )}
        {activeTab === 'rental' && (
          <CreateRentalPackageDialog
            categories={rentalCategories}
            onCreated={fetchRental}
          />
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border-light">
        {TABS.map(tab => {
          const Icon = tab.icon
          const active = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all duration-150 -mb-px ${
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text-secondary hover:border-border'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* ── Rate Cards tab ────────────────────────────────────────────────── */}
      {activeTab === 'rate_cards' && (
        <div className="space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="admin-card flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center flex-shrink-0">
                <Tag size={18} className="text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary">{loading ? '—' : cards.length}</p>
                <p className="text-xs text-text-muted mt-0.5">Active rate cards</p>
              </div>
            </div>
            <div className="admin-card flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center flex-shrink-0">
                <Tag size={18} className="text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary">{loading ? '—' : configuredCategories}</p>
                <p className="text-xs text-text-muted mt-0.5">Categories configured</p>
              </div>
            </div>
            <div className={`admin-card flex items-center gap-4 ${activeSurges.length > 0 ? 'ring-1 ring-warning/30' : ''}`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${activeSurges.length > 0 ? 'bg-warning-light' : 'bg-surface-2'}`}>
                <Zap size={18} className={activeSurges.length > 0 ? 'text-warning' : 'text-text-muted'} />
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary">{loading ? '—' : activeSurges.length}</p>
                <p className="text-xs text-text-muted mt-0.5">Active surge events</p>
              </div>
            </div>
          </div>

          {/* City filter */}
          <div className="flex items-center gap-2.5">
            <label className="text-xs font-semibold text-text-muted">City</label>
            <select value={cityFilter} onChange={e => setCityFilter(e.target.value)}
              className="border border-border rounded-xl px-3 py-1.5 text-sm text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">All Cities</option>
              <option value="global">Global Default Only</option>
              {cities.filter(c => c.status === 'active').map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {error ? (
            <div className="admin-card text-center py-8">
              <p className="text-text-muted mb-3">{error}</p>
              <button onClick={() => setRetry(r => r + 1)} className="btn-secondary">Retry</button>
            </div>
          ) : loading ? (
            <div className="admin-card !p-0 overflow-hidden">
              <table className="data-table"><tbody><SkeletonRows cols={9} n={6} /></tbody></table>
            </div>
          ) : filteredCards.length === 0 ? (
            <div className="admin-card text-center py-8 text-text-muted text-sm">
              No rate cards for this city filter.
            </div>
          ) : (
            CATEGORY_ORDER_ITEMS.map(slug => {
              const rows = grouped[slug]
              if (!rows?.length) return null
              const catName = rows[0]?.category_name ?? slug
              return (
                <div key={slug} className="admin-card !p-0 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-border bg-surface-2 flex items-center gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    <h3 className="text-sm font-semibold text-text-primary">{catName}</h3>
                  </div>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>City</th>
                        <th>Ride Type</th>
                        <th className="!text-right">Per KM</th>
                        <th className="!text-right">Per Min</th>
                        <th className="!text-right">Min Fare</th>
                        <th className="!text-right">Return Rate</th>
                        <th className="!text-right">KM/day</th>
                        <th className="!text-right">Driver Allowance/day</th>
                        <th className="!text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(card => (
                        <tr key={card.id} className="cursor-default">
                          <td>
                            {card.city_name
                              ? <span className="pill-info">{card.city_name}</span>
                              : <span className="pill-muted">Global</span>}
                          </td>
                          <td><StatusPillRideType type={card.ride_type} /></td>
                          <td className="!text-right font-mono font-semibold text-text-primary">{fmt(card.rate_per_km)}</td>
                          <td className="!text-right font-mono">{fmt(card.rate_per_min)}</td>
                          <td className="!text-right font-mono font-semibold text-text-primary">{fmt(card.min_fare)}</td>
                          <td className="!text-right font-mono text-text-muted">{fmt(card.return_rate_per_km)}</td>
                          <td className="!text-right font-mono text-text-muted">{card.km_per_day ?? '—'}</td>
                          <td className="!text-right font-mono text-text-muted">{fmt(card.driver_allowance_per_day)}</td>
                          <td className="!text-right">
                            <UpdateRateDialog card={card} cities={cities} onUpdated={fetchAll} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })
          )}

          {/* Rate change history */}
          <div className="admin-card !p-0 overflow-hidden">
            <button
              className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-2 transition-colors text-left"
              onClick={() => { setHistoryOpen(h => !h); if (!historyOpen) void loadHistory() }}
            >
              <div className="flex items-center gap-2.5">
                <History size={15} className="text-text-muted" />
                <span className="text-sm font-semibold text-text-primary">Rate Change History</span>
              </div>
              {historyOpen ? <ChevronUp size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
            </button>
            {historyOpen && (
              historyLoading ? (
                <div className="border-t border-border">
                  <table className="data-table"><tbody><SkeletonRows cols={5} n={4} /></tbody></table>
                </div>
              ) : history.length === 0 ? (
                <p className="border-t border-border px-5 py-8 text-center text-text-muted text-sm">No rate changes recorded yet.</p>
              ) : (
                <div className="border-t border-border">
                  <table className="data-table">
                    <thead>
                      <tr><th>Category</th><th>Ride Type</th><th>Per KM</th><th>Reason</th><th>Changed</th></tr>
                    </thead>
                    <tbody>
                      {history.map(h => (
                        <tr key={h.id} className="cursor-default">
                          <td className="font-medium text-text-primary">{h.category_name}</td>
                          <td>{RIDE_TYPE_LABEL[h.ride_type] ?? h.ride_type}</td>
                          <td className="font-mono font-semibold text-text-primary">{fmt(h.rate_per_km)}</td>
                          <td className="max-w-[240px] truncate">{h.change_reason ?? '—'}</td>
                          <td className="text-xs">{new Date(h.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* ── Surge Events tab ──────────────────────────────────────────────── */}
      {activeTab === 'surge' && (
        <div className="space-y-5">
          {activeSurges.length > 0 && (
            <div className="bg-warning-light border border-warning/20 rounded-2xl px-5 py-4 flex items-center gap-3">
              <AlertTriangle size={18} className="text-warning flex-shrink-0" />
              <p className="text-sm font-semibold text-warning">
                {activeSurges.length} active surge event{activeSurges.length > 1 ? 's' : ''}, fares are currently elevated
              </p>
            </div>
          )}
          <div className="admin-card !p-0 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-surface-2 flex items-center gap-2.5">
              <Zap size={14} className="text-warning" />
              <h3 className="text-sm font-semibold text-text-primary">All Surge Events</h3>
            </div>
            {surges.length === 0 ? (
              <p className="px-5 py-8 text-center text-text-muted text-sm">
                No surge events scheduled. Use the button above to create one.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>{['City', 'Category', 'Multiplier', 'Reason', 'Status', 'Starts', 'Ends', ''].map(h => <th key={h}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {surges.map(s => (
                    <tr key={s.id} className="cursor-default">
                      <td className="font-medium text-text-primary">{s.city_name}</td>
                      <td>{s.category_name ?? 'All'}</td>
                      <td><span className="font-mono font-bold text-warning">{parseFloat(s.multiplier).toFixed(2)}×</span></td>
                      <td className="max-w-[160px] truncate">{s.reason ?? '—'}</td>
                      <td><span className={SURGE_STATUS_CLS[s.status] ?? 'pill-muted'}>{s.status.charAt(0).toUpperCase() + s.status.slice(1)}</span></td>
                      <td className="text-xs">{new Date(s.starts_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="text-xs">{new Date(s.ends_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      <td>
                        {(s.status === 'scheduled' || s.status === 'active') && (
                          <button onClick={() => cancelSurge(s.id)}
                            className="text-xs text-danger font-semibold px-2.5 py-1 rounded-lg hover:bg-danger-light transition-colors">
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── Rental Packages tab ───────────────────────────────────────────── */}
      {activeTab === 'rental' && (
        <div className="space-y-5">
          {/* Stats row */}
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
              <table className="data-table"><tbody><SkeletonRows cols={8} n={8} /></tbody></table>
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
                            <EditRentalPackageDialog pkg={pkg} onUpdated={fetchRental} />
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
        </div>
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
