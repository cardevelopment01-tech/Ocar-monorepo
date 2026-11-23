'use client'
import { useCallback, useEffect, useId, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Toggle from '@/components/ui/Toggle'
import { dispatchApi } from '@/lib/dispatch-api'
import { extractErrorMessage } from '@/lib/http-errors'
import { feeExample, policyChanges, policyProblem, samePolicy, type AdvancePolicy, type PolicyLimits } from '@/lib/advance-policy-model'

const inputCls = 'w-24 px-3 py-2 text-sm text-right tabular-nums bg-surface border border-border rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 disabled:bg-surface-2'

// One setting: what it is and what it does on the left, the control on the right. Plain rows, no nested cards.
function Row({ label, hint, children, id }: { label: string; hint: string; children: React.ReactNode; id: string }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div className="min-w-0 max-w-md">
        <label htmlFor={id} id={`${id}-label`} className="block text-sm font-semibold text-text-primary">{label}</label>
        <p id={`${id}-hint`} className="text-xs text-text-muted mt-0.5 leading-relaxed">{hint}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-2" aria-label={title}>
      <h3 className="text-sm font-bold text-text-primary pt-3">{title}</h3>
      <div className="divide-y divide-border-light">{children}</div>
    </section>
  )
}

function NumberField({ id, value, onChange, disabled, unit, step = 1 }: { id: string; value: number; onChange: (n: number) => void; disabled: boolean; unit: string; step?: number }) {
  // Kept as text while typing so "1." or an empty box is allowed on the way to a number.
  const [text, setText] = useState(String(value))
  // Only follow the value when it changed from outside (Discard, a save). An emptied box is NaN, and NaN never equals itself.
  useEffect(() => {
    const typedEmpty = text.trim() === '' && Number.isNaN(value)
    if (!typedEmpty && Number(text) !== value) setText(String(value))
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <input id={id} aria-describedby={`${id}-hint`} inputMode="decimal" step={step} value={text} disabled={disabled} className={inputCls}
        onChange={e => { setText(e.target.value); onChange(e.target.value.trim() === '' ? Number.NaN : Number(e.target.value)) }} />
      <span className="text-xs text-text-muted w-14">{unit}</span>
    </>
  )
}

export default function DispatchPolicy({ canEdit }: { canEdit: boolean }) {
  const uid = useId()
  const [saved, setSaved] = useState<AdvancePolicy | null>(null)
  const [draft, setDraft] = useState<AdvancePolicy | null>(null)
  const [limits, setLimits] = useState<PolicyLimits | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [justSaved, setJustSaved] = useState(false)

  const load = useCallback(() => {
    setLoadError('')
    dispatchApi.policy().then(r => { setSaved(r.policy); setDraft(r.policy); setLimits(r.limits) }).catch(err => setLoadError(extractErrorMessage(err, 'Could not load the policy.')))
  }, [])
  useEffect(() => { load() }, [load])

  if (loadError) {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-light px-3 py-2 text-xs text-danger">
        <span className="font-semibold">{loadError}</span><button onClick={load} className="font-semibold underline">Retry</button>
      </div>
    )
  }
  if (!draft || !saved) return <ul className="space-y-3" aria-busy>{[0, 1, 2, 3].map(i => <li key={i} className="h-16 rounded-xl bg-surface-2 animate-pulse" />)}</ul>

  const set = <K extends keyof AdvancePolicy>(k: K, v: AdvancePolicy[K]) => { setDraft({ ...draft, [k]: v }); setJustSaved(false); setSaveError('') }
  const dirty = !samePolicy(saved, draft)
  const problem = policyProblem(draft, limits)
  const reasonOk = reason.trim().length >= 3
  const disabled = !canEdit || saving
  const feeOff = !draft.lateCancelEnabled

  async function save() {
    if (!saved || !draft) return
    setSaving(true); setSaveError('')
    try {
      const next = await dispatchApi.savePolicy(policyChanges(saved, draft), reason.trim())
      setSaved(next); setDraft(next); setReason(''); setJustSaved(true)
    } catch (err) {
      setSaveError(extractErrorMessage(err, 'Could not save. Nothing was changed.'))
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl">
      {!canEdit && <p className="mb-2 text-xs text-text-muted rounded-xl bg-surface-2 px-3 py-2">You can see these rules but only a super admin can change them.</p>}

      <Section title="Late cancellation">
        <Row id={`${uid}-on`} label="Charge a fee for late cancellations" hint="Applies to advance bookings only, and only when the rider cancels after a driver has accepted. Off by default: nobody is charged until you turn this on.">
          <Toggle checked={draft.lateCancelEnabled} onChange={v => set('lateCancelEnabled', v)} disabled={disabled} labelledBy={`${uid}-on-label`} describedBy={`${uid}-on-hint`} />
        </Row>
        <Row id={`${uid}-win`} label="Late means within" hint="A cancellation this close to pickup, or after it, is late. Earlier than this is always free.">
          <NumberField id={`${uid}-win`} value={draft.lateCancelWindowMin} onChange={n => set('lateCancelWindowMin', n)} disabled={disabled || feeOff} unit="minutes" />
        </Row>
        <Row id={`${uid}-mode`} label="How the fee is worked out" hint="A share of the fare keeps it fair on short and long trips. A flat amount is simpler to explain.">
          <div role="radiogroup" aria-labelledby={`${uid}-mode-label`} className="inline-flex rounded-xl bg-surface-2 p-1">
            {(['percent', 'flat'] as const).map(m => (
              <button key={m} type="button" role="radio" aria-checked={draft.feeMode === m} disabled={disabled || feeOff} onClick={() => set('feeMode', m)}
                className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 ${draft.feeMode === m ? 'bg-surface shadow-card text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}>
                {m === 'percent' ? 'Percent of fare' : 'Flat amount'}
              </button>
            ))}
          </div>
        </Row>
        {draft.feeMode === 'percent' ? (
          <>
            <Row id={`${uid}-pct`} label="Percent of the fare" hint="Worked out on the fare quoted at booking.">
              <NumberField id={`${uid}-pct`} value={draft.feePercent} onChange={n => set('feePercent', n)} disabled={disabled || feeOff} unit="%" step={0.5} />
            </Row>
            <Row id={`${uid}-cap`} label="Most a rider can be charged" hint="The fee never goes above this. Set 0 for no cap.">
              <NumberField id={`${uid}-cap`} value={draft.feeCap} onChange={n => set('feeCap', n)} disabled={disabled || feeOff} unit="rupees" />
            </Row>
          </>
        ) : (
          <Row id={`${uid}-flat`} label="Flat fee" hint="The same amount whatever the fare, though never more than the fare itself.">
            <NumberField id={`${uid}-flat`} value={draft.feeFlat} onChange={n => set('feeFlat', n)} disabled={disabled || feeOff} unit="rupees" />
          </Row>
        )}
        <p className="py-3 text-sm text-text-secondary leading-relaxed" role="status" aria-live="polite" data-testid="fee-example">{feeExample(draft)}</p>
      </Section>

      <Section title="Changing the pickup time">
        <Row id={`${uid}-resch`} label="Times a rider can change it" hint="Per booking. Changing the time is free until we start looking for a driver. Support can always change it for them.">
          <NumberField id={`${uid}-resch`} value={draft.rescheduleMax} onChange={n => set('rescheduleMax', n)} disabled={disabled} unit="times" />
        </Row>
      </Section>

      <Section title="When no driver is found">
        <Row id={`${uid}-grace`} label="Keep searching after pickup time" hint="If the first rounds find nobody, we keep trying until this long after the pickup time, then tell the rider. Support is alerted on the first miss. Set 0 to give up at once.">
          <NumberField id={`${uid}-grace`} value={draft.searchGraceMin} onChange={n => set('searchGraceMin', n)} disabled={disabled} unit="minutes" />
        </Row>
      </Section>

      {canEdit && (
        <div className="sticky bottom-0 -mx-1 mt-3 bg-surface/95 backdrop-blur-sm border-t border-border-light px-1 py-3 flex items-center gap-3 flex-wrap">
          <input aria-label="Reason for this change" value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason for the change (kept in the audit log)" disabled={!dirty || saving}
            className="flex-1 min-w-[220px] px-3 py-2 text-sm bg-surface border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60" />
          <button type="button" onClick={() => { setDraft(saved); setReason(''); setSaveError('') }} disabled={!dirty || saving} className="px-3 py-2 text-sm font-medium text-text-secondary border border-border rounded-xl hover:bg-surface-2 disabled:opacity-40">Discard</button>
          <button type="button" onClick={() => void save()} disabled={!dirty || !reasonOk || !!problem || saving}
            className="btn-primary inline-flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none">
            {saving && <Loader2 size={14} className="animate-spin" />}Save changes
          </button>
          <p className="basis-full text-xs min-h-[1rem]" role="status" aria-live="polite">
            {problem ? <span className="text-danger font-semibold">{problem}</span>
              : saveError ? <span className="text-danger font-semibold">{saveError}</span>
              : justSaved ? <span className="text-success font-semibold">Saved. New bookings and cancellations use these rules now.</span>
              : dirty && !reasonOk ? <span className="text-text-muted">Add a short reason to save.</span> : null}
          </p>
        </div>
      )}
    </div>
  )
}
