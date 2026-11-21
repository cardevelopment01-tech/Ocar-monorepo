'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plane, Plus, Pencil, Trash2 } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import Toggle from '@/components/ui/Toggle'
import { airportApi, type AirportZone, type AirportChange } from '@/lib/airport-api'
import { vehicleCategoryApi, type VehicleCategory } from '@/lib/vehicle-api'
import { parsePastedPolygon } from '@/lib/boundary-utils'
import { extractErrorMessage } from '@/lib/http-errors'
import { inputCls, labelCls } from '../rate-cards/shared'

const rupees = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(2)}`

function ZoneDialog({ zone, categories, onSaved, trigger }: {
  zone: AirportZone | null; categories: VehicleCategory[]; onSaved: () => void; trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [shape, setShape] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!open) return
    setName(zone?.name ?? '')
    setShape(zone ? JSON.stringify(zone.boundary) : '')
    setAmounts(Object.fromEntries(categories.map(c => [c.id, String(zone?.rates.find(r => String(r.category_id) === c.id)?.amount ?? '')])))
    setReason(''); setError('')
  }, [open, zone, categories])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const parsed = parsePastedPolygon(shape)
    if (!parsed.ok) { setError(parsed.error.replace('City boundaries are', 'A zone is')); return }
    const rates: Array<{ category_id: number; amount: number }> = []
    for (const c of categories) {
      const raw = (amounts[c.id] ?? '').trim()
      if (raw === '') continue
      const amount = Number(raw)
      if (!Number.isFinite(amount) || amount < 0) { setError(`The toll for ${c.display_name} must be a number, 0 or more.`); return }
      rates.push({ category_id: Number(c.id), amount })
    }
    setLoading(true)
    try {
      if (zone) await airportApi.update(zone.id, { name, boundary: parsed.polygon as AirportZone['boundary'], rates, reason })
      else await airportApi.create({ name, boundary: parsed.polygon as AirportZone['boundary'], rates, reason })
      setOpen(false); onSaved()
    } catch (err: unknown) {
      setError(extractErrorMessage(err, 'Could not save the zone.'))
    } finally { setLoading(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[520px] max-h-[90vh] overflow-y-auto bg-surface rounded-2xl shadow-hover p-6 z-[60]">
          <Dialog.Title className="text-lg font-bold text-text-primary mb-1">{zone ? `Edit ${zone.name}` : 'Add an airport zone'}</Dialog.Title>
          <Dialog.Description className="text-xs text-text-muted mb-5">
            A trip that enters this zone (or starts or ends in it) is charged the toll below, once per ride. Rides already booked keep the tolls they were booked with.
          </Dialog.Description>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className={labelCls}>Zone name *</label>
              <input required value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Biju Patnaik Airport" maxLength={80} />
            </div>
            <div>
              <label className={labelCls}>Zone outline (GeoJSON polygon) *</label>
              <textarea required value={shape} onChange={e => setShape(e.target.value)} rows={5}
                className={`${inputCls} font-mono text-xs`} placeholder='{"type":"Polygon","coordinates":[[[85.808,20.235],[85.828,20.235],[85.828,20.254],[85.808,20.254],[85.808,20.235]]]}' />
              <p className="text-xs text-text-muted mt-1">Draw the airport on geojson.io and paste the polygon. Longitude first. It is checked for a valid shape and a sensible size (at most 100 km²) when you save.</p>
            </div>
            <div>
              <label className={labelCls}>Toll per vehicle type (₹)</label>
              <div className="grid grid-cols-2 gap-3">
                {categories.map(c => (
                  <div key={c.id}>
                    <span className="block text-xs text-text-secondary mb-1">{c.display_name}</span>
                    <input type="number" step="0.01" min="0" value={amounts[c.id] ?? ''} onChange={e => setAmounts(a => ({ ...a, [c.id]: e.target.value }))}
                      className={`${inputCls} font-mono`} placeholder="No toll" />
                  </div>
                ))}
              </div>
              <p className="text-xs text-text-muted mt-1">Blank or 0 = that vehicle type pays nothing here. The toll is paid on to the driver; commission is taken on the fare without it.</p>
            </div>
            <div>
              <label className={labelCls}>Reason for this change *</label>
              <input required minLength={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} className={inputCls} placeholder="e.g. Toll revised by the airport authority" />
              <p className="text-xs text-text-muted mt-1">Kept in the change history with your name.</p>
            </div>
            {error && <p className="text-xs text-danger font-semibold">{error}</p>}
            <div className="flex gap-3 pt-2">
              <Dialog.Close asChild><button type="button" className="btn-secondary flex-1 justify-center">Cancel</button></Dialog.Close>
              <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center disabled:opacity-50 disabled:pointer-events-none">{loading ? 'Saving…' : 'Save zone'}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function AirportZonesPage() {
  const [zones, setZones] = useState<AirportZone[] | null>(null)
  const [categories, setCategories] = useState<VehicleCategory[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const [pending, setPending] = useState<{ kind: 'toggle' | 'delete'; zone: AirportZone } | null>(null)
  const [pendingReason, setPendingReason] = useState('')
  const [pendingError, setPendingError] = useState('')
  const [changes, setChanges] = useState<AirportChange[]>([])

  const load = useCallback(async () => {
    try {
      const [z, c, h] = await Promise.all([airportApi.list(), vehicleCategoryApi.list(), airportApi.changes()])
      setZones(z); setCategories(c.filter(x => x.is_active)); setChanges(h); setError('')
    } catch (err: unknown) { setError(extractErrorMessage(err, 'Could not load the airport zones.')) }
  }, [])
  useEffect(() => { void load() }, [load])

  function ask(kind: 'toggle' | 'delete', zone: AirportZone) { setPending({ kind, zone }); setPendingReason(''); setPendingError('') }

  async function confirmPending(e: React.FormEvent) {
    e.preventDefault()
    if (!pending) return
    setBusy(pending.zone.id)
    try {
      if (pending.kind === 'delete') await airportApi.remove(pending.zone.id, pendingReason)
      else await airportApi.update(pending.zone.id, { is_active: !pending.zone.is_active, reason: pendingReason })
      setPending(null); await load()
    } catch (err: unknown) { setPendingError(extractErrorMessage(err, 'Could not save the change.')) }
    finally { setBusy(null) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-text-secondary max-w-xl">
          Rides that enter an airport zone are charged a toll, shown as its own line on the receipt and paid on to the driver.
          Set the amount for each vehicle type.
        </p>
        <ZoneDialog zone={null} categories={categories} onSaved={() => void load()}
          trigger={<button className="btn-primary inline-flex items-center gap-2 flex-shrink-0"><Plus size={14} />Add zone</button>} />
      </div>

      {error && <p className="text-sm text-danger font-semibold">{error}</p>}
      {zones === null && !error && <p className="text-sm text-text-muted">Loading…</p>}
      {zones?.length === 0 && (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <Plane size={22} className="mx-auto text-text-muted mb-2" />
          <p className="text-sm font-semibold text-text-primary">No airport zones yet</p>
          <p className="text-xs text-text-muted mt-1">Add the first one to start charging an airport toll.</p>
        </div>
      )}

      <div className="grid gap-3">
        {zones?.map(z => (
          <div key={z.id} className="rounded-2xl border border-border bg-surface p-4 flex flex-wrap items-center gap-4">
            <div className="w-9 h-9 rounded-xl bg-primary-light text-primary flex items-center justify-center flex-shrink-0"><Plane size={16} /></div>
            <div className="flex-1 min-w-[200px]">
              <p className="text-sm font-bold text-text-primary">{z.name}</p>
              <p className="text-xs text-text-muted">{z.area_km2} km²</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {z.rates.filter(r => r.amount > 0).length === 0
                  ? <span className="text-xs text-text-muted">No tolls set</span>
                  : z.rates.filter(r => r.amount > 0).map(r => (
                    <span key={r.category_id} className="text-xs font-medium rounded-full bg-surface-2 border border-border px-2.5 py-1 text-text-secondary">
                      {r.category_name} <span className="font-mono font-semibold text-text-primary">{rupees(r.amount)}</span>
                    </span>
                  ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-muted">{z.is_active ? 'Active' : 'Off'}</span>
              <Toggle checked={z.is_active} onChange={() => ask('toggle', z)} disabled={busy === z.id} />
              <ZoneDialog zone={z} categories={categories} onSaved={() => void load()}
                trigger={<button className="p-1.5 text-text-muted hover:text-primary hover:bg-primary-light rounded-lg transition-colors" title="Edit zone" aria-label={`Edit ${z.name}`}><Pencil size={14} /></button>} />
              <button onClick={() => ask('delete', z)} className="p-1.5 text-text-muted hover:text-danger hover:bg-danger-light rounded-lg transition-colors" title="Delete zone" aria-label={`Delete ${z.name}`}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      {changes.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm font-bold text-text-primary mb-3">Recent changes</p>
          <ul className="divide-y divide-border">
            {changes.map(c => (
              <li key={c.id} className="py-2 text-xs text-text-secondary flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="font-semibold text-text-primary">{c.zone_name}</span>
                <span>{c.action === 'create' ? 'Added' : c.action === 'delete' ? 'Deleted' : 'Edited'}</span>
                <span className="flex-1 min-w-[160px]">“{c.reason}”</span>
                <span className="text-text-muted">{c.changed_by ?? 'Unknown'} · {new Date(c.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Dialog.Root open={pending !== null} onOpenChange={(v) => { if (!v) setPending(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-[420px] bg-surface rounded-2xl shadow-hover p-6 z-[60]">
            <Dialog.Title className="text-lg font-bold text-text-primary mb-1">
              {pending?.kind === 'delete' ? `Delete ${pending.zone.name}?` : pending ? `${pending.zone.is_active ? 'Turn off' : 'Turn on'} ${pending.zone.name}?` : ''}
            </Dialog.Title>
            <Dialog.Description className="text-xs text-text-muted mb-4">
              {pending?.kind === 'delete'
                ? 'Rides already booked keep the toll they were booked with. New rides will no longer be charged for this zone.'
                : 'Rides already booked keep the toll they were booked with. Only new bookings are affected.'}
            </Dialog.Description>
            <form onSubmit={confirmPending} className="space-y-3">
              <div>
                <label className={labelCls}>Reason for this change *</label>
                <input required minLength={3} maxLength={300} autoFocus value={pendingReason} onChange={e => setPendingReason(e.target.value)} className={inputCls} />
              </div>
              {pendingError && <p className="text-xs text-danger font-semibold">{pendingError}</p>}
              <div className="flex gap-3 pt-1">
                <Dialog.Close asChild><button type="button" className="btn-secondary flex-1 justify-center">Cancel</button></Dialog.Close>
                <button type="submit" disabled={busy !== null} className="btn-primary flex-1 justify-center disabled:opacity-50 disabled:pointer-events-none">
                  {pending?.kind === 'delete' ? 'Delete zone' : 'Confirm'}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
