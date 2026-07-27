'use client'
import { useState, useEffect, useCallback } from 'react'
import { MapPin, Plus, Pencil, CheckCircle2, Clock } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import Toggle from '@/components/ui/Toggle'
import { cityApi, type AdminCity } from '@/lib/city-api'

// ── Helpers ──────────────────────────────────────────────────────────────────

function CityStatusPill({ status }: { status: AdminCity['status'] }) {
  if (status === 'active')   return <span className="pill-success">Active</span>
  if (status === 'draft')    return <span className="pill-warning">Draft</span>
  return <span className="pill-muted">Inactive</span>
}

function Check({ on }: { on: boolean }) {
  return on
    ? <CheckCircle2 size={15} className="text-success" />
    : <span className="text-text-muted">—</span>
}

function SkeletonRows({ n }: { n: number }) {
  return <>{Array.from({ length: n }).map((_, i) => (
    <tr key={i} className="border-b border-border-light last:border-b-0">
      {Array.from({ length: 7 }).map((_, j) => (
        <td key={j} className="px-4 py-3.5">
          <div className="h-4 bg-surface-2 rounded animate-pulse" style={{ width: `${50 + (j * 17) % 40}%` }} />
        </td>
      ))}
    </tr>
  ))}</>
}

const inputCls = 'w-full border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted'
const labelCls = 'block text-xs font-semibold text-text-muted mb-1.5'

// ── Add City Dialog ───────────────────────────────────────────────────────────

function AddCityDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: '', slug: '', state: '',
    centroid_lat: '', centroid_lng: '',
    default_speed_limit_kmph: '50',
    is_rental_enabled: false,
    is_return_cab_enabled: false,
  })

  function autoSlug(name: string) {
    return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  }

  function set(field: string, value: string | boolean) {
    setForm(f => {
      const next = { ...f, [field]: value }
      if (field === 'name') next.slug = autoSlug(value as string)
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await cityApi.create({
        name: form.name,
        slug: form.slug,
        state: form.state,
        centroid_lat: parseFloat(form.centroid_lat),
        centroid_lng: parseFloat(form.centroid_lng),
        default_speed_limit_kmph: parseInt(form.default_speed_limit_kmph, 10),
        is_rental_enabled: form.is_rental_enabled,
        is_return_cab_enabled: form.is_return_cab_enabled,
      })
      setOpen(false)
      setForm({ name: '', slug: '', state: '', centroid_lat: '', centroid_lng: '', default_speed_limit_kmph: '50', is_rental_enabled: false, is_return_cab_enabled: false })
      onCreated()
    } catch {
      setError('Failed to create city. Check if slug is already taken.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="btn-primary"><Plus size={15} />Add City</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[480px] max-h-[90vh] overflow-y-auto bg-surface rounded-2xl shadow-hover p-6 z-[60]">
          <Dialog.Title className="text-lg font-bold text-text-primary mb-5">Add City</Dialog.Title>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>City Name *</label>
                <input value={form.name} onChange={e => set('name', e.target.value)} required
                  className={inputCls} placeholder="e.g. Bhubaneswar" />
              </div>
              <div>
                <label className={labelCls}>Slug *</label>
                <input value={form.slug} onChange={e => set('slug', e.target.value)} required
                  className={inputCls} placeholder="auto-generated" />
              </div>
              <div>
                <label className={labelCls}>State *</label>
                <input value={form.state} onChange={e => set('state', e.target.value)} required
                  className={inputCls} placeholder="e.g. Odisha" />
              </div>
              <div>
                <label className={labelCls}>Latitude *</label>
                <input value={form.centroid_lat} onChange={e => set('centroid_lat', e.target.value)} required type="number" step="any" min="-90" max="90"
                  className={inputCls} placeholder="20.2961" />
              </div>
              <div>
                <label className={labelCls}>Longitude *</label>
                <input value={form.centroid_lng} onChange={e => set('centroid_lng', e.target.value)} required type="number" step="any" min="-180" max="180"
                  className={inputCls} placeholder="85.8245" />
              </div>
            </div>
            <p className="text-xs text-text-muted">Tip: Right-click any point in Google Maps to copy coordinates.</p>
            <div>
              <label className={labelCls}>Default Speed Limit (km/h)</label>
              <input value={form.default_speed_limit_kmph} onChange={e => set('default_speed_limit_kmph', e.target.value)} type="number" min="20" max="120"
                className="w-32 border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div className="space-y-3 pt-1 border-t border-border-light">
              <div className="flex items-center justify-between pt-3">
                <span className="text-sm font-medium text-text-secondary">Rental Enabled</span>
                <Toggle checked={form.is_rental_enabled} onChange={v => set('is_rental_enabled', v)} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-secondary">Return Cab Enabled</span>
                <Toggle checked={form.is_return_cab_enabled} onChange={v => set('is_return_cab_enabled', v)} />
              </div>
            </div>
            <p className="text-xs text-text-muted">Status starts as <span className="text-warning font-semibold">Draft</span>. Activate after verifying coordinates.</p>
            {error && <p className="text-xs text-danger font-semibold">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary flex-1 justify-center">Cancel</button>
              </Dialog.Close>
              <button type="submit" disabled={loading}
                className="btn-primary flex-1 justify-center disabled:opacity-50 disabled:pointer-events-none">
                {loading ? 'Creating…' : 'Create City'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Edit City Dialog ──────────────────────────────────────────────────────────

function EditCityDialog({ city, onUpdated }: { city: AdminCity; onUpdated: () => void }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    name: city.name,
    state: city.state,
    default_speed_limit_kmph: String(city.default_speed_limit_kmph),
    status: city.status,
    is_rental_enabled: city.is_rental_enabled,
    is_return_cab_enabled: city.is_return_cab_enabled,
  })

  useEffect(() => {
    if (open) {
      setForm({
        name: city.name, state: city.state,
        default_speed_limit_kmph: String(city.default_speed_limit_kmph),
        status: city.status,
        is_rental_enabled: city.is_rental_enabled,
        is_return_cab_enabled: city.is_return_cab_enabled,
      })
      setError('')
    }
  }, [open, city])

  function set(field: string, value: string | boolean) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await cityApi.update(city.id, {
        name: form.name,
        state: form.state,
        default_speed_limit_kmph: parseInt(form.default_speed_limit_kmph, 10),
        status: form.status,
        is_rental_enabled: form.is_rental_enabled,
        is_return_cab_enabled: form.is_return_cab_enabled,
      })
      setOpen(false)
      onUpdated()
    } catch {
      setError('Failed to update city.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="p-1.5 text-text-muted hover:text-primary hover:bg-primary-light rounded-lg transition-colors" title="Edit" aria-label="Edit city">
          <Pencil size={14} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[440px] max-h-[90vh] overflow-y-auto bg-surface rounded-2xl shadow-hover p-6 z-[60]">
          <Dialog.Title className="text-lg font-bold text-text-primary mb-1">Edit City</Dialog.Title>
          <p className="text-xs text-text-muted mb-5">Slug and coordinates cannot be changed after creation.</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={labelCls}>City Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} required className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>State *</label>
              <input value={form.state} onChange={e => set('state', e.target.value)} required className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Default Speed Limit (km/h)</label>
              <input value={form.default_speed_limit_kmph} onChange={e => set('default_speed_limit_kmph', e.target.value)} type="number" min="20" max="120"
                className="w-32 border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="space-y-3 pt-1 border-t border-border-light">
              <div className="flex items-center justify-between pt-3">
                <div>
                  <span className="text-sm font-medium text-text-secondary">Rental Enabled</span>
                  {form.is_rental_enabled && (
                    <p className="text-xs text-text-muted mt-0.5">Rental boundary must be configured separately</p>
                  )}
                </div>
                <Toggle checked={form.is_rental_enabled} onChange={v => set('is_rental_enabled', v)} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text-secondary">Return Cab Enabled</span>
                <Toggle checked={form.is_return_cab_enabled} onChange={v => set('is_return_cab_enabled', v)} />
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CitiesPage() {
  const [cities, setCities] = useState<AdminCity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  const fetchCities = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setCities(await cityApi.list())
    } catch {
      setError('Failed to load cities.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchCities() }, [fetchCities, retry])

  const active    = cities.filter(c => c.status === 'active').length
  const draft     = cities.filter(c => c.status === 'draft').length
  const returnCab = cities.filter(c => c.is_return_cab_enabled).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
            <MapPin size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="page-title">Cities</h1>
            <p className="page-subtitle">Manage service areas and city settings</p>
          </div>
        </div>
        <AddCityDialog onCreated={fetchCities} />
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="admin-card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={18} className="text-success" />
          </div>
          <div>
            <p className="text-2xl font-bold text-text-primary">{loading ? '—' : active}</p>
            <p className="text-xs text-text-muted mt-0.5">Active cities</p>
          </div>
        </div>
        <div className="admin-card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-warning-light flex items-center justify-center flex-shrink-0">
            <Clock size={18} className="text-warning" />
          </div>
          <div>
            <p className="text-2xl font-bold text-text-primary">{loading ? '—' : draft}</p>
            <p className="text-xs text-text-muted mt-0.5">Awaiting activation</p>
          </div>
        </div>
        <div className="admin-card flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-info-light flex items-center justify-center flex-shrink-0">
            <MapPin size={18} className="text-info" />
          </div>
          <div>
            <p className="text-2xl font-bold text-text-primary">{loading ? '—' : returnCab}</p>
            <p className="text-xs text-text-muted mt-0.5">Return cab enabled</p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="admin-card !p-0 overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>City</th>
              <th>State</th>
              <th>Status</th>
              <th className="!text-center">Rental</th>
              <th className="!text-center">Return Cab</th>
              <th>Speed Limit</th>
              <th className="!text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows n={4} />
            ) : error ? (
              <tr>
                <td colSpan={7} className="!text-center py-12">
                  <p className="text-text-muted mb-3">{error}</p>
                  <button onClick={() => setRetry(r => r + 1)} className="btn-secondary">Retry</button>
                </td>
              </tr>
            ) : cities.length === 0 ? (
              <tr>
                <td colSpan={7} className="!text-center py-12 text-text-muted">
                  No cities yet. Add the first one.
                </td>
              </tr>
            ) : cities.map(city => (
              <tr key={city.id} className="cursor-default">
                <td>
                  <div>
                    <span className="font-semibold text-text-primary">{city.name}</span>
                    <span className="text-text-muted text-xs ml-2 font-mono">{city.slug}</span>
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {city.centroid_lat.toFixed(4)}, {city.centroid_lng.toFixed(4)}
                  </div>
                </td>
                <td>{city.state}</td>
                <td><CityStatusPill status={city.status} /></td>
                <td className="!text-center"><Check on={city.is_rental_enabled} /></td>
                <td className="!text-center"><Check on={city.is_return_cab_enabled} /></td>
                <td className="font-mono">{city.default_speed_limit_kmph} km/h</td>
                <td className="!text-right">
                  <EditCityDialog city={city} onUpdated={fetchCities} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
