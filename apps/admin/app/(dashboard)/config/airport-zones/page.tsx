'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plane, Plus, Pencil, Trash2 } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import Toggle from '@/components/ui/Toggle'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { airportApi, type AirportZone } from '@/lib/airport-api'
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

  useEffect(() => {
    if (!open) return
    setName(zone?.name ?? '')
    setShape(zone ? JSON.stringify(zone.boundary) : '')
    setAmounts(Object.fromEntries(categories.map(c => [c.id, String(zone?.rates.find(r => String(r.category_id) === c.id)?.amount ?? '')])))
    setError('')
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
      if (zone) await airportApi.update(zone.id, { name, boundary: parsed.polygon as AirportZone['boundary'], rates })
      else await airportApi.create({ name, boundary: parsed.polygon as AirportZone['boundary'], rates })
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
  const [removing, setRemoving] = useState<AirportZone | null>(null)

  const load = useCallback(async () => {
    try {
      const [z, c] = await Promise.all([airportApi.list(), vehicleCategoryApi.list()])
      setZones(z); setCategories(c.filter(x => x.is_active)); setError('')
    } catch (err: unknown) { setError(extractErrorMessage(err, 'Could not load the airport zones.')) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function toggle(z: AirportZone) {
    setBusy(z.id)
    try { await airportApi.update(z.id, { is_active: !z.is_active }); await load() }
    catch (err: unknown) { setError(extractErrorMessage(err, 'Could not change the zone.')) }
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
              <Toggle checked={z.is_active} onChange={() => void toggle(z)} disabled={busy === z.id} />
              <ZoneDialog zone={z} categories={categories} onSaved={() => void load()}
                trigger={<button className="p-1.5 text-text-muted hover:text-primary hover:bg-primary-light rounded-lg transition-colors" title="Edit zone" aria-label={`Edit ${z.name}`}><Pencil size={14} /></button>} />
              <button onClick={() => setRemoving(z)} className="p-1.5 text-text-muted hover:text-danger hover:bg-danger-light rounded-lg transition-colors" title="Delete zone" aria-label={`Delete ${z.name}`}><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => { if (!v) setRemoving(null) }}
        onConfirm={() => { const z = removing; setRemoving(null); if (z) void airportApi.remove(z.id).catch(() => undefined).then(() => load()) }}
        title={`Delete ${removing?.name ?? 'zone'}?`}
        description="Rides already booked keep the toll they were booked with. New rides will no longer be charged for this zone."
        confirmLabel="Delete zone"
      />
    </div>
  )
}
