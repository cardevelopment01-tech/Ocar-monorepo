'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Tag, Pencil, Zap, AlertTriangle, History, Package, Plus, Globe, Clock } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence } from 'framer-motion'
import { pricingApi, type RateCard, type SurgeEvent, type RateCardHistoryRow } from '@/lib/pricing-api'
import { cityApi, type AdminCity } from '@/lib/city-api'
import { SkeletonRows, inputCls, labelCls } from './shared'
import RentalPackagesTab from './RentalPackagesTab'
import SuccessToast from '@/components/ui/SuccessToast'
import SlideOver from '@/components/ui/SlideOver'

// ── Shared helpers ─────────────────────────────────────────────────────────────

const RIDE_TYPE_LABEL: Record<string, string> = {
  one_way: 'One Way', round_trip: 'Round Trip', rental: 'Rental',
}

const SURGE_STATUS_CLS: Record<string, string> = {
  scheduled: 'pill-info', active: 'pill-warning',
  expired:   'pill-muted', cancelled: 'pill-danger',
}

const CATEGORY_ORDER_ITEMS = ['hatchback', 'sedan', 'suv', 'luxury', 'van', 'auto_rickshaw']
const RIDE_TYPE_ORDER = ['one_way', 'round_trip', 'rental']

function fmt(v: string | null): string {
  return v ? `₹${parseFloat(v).toFixed(2)}` : '—'
}

function diffRateVsGlobal(city: RateCard, global: RateCard): { text: string; up: boolean } | null {
  const delta = parseFloat(city.rate_per_km) - parseFloat(global.rate_per_km)
  if (Math.abs(delta) < 0.005) return null
  const sign = delta > 0 ? '+' : '−'
  return { text: `${sign}₹${Math.abs(delta).toFixed(2)}/km vs global`, up: delta > 0 }
}

// ── Effective-row model: resolves each city view to global + override rows ─────

interface EffectiveRow {
  card: RateCard
  globalCard: RateCard
  isOverride: boolean
  isInherited: boolean
}

function buildEffectiveRows(cards: RateCard[], selectedCityId: number | null): Record<string, EffectiveRow[]> {
  const bySlug: Record<string, RateCard[]> = {}
  for (const c of cards) (bySlug[c.category_slug] ??= []).push(c)

  const result: Record<string, EffectiveRow[]> = {}
  for (const slug of CATEGORY_ORDER_ITEMS) {
    const rows = bySlug[slug] ?? []
    const globalRows = rows
      .filter(c => c.city_id === null)
      .sort((a, b) => RIDE_TYPE_ORDER.indexOf(a.ride_type) - RIDE_TYPE_ORDER.indexOf(b.ride_type))
    if (!globalRows.length) continue

    if (selectedCityId === null) {
      result[slug] = globalRows.map(card => ({ card, globalCard: card, isOverride: false, isInherited: false }))
    } else {
      const cityRows = rows.filter(c => c.city_id === selectedCityId)
      result[slug] = globalRows.map(globalCard => {
        const override = cityRows.find(c => c.ride_type === globalCard.ride_type)
        return override
          ? { card: override, globalCard, isOverride: true, isInherited: false }
          : { card: globalCard, globalCard, isOverride: false, isInherited: true }
      })
    }
  }
  return result
}

// ── Rate card dialog (also used as "+ Override" when defaultCityId is passed) ──

function UpdateRateDialog({
  card, cities, onUpdated, defaultCityId, trigger,
}: {
  card: RateCard
  cities: AdminCity[]
  onUpdated: () => void
  defaultCityId?: number | null
  trigger?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const initialCityId = defaultCityId !== undefined ? defaultCityId : card.city_id
  const [form, setForm] = useState({
    city_id: initialCityId !== null ? String(initialCityId) : '',
    rate_per_km: card.rate_per_km, rate_per_min: card.rate_per_min, min_fare: card.min_fare,
    return_rate_per_km: card.return_rate_per_km ?? '', hour_rate: card.hour_rate ?? '',
    km_per_day: card.km_per_day ?? '', driver_allowance_per_day: card.driver_allowance_per_day ?? '', notes: '',
  })

  useEffect(() => {
    if (open) {
      setForm({
        city_id: initialCityId !== null ? String(initialCityId) : '',
        rate_per_km: card.rate_per_km, rate_per_min: card.rate_per_min, min_fare: card.min_fare,
        return_rate_per_km: card.return_rate_per_km ?? '', hour_rate: card.hour_rate ?? '',
        km_per_day: card.km_per_day ?? '', driver_allowance_per_day: card.driver_allowance_per_day ?? '', notes: '',
      })
      setError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        {trigger ?? (
          <button className="p-1.5 text-text-muted hover:text-primary hover:bg-primary-light rounded-lg transition-colors" title="Update rate" aria-label="Update rate">
            <Pencil size={13} />
          </button>
        )}
      </Dialog.Trigger>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="fixed left-1/2 top-1/2 w-full max-w-[480px] max-h-[90vh] overflow-y-auto bg-surface rounded-2xl shadow-hover p-6 z-[60]"
                initial={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%' }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              >
          <Dialog.Title className="text-lg font-bold text-text-primary mb-1">
            {defaultCityId !== undefined && defaultCityId !== null ? 'Override ' : 'Update '}
            {card.category_name} · {RIDE_TYPE_LABEL[card.ride_type]}
          </Dialog.Title>
          <Dialog.Description className="text-xs text-warning bg-warning-light border border-warning/20 rounded-xl px-3 py-2 mb-5">
            {cityChanged
              ? `You're creating/updating ${selectedCityName}'s rate. ${originalCityName}'s current rate for this row is unaffected.`
              : 'Creates a new rate card and expires the current one. All future rides use the new rate.'}
          </Dialog.Description>
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
                  onChange={e => setForm(f => ({ ...f, rate_per_km: e.target.value }))} className={`${inputCls} font-mono`} />
                <p className="text-xs text-text-muted mt-1">was {fmt(card.rate_per_km)}</p>
              </div>
              <div>
                <label className={labelCls}>Per Min (₹)</label>
                <input type="number" step="0.01" value={form.rate_per_min}
                  onChange={e => setForm(f => ({ ...f, rate_per_min: e.target.value }))} className={`${inputCls} font-mono`} />
                <p className="text-xs text-text-muted mt-1">was {fmt(card.rate_per_min)}</p>
              </div>
              <div>
                <label className={labelCls}>Min Fare (₹)</label>
                <input type="number" step="0.01" value={form.min_fare}
                  onChange={e => setForm(f => ({ ...f, min_fare: e.target.value }))} className={`${inputCls} font-mono`} />
                <p className="text-xs text-text-muted mt-1">was {fmt(card.min_fare)}</p>
              </div>
            </div>
            {card.ride_type === 'one_way' && (
              <div>
                <label className={labelCls}>Return Cab Rate /km (₹)</label>
                <input type="number" step="0.01" value={form.return_rate_per_km}
                  onChange={e => setForm(f => ({ ...f, return_rate_per_km: e.target.value }))}
                  className="w-40 border border-border rounded-xl px-3 py-2 text-sm font-mono text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted"
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
                    className={`${inputCls} font-mono`} placeholder="e.g. 250" />
                  <p className="text-xs text-text-muted mt-1">was {card.km_per_day ?? '—'}</p>
                </div>
                <div>
                  <label className={labelCls}>Driver Allowance/day (₹)</label>
                  <input type="number" step="0.01" value={form.driver_allowance_per_day}
                    onChange={e => setForm(f => ({ ...f, driver_allowance_per_day: e.target.value }))}
                    className={`${inputCls} font-mono`} placeholder="e.g. 300" />
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
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
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
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="fixed left-1/2 top-1/2 w-full max-w-[480px] max-h-[90vh] overflow-y-auto bg-surface rounded-2xl shadow-hover p-6 z-[60]"
                initial={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%' }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              >
          <Dialog.Title className="text-lg font-bold text-text-primary mb-1">Schedule Surge Event</Dialog.Title>
          <Dialog.Description className="text-xs text-text-muted mb-5">
            Multiplies fares for the selected city and window. Existing rides in progress are unaffected.
          </Dialog.Description>
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
                <span className="text-warning font-semibold font-mono">{mult.toFixed(2)}× · fares {pct}% higher</span>
              </label>
              <div className="flex items-center gap-3">
                <input type="range" min="1.0" max="5.0" step="0.1" value={form.multiplier}
                  onChange={e => set('multiplier', e.target.value)} className="flex-1 accent-warning" />
                <input type="number" min="1.0" max="5.0" step="0.1" value={form.multiplier}
                  onChange={e => set('multiplier', e.target.value)}
                  className="w-20 border border-border rounded-xl px-3 py-2 text-sm font-mono text-text-primary bg-surface-2 text-center focus:outline-none focus:ring-2 focus:ring-primary/30" />
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
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}

// ── Inline ride-type badge ─────────────────────────────────────────────────────

function StatusPillRideType({ type }: { type: string }) {
  const cls = type === 'one_way' ? 'pill-info' : type === 'round_trip' ? 'pill-purple' : 'pill-muted'
  return <span className={cls}>{RIDE_TYPE_LABEL[type] ?? type}</span>
}

// ── City pill bar ─────────────────────────────────────────────────────────────
// A horizontal, single-row switcher instead of a tall vertical rail: every city
// (+ its override count) stays visible at a glance without needing `sticky`
// positioning to survive scrolling past a tall category table.

function CityPillBar({
  cities, cards, selectedCityId, onSelect,
}: {
  cities: AdminCity[]
  cards: RateCard[]
  selectedCityId: number | null
  onSelect: (id: number | null) => void
}) {
  const globalCount = cards.filter(c => c.city_id === null).length
  return (
    <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-bg/95 backdrop-blur-sm">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => onSelect(null)}
          className={`flex-shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
            selectedCityId === null ? 'bg-primary text-white shadow-sm' : 'bg-surface border border-border text-text-secondary hover:bg-surface-2'
          }`}
        >
          Global Defaults
          <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-full ${selectedCityId === null ? 'bg-white/20 text-white' : 'bg-surface-3 text-text-secondary'}`}>
            {globalCount}
          </span>
        </button>
        <div className="w-px h-5 bg-border-light flex-shrink-0" />
        {cities.filter(c => c.status === 'active').map(city => {
          const count = cards.filter(c => c.city_id === city.id).length
          const active = selectedCityId === city.id
          return (
            <button
              key={city.id}
              onClick={() => onSelect(city.id)}
              className={`flex-shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
                active ? 'bg-primary text-white shadow-sm' : 'bg-surface border border-border text-text-secondary hover:bg-surface-2'
              }`}
            >
              {city.name}
              <span className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : count > 0 ? 'bg-primary-light text-primary' : 'bg-surface-3 text-text-muted opacity-60'}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── History drawer content ────────────────────────────────────────────────────

function HistoryDrawerBody({ rows }: { rows: RateCardHistoryRow[] }) {
  if (!rows.length) return <p className="px-6 py-10 text-center text-text-muted text-sm">No changes recorded yet.</p>
  return (
    <div className="px-6 py-5 space-y-0">
      {rows.map((h, i) => (
        <div key={h.id} className={`relative pl-5 ${i === rows.length - 1 ? 'pb-0' : 'pb-5'} border-l-2 border-border-light`}>
          <span className={`absolute -left-[5px] top-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface ${i === 0 ? 'bg-primary shadow-[0_0_0_3px_theme(colors.primary-light)]' : 'bg-text-muted'}`} />
          <p className="text-[11px] text-text-muted font-medium mb-1">
            {new Date(h.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className="text-[12.5px] font-bold text-text-primary mb-1.5">
            {h.change_reason ? `"${h.change_reason}"` : 'Rate card created'}
          </p>
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <span className="w-14">Per KM</span>
            <span className="font-mono font-bold text-primary">{fmt(h.rate_per_km)}</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-text-muted mt-0.5">
            <span>{h.category_name} · {RIDE_TYPE_LABEL[h.ride_type] ?? h.ride_type} · {h.city_name ?? 'Global'}</span>
          </div>
        </div>
      ))}
    </div>
  )
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

  const [cards,   setCards]   = useState<RateCard[]>([])
  const [surges,  setSurges]  = useState<SurgeEvent[]>([])
  const [cities,  setCities]  = useState<AdminCity[]>([])
  const [history, setHistory] = useState<RateCardHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [retry,   setRetry]   = useState(0)
  const [selectedCityId, setSelectedCityId] = useState<number | null>(null)
  const [drawer,      setDrawer]      = useState<{ open: boolean; title: string; subtitle: string; rows: RateCardHistoryRow[] }>({ open: false, title: '', subtitle: '', rows: [] })
  const [successMsg,  setSuccessMsg]  = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [c, s, ci, h] = await Promise.all([
        pricingApi.getRateCards(), pricingApi.getSurgeEvents(), cityApi.list(), pricingApi.getRateCardHistory(),
      ])
      setCards(c); setSurges(s); setCities(ci); setHistory(h)
    } catch { setError('Failed to load pricing data.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll, retry])

  useEffect(() => {
    if (selectedCityId !== null && !cities.some(c => c.id === selectedCityId)) setSelectedCityId(null)
  }, [cities, selectedCityId])

  async function cancelSurge(id: number) {
    try { await pricingApi.cancelSurgeEvent(id); void fetchAll() }
    catch { /* silent */ }
  }

  function openRowHistory(card: RateCard) {
    const rows = history.filter(h => h.category_name === card.category_name && h.ride_type === card.ride_type && h.city_id === card.city_id)
    setDrawer({
      open: true,
      title: `${card.category_name} · ${RIDE_TYPE_LABEL[card.ride_type]}`,
      subtitle: `${card.city_name ?? 'Global default'} · rate history, newest first`,
      rows,
    })
  }
  function openAllHistory() {
    setDrawer({ open: true, title: 'All rate changes', subtitle: 'Every city, every category — newest first', rows: history })
  }

  const categoryOptions = useMemo(
    () => [...new Map(cards.map(c => [c.category_id, { id: c.category_id, slug: c.category_slug, display_name: c.category_name }])).values()],
    [cards],
  )
  const activeSurges = surges.filter(s => s.status === 'active')
  const configuredCategories = new Set(cards.map(c => c.category_id)).size
  const citiesWithOverrides = cities.filter(city => cards.some(c => c.city_id === city.id)).length

  const grouped = useMemo(() => buildEffectiveRows(cards, selectedCityId), [cards, selectedCityId])
  const selectedCity = selectedCityId !== null ? cities.find(c => c.id === selectedCityId) ?? null : null

  return (
    <div className="space-y-5">
      <SuccessToast message={successMsg} onDismiss={() => setSuccessMsg(null)} />

      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-light to-primary/20 flex items-center justify-center">
            <Tag size={20} className="text-primary-dark" />
          </div>
          <div>
            <h1 className="page-title">Pricing</h1>
            <p className="page-subtitle">Rate cards, surge events, and rental packages — organized city-first</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {activeTab === 'rate_cards' && (
            <button
              onClick={openAllHistory}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface border border-border text-text-secondary text-sm font-semibold hover:bg-surface-2 hover:text-text-primary transition-all duration-150"
            >
              <History size={14} />All changes
            </button>
          )}
          {activeTab === 'rate_cards' && selectedCityId === null && (
            <CreateRateCardDialog cities={cities} categories={categoryOptions} onCreated={() => { fetchAll(); setSuccessMsg('Rate card created') }} />
          )}
        </div>
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
                <p className="text-2xl font-bold text-text-primary font-mono">{loading ? '—' : cards.length}</p>
                <p className="text-xs text-text-muted mt-0.5">Active rate cards</p>
              </div>
            </div>
            <div className="admin-card flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-success-light flex items-center justify-center flex-shrink-0">
                <Globe size={18} className="text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary font-mono">{loading ? '—' : citiesWithOverrides}</p>
                <p className="text-xs text-text-muted mt-0.5">Cities with overrides · {configuredCategories} categories</p>
              </div>
            </div>
            <div className={`admin-card flex items-center gap-4 ${activeSurges.length > 0 ? 'ring-1 ring-warning/30' : ''}`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${activeSurges.length > 0 ? 'bg-warning-light' : 'bg-surface-2'}`}>
                <Zap size={18} className={activeSurges.length > 0 ? 'text-warning' : 'text-text-muted'} />
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary font-mono">{loading ? '—' : activeSurges.length}</p>
                <p className="text-xs text-text-muted mt-0.5">Active surge events</p>
              </div>
            </div>
          </div>

          {error ? (
            <div className="admin-card text-center py-8">
              <p className="text-text-muted mb-3">{error}</p>
              <button onClick={() => setRetry(r => r + 1)} className="btn-secondary">Retry</button>
            </div>
          ) : loading ? (
            <div className="space-y-4">
              <div className="admin-card !p-3 h-12" />
              <div className="admin-card !p-0 overflow-hidden">
                <table className="data-table"><tbody><SkeletonRows cols={6} n={6} /></tbody></table>
              </div>
            </div>
          ) : cards.length === 0 ? (
            <div className="admin-card text-center py-8 text-text-muted text-sm">No rate cards configured yet.</div>
          ) : (
            <div className="space-y-4">
              <CityPillBar cities={cities} cards={cards} selectedCityId={selectedCityId} onSelect={setSelectedCityId} />

              <div className="space-y-4">
                {Object.keys(grouped).length === 0 ? (
                  <div className="admin-card text-center py-8 text-text-muted text-sm">
                    No rate cards for {selectedCity ? selectedCity.name : 'this view'}.
                  </div>
                ) : (
                  CATEGORY_ORDER_ITEMS.map(slug => {
                    const rows = grouped[slug]
                    if (!rows?.length) return null
                    const catName = rows[0]?.card.category_name ?? slug
                    return (
                      <div key={slug} className="admin-card !p-0 overflow-hidden">
                        <div className="px-5 py-3.5 border-b border-border bg-surface-2 flex items-center gap-2.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                          <h3 className="text-sm font-semibold text-text-primary">{catName}</h3>
                          <span className="ml-auto text-xs text-text-muted">{rows.length} ride type{rows.length > 1 ? 's' : ''}</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Ride Type</th>
                                <th className="!text-right">Per KM</th>
                                <th className="!text-right">Per Min</th>
                                <th className="!text-right">Min Fare</th>
                                <th></th>
                                <th className="!text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map(({ card, globalCard, isOverride, isInherited }) => {
                                const diff = isOverride ? diffRateVsGlobal(card, globalCard) : null
                                const rowHistoryCount = history.filter(h => h.category_name === card.category_name && h.ride_type === card.ride_type && h.city_id === card.city_id).length
                                return (
                                  <tr key={`${card.category_id}-${card.ride_type}-${card.city_id ?? 'g'}`} className={`cursor-default ${isInherited ? 'opacity-60' : ''}`}>
                                    <td>
                                      <StatusPillRideType type={card.ride_type} />
                                      <span className={`ml-2 ${isOverride ? 'pill-info' : 'pill-muted'}`}>
                                        {isOverride ? 'City override' : isInherited ? 'Inherited' : 'Global'}
                                      </span>
                                      {!isInherited && (
                                        <button
                                          onClick={() => openRowHistory(card)}
                                          className="flex items-center gap-1 mt-1.5 text-[11px] font-bold text-primary-dark hover:text-primary hover:underline"
                                        >
                                          <Clock size={11} />{rowHistoryCount} change{rowHistoryCount === 1 ? '' : 's'}
                                        </button>
                                      )}
                                    </td>
                                    <td className="!text-right font-mono font-semibold text-text-primary">
                                      {fmt(card.rate_per_km)}
                                      {card.ride_type === 'one_way' && (
                                        <span className="block text-[11px] font-sans font-medium text-text-muted mt-0.5">Return {fmt(card.return_rate_per_km)}/km</span>
                                      )}
                                      {card.ride_type === 'round_trip' && (
                                        <span className="block text-[11px] font-sans font-medium text-text-muted mt-0.5">{card.km_per_day ?? '—'} km/day · {fmt(card.driver_allowance_per_day)} allowance</span>
                                      )}
                                    </td>
                                    <td className="!text-right font-mono">{fmt(card.rate_per_min)}</td>
                                    <td className="!text-right font-mono font-semibold text-text-primary">{fmt(card.min_fare)}</td>
                                    <td className="!text-right">
                                      {diff && (
                                        <span className={`text-[11px] font-mono font-semibold ${diff.up ? 'text-warning' : 'text-success'}`}>{diff.text}</span>
                                      )}
                                    </td>
                                    <td className="!text-right">
                                      {isInherited ? (
                                        <UpdateRateDialog
                                          card={globalCard} cities={cities} defaultCityId={selectedCityId}
                                          onUpdated={() => { fetchAll(); setSuccessMsg('Override created') }}
                                          trigger={
                                            <button className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-success-light text-success text-xs font-semibold hover:bg-success/10 transition-colors">
                                              <Plus size={12} />Override
                                            </button>
                                          }
                                        />
                                      ) : (
                                        <UpdateRateDialog card={card} cities={cities} onUpdated={() => { fetchAll(); setSuccessMsg('Rate updated') }} />
                                      )}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Surge Events tab ──────────────────────────────────────────────── */}
      {activeTab === 'surge' && (
        <div className="space-y-5">
          <div className="flex justify-end">
            <CreateSurgeDialog cities={cities} categories={categoryOptions} onCreated={() => { fetchAll(); setSuccessMsg('Surge event scheduled') }} />
          </div>
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
              <div className="overflow-x-auto">
                <table className="data-table min-w-[800px]">
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
                        <td className="text-xs font-mono">{new Date(s.starts_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="text-xs font-mono">{new Date(s.ends_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
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
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'rental' && (
        <RentalPackagesTab cities={cities} categoryOptions={categoryOptions} />
      )}

      <SlideOver isOpen={drawer.open} onClose={() => setDrawer(d => ({ ...d, open: false }))} title={drawer.title} width="md">
        <p className="px-6 pt-4 pb-1 text-xs text-text-muted">{drawer.subtitle}</p>
        <HistoryDrawerBody rows={drawer.rows} />
      </SlideOver>
    </div>
  )
}

// ── Create city rate-card dialog ──────────────────────────────────────────────

function CreateRateCardDialog({
  cities, categories, onCreated,
}: {
  cities: AdminCity[]
  categories: { id: number; slug: string; display_name: string }[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    city_id: '', category_id: '', ride_type: 'one_way',
    rate_per_km: '', rate_per_min: '', min_fare: '',
    return_rate_per_km: '', hour_rate: '', km_per_day: '', driver_allowance_per_day: '', notes: '',
  })

  useEffect(() => {
    if (open) {
      setForm({
        city_id: '', category_id: '', ride_type: 'one_way',
        rate_per_km: '', rate_per_min: '', min_fare: '',
        return_rate_per_km: '', hour_rate: '', km_per_day: '', driver_allowance_per_day: '', notes: '',
      })
      setError('')
    }
  }, [open])

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.city_id || !form.category_id) { setError('City and category are required'); return }
    if (!form.notes.trim()) { setError('Change reason is required'); return }
    setLoading(true); setError('')
    try {
      await pricingApi.createRateCard({
        category_id: parseInt(form.category_id, 10), ride_type: form.ride_type,
        city_id: parseInt(form.city_id, 10),
        rate_per_km: parseFloat(form.rate_per_km), rate_per_min: parseFloat(form.rate_per_min),
        min_fare: parseFloat(form.min_fare),
        return_rate_per_km: form.return_rate_per_km ? parseFloat(form.return_rate_per_km) : null,
        hour_rate: form.hour_rate ? parseFloat(form.hour_rate) : null,
        km_per_day: form.km_per_day ? parseFloat(form.km_per_day) : null,
        driver_allowance_per_day: form.driver_allowance_per_day ? parseFloat(form.driver_allowance_per_day) : null,
        notes: form.notes,
      })
      setOpen(false); onCreated()
    } catch { setError('Failed to create rate card.') }
    finally { setLoading(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-light border border-primary/20 text-primary text-sm font-semibold hover:bg-primary/10 transition-all duration-150">
          <Plus size={14} />Add City Rate
        </button>
      </Dialog.Trigger>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="fixed left-1/2 top-1/2 w-full max-w-[480px] max-h-[90vh] overflow-y-auto bg-surface rounded-2xl shadow-hover p-6 z-[60]"
                initial={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%' }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              >
          <Dialog.Title className="text-lg font-bold text-text-primary mb-1">Add City Rate Override</Dialog.Title>
          <Dialog.Description className="text-xs text-text-muted mb-5">
            Creates a city-specific rate that takes priority over the global default for that city only.
          </Dialog.Description>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
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
                <label className={labelCls}>Category *</label>
                <select value={form.category_id} onChange={e => set('category_id', e.target.value)} required className={inputCls}>
                  <option value="">Select…</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>Ride Type *</label>
              <select value={form.ride_type} onChange={e => set('ride_type', e.target.value)} className={inputCls}>
                <option value="one_way">One Way</option>
                <option value="round_trip">Round Trip</option>
                <option value="rental">Rental</option>
              </select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Per KM (₹) *</label>
                <input type="number" step="0.01" min="0.01" required value={form.rate_per_km}
                  onChange={e => set('rate_per_km', e.target.value)} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className={labelCls}>Per Min (₹) *</label>
                <input type="number" step="0.01" min="0" required value={form.rate_per_min}
                  onChange={e => set('rate_per_min', e.target.value)} className={`${inputCls} font-mono`} />
              </div>
              <div>
                <label className={labelCls}>Min Fare (₹) *</label>
                <input type="number" step="0.01" min="0.01" required value={form.min_fare}
                  onChange={e => set('min_fare', e.target.value)} className={`${inputCls} font-mono`} />
              </div>
            </div>
            {form.ride_type === 'one_way' && (
              <div>
                <label className={labelCls}>Return Cab Rate /km (₹)</label>
                <input type="number" step="0.01" value={form.return_rate_per_km}
                  onChange={e => set('return_rate_per_km', e.target.value)} className={`${inputCls} font-mono`} placeholder="optional" />
              </div>
            )}
            {form.ride_type === 'round_trip' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Package KM/day</label>
                  <input type="number" step="1" value={form.km_per_day}
                    onChange={e => set('km_per_day', e.target.value)} className={`${inputCls} font-mono`} placeholder="e.g. 250" />
                </div>
                <div>
                  <label className={labelCls}>Driver Allowance/day (₹)</label>
                  <input type="number" step="0.01" value={form.driver_allowance_per_day}
                    onChange={e => set('driver_allowance_per_day', e.target.value)} className={`${inputCls} font-mono`} placeholder="e.g. 300" />
                </div>
              </div>
            )}
            <div>
              <label className={labelCls}>Change Reason *</label>
              <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
                className={`${inputCls} resize-none`} placeholder="e.g. Puri festival-season pricing" />
            </div>
            {error && <p className="text-xs text-danger font-semibold">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="btn-secondary flex-1 justify-center">Cancel</button>
              </Dialog.Close>
              <button type="submit" disabled={loading}
                className="btn-primary flex-1 justify-center disabled:opacity-50 disabled:pointer-events-none">
                {loading ? 'Creating…' : 'Create Override'}
              </button>
            </div>
          </form>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
