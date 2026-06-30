'use client'
import { useState, useEffect, useCallback } from 'react'
import { Tag, Plus, Pencil, Zap, AlertTriangle, ChevronDown, ChevronUp, History } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { pricingApi, type RateCard, type SurgeEvent } from '@/lib/pricing-api'
import { cityApi, type AdminCity } from '@/lib/city-api'

// ── Helpers ──────────────────────────────────────────────────────────────────

const RIDE_TYPE_LABEL: Record<string, string> = {
  one_way: 'One Way', round_trip: 'Round Trip', rental: 'Rental',
}

const SURGE_STATUS_CLS: Record<string, string> = {
  scheduled: 'pill-info',
  active:    'pill-warning',
  expired:   'pill-muted',
  cancelled: 'pill-danger',
}

function fmt(v: string | null): string {
  if (!v) return '—'
  return `₹${parseFloat(v).toFixed(2)}`
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${value ? 'bg-primary' : 'bg-border'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
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

// ── Update Rate Dialog ────────────────────────────────────────────────────────

function UpdateRateDialog({ card, onUpdated }: { card: RateCard; onUpdated: () => void }) {
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
        <button className="p-1.5 text-text-muted hover:text-primary hover:bg-primary-light rounded-lg transition-colors" title="Update rate">
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
            Creates a new rate card and expires the current one. All future rides use the new rate.
          </p>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Per KM (₹)</label>
                <input type="number" step="0.01" value={form.rate_per_km}
                  onChange={e => setForm(f => ({ ...f, rate_per_km: e.target.value }))}
                  className={inputCls} />
                <p className="text-xs text-text-muted mt-1">was {fmt(card.rate_per_km)}</p>
              </div>
              <div>
                <label className={labelCls}>Per Min (₹)</label>
                <input type="number" step="0.01" value={form.rate_per_min}
                  onChange={e => setForm(f => ({ ...f, rate_per_min: e.target.value }))}
                  className={inputCls} />
                <p className="text-xs text-text-muted mt-1">was {fmt(card.rate_per_min)}</p>
              </div>
              <div>
                <label className={labelCls}>Min Fare (₹)</label>
                <input type="number" step="0.01" value={form.min_fare}
                  onChange={e => setForm(f => ({ ...f, min_fare: e.target.value }))}
                  className={inputCls} />
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
              <div>
                <label className={labelCls}>Hour Rate (₹)</label>
                <input type="number" step="0.01" value={form.hour_rate}
                  onChange={e => setForm(f => ({ ...f, hour_rate: e.target.value }))}
                  className="w-40 border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted"
                  placeholder="optional" />
                <p className="text-xs text-text-muted mt-1">was {fmt(card.hour_rate)}</p>
              </div>
            )}
            <div>
              <label className={labelCls}>Change Reason *</label>
              <textarea rows={2} value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className={`${inputCls} resize-none`}
                placeholder="e.g. Fuel price increase" />
            </div>
            {error && <p className="text-xs text-danger font-semibold">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary flex-1 justify-center">Cancel</button>
              </Dialog.Close>
              <button type="submit" disabled={loading}
                className="btn-primary flex-1 justify-center disabled:opacity-50 disabled:pointer-events-none">
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
  const pct  = Math.round((mult - 1) * 100)

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
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.display_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>
                Multiplier —{' '}
                <span className="text-warning font-semibold">{mult.toFixed(2)}× · fares {pct}% higher</span>
              </label>
              <div className="flex items-center gap-3">
                <input type="range" min="1.0" max="5.0" step="0.1" value={form.multiplier}
                  onChange={e => set('multiplier', e.target.value)}
                  className="flex-1 accent-warning" />
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

// ── Page ──────────────────────────────────────────────────────────────────────

const CATEGORY_ORDER = ['hatchback', 'sedan', 'suv', 'luxury', 'van']
const RIDE_ORDER: RateCard['ride_type'][] = ['one_way', 'round_trip', 'rental']

export default function RateCardsPage() {
  const [cards, setCards]         = useState<RateCard[]>([])
  const [surges, setSurges]       = useState<SurgeEvent[]>([])
  const [cities, setCities]       = useState<AdminCity[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory]     = useState<{ id: number; category_name: string; ride_type: string; rate_per_km: string; change_reason: string | null; created_at: string }[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [retry, setRetry]         = useState(0)

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

  const grouped = CATEGORY_ORDER.reduce<Record<string, RateCard[]>>((acc, slug) => {
    acc[slug] = cards.filter(c => c.category_slug === slug)
      .sort((a, b) => RIDE_ORDER.indexOf(a.ride_type) - RIDE_ORDER.indexOf(b.ride_type))
    return acc
  }, {})

  const categoryOptions = [...new Map(cards.map(c => [c.category_id, { id: c.category_id, slug: c.category_slug, display_name: c.category_name }])).values()]
  const activeSurges    = surges.filter(s => s.status === 'active')
  const configuredCategories = new Set(cards.map(c => c.category_id)).size

  async function cancelSurge(id: number) {
    try { await pricingApi.cancelSurgeEvent(id); fetchAll() }
    catch { /* silent */ }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
            <Tag size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="page-title">Rate Cards</h1>
            <p className="page-subtitle">Fare structure and surge management</p>
          </div>
        </div>
        <CreateSurgeDialog cities={cities} categories={categoryOptions} onCreated={fetchAll} />
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-4">
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

      {/* Active surge banner */}
      {activeSurges.length > 0 && (
        <div className="bg-warning-light border border-warning/20 rounded-2xl px-5 py-4 flex items-center gap-3">
          <AlertTriangle size={18} className="text-warning flex-shrink-0" />
          <p className="text-sm font-semibold text-warning">
            {activeSurges.length} active surge event{activeSurges.length > 1 ? 's' : ''} — fares are currently elevated
          </p>
        </div>
      )}

      {/* Rate cards by category */}
      {error ? (
        <div className="admin-card text-center py-8">
          <p className="text-text-muted mb-3">{error}</p>
          <button onClick={() => setRetry(r => r + 1)} className="btn-secondary">Retry</button>
        </div>
      ) : loading ? (
        <div className="admin-card !p-0 overflow-hidden">
          <table className="data-table"><tbody><SkeletonRows cols={7} n={6} /></tbody></table>
        </div>
      ) : (
        CATEGORY_ORDER.map(slug => {
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
                    <th>Ride Type</th>
                    <th className="!text-right">Per KM</th>
                    <th className="!text-right">Per Min</th>
                    <th className="!text-right">Min Fare</th>
                    <th className="!text-right">Return Rate</th>
                    <th className="!text-right">Hour Rate</th>
                    <th className="!text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(card => (
                    <tr key={card.id} className="cursor-default">
                      <td>
                        <StatusPillRideType type={card.ride_type} />
                      </td>
                      <td className="!text-right font-mono font-semibold text-text-primary">{fmt(card.rate_per_km)}</td>
                      <td className="!text-right font-mono">{fmt(card.rate_per_min)}</td>
                      <td className="!text-right font-mono font-semibold text-text-primary">{fmt(card.min_fare)}</td>
                      <td className="!text-right font-mono text-text-muted">{fmt(card.return_rate_per_km)}</td>
                      <td className="!text-right font-mono text-text-muted">{fmt(card.hour_rate)}</td>
                      <td className="!text-right">
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
      <div className="admin-card !p-0 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-surface-2 flex items-center gap-2.5">
          <Zap size={14} className="text-warning" />
          <h3 className="text-sm font-semibold text-text-primary">Surge Events</h3>
        </div>
        {surges.length === 0 ? (
          <p className="px-5 py-8 text-center text-text-muted text-sm">
            No surge events scheduled. Use the button above to create one.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                {['City', 'Category', 'Multiplier', 'Reason', 'Status', 'Starts', 'Ends', ''].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {surges.map(s => (
                <tr key={s.id} className="cursor-default">
                  <td className="font-medium text-text-primary">{s.city_name}</td>
                  <td>{s.category_name ?? 'All'}</td>
                  <td>
                    <span className="font-mono font-bold text-warning">{parseFloat(s.multiplier).toFixed(2)}×</span>
                  </td>
                  <td className="max-w-[160px] truncate">{s.reason ?? '—'}</td>
                  <td>
                    <span className={SURGE_STATUS_CLS[s.status] ?? 'pill-muted'}>
                      {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                    </span>
                  </td>
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

      {/* Rate change history (collapsible) */}
      <div className="admin-card !p-0 overflow-hidden">
        <button
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-2 transition-colors text-left"
          onClick={() => { setHistoryOpen(h => !h); if (!historyOpen) loadHistory() }}
        >
          <div className="flex items-center gap-2.5">
            <History size={15} className="text-text-muted" />
            <span className="text-sm font-semibold text-text-primary">Rate Change History</span>
          </div>
          {historyOpen
            ? <ChevronUp size={16} className="text-text-muted" />
            : <ChevronDown size={16} className="text-text-muted" />}
        </button>
        {historyOpen && (
          historyLoading ? (
            <div className="border-t border-border">
              <table className="data-table"><tbody><SkeletonRows cols={5} n={4} /></tbody></table>
            </div>
          ) : history.length === 0 ? (
            <p className="border-t border-border px-5 py-8 text-center text-text-muted text-sm">
              No rate changes recorded yet.
            </p>
          ) : (
            <div className="border-t border-border">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Ride Type</th>
                    <th>Per KM</th>
                    <th>Reason</th>
                    <th>Changed</th>
                  </tr>
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
  )
}

// Inline ride type badge — avoids shared StatusPill for ride type display in table context
function StatusPillRideType({ type }: { type: string }) {
  const cls = type === 'one_way' ? 'pill-info' : type === 'round_trip' ? 'pill-purple' : 'pill-muted'
  return <span className={cls}>{RIDE_TYPE_LABEL[type] ?? type}</span>
}
