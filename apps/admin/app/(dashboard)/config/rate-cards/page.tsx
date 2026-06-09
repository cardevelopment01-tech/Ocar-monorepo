'use client'
import { useState, useEffect, useCallback } from 'react'
import { Tag, Plus, Pencil, Zap, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { pricingApi, type RateCard, type SurgeEvent } from '@/lib/pricing-api'
import { cityApi, type AdminCity } from '@/lib/city-api'

// ── Helpers ──────────────────────────────────────────────────────────────────

const RIDE_TYPE_LABEL: Record<string, string> = {
  one_way: 'One Way', round_trip: 'Round Trip', rental: 'Rental',
}

const STATUS_STYLE: Record<string, string> = {
  scheduled: 'bg-blue-500/15 text-blue-400',
  active:    'bg-green-500/15 text-green-400',
  expired:   'bg-slate-500/15 text-slate-400',
  cancelled: 'bg-red-500/15 text-red-400',
}

function fmt(v: string | null): string {
  if (!v) return '—'
  return `₹${parseFloat(v).toFixed(2)}`
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`relative w-10 h-5 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-slate-700'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

function SkeletonRows({ cols, n }: { cols: number; n: number }) {
  return <>{Array.from({ length: n }).map((_, i) => (
    <tr key={i} className="border-b border-slate-800/60">
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j} className="px-4 py-3">
          <div className="h-4 bg-slate-800 rounded animate-pulse" style={{ width: `${45 + (j * 20) % 45}%` }} />
        </td>
      ))}
    </tr>
  ))}</>
}

// ── Update Rate Dialog ────────────────────────────────────────────────────────

function UpdateRateDialog({
  card,
  onUpdated,
}: {
  card: RateCard
  onUpdated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    rate_per_km: card.rate_per_km,
    rate_per_min: card.rate_per_min,
    min_fare: card.min_fare,
    return_rate_per_km: card.return_rate_per_km ?? '',
    hour_rate: card.hour_rate ?? '',
    notes: '',
  })

  useEffect(() => {
    if (open) {
      setForm({
        rate_per_km: card.rate_per_km,
        rate_per_min: card.rate_per_min,
        min_fare: card.min_fare,
        return_rate_per_km: card.return_rate_per_km ?? '',
        hour_rate: card.hour_rate ?? '',
        notes: '',
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
        category_id: card.category_id,
        ride_type: card.ride_type,
        rate_per_km: parseFloat(form.rate_per_km),
        rate_per_min: parseFloat(form.rate_per_min),
        min_fare: parseFloat(form.min_fare),
        return_rate_per_km: form.return_rate_per_km ? parseFloat(form.return_rate_per_km) : null,
        hour_rate: form.hour_rate ? parseFloat(form.hour_rate) : null,
        notes: form.notes,
      })
      setOpen(false)
      onUpdated()
    } catch { setError('Failed to update rate card.') }
    finally { setLoading(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors" title="Update rate">
          <Pencil size={13} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-h-[90vh] overflow-y-auto bg-card border border-slate-800 rounded-xl p-6 z-50 shadow-2xl">
          <Dialog.Title className="text-white font-semibold text-lg mb-1">
            Update {card.category_name} — {RIDE_TYPE_LABEL[card.ride_type]}
          </Dialog.Title>
          <p className="text-xs text-amber-400 mb-4">This will create a new rate card and expire the current one. All future rides will use the new rate.</p>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Per KM (₹)</label>
                <input type="number" step="0.01" value={form.rate_per_km}
                  onChange={e => setForm(f => ({ ...f, rate_per_km: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
                <p className="text-xs text-slate-600 mt-0.5">was {fmt(card.rate_per_km)}</p>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Per Min (₹)</label>
                <input type="number" step="0.01" value={form.rate_per_min}
                  onChange={e => setForm(f => ({ ...f, rate_per_min: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
                <p className="text-xs text-slate-600 mt-0.5">was {fmt(card.rate_per_min)}</p>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Min Fare (₹)</label>
                <input type="number" step="0.01" value={form.min_fare}
                  onChange={e => setForm(f => ({ ...f, min_fare: e.target.value }))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
                <p className="text-xs text-slate-600 mt-0.5">was {fmt(card.min_fare)}</p>
              </div>
            </div>
            {card.ride_type === 'one_way' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">Return Cab Rate /km (₹)</label>
                <input type="number" step="0.01" value={form.return_rate_per_km}
                  onChange={e => setForm(f => ({ ...f, return_rate_per_km: e.target.value }))}
                  className="w-40 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  placeholder="optional" />
                <p className="text-xs text-slate-600 mt-0.5">was {fmt(card.return_rate_per_km)}</p>
              </div>
            )}
            {card.ride_type === 'round_trip' && (
              <div>
                <label className="block text-xs text-slate-400 mb-1">Hour Rate (₹)</label>
                <input type="number" step="0.01" value={form.hour_rate}
                  onChange={e => setForm(f => ({ ...f, hour_rate: e.target.value }))}
                  className="w-40 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                  placeholder="optional" />
                <p className="text-xs text-slate-600 mt-0.5">was {fmt(card.hour_rate)}</p>
              </div>
            )}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Change Reason *</label>
              <textarea rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-primary"
                placeholder="e.g. Fuel price increase" />
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors">Cancel</button>
              </Dialog.Close>
              <button type="submit" disabled={loading} className="flex-1 px-4 py-2 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {loading ? 'Updating…' : 'Update Rate'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Create Surge Dialog ───────────────────────────────────────────────────────

function CreateSurgeDialog({
  cities,
  categories,
  onCreated,
}: {
  cities: AdminCity[]
  categories: { id: number; slug: string; display_name: string }[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    city_id: '', category_id: '', multiplier: '1.5',
    reason: '', starts_at: '', ends_at: '',
  })

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  const mult = parseFloat(form.multiplier) || 1
  const pct = Math.round((mult - 1) * 100)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await pricingApi.createSurgeEvent({
        city_id: parseInt(form.city_id, 10),
        category_id: form.category_id ? parseInt(form.category_id, 10) : null,
        multiplier: mult,
        reason: form.reason || undefined,
        starts_at: form.starts_at,
        ends_at: form.ends_at,
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
        <button className="flex items-center gap-2 px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-sm font-medium rounded-lg transition-colors border border-amber-500/30">
          <Zap size={14} />Schedule Surge
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[480px] max-h-[90vh] overflow-y-auto bg-card border border-slate-800 rounded-xl p-6 z-50 shadow-2xl">
          <Dialog.Title className="text-white font-semibold text-lg mb-5">Schedule Surge Event</Dialog.Title>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">City *</label>
              <select value={form.city_id} onChange={e => set('city_id', e.target.value)} required
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary">
                <option value="">Select city…</option>
                {cities.filter(c => c.status === 'active').map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Category (leave blank for all)</label>
              <select value={form.category_id} onChange={e => set('category_id', e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary">
                <option value="">All categories</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.display_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Multiplier — <span className="text-amber-400 font-medium">{mult.toFixed(2)}× — fares will be {pct}% higher</span>
              </label>
              <div className="flex items-center gap-3">
                <input type="range" min="1.0" max="5.0" step="0.1" value={form.multiplier}
                  onChange={e => set('multiplier', e.target.value)}
                  className="flex-1 accent-amber-400" />
                <input type="number" min="1.0" max="5.0" step="0.1" value={form.multiplier}
                  onChange={e => set('multiplier', e.target.value)}
                  className="w-20 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white text-center focus:outline-none focus:border-primary" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Reason</label>
              <input value={form.reason} onChange={e => set('reason', e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
                placeholder="e.g. Festival surge, Heavy rain" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Starts At *</label>
                <input type="datetime-local" value={form.starts_at} onChange={e => set('starts_at', e.target.value)} required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Ends At *</label>
                <input type="datetime-local" value={form.ends_at} onChange={e => set('ends_at', e.target.value)} required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary" />
              </div>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm rounded-lg transition-colors">Cancel</button>
              </Dialog.Close>
              <button type="submit" disabled={loading} className="flex-1 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {loading ? 'Scheduling…' : 'Schedule Surge'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const CATEGORY_ORDER = ['hatchback', 'sedan', 'suv', 'luxury', 'van']
const RIDE_ORDER: RateCard['ride_type'][] = ['one_way', 'round_trip', 'rental']

export default function RateCardsPage() {
  const [cards, setCards] = useState<RateCard[]>([])
  const [surges, setSurges] = useState<SurgeEvent[]>([])
  const [cities, setCities] = useState<AdminCity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<{ id: number; category_name: string; ride_type: string; rate_per_km: string; change_reason: string | null; created_at: string }[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [retry, setRetry] = useState(0)

  const fetchAll = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [c, s, ci] = await Promise.all([
        pricingApi.getRateCards(),
        pricingApi.getSurgeEvents(),
        cityApi.list(),
      ])
      setCards(c); setSurges(s); setCities(ci)
    } catch { setError('Failed to load pricing data.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll, retry])

  async function loadHistory() {
    if (historyLoading) return
    setHistoryLoading(true)
    try { setHistory(await pricingApi.getRateCardHistory()) }
    finally { setHistoryLoading(false) }
  }

  // Group cards by category
  const grouped = CATEGORY_ORDER.reduce<Record<string, RateCard[]>>((acc, slug) => {
    acc[slug] = cards.filter(c => c.category_slug === slug)
      .sort((a, b) => RIDE_ORDER.indexOf(a.ride_type) - RIDE_ORDER.indexOf(b.ride_type))
    return acc
  }, {})

  // Get unique categories for surge dialog
  const categoryOptions = [...new Map(cards.map(c => [c.category_id, { id: c.category_id, slug: c.category_slug, display_name: c.category_name }])).values()]

  const activeSurges = surges.filter(s => s.status === 'active')
  const lastUpdated = cards.length
    ? new Date(Math.max(...cards.map(c => +new Date(c.created_at)))).toLocaleDateString()
    : '—'
  const configuredCategories = new Set(cards.map(c => c.category_id)).size

  async function cancelSurge(id: number) {
    try {
      await pricingApi.cancelSurgeEvent(id)
      fetchAll()
    } catch { /* silent */ }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
            <Tag size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-white font-semibold text-xl">Rate Cards</h1>
            <p className="text-slate-400 text-sm">Fare structure and surge management</p>
          </div>
        </div>
        <CreateSurgeDialog cities={cities} categories={categoryOptions} onCreated={fetchAll} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Active Rate Cards</p>
          <p className="text-2xl font-bold text-blue-400">{loading ? '—' : cards.length}</p>
        </div>
        <div className="bg-card border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Last Updated</p>
          <p className="text-2xl font-bold text-amber-400">{loading ? '—' : lastUpdated}</p>
        </div>
        <div className="bg-card border border-slate-800 rounded-xl p-4">
          <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Categories Configured</p>
          <p className="text-2xl font-bold text-green-400">{loading ? '—' : configuredCategories}</p>
        </div>
      </div>

      {/* Active surge banner */}
      {activeSurges.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
          <p className="text-red-300 text-sm font-medium">
            {activeSurges.length} active surge event{activeSurges.length > 1 ? 's' : ''} — fares are elevated
          </p>
        </div>
      )}

      {/* Rate cards by category */}
      {error ? (
        <div className="bg-card border border-slate-800 rounded-xl p-12 text-center">
          <p className="text-slate-400 mb-3">{error}</p>
          <button onClick={() => setRetry(r => r + 1)} className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-sm text-slate-300 rounded-lg transition-colors">Retry</button>
        </div>
      ) : loading ? (
        <div className="bg-card border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm"><tbody><SkeletonRows cols={7} n={6} /></tbody></table>
        </div>
      ) : (
        CATEGORY_ORDER.map(slug => {
          const rows = grouped[slug]
          if (!rows?.length) return null
          const catName = rows[0]?.category_name ?? slug
          return (
            <div key={slug} className="bg-card border border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/40">
                <h3 className="text-white font-semibold text-sm">{catName}</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="px-4 py-2.5 text-left text-xs text-slate-400 font-medium">Ride Type</th>
                    <th className="px-4 py-2.5 text-right text-xs text-slate-400 font-medium">Per KM</th>
                    <th className="px-4 py-2.5 text-right text-xs text-slate-400 font-medium">Per Min</th>
                    <th className="px-4 py-2.5 text-right text-xs text-slate-400 font-medium">Min Fare</th>
                    <th className="px-4 py-2.5 text-right text-xs text-slate-400 font-medium">Return Rate</th>
                    <th className="px-4 py-2.5 text-right text-xs text-slate-400 font-medium">Hour Rate</th>
                    <th className="px-4 py-2.5 text-right text-xs text-slate-400 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(card => (
                    <tr key={card.id} className="border-b border-slate-800/60 hover:bg-slate-900/30 transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-white font-medium">{RIDE_TYPE_LABEL[card.ride_type]}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-200">{fmt(card.rate_per_km)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-200">{fmt(card.rate_per_min)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-200">{fmt(card.min_fare)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-400">{fmt(card.return_rate_per_km)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-400">{fmt(card.hour_rate)}</td>
                      <td className="px-4 py-3 text-right">
                        <UpdateRateDialog card={card} onUpdated={fetchAll} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })
      )}

      {/* Surge events */}
      <div className="bg-card border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={15} className="text-amber-400" />
            <h3 className="text-white font-semibold text-sm">Surge Events</h3>
          </div>
        </div>
        {surges.length === 0 ? (
          <p className="px-4 py-8 text-center text-slate-500 text-sm">No surge events. Schedule one using the button above.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                {['City', 'Category', 'Multiplier', 'Reason', 'Status', 'Starts', 'Ends', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs text-slate-400 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {surges.map(s => (
                <tr key={s.id} className="border-b border-slate-800/60 hover:bg-slate-900/30 transition-colors">
                  <td className="px-4 py-3 text-slate-200">{s.city_name}</td>
                  <td className="px-4 py-3 text-slate-400">{s.category_name ?? 'All'}</td>
                  <td className="px-4 py-3">
                    <span className="text-amber-400 font-mono font-bold">{parseFloat(s.multiplier).toFixed(2)}×</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 max-w-[160px] truncate">{s.reason ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[s.status] ?? ''}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(s.starts_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(s.ends_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {(s.status === 'scheduled' || s.status === 'active') && (
                      <button onClick={() => cancelSurge(s.id)}
                        className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10 transition-colors">
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

      {/* Rate change history */}
      <div className="bg-card border border-slate-800 rounded-xl overflow-hidden">
        <button
          className="w-full px-4 py-3 flex items-center justify-between border-b border-slate-800 hover:bg-slate-900/30 transition-colors"
          onClick={() => { setHistoryOpen(h => !h); if (!historyOpen) loadHistory() }}
        >
          <span className="text-white font-semibold text-sm">Rate Change History</span>
          {historyOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {historyOpen && (
          historyLoading ? (
            <table className="w-full text-sm"><tbody><SkeletonRows cols={5} n={4} /></tbody></table>
          ) : history.length === 0 ? (
            <p className="px-4 py-8 text-center text-slate-500 text-sm">No rate changes recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  {['Category', 'Ride Type', 'Per KM', 'Reason', 'Changed At'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs text-slate-400 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.id} className="border-b border-slate-800/60">
                    <td className="px-4 py-3 text-slate-300">{h.category_name}</td>
                    <td className="px-4 py-3 text-slate-400">{RIDE_TYPE_LABEL[h.ride_type] ?? h.ride_type}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{fmt(h.rate_per_km)}</td>
                    <td className="px-4 py-3 text-slate-400 max-w-[240px] truncate">{h.change_reason ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{new Date(h.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  )
}
