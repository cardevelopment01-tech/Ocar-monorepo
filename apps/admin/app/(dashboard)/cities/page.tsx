'use client'
import { useState, useEffect, useCallback } from 'react'
import { MapPin, Plus, Pencil, CheckCircle2, Clock, XCircle } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { cityApi, type AdminCity } from '@/lib/city-api'

// ── Helpers ──────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: AdminCity['status'] }) {
  if (status === 'active')   return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400"><CheckCircle2 size={11} />Active</span>
  if (status === 'draft')    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400"><Clock size={11} />Draft</span>
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-500/15 text-slate-400"><XCircle size={11} />Inactive</span>
}

function Check({ on }: { on: boolean }) {
  return on
    ? <CheckCircle2 size={15} className="text-green-400" />
    : <span className="text-slate-600">—</span>
}

function SkeletonRows({ n }: { n: number }) {
  return <>{Array.from({ length: n }).map((_, i) => (
    <tr key={i} className="border-b border-slate-800/60">
      {Array.from({ length: 7 }).map((_, j) => (
        <td key={j} className="px-4 py-3">
          <div className="h-4 bg-slate-800 rounded animate-pulse" style={{ width: `${50 + (j * 17) % 40}%` }} />
        </td>
      ))}
    </tr>
  ))}</>
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative w-10 h-5 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-slate-700'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

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
        <button className="flex items-center gap-2 px-3 py-2 bg-primary hover:bg-primary-dark text-white text-sm font-medium rounded-lg transition-colors">
          <Plus size={15} />Add City
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-h-[90vh] overflow-y-auto bg-card border border-slate-800 rounded-xl p-6 z-50 shadow-2xl">
          <Dialog.Title className="text-white font-semibold text-lg mb-5">Add City</Dialog.Title>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-slate-400 mb-1">City Name *</label>
                <input value={form.name} onChange={e => set('name', e.target.value)} required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary" placeholder="e.g. Bhubaneswar" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Slug *</label>
                <input value={form.slug} onChange={e => set('slug', e.target.value)} required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary" placeholder="auto-generated" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">State *</label>
                <input value={form.state} onChange={e => set('state', e.target.value)} required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary" placeholder="e.g. Odisha" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Latitude *</label>
                <input value={form.centroid_lat} onChange={e => set('centroid_lat', e.target.value)} required type="number" step="any" min="-90" max="90"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary" placeholder="20.2961" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Longitude *</label>
                <input value={form.centroid_lng} onChange={e => set('centroid_lng', e.target.value)} required type="number" step="any" min="-180" max="180"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary" placeholder="85.8245" />
              </div>
            </div>
            <p className="text-xs text-slate-500">Tip: Open Google Maps, right-click any point, copy the coordinates shown.</p>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Default Speed Limit (km/h)</label>
              <input value={form.default_speed_limit_kmph} onChange={e => set('default_speed_limit_kmph', e.target.value)} type="number" min="20" max="120"
                className="w-32 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Rental Enabled</span>
              <Toggle value={form.is_rental_enabled} onChange={v => set('is_rental_enabled', v)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Return Cab Enabled</span>
              <Toggle value={form.is_return_cab_enabled} onChange={v => set('is_return_cab_enabled', v)} />
            </div>
            <p className="text-xs text-slate-500">Status starts as <span className="text-amber-400">Draft</span>. Activate after verifying coordinates.</p>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors">Cancel</button>
              </Dialog.Close>
              <button type="submit" disabled={loading} className="flex-1 px-4 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
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
        <button className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors" title="Edit">
          <Pencil size={14} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[440px] max-h-[90vh] overflow-y-auto bg-card border border-slate-800 rounded-xl p-6 z-50 shadow-2xl">
          <Dialog.Title className="text-white font-semibold text-lg mb-1">Edit City</Dialog.Title>
          <p className="text-xs text-slate-500 mb-5">Slug and coordinates cannot be changed after creation.</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">City Name *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} required
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">State *</label>
              <input value={form.state} onChange={e => set('state', e.target.value)} required
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Default Speed Limit (km/h)</label>
              <input value={form.default_speed_limit_kmph} onChange={e => set('default_speed_limit_kmph', e.target.value)} type="number" min="20" max="120"
                className="w-32 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary">
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-slate-300">Rental Enabled</span>
                {form.is_rental_enabled && (
                  <p className="text-xs text-slate-500 mt-0.5">Rental boundary must be configured separately</p>
                )}
              </div>
              <Toggle value={form.is_rental_enabled} onChange={v => set('is_rental_enabled', v)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Return Cab Enabled</span>
              <Toggle value={form.is_return_cab_enabled} onChange={v => set('is_return_cab_enabled', v)} />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors">Cancel</button>
              </Dialog.Close>
              <button type="submit" disabled={loading} className="flex-1 px-4 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
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
          <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
            <MapPin size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-xl">Cities</h1>
            <p className="text-slate-400 text-sm">Manage service areas and city settings</p>
          </div>
        </div>
        <AddCityDialog onCreated={fetchCities} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Active Cities</p>
          <p className="text-2xl font-bold text-green-400">{loading ? '—' : active}</p>
        </div>
        <div className="bg-card border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Draft Cities</p>
          <p className="text-2xl font-bold text-amber-400">{loading ? '—' : draft}</p>
        </div>
        <div className="bg-card border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Return Cab Enabled</p>
          <p className="text-2xl font-bold text-blue-400">{loading ? '—' : returnCab}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-slate-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50">
              <th className="px-4 py-3 text-left text-xs text-slate-400 font-medium uppercase tracking-wider">City</th>
              <th className="px-4 py-3 text-left text-xs text-slate-400 font-medium uppercase tracking-wider">State</th>
              <th className="px-4 py-3 text-left text-xs text-slate-400 font-medium uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-center text-xs text-slate-400 font-medium uppercase tracking-wider">Rental</th>
              <th className="px-4 py-3 text-center text-xs text-slate-400 font-medium uppercase tracking-wider">Return Cab</th>
              <th className="px-4 py-3 text-left text-xs text-slate-400 font-medium uppercase tracking-wider">Speed Limit</th>
              <th className="px-4 py-3 text-right text-xs text-slate-400 font-medium uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows n={4} />
            ) : error ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <p className="text-slate-400 mb-3">{error}</p>
                  <button onClick={() => setRetry(r => r + 1)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-sm text-slate-300 rounded-lg transition-colors">
                    Retry
                  </button>
                </td>
              </tr>
            ) : cities.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  No cities yet. Add the first one.
                </td>
              </tr>
            ) : (
              cities.map(city => (
                <tr key={city.id} className="border-b border-slate-800/60 hover:bg-slate-900/30 transition-colors">
                  <td className="px-4 py-3">
                    <div>
                      <span className="text-white font-medium">{city.name}</span>
                      <span className="text-slate-500 text-xs ml-2">{city.slug}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {city.centroid_lat.toFixed(4)}, {city.centroid_lng.toFixed(4)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{city.state}</td>
                  <td className="px-4 py-3"><StatusPill status={city.status} /></td>
                  <td className="px-4 py-3 text-center"><Check on={city.is_rental_enabled} /></td>
                  <td className="px-4 py-3 text-center"><Check on={city.is_return_cab_enabled} /></td>
                  <td className="px-4 py-3 text-slate-300">{city.default_speed_limit_kmph} km/h</td>
                  <td className="px-4 py-3 text-right">
                    <EditCityDialog city={city} onUpdated={fetchCities} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
