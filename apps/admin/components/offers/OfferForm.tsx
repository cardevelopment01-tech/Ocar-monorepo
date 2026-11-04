'use client'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { offersApi, type OffersMeta } from '@/lib/offers-api'
import { publishChecklist, validateDraft, type Draft } from '@/lib/offers-model'
import RuleBuilder, { inputCls, type Lookups } from './RuleBuilder'
import PreviewPanel from './PreviewPanel'

const labelCls = 'block text-xs font-semibold text-text-muted mb-1.5'

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="admin-card space-y-4">
      <div>
        <h2 className="text-sm font-bold text-text-primary">{title}</h2>
        {hint && <p className="text-xs text-text-muted mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * One form for creating an offer and editing its terms. Rules, discount kinds and the limits all come from the server
 * catalog (`meta`); the sentence and the sample ride come from the server too (PreviewPanel).
 */
export default function OfferForm({ meta, draft, onChange, mode, readOnly = false, lookups, submitting, error, onSave, ownId }: {
  meta: OffersMeta
  draft: Draft
  onChange: (d: Draft) => void
  mode: 'create' | 'edit'
  readOnly?: boolean
  lookups: Lookups
  submitting: boolean
  error: string
  onSave: (publish: boolean) => void
  /** the offer being edited, so its own code is not reported as a duplicate */
  ownId?: string
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })
  const errors = useMemo(() => validateDraft(draft, meta), [draft, meta])
  const checklist = useMemo(() => publishChecklist(draft, meta), [draft, meta])
  const [touched, setTouched] = useState(false)
  const [codeTaken, setCodeTaken] = useState(false)
  const benefits = meta.benefits.filter((b) => !b.isCashback || meta.capabilities.cashback)
  const cap = meta.capabilities.maxDiscountPercent

  // A changed code is no longer the one we checked.
  useEffect(() => { setCodeTaken(false) }, [draft.code])
  async function checkCode() {
    const code = draft.code.trim().toUpperCase()
    if (draft.kind !== 'code' || code.length < 3) return
    try {
      const { offers } = await offersApi.list({ search: code, limit: 20 })
      setCodeTaken(offers.some((o) => o.code?.toUpperCase() === code && o.id !== ownId))
    } catch { /* the server refuses a duplicate on save anyway */ }
  }

  function save(publish: boolean) {
    setTouched(true)
    if (errors.length === 0 && !(draft.kind === 'code' && codeTaken)) onSave(publish)
  }
  const ro = readOnly || submitting
  const showErrors = touched && (errors.length > 0 || codeTaken)

  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); save(false) }} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
      <div className="space-y-5 min-w-0">
        <Section title="The offer" hint="A name only your team sees, and how riders get it.">
          <div>
            <label htmlFor="of-name" className={labelCls}>Name</label>
            <input id="of-name" className={inputCls} value={draft.name} disabled={ro} maxLength={120} onChange={(e) => set('name', e.target.value)} placeholder="e.g. First ride discount" />
          </div>
          <fieldset disabled={ro || mode === 'edit'}>
            <legend className={labelCls}>How riders get it</legend>
            <div className="flex flex-wrap gap-2">
              {([['code', 'They type a code'], ['auto', 'Applied automatically']] as const).map(([v, l]) => (
                <label key={v} className={`inline-flex items-center gap-2 min-h-[40px] px-3 rounded-xl border text-sm cursor-pointer ${draft.kind === v ? 'border-primary bg-primary-light text-primary font-semibold' : 'border-border bg-surface text-text-secondary'}`}>
                  <input type="radio" name="of-kind" checked={draft.kind === v} onChange={() => set('kind', v)} />{l}
                </label>
              ))}
            </div>
          </fieldset>
          {draft.kind === 'code' && (
            <div className="max-w-xs">
              <label htmlFor="of-code" className={labelCls}>Code</label>
              <input id="of-code" className={`${inputCls} uppercase font-mono`} value={draft.code} disabled={ro || mode === 'edit'} maxLength={24}
                onChange={(e) => set('code', e.target.value.toUpperCase().replace(/\s/g, ''))} onBlur={() => void checkCode()} placeholder="SAVE10" aria-describedby="of-code-help" />
              <p id="of-code-help" className={`text-xs mt-1 ${codeTaken ? 'text-danger' : 'text-text-muted'}`}>
                {codeTaken ? 'That code is already used by another offer.' : mode === 'edit' ? 'The code cannot change after the offer is created.' : '3 to 24 letters or numbers. Riders can type it in any case.'}
              </p>
            </div>
          )}
        </Section>

        <Section title="The discount" hint={`Taken off the fare before surge, stops and waiting. Limited to ${cap}% of the fare (set in System Config) so drivers are never worse off.`}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="of-type" className={labelCls}>Type</label>
              <select id="of-type" className={inputCls} disabled={ro} value={draft.benefitType} onChange={(e) => set('benefitType', e.target.value as Draft['benefitType'])}>
                {benefits.map((b) => <option key={b.type} value={b.type}>{b.label}</option>)}
              </select>
            </div>
            {(draft.benefitType === 'percent_off' || draft.benefitType === 'cashback_percent') && (
              <div>
                <label htmlFor="of-percent" className={labelCls}>Percent</label>
                <input id="of-percent" type="number" min="0" step="any" className={inputCls} disabled={ro} value={draft.percent} onChange={(e) => set('percent', e.target.value)} />
              </div>
            )}
            {(draft.benefitType === 'flat_off' || draft.benefitType === 'cashback_flat') && (
              <div>
                <label htmlFor="of-amount" className={labelCls}>Amount (₹)</label>
                <input id="of-amount" type="number" min="0" step="any" className={inputCls} disabled={ro} value={draft.amount} onChange={(e) => set('amount', e.target.value)} />
              </div>
            )}
            {draft.benefitType === 'percent_off' && (
              <div>
                <label htmlFor="of-max" className={labelCls}>Most it can take off (₹), optional</label>
                <input id="of-max" type="number" min="0" step="any" className={inputCls} disabled={ro} value={draft.maxDiscount} onChange={(e) => set('maxDiscount', e.target.value)} />
              </div>
            )}
            {draft.benefitType === 'cashback_percent' && (
              <div>
                <label htmlFor="of-maxcb" className={labelCls}>Most cashback (₹), optional</label>
                <input id="of-maxcb" type="number" min="0" step="any" className={inputCls} disabled={ro} value={draft.maxCashback} onChange={(e) => set('maxCashback', e.target.value)} />
              </div>
            )}
            {(draft.benefitType === 'cashback_percent' || draft.benefitType === 'cashback_flat') && (
              <div>
                <label htmlFor="of-exp" className={labelCls}>Cashback lasts (days)</label>
                <input id="of-exp" type="number" min="1" className={inputCls} disabled={ro} value={draft.expiresInDays} onChange={(e) => set('expiresInDays', e.target.value)} />
              </div>
            )}
          </div>
          {!meta.capabilities.cashback && <p className="text-xs text-text-muted">Cashback offers are switched off in System Config, so they are not listed.</p>}
        </Section>

        <Section title="Who, where, what and when" hint="Leave a group empty to apply to everyone. All conditions must be true for the offer to apply.">
          <RuleBuilder meta={meta} rules={draft.rules} lookups={lookups} disabled={ro} onChange={(rules) => set('rules', rules)} />
        </Section>

        <Section title="Limits and dates" hint="Dates are in India time. An offer with no budget and no end date runs until someone pauses it.">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="of-per" className={labelCls}>Uses per rider</label>
              <input id="of-per" type="number" min="1" step="1" className={inputCls} disabled={ro} value={draft.perUserLimit} onChange={(e) => set('perUserLimit', e.target.value)} placeholder="No limit" />
            </div>
            <div>
              <label htmlFor="of-global" className={labelCls}>Total uses</label>
              <input id="of-global" type="number" min="1" step="1" className={inputCls} disabled={ro} value={draft.globalLimit} onChange={(e) => set('globalLimit', e.target.value)} placeholder="No limit" />
            </div>
            <div>
              <label htmlFor="of-budget" className={labelCls}>Budget (₹)</label>
              <input id="of-budget" type="number" min="0" step="any" className={inputCls} disabled={ro} value={draft.budgetTotal} onChange={(e) => set('budgetTotal', e.target.value)} placeholder="No limit" />
            </div>
            <div className="hidden sm:block" />
            <div>
              <label htmlFor="of-start" className={labelCls}>Starts on</label>
              <input id="of-start" type="date" className={inputCls} disabled={ro || mode === 'edit'} value={draft.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
            </div>
            <div>
              <label htmlFor="of-end" className={labelCls}>Ends on (end of day)</label>
              <input id="of-end" type="date" className={inputCls} disabled={ro} value={draft.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
            </div>
          </div>
        </Section>

        <Section title="Before it goes live" hint="A reminder, not a block.">
          <ul className="space-y-2">
            {checklist.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-sm">
                {c.ok ? <CheckCircle2 size={16} className="text-success mt-0.5 shrink-0" aria-label="OK" /> : <AlertTriangle size={16} className="text-warning mt-0.5 shrink-0" aria-label="Check" />}
                <span className={c.ok ? 'text-text-secondary' : 'text-text-primary'}>{c.text}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-muted">Offers only apply while commission is set to 0 in System Config, and not in package-billing cities.</p>
        </Section>

        {showErrors && (
          <div role="alert" className="rounded-2xl border border-danger/30 bg-danger-light p-4 text-sm text-danger space-y-1">
            <p className="font-semibold">Fix these before saving:</p>
            <ul className="list-disc pl-5">
              {errors.map((e) => <li key={e}>{e}</li>)}
              {codeTaken && <li>That code is already used by another offer.</li>}
            </ul>
          </div>
        )}
        {error && <div role="alert" className="rounded-2xl border border-danger/30 bg-danger-light p-4 text-sm text-danger">{error}</div>}

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3">
            {mode === 'create' ? (
              <>
                <button type="button" disabled={submitting} onClick={() => save(true)} className="btn-primary disabled:opacity-50 disabled:pointer-events-none">{submitting ? 'Saving…' : 'Publish now'}</button>
                <button type="button" disabled={submitting} onClick={() => save(false)} className="btn-secondary disabled:opacity-50 disabled:pointer-events-none">Save as draft</button>
              </>
            ) : (
              <>
                <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50 disabled:pointer-events-none">{submitting ? 'Saving…' : 'Save changes'}</button>
                <p className="text-xs text-text-muted">Changes apply to new bookings only. Rides already booked keep the old terms.</p>
              </>
            )}
          </div>
        )}
      </div>
      <PreviewPanel draft={draft} />
    </form>
  )
}
