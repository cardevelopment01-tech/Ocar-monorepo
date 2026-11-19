'use client'
import { useMemo, useState } from 'react'
import { Zap, Clock, MapPin, Plus, X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { pricingApi, type SurgeEvent } from '@/lib/pricing-api'
import type { AdminCity } from '@/lib/city-api'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { surgeState, surgePct, fareAfterSurge, formatDuration, presetWindow, windowLabel, type SurgeState } from '@/lib/surge-model'
import { useNow } from '@/lib/use-now'
import { inputCls, labelCls } from './shared'

type Category = { id: number; slug: string; display_name: string }

const MULTIPLIERS = [1.25, 1.5, 2, 2.5]
const DURATIONS: { label: string; hours: number }[] = [
  { label: '1 h', hours: 1 }, { label: '2 h', hours: 2 }, { label: '4 h', hours: 4 }, { label: '8 h', hours: 8 }, { label: '24 h', hours: 24 },
]
const REASONS = ['Heavy rain', 'Festival', 'Peak hours', 'Event']
const SAMPLE_FARE = 500
const ALL_CITIES = 'all'
const tzName = new Intl.DateTimeFormat('en-IN', { timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value ?? 'local'

function chip(active: boolean): string {
  return `px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors duration-150 ${
    active ? 'bg-primary-light border-primary text-primary-dark' : 'bg-surface border-border text-text-secondary hover:border-primary/40'}`
}

// ── Schedule dialog ───────────────────────────────────────────────────────────

function newForm() {
  return { city_id: '', category_id: '', multiplier: 1.5, reason: '', ...presetWindow(new Date(), 4) }
}
type FormState = ReturnType<typeof newForm>

function ScheduleSurgeDialog({ cities, categories, onCreated }: { cities: AdminCity[]; categories: Category[]; onCreated: () => void }) {
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hours, setHours] = useState<number | null>(4)
  const [form, setForm] = useState<FormState>(newForm)

  function set<K extends keyof FormState>(k: K, v: FormState[K]) { setForm(f => ({ ...f, [k]: v })) }
  function pickDuration(h: number) { setHours(h); setForm(f => ({ ...f, ...presetWindow(new Date(), h) })) }
  function openChange(v: boolean) { setOpen(v); if (v) { setForm(newForm()); setHours(4); setError('') } }

  const formStartMs = new Date(form.starts_at).getTime()
  const formEndMs = new Date(form.ends_at).getTime()
  const timesOk = !Number.isNaN(formStartMs) && !Number.isNaN(formEndMs) && formEndMs > formStartMs
  const allCities = form.city_id === ALL_CITIES
  const cityName = allCities ? 'all cities' : cities.find(c => String(c.id) === form.city_id)?.name
  const catName = categories.find(c => String(c.id) === form.category_id)?.display_name
  const summary = cityName && timesOk
    ? `${form.multiplier.toFixed(2)}× on ${catName ?? 'all categories'} in ${cityName}${allCities ? ' (a city with its own surge keeps that one)' : ''}, ${windowLabel(new Date(formStartMs).toISOString(), new Date(formEndMs).toISOString(), new Date())} (${formatDuration(formEndMs - formStartMs)})`
    : null

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    // A duration chip means "starts now": take the clock at submit, not when the dialog was opened.
    const fresh = hours !== null ? presetWindow(new Date(), hours) : null
    const startMs = new Date(fresh?.starts_at ?? form.starts_at).getTime()
    const endMs = new Date(fresh?.ends_at ?? form.ends_at).getTime()
    if (!Number.isNaN(endMs) && endMs <= Date.now()) { setError('That window has already ended. Pick a later end time.'); return }
    if (!fresh && !timesOk) { setError(Number.isNaN(startMs) || Number.isNaN(endMs) ? 'Enter a start and end time.' : 'End time must be after the start time.'); return }
    setLoading(true)
    try {
      await pricingApi.createSurgeEvent({
        city_id:     allCities ? null : parseInt(form.city_id, 10),
        category_id: form.category_id ? parseInt(form.category_id, 10) : null,
        multiplier:  form.multiplier,
        reason:      form.reason.trim() || undefined,
        // datetime-local has no zone; the server stores UTC, so send the admin's local time as an absolute instant.
        starts_at:   new Date(startMs).toISOString(),
        ends_at:     new Date(endMs).toISOString(),
      })
      setOpen(false)
      onCreated()
    } catch { setError('Could not schedule the surge. Check the details and try again.') }
    finally { setLoading(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={openChange}>
      <Dialog.Trigger asChild>
        <button className="btn-primary"><Plus size={15} />Schedule surge</button>
      </Dialog.Trigger>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.2 }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="fixed left-1/2 top-1/2 w-full max-w-[520px] max-h-[92vh] overflow-y-auto bg-surface rounded-2xl shadow-hover z-[60]"
                initial={{ opacity: 0, scale: 0.97, x: '-50%', y: '-50%' }} animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={{ opacity: 0, scale: 0.97, x: '-50%', y: '-50%' }}
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }}>
                <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-border">
                  <div>
                    <Dialog.Title className="text-base font-bold text-text-primary">Schedule a surge</Dialog.Title>
                    <Dialog.Description className="text-xs text-text-muted mt-0.5">Raises fares in one city, or in every city, for a set window. Rides already booked keep their price.</Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button type="button" aria-label="Close" className="p-1.5 -m-1.5 rounded-lg text-text-muted hover:bg-surface-2"><X size={16} /></button>
                  </Dialog.Close>
                </div>

                <form onSubmit={submit} className="px-6 py-5 space-y-6">
                  {/* Where */}
                  <section className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelCls} htmlFor="surge-city">City</label>
                      <select id="surge-city" value={form.city_id} onChange={e => set('city_id', e.target.value)} required className={inputCls}>
                        <option value="">Select a city</option>
                        <option value={ALL_CITIES}>All cities (default)</option>
                        {cities.filter(c => c.status === 'active').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="surge-cat">Category</label>
                      <select id="surge-cat" value={form.category_id} onChange={e => set('category_id', e.target.value)} className={inputCls}>
                        <option value="">All categories</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
                      </select>
                    </div>
                  </section>
                  <p className="text-[11px] text-text-muted -mt-4">A surge for one city overrides the all-cities surge there. Use 1.00× to exempt a city.</p>

                  {/* How much */}
                  <section>
                    <div className="flex items-baseline justify-between mb-2">
                      <span className={labelCls + ' !mb-0'}>Multiplier</span>
                      <span className="text-xs text-text-muted tabular-nums">A ₹{SAMPLE_FARE} fare becomes <span className="font-semibold text-text-primary">₹{fareAfterSurge(SAMPLE_FARE, form.multiplier)}</span></span>
                    </div>
                    <div className="flex items-center gap-4 rounded-xl bg-surface-2 px-4 py-3">
                      <div className="w-24 shrink-0">
                        <div className="text-3xl font-bold font-mono tabular-nums text-text-primary leading-none">{form.multiplier.toFixed(2)}×</div>
                        <div className="text-xs font-semibold text-warning mt-1">+{surgePct(form.multiplier)}% on fares</div>
                      </div>
                      <input type="range" min="1.05" max="5" step="0.05" value={form.multiplier} aria-label="Multiplier"
                        onChange={e => set('multiplier', parseFloat(e.target.value))} className="flex-1 accent-warning" />
                      <input type="number" min="1" max="5" step="0.05" value={form.multiplier} aria-label="Multiplier value"
                        onChange={e => { const v = parseFloat(e.target.value); if (!Number.isNaN(v)) set('multiplier', Math.min(5, Math.max(1, v))) }}
                        className="w-[4.5rem] border border-border rounded-xl px-2 py-1.5 text-sm font-mono tabular-nums text-center bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    </div>
                    <div className="flex gap-2 mt-2.5 flex-wrap">
                      {MULTIPLIERS.map(m => (
                        <button key={m} type="button" onClick={() => set('multiplier', m)} className={chip(form.multiplier === m)}>{m}×</button>
                      ))}
                    </div>
                  </section>

                  {/* When */}
                  <section>
                    <span className={labelCls}>Starts now and runs for</span>
                    <div className="flex gap-2 flex-wrap">
                      {DURATIONS.map(d => (
                        <button key={d.hours} type="button" onClick={() => pickDuration(d.hours)} className={chip(hours === d.hours)}>{d.label}</button>
                      ))}
                      <button type="button" onClick={() => setHours(null)} className={chip(hours === null)}>Custom</button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-3">
                      <div>
                        <label className={labelCls} htmlFor="surge-start">Starts</label>
                        <input id="surge-start" type="datetime-local" value={form.starts_at} required className={inputCls}
                          onChange={e => { setHours(null); set('starts_at', e.target.value) }} />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor="surge-end">Ends</label>
                        <input id="surge-end" type="datetime-local" value={form.ends_at} required className={inputCls}
                          onChange={e => { setHours(null); set('ends_at', e.target.value) }} />
                      </div>
                    </div>
                    <p className="text-[11px] text-text-muted mt-1.5">Times are in your local time ({tzName}).</p>
                  </section>

                  {/* Why */}
                  <section>
                    <label className={labelCls} htmlFor="surge-reason">Reason <span className="font-normal">(optional, internal)</span></label>
                    <input id="surge-reason" value={form.reason} onChange={e => set('reason', e.target.value)} maxLength={120} className={inputCls} placeholder="Why is demand up?" />
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {REASONS.map(r => <button key={r} type="button" onClick={() => set('reason', r)} className={chip(form.reason === r)}>{r}</button>)}
                    </div>
                  </section>

                  {/* Confirm */}
                  <div className="rounded-xl border border-border px-4 py-3 text-sm text-text-secondary min-h-[3.25rem] flex items-center">
                    {summary ?? 'Pick a city to see what this surge will do.'}
                  </div>
                  {error && <p role="alert" className="text-xs text-danger font-semibold -mt-3">{error}</p>}
                  <div className="flex gap-3">
                    <Dialog.Close asChild><button type="button" className="btn-secondary flex-1 justify-center">Cancel</button></Dialog.Close>
                    <button type="submit" disabled={loading || !form.city_id} className="btn-primary flex-1 justify-center disabled:opacity-50 disabled:pointer-events-none">
                      {loading ? 'Scheduling…' : 'Schedule surge'}
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

// ── List ──────────────────────────────────────────────────────────────────────

const STATE_PILL: Record<SurgeState, { cls: string; label: string }> = {
  live:      { cls: 'pill-warning', label: 'Live' },
  upcoming:  { cls: 'pill-info',    label: 'Upcoming' },
  ended:     { cls: 'pill-muted',   label: 'Ended' },
  cancelled: { cls: 'pill-muted',   label: 'Cancelled' },
}

function SurgeRow({ s, now, onCancel }: { s: SurgeEvent; now: number; onCancel: (s: SurgeEvent) => void }) {
  const state = surgeState(s, now)
  const mult = parseFloat(s.multiplier)
  const muted = state === 'ended' || state === 'cancelled'
  const note = state === 'live' ? `Ends in ${formatDuration(Date.parse(s.ends_at) - now)}`
    : state === 'upcoming' ? `Starts in ${formatDuration(Date.parse(s.starts_at) - now)}` : null
  return (
    <li className={`admin-card !p-4 flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-3 ${state === 'live' ? 'ring-1 ring-warning/40' : ''} ${muted ? 'opacity-70' : ''}`}>
      <div className={`w-16 shrink-0 rounded-xl py-2 text-center ${muted ? 'bg-surface-2' : 'bg-warning-light'}`}>
        <div className={`text-lg font-bold font-mono tabular-nums leading-none ${muted ? 'text-text-muted' : 'text-text-primary'}`}>{mult.toFixed(2)}×</div>
        <div className="text-[10px] font-semibold text-text-muted mt-1">+{surgePct(mult)}%</div>
      </div>
      <div className="min-w-0 flex-1 basis-40">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-text-primary inline-flex items-center gap-1"><MapPin size={13} className="text-text-muted" />{s.city_name}</span>
          {s.city_id === null && <span className="pill-info">Default</span>}
          <span className="text-xs text-text-muted">{s.category_name ?? 'All categories'}</span>
          {s.reason && <span className="text-xs text-text-secondary truncate max-w-[14rem]">· {s.reason}</span>}
        </div>
        <div className="mt-1 text-xs text-text-secondary inline-flex items-center gap-1.5 tabular-nums">
          <Clock size={12} className="text-text-muted" />{windowLabel(s.starts_at, s.ends_at, new Date(now))}
          <span className="text-text-muted">({formatDuration(Date.parse(s.ends_at) - Date.parse(s.starts_at))})</span>
        </div>
      </div>
      <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto shrink-0">
      <div className="flex flex-col items-end gap-1.5">
        <span className={STATE_PILL[state].cls}>
          {state === 'live' && <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-warning mr-1.5 align-middle motion-safe:animate-pulse" />}
          {STATE_PILL[state].label}
        </span>
        {note && <span className="text-[11px] text-text-muted tabular-nums">{note}</span>}
      </div>
      {(state === 'live' || state === 'upcoming') && (
        <button onClick={() => onCancel(s)} className="text-xs text-danger font-semibold px-2.5 py-1.5 rounded-lg hover:bg-danger-light transition-colors shrink-0">Cancel</button>
      )}
      </div>
    </li>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null
  return (
    <section>
      <h3 className="text-xs font-semibold text-text-muted mb-2.5">{title} <span className="tabular-nums">· {count}</span></h3>
      <ul className="space-y-2.5">{children}</ul>
    </section>
  )
}

export default function SurgeTab({ surges, cities, categories, onChanged }: {
  surges: SurgeEvent[]; cities: AdminCity[]; categories: Category[]; onChanged: (message?: string) => void
}) {
  const now = useNow()
  const [toCancel, setToCancel] = useState<SurgeEvent | null>(null)
  const [showPast, setShowPast] = useState(false)
  const [cancelError, setCancelError] = useState('')

  const groups = useMemo(() => {
    const g: Record<SurgeState, SurgeEvent[]> = { live: [], upcoming: [], ended: [], cancelled: [] }
    for (const s of surges) g[surgeState(s, now)].push(s)
    g.upcoming.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
    return { live: g.live, upcoming: g.upcoming, past: [...g.ended, ...g.cancelled].sort((a, b) => Date.parse(b.ends_at) - Date.parse(a.ends_at)) }
  }, [surges, now])

  async function confirmCancel() {
    if (!toCancel) return
    setCancelError('')
    try { await pricingApi.cancelSurgeEvent(toCancel.id); onChanged('Surge cancelled') }
    catch { setCancelError(`Could not cancel the ${toCancel.city_name.toLowerCase() === 'all cities' ? 'all-cities' : toCancel.city_name} surge. It may have just ended. Refresh and check before trying again.`); onChanged() }
    setToCancel(null)
  }

  const none = groups.live.length + groups.upcoming.length + groups.past.length === 0
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-text-primary">Surge pricing</h2>
          <p className="text-xs text-text-muted mt-0.5">Raise fares in one city, or in every city, when demand spikes. Riders see the multiplier before they book.</p>
        </div>
        <ScheduleSurgeDialog cities={cities} categories={categories} onCreated={() => onChanged('Surge scheduled')} />
      </div>

      {cancelError && <p role="alert" className="text-sm font-semibold text-danger bg-danger-light rounded-xl px-4 py-3">{cancelError}</p>}

      {none ? (
        <div className="admin-card text-center py-12">
          <div className="mx-auto w-11 h-11 rounded-xl bg-warning-light flex items-center justify-center mb-3"><Zap size={20} className="text-warning" /></div>
          <p className="text-sm font-semibold text-text-primary">No surges yet</p>
          <p className="text-xs text-text-muted mt-1">Schedule one when rain, a festival or a rush pushes demand past supply.</p>
        </div>
      ) : (
        <>
          <Section title="Live now" count={groups.live.length}>{groups.live.map(s => <SurgeRow key={s.id} s={s} now={now} onCancel={setToCancel} />)}</Section>
          <Section title="Upcoming" count={groups.upcoming.length}>{groups.upcoming.map(s => <SurgeRow key={s.id} s={s} now={now} onCancel={setToCancel} />)}</Section>
          {groups.live.length + groups.upcoming.length === 0 && (
            <p className="text-sm text-text-muted">No surge is running or scheduled. Fares are at their normal rates.</p>
          )}
          {groups.past.length > 0 && (
            <div>
              <button onClick={() => setShowPast(v => !v)} className="text-xs font-semibold text-primary-dark hover:underline" aria-expanded={showPast}>
                {showPast ? 'Hide' : 'Show'} past surges ({groups.past.length})
              </button>
              {showPast && <ul className="space-y-2.5 mt-3">{groups.past.map(s => <SurgeRow key={s.id} s={s} now={now} onCancel={setToCancel} />)}</ul>}
            </div>
          )}
        </>
      )}

      <ConfirmDialog open={toCancel !== null} onOpenChange={v => { if (!v) setToCancel(null) }}
        title="Cancel this surge?"
        description={toCancel ? `Fares in ${toCancel.city_id === null ? 'every city without its own surge' : toCancel.city_name} return to normal straight away. Rides already booked keep the surged price.` : ''}
        confirmLabel="Cancel surge" cancelLabel="Keep it" onConfirm={confirmCancel} />
    </div>
  )
}
