'use client'
import { Trash2 } from 'lucide-react'
import type { FieldSpec, OffersMeta, Rule } from '@/lib/offers-api'
import { groupCatalog } from '@/lib/offers-model'

export const inputCls = 'w-full border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted disabled:opacity-60'
const labelCls = 'block text-xs font-semibold text-text-muted mb-1.5'

export type Option = { value: string; label: string }
/** Choices the catalog cannot list itself (it only knows the field is a list of ids). */
export type Lookups = { categoryIds: Option[]; cityIds: Option[] }

// Fields whose values are numbers even though checkbox values are strings.
const NUMERIC_MULTI = new Set(['weekdays', 'categoryIds', 'cityIds'])

function toggle(list: unknown, value: string, numeric: boolean): (string | number)[] {
  const cur = Array.isArray(list) ? (list as (string | number)[]) : []
  const v = numeric ? Number(value) : value
  return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
}

function CheckList({ idBase, label, options, selected, numeric, onChange, disabled }: {
  idBase: string; label: string; options: Option[]; selected: unknown; numeric: boolean; onChange: (next: (string | number)[]) => void; disabled: boolean
}) {
  const sel = Array.isArray(selected) ? (selected as (string | number)[]).map(String) : []
  return (
    <fieldset disabled={disabled}>
      <legend className={labelCls}>{label}</legend>
      {options.length === 0 ? (
        <p className="text-xs text-text-muted">Nothing to choose from yet.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((o) => (
            <label key={o.value} htmlFor={`${idBase}-${o.value}`}
              className={`inline-flex items-center gap-2 min-h-[36px] px-3 rounded-xl border text-sm cursor-pointer ${sel.includes(o.value) ? 'border-primary bg-primary-light text-primary font-semibold' : 'border-border bg-surface text-text-secondary'}`}>
              <input id={`${idBase}-${o.value}`} type="checkbox" className="accent-[var(--color-primary,#0E8FA3)]" checked={sel.includes(o.value)}
                onChange={() => onChange(toggle(selected, o.value, numeric))} />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

function RoutePairs({ rule, lookups, onChange, disabled }: { rule: Rule; lookups: Lookups; onChange: (r: Rule) => void; disabled: boolean }) {
  const pairs = (Array.isArray(rule['pairs']) ? rule['pairs'] : []) as { originCityId: number; destinationCityId: number }[]
  const set = (next: typeof pairs) => onChange({ ...rule, pairs: next })
  const sel = (value: number | undefined, label: string, onPick: (n: number) => void) => (
    <select aria-label={label} className={inputCls} value={value ?? ''} disabled={disabled} onChange={(e) => onPick(Number(e.target.value))}>
      <option value="" disabled>{label}</option>
      {lookups.cityIds.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
    </select>
  )
  return (
    <div className="space-y-2">
      <p className={labelCls}>Routes (from, to)</p>
      {pairs.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          {sel(p.originCityId || undefined, 'From city', (n) => set(pairs.map((x, j) => (j === i ? { ...x, originCityId: n } : x))))}
          <span aria-hidden className="text-text-muted">to</span>
          {sel(p.destinationCityId || undefined, 'To city', (n) => set(pairs.map((x, j) => (j === i ? { ...x, destinationCityId: n } : x))))}
          <button type="button" disabled={disabled} aria-label={`Remove route ${i + 1}`} onClick={() => set(pairs.filter((_, j) => j !== i))}
            className="min-w-[36px] min-h-[36px] grid place-items-center rounded-lg text-text-muted hover:text-danger"><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="flex items-center gap-4">
        <button type="button" disabled={disabled} className="text-xs font-semibold text-primary hover:underline min-h-[32px]"
          onClick={() => set([...pairs, { originCityId: 0, destinationCityId: 0 }])}>Add a route</button>
        <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" disabled={disabled} checked={rule['bothDirections'] === true} onChange={(e) => onChange({ ...rule, bothDirections: e.target.checked })} />
          Both directions
        </label>
      </div>
    </div>
  )
}

function Field({ ruleKind, spec, rule, lookups, onChange, disabled }: {
  ruleKind: string; spec: FieldSpec; rule: Rule; lookups: Lookups; onChange: (r: Rule) => void; disabled: boolean
}) {
  const id = `rule-${ruleKind}-${spec.key}`
  const set = (patch: Record<string, unknown>) => onChange({ ...rule, ...patch })

  if (ruleKind === 'route' && spec.key === 'pairs') return <RoutePairs rule={rule} lookups={lookups} onChange={onChange} disabled={disabled} />
  if (ruleKind === 'route' && spec.key === 'bothDirections') return null // rendered with the route list

  switch (spec.type) {
    case 'number':
      return (
        <div>
          <label htmlFor={id} className={labelCls}>{spec.label}</label>
          <input id={id} type="number" min="0" step="any" className={inputCls} disabled={disabled}
            value={typeof rule[spec.key] === 'number' ? String(rule[spec.key]) : ''}
            onChange={(e) => set({ [spec.key]: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </div>
      )
    case 'text':
      return (
        <div>
          <label htmlFor={id} className={labelCls}>{spec.label}</label>
          <input id={id} type="text" className={inputCls} disabled={disabled} value={String(rule[spec.key] ?? '')} onChange={(e) => set({ [spec.key]: e.target.value })} />
        </div>
      )
    case 'enum':
      return (
        <div>
          <label htmlFor={id} className={labelCls}>{spec.label}</label>
          <select id={id} className={inputCls} disabled={disabled} value={String(rule[spec.key] ?? spec.options?.[0]?.value ?? '')} onChange={(e) => set({ [spec.key]: e.target.value })}>
            {(spec.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )
    case 'multi': {
      const options = spec.options ?? (spec.key === 'categoryIds' ? lookups.categoryIds : spec.key === 'cityIds' ? lookups.cityIds : [])
      return (
        <CheckList idBase={id} label={spec.label} options={options} selected={rule[spec.key]} numeric={NUMERIC_MULTI.has(spec.key)} disabled={disabled}
          onChange={(next) => set({ [spec.key]: next.length ? next : undefined })} />
      )
    }
    case 'dateRange':
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-from`} className={labelCls}>From date</label>
            <input id={`${id}-from`} type="date" className={inputCls} disabled={disabled} value={String(rule['startDate'] ?? '')} onChange={(e) => set({ startDate: e.target.value || undefined })} />
          </div>
          <div>
            <label htmlFor={`${id}-to`} className={labelCls}>To date</label>
            <input id={`${id}-to`} type="date" className={inputCls} disabled={disabled} value={String(rule['endDate'] ?? '')} onChange={(e) => set({ endDate: e.target.value || undefined })} />
          </div>
        </div>
      )
    case 'hours': {
      const h = (rule['hours'] ?? {}) as { from?: number; to?: number }
      const put = (patch: { from?: number | undefined; to?: number | undefined }) => {
        const next = { ...h, ...patch }
        set({ hours: next.from == null && next.to == null ? undefined : next })
      }
      const pick = (v: string) => (v === '' ? undefined : Number(v))
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${id}-from`} className={labelCls}>From hour (0 to 23)</label>
            <input id={`${id}-from`} type="number" min="0" max="23" className={inputCls} disabled={disabled} value={h.from ?? ''} onChange={(e) => put({ from: pick(e.target.value) })} />
          </div>
          <div>
            <label htmlFor={`${id}-to`} className={labelCls}>Until hour (1 to 24)</label>
            <input id={`${id}-to`} type="number" min="1" max="24" className={inputCls} disabled={disabled} value={h.to ?? ''} onChange={(e) => put({ to: pick(e.target.value) })} />
          </div>
        </div>
      )
    }
  }
}

/** The conditions of an offer, grouped Who / Where / What / When. Everything shown comes from the server catalog. */
export default function RuleBuilder({ meta, rules, lookups, onChange, disabled = false }: {
  meta: OffersMeta; rules: Rule[]; lookups: Lookups; onChange: (rules: Rule[]) => void; disabled?: boolean
}) {
  const groups = groupCatalog(meta)
  const replace = (index: number, rule: Rule) => onChange(rules.map((r, i) => (i === index ? rule : r)))
  return (
    <div className="space-y-5">
      {groups.map(({ group, kinds }) => {
        const present = rules.map((r, index) => ({ r, index })).filter(({ r }) => kinds.some((k) => k.kind === r.kind))
        const addable = kinds.filter((k) => !rules.some((r) => r.kind === k.kind))
        return (
          <section key={group.id} aria-labelledby={`grp-${group.id}`} className="rounded-2xl border border-border-light p-4 space-y-3">
            <div>
              <h3 id={`grp-${group.id}`} className="text-sm font-bold text-text-primary">{group.label}</h3>
              <p className="text-xs text-text-muted">{group.hint}</p>
            </div>
            {present.length === 0 && <p className="text-xs text-text-muted">No condition here, so it does not narrow the offer.</p>}
            {present.map(({ r, index }) => {
              const def = kinds.find((k) => k.kind === r.kind)!
              return (
                <div key={r.kind} className="rounded-xl bg-surface-2 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-text-primary">{def.label}</p>
                    <button type="button" disabled={disabled} aria-label={`Remove ${def.label}`} onClick={() => onChange(rules.filter((_, i) => i !== index))}
                      className="min-w-[36px] min-h-[36px] grid place-items-center rounded-lg text-text-muted hover:text-danger"><Trash2 size={14} /></button>
                  </div>
                  {def.fields.map((f) => <Field key={f.key} ruleKind={def.kind} spec={f} rule={r} lookups={lookups} disabled={disabled} onChange={(next) => replace(index, next)} />)}
                </div>
              )
            })}
            {addable.length > 0 && !disabled && (
              <div>
                <label htmlFor={`add-${group.id}`} className="sr-only">Add a {group.label.toLowerCase()} condition</label>
                <select id={`add-${group.id}`} className={`${inputCls} max-w-xs`} value="" onChange={(e) => { if (e.target.value) onChange([...rules, { kind: e.target.value }]) }}>
                  <option value="">Add a condition…</option>
                  {addable.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                </select>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
