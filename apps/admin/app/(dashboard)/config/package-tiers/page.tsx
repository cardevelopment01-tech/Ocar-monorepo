'use client'
import { useState, useEffect, useCallback, useMemo, useId } from 'react'
import { AlertTriangle, ChevronDown, Info, Package as PackageIcon, Pencil, Plus, RefreshCw } from 'lucide-react'
import { packageApi, type PackageTier } from '@/lib/package-api'
import {
  checkForm, EMPTY_FORM, errorMessage, formatMultiple, formFromTier, GROUP_LABEL, hasErrors, inr, lowerValueIds, multiple, pricing, summarize,
  VALIDITY_SHORTCUTS, MAX_LABEL_LENGTH, type Group, type TierForm,
} from '@/lib/package-tier-model'
import SlideOver from '@/components/ui/SlideOver'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import SuccessToast from '@/components/ui/SuccessToast'
import Toggle from '@/components/ui/Toggle'

const inputCls = 'w-full border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-text-muted'
const errorInputCls = '!border-danger focus:!ring-danger/20 focus:!border-danger'
const DEFAULT_GST = 18

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3.5">
      <div className="text-xs font-semibold text-text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-text-primary tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-text-muted">{hint}</div>
    </div>
  )
}

/** The plan as a driver sees it in the app, drawn live from the form so the admin knows what they are about to publish. */
function DriverPreview({ form, gstPercent }: { form: TierForm; gstPercent: number }) {
  const price = Number(form.price), value = Number(form.thresholdValue), days = Number(form.validityDays)
  const ready = form.price.trim() !== '' && form.thresholdValue.trim() !== '' && Number.isFinite(price) && Number.isFinite(value) && price > 0 && value > 0
  if (!ready) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface-2 px-4 py-5 text-center text-sm text-text-muted" data-testid="driver-preview-empty">
        Enter a price and a ride value to see the plan as drivers will.
      </div>
    )
  }
  const p = pricing(price, gstPercent)
  return (
    <div className="rounded-2xl border border-primary/30 bg-surface p-4 shadow-sm" data-testid="driver-preview">
      <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">What drivers see</div>
      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-extrabold text-text-primary tabular-nums">{inr(value)}</div>
          <div className="text-xs font-semibold text-text-muted">ride credit</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold text-text-muted">You pay</div>
          <div className="text-xl font-extrabold text-primary tabular-nums">{inr(p.total, { paise: true })}</div>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-dashed border-border pt-3 text-sm">
        <div><dt className="text-xs font-semibold text-text-muted">Plan price</dt><dd className="font-bold text-text-primary tabular-nums">{inr(p.price, { paise: true })}</dd></div>
        <div className="text-center"><dt className="text-xs font-semibold text-text-muted">GST {gstPercent}%</dt><dd className="font-bold text-text-primary tabular-nums">{inr(p.gst, { paise: true })}</dd></div>
        <div className="text-right"><dt className="text-xs font-semibold text-text-muted">Valid for</dt><dd className="font-bold text-text-primary">{Number.isInteger(days) && days > 0 ? `${days} days` : '—'}</dd></div>
      </dl>
      {value < price ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-warning-light px-3 py-2 text-xs font-semibold text-amber-900" data-testid="preview-worth-less">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          Worth less than its price: the driver would get {formatMultiple(multiple(price, value))} ride credit for every ₹1 they pay
        </div>
      ) : (
        <div className="mt-3 rounded-lg bg-primary-light px-3 py-2 text-xs font-semibold text-primary">
          {formatMultiple(multiple(price, value))} ride credit for every ₹1 of plan price
        </div>
      )}
    </div>
  )
}

function Field({ id, label, help, error, children }: { id: string; label: string; help?: string; error?: string | undefined; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-text-primary">{label}</label>
      {children}
      {error ? <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs font-medium text-danger">{error}</p> : help ? <p id={`${id}-help`} className="mt-1.5 text-xs text-text-muted">{help}</p> : null}
    </div>
  )
}

export default function PackageTiersPage() {
  const uid = useId()
  const [tiers, setTiers] = useState<PackageTier[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [group, setGroup] = useState<Group>('cab')
  const [toast, setToast] = useState<string | null>(null)
  const [pageError, setPageError] = useState('')

  // Add / edit form
  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<PackageTier | null>(null)
  const [form, setForm] = useState<TierForm>(EMPTY_FORM)
  const [attempted, setAttempted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  // Switching a plan off asks first
  const [confirmOff, setConfirmOff] = useState<PackageTier | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setTiers(await packageApi.listTiers())
    } catch {
      setLoadError('Could not load the plans.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const summary = useMemo(() => summarize(tiers), [tiers])
  const gstPercent = summary.gstPercent ?? DEFAULT_GST
  const flagged = useMemo(() => lowerValueIds(tiers), [tiers])
  // Cheapest first, by the number (never by the text of the price, where "250.00" sorts before "40.00").
  const shown = useMemo(() => tiers.filter((t) => t.vehicle_group === group).sort((a, b) => parseFloat(a.price) - parseFloat(b.price)), [tiers, group])
  const maxMultiple = useMemo(() => Math.max(1, ...shown.map((t) => multiple(parseFloat(t.price), parseFloat(t.threshold_value)))), [shown])
  const check = useMemo(() => checkForm(form, tiers, editing?.id ?? null), [form, tiers, editing])

  function openAdd() {
    setEditing(null); setForm({ ...EMPTY_FORM, vehicleGroup: group }); setAttempted(false); setFormError(''); setPanelOpen(true)
  }
  function openEdit(t: PackageTier) {
    setEditing(t); setForm(formFromTier(t)); setAttempted(false); setFormError(''); setPanelOpen(true)
  }
  const set = <K extends keyof TierForm>(k: K, v: TierForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  // An error shows once the admin has typed in the field, or tried to save; an untouched empty field stays quiet.
  const fieldError = (k: 'label' | 'price' | 'thresholdValue' | 'validityDays') => (attempted || form[k].trim() !== '' ? check.errors[k] : undefined)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setAttempted(true)
    if (hasErrors(check)) return
    setSubmitting(true)
    setFormError('')
    const body = { label: form.label.trim(), price: Number(form.price), thresholdValue: Number(form.thresholdValue), vehicleGroup: form.vehicleGroup, validityDays: Number(form.validityDays) }
    try {
      if (editing) await packageApi.updateTier(editing.id, body)
      else await packageApi.createTier(body)
      setPanelOpen(false)
      setGroup(form.vehicleGroup)
      setToast(editing ? 'Plan updated' : 'Plan added')
      await load()
    } catch (err) {
      setFormError(errorMessage(err, 'Could not save the plan. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  async function setActive(t: PackageTier, isActive: boolean) {
    setBusyId(t.id)
    setPageError('')
    try {
      await packageApi.updateTier(t.id, { isActive })
      setToast(isActive ? 'Plan is live again' : 'Plan hidden from drivers')
      await load()
    } catch (err) {
      setPageError(errorMessage(err, 'Could not change the plan. Please try again.'))
    } finally {
      setBusyId(null)
    }
  }

  const title = editing ? 'Edit plan' : 'Add a plan'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-light">
            <PackageIcon size={22} className="text-primary" />
          </div>
          <div>
            <h1 className="page-title">Ride credit plans</h1>
            <p className="page-subtitle">Prepaid ride credit that drivers in package-billing cities buy. GST is added on top of the price; the driver gets the full ride value.</p>
          </div>
        </div>
        <button type="button" onClick={openAdd} className="btn-primary inline-flex items-center gap-2">
          <Plus size={16} aria-hidden="true" /> Add plan
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Live plans" value={loading ? '—' : `${summary.active} of ${summary.total}`} hint="Visible to drivers right now" />
        <SummaryCard label="GST on purchase" value={summary.gstPercent === null ? '—' : `${summary.gstPercent}%`} hint="Added on top of the price. Set in System config." />
        <SummaryCard label="Usual validity" value={summary.usualValidityDays === null ? '—' : `${summary.usualValidityDays} days`} hint="Each purchase expires on its own date; unused credit lapses, no refund" />
      </div>

      {pageError ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-light px-4 py-3 text-sm text-danger">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> {pageError}
        </div>
      ) : null}

      <div className="admin-card !p-0 overflow-hidden hover:!shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div role="tablist" aria-label="Plans for" className="inline-flex rounded-xl bg-surface-2 p-1">
            {(['cab', 'auto'] as const).map((g) => (
              <button
                key={g} role="tab" type="button" aria-selected={group === g} onClick={() => setGroup(g)}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${group === g ? 'bg-surface text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
              >
                {GROUP_LABEL[g]} <span className="ml-1 text-xs font-medium text-text-muted" title="Live plans out of all plans">{summary.byGroup[g].active}/{summary.byGroup[g].total}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-text-muted">
            {group === 'cab' ? 'Shown to drivers of every car type: hatchback, sedan, SUV and so on.' : 'Shown only to auto-rickshaw drivers.'}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Driver pays</th>
                <th>Ride value</th>
                <th>Value per ₹1</th>
                <th>Valid for</th>
                <th className="!text-center">Live</th>
                <th className="!text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [0, 1, 2].map((i) => (
                  <tr key={i} aria-hidden="true"><td colSpan={7}><div className="h-9 animate-pulse rounded-lg bg-surface-2" /></td></tr>
                ))
              ) : loadError ? (
                <tr><td colSpan={7} className="!text-center py-12">
                  <p className="text-danger">{loadError}</p>
                  <button type="button" onClick={() => void load()} className="btn-secondary mt-3 inline-flex items-center gap-2"><RefreshCw size={14} aria-hidden="true" /> Try again</button>
                </td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={7} className="!text-center py-14">
                  <p className="font-semibold text-text-primary">No plans for {GROUP_LABEL[group].toLowerCase()} yet</p>
                  <p className="mt-1 text-sm text-text-muted">Drivers of {GROUP_LABEL[group].toLowerCase()} in a package city see no plans until you add one.</p>
                  <button type="button" onClick={openAdd} className="btn-primary mt-4 inline-flex items-center gap-2"><Plus size={16} aria-hidden="true" /> Add the first plan</button>
                </td></tr>
              ) : shown.map((t) => {
                const p = pricing(parseFloat(t.price), t.gst_percent)
                const m = multiple(parseFloat(t.price), parseFloat(t.threshold_value))
                return (
                  <tr key={t.id} className={`!cursor-default ${t.is_active ? '' : 'opacity-60'}`}>
                    <td className="font-semibold text-text-primary">{t.label}</td>
                    <td>
                      <div className="font-bold text-text-primary tabular-nums">{inr(p.total, { paise: true })}</div>
                      <div className="text-xs text-text-muted tabular-nums">{inr(p.price, { paise: true })} + {inr(p.gst, { paise: true })} GST ({t.gst_percent}%)</div>
                    </td>
                    <td className="font-semibold tabular-nums">{inr(t.threshold_value)}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="w-12 font-semibold tabular-nums">{formatMultiple(m)}</span>
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                          <span className={`block h-full rounded-full ${flagged.has(t.id) ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.max(6, (m / maxMultiple) * 100)}%` }} />
                        </span>
                        {flagged.has(t.id) ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800" title="Gives less ride value per ₹ than a cheaper plan">
                            <AlertTriangle size={13} aria-hidden="true" /> Lower than a cheaper plan
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="tabular-nums">{t.validity_days} days</td>
                    <td className="!text-center">
                      <Toggle
                        checked={t.is_active} disabled={busyId === t.id} label={`${t.label} is live for drivers`}
                        onChange={(on) => (on ? void setActive(t, true) : setConfirmOff(t))}
                      />
                    </td>
                    <td className="!text-right">
                      <button
                        type="button" onClick={() => openEdit(t)} aria-label={`Edit ${t.label}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-primary-light hover:text-primary"
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <details className="group admin-card hover:!shadow-none" open={!loading && tiers.length === 0}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-text-primary">
          <span className="inline-flex items-center gap-2"><Info size={16} className="text-primary" aria-hidden="true" /> How plans work</span>
          <ChevronDown size={16} className="text-text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="mt-4 grid gap-6 text-sm text-text-secondary md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-text-muted">What a plan needs</h3>
            <ul className="list-disc space-y-1.5 pl-5">
              <li><strong className="text-text-primary">Name</strong>: shown to drivers.</li>
              <li><strong className="text-text-primary">Drivers</strong>: cabs or autos. Cab plans go to every car type, auto plans only to autos.</li>
              <li><strong className="text-text-primary">Price</strong>: before GST, up to two decimals. This is what Ocar earns.</li>
              <li><strong className="text-text-primary">Ride value</strong>: the credit the driver can spend on fares. It must be at least the price.</li>
              <li><strong className="text-text-primary">Valid for</strong>: whole days, 1 to 3,650.</li>
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-text-muted">What happens to it</h3>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>The driver pays the price plus GST and gets the full ride value as credit with its own expiry date.</li>
              <li>Each ride uses its fare from the credit that expires first. Credit left at its date lapses and is not refunded.</li>
              <li>Editing a plan changes it for <strong className="text-text-primary">new purchases only</strong>. Credit already bought keeps its value and expiry.</li>
              <li>Switching a plan off hides it from drivers. Credit already bought stays usable. Plans are never deleted, so history stays complete.</li>
              <li>Every purchase gets a GST tax invoice, and every change to a plan is written to the audit log.</li>
              <li>Only drivers in cities billed by package see plans. Two active plans cannot be identical.</li>
            </ul>
          </div>
        </div>
      </details>

      <SlideOver isOpen={panelOpen} onClose={() => setPanelOpen(false)} title={title}>
        <form onSubmit={handleSave} className="space-y-5 p-6" noValidate>
          {editing ? (
            <div className="flex items-start gap-2 rounded-xl bg-primary-light px-3.5 py-3 text-xs text-primary">
              <Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>Changes apply to <strong>new purchases only</strong>. Credit drivers already bought keeps its value and expiry.</span>
            </div>
          ) : null}

          <DriverPreview form={form} gstPercent={gstPercent} />

          <Field id={`${uid}-label`} label="Plan name" help="Shown to drivers on their wallet screen, for example Starter." error={fieldError('label')}>
            <input
              id={`${uid}-label`} value={form.label} maxLength={MAX_LABEL_LENGTH} onChange={(e) => set('label', e.target.value)} placeholder="Starter"
              aria-invalid={!!fieldError('label')} className={`${inputCls} ${fieldError('label') ? errorInputCls : ''}`}
            />
          </Field>

          <div>
            <span className="mb-1.5 block text-xs font-semibold text-text-primary" id={`${uid}-group`}>Drivers</span>
            <div role="radiogroup" aria-labelledby={`${uid}-group`} className="grid grid-cols-2 gap-2">
              {(['cab', 'auto'] as const).map((g) => (
                <button
                  key={g} type="button" role="radio" aria-checked={form.vehicleGroup === g} onClick={() => set('vehicleGroup', g)}
                  className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${form.vehicleGroup === g ? 'border-primary bg-primary-light font-semibold text-primary' : 'border-border bg-surface text-text-secondary hover:border-primary/40'}`}
                >
                  {GROUP_LABEL[g]}
                  <span className="mt-0.5 block text-xs font-normal text-text-muted">{g === 'cab' ? 'Every car type' : 'Auto-rickshaws only'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field id={`${uid}-price`} label="Price (₹)" help="Before GST. What Ocar earns." error={fieldError('price')}>
              <input
                id={`${uid}-price`} type="number" inputMode="decimal" min="0" step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} placeholder="40"
                aria-invalid={!!fieldError('price')} className={`${inputCls} ${fieldError('price') ? errorInputCls : ''}`}
              />
            </Field>
            <Field id={`${uid}-value`} label="Ride value (₹)" help="Credit the driver can spend." error={fieldError('thresholdValue')}>
              <input
                id={`${uid}-value`} type="number" inputMode="decimal" min="0" step="0.01" value={form.thresholdValue} onChange={(e) => set('thresholdValue', e.target.value)} placeholder="550"
                aria-invalid={!!fieldError('thresholdValue')} className={`${inputCls} ${fieldError('thresholdValue') ? errorInputCls : ''}`}
              />
            </Field>
          </div>

          <Field id={`${uid}-days`} label="Valid for (days)" help="Each purchase expires this many days after it is bought." error={fieldError('validityDays')}>
            <input
              id={`${uid}-days`} type="number" inputMode="numeric" min="1" max="3650" step="1" value={form.validityDays} onChange={(e) => set('validityDays', e.target.value)}
              aria-invalid={!!fieldError('validityDays')} className={`${inputCls} ${fieldError('validityDays') ? errorInputCls : ''}`}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {VALIDITY_SHORTCUTS.map((d) => (
                <button
                  key={d} type="button" onClick={() => set('validityDays', String(d))}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${form.validityDays === String(d) ? 'border-primary bg-primary-light text-primary' : 'border-border text-text-secondary hover:border-primary/40'}`}
                >
                  {d} days
                </button>
              ))}
            </div>
          </Field>

          {check.warnings.length > 0 ? (
            <ul className="space-y-1.5 rounded-xl bg-warning-light px-3.5 py-3 text-xs text-amber-900" aria-label="Worth a second look">
              {check.warnings.map((w) => (
                <li key={w} className="flex items-start gap-2"><AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {w}</li>
              ))}
            </ul>
          ) : null}

          {(check.errors.form || formError) ? (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-light px-3.5 py-3 text-sm text-danger">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError || check.errors.form}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
            <button type="button" onClick={() => setPanelOpen(false)} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary disabled:pointer-events-none disabled:opacity-50">
              {submitting ? 'Saving…' : editing ? 'Save changes' : 'Add plan'}
            </button>
          </div>
        </form>
      </SlideOver>

      <ConfirmDialog
        open={confirmOff !== null}
        onOpenChange={(open) => { if (!open) setConfirmOff(null) }}
        title={confirmOff ? `Hide “${confirmOff.label}” from drivers?` : ''}
        description="Drivers will no longer see this plan when they recharge. Credit they already bought with it stays usable until it expires. You can switch it back on at any time."
        confirmLabel="Hide plan"
        variant="warning"
        onConfirm={() => { const t = confirmOff; setConfirmOff(null); if (t) void setActive(t, false) }}
      />

      <SuccessToast message={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
