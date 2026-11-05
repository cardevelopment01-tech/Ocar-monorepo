import type { Benefit, BenefitType, OfferDetail, OfferPayload, OffersMeta, Redemption, Rule } from './offers-api'

// Everything the offer form decides without a server: the draft shape, starting templates, validation and the
// pre-publish checklist. The rule and benefit LISTS come from the server catalog (GET /admin/offers/meta), so a new
// rule kind needs no change here; there is deliberately no client copy of the offer wording (the server's
// describeOffer builds the sentence). validateDraft only checks what the field specs say.

export type Draft = {
  name: string
  kind: 'code' | 'auto' | 'assigned'
  code: string
  benefitType: BenefitType
  percent: string
  amount: string
  maxDiscount: string
  maxCashback: string
  expiresInDays: string
  rules: Rule[]
  perUserLimit: string
  budgetTotal: string
  globalLimit: string
  startsAt: string // yyyy-mm-dd, India time
  endsAt: string
}

export const emptyDraft = (): Draft => ({
  name: '', kind: 'code', code: '', benefitType: 'percent_off', percent: '', amount: '', maxDiscount: '', maxCashback: '',
  expiresInDays: '30', rules: [], perUserLimit: '', budgetTotal: '', globalLimit: '', startsAt: '', endsAt: '',
})

export type Template = { id: string; label: string; hint: string; apply: (d: Draft) => Draft }

export const TEMPLATES: Template[] = [
  {
    id: 'blank', label: 'Start from scratch', hint: 'Choose everything yourself',
    apply: (d) => d,
  },
  {
    id: 'first_ride', label: 'First ride discount', hint: 'Percent off for riders who have not completed a ride',
    apply: (d) => ({ ...d, name: d.name || 'First ride discount', kind: 'auto', benefitType: 'percent_off', percent: '10', maxDiscount: '50', rules: [{ kind: 'new_user' }] }),
  },
  {
    id: 'flat_off', label: 'Flat ₹ off', hint: 'A fixed amount off fares above a minimum',
    apply: (d) => ({ ...d, name: d.name || 'Flat discount', kind: 'code', benefitType: 'flat_off', amount: '40', rules: [{ kind: 'min_fare', amount: 300 }] }),
  },
  {
    id: 'weekend', label: 'Weekend offer', hint: 'Percent off on Saturdays and Sundays',
    apply: (d) => ({ ...d, name: d.name || 'Weekend offer', kind: 'auto', benefitType: 'percent_off', percent: '10', maxDiscount: '60', rules: [{ kind: 'schedule', weekdays: [0, 6] }] }),
  },
]

// ── Rule groups: plain language over the catalog ─────────────────────────────

export type RuleGroup = { id: string; label: string; hint: string; kinds: string[] }
export const RULE_GROUPS: RuleGroup[] = [
  { id: 'who', label: 'Who', hint: 'Which riders can use it', kinds: ['new_user', 'first_n_rides'] },
  { id: 'where', label: 'Where', hint: 'Which cities and routes', kinds: ['city', 'route'] },
  { id: 'what', label: 'What', hint: 'Which rides and payments', kinds: ['ride_type', 'category', 'payment_channel', 'min_fare'] },
  { id: 'when', label: 'When', hint: 'Dates, days and hours (India time)', kinds: ['schedule'] },
]
export const OTHER_GROUP: RuleGroup = { id: 'other', label: 'Other', hint: 'Additional conditions', kinds: [] }

/** Groups with the kinds the server actually offers; a kind no group names lands in "Other" so it still appears. */
export function groupCatalog(meta: OffersMeta): { group: RuleGroup; kinds: OffersMeta['rules'] }[] {
  const named = new Set(RULE_GROUPS.flatMap((g) => g.kinds))
  const byKind = new Map(meta.rules.map((r) => [r.kind, r]))
  const out = RULE_GROUPS.map((group) => ({ group, kinds: group.kinds.flatMap((k) => (byKind.has(k) ? [byKind.get(k)!] : [])) }))
  const rest = meta.rules.filter((r) => !named.has(r.kind))
  if (rest.length) out.push({ group: OTHER_GROUP, kinds: rest })
  return out.filter((g) => g.kinds.length > 0)
}

// ── Draft <-> API ────────────────────────────────────────────────────────────

const num = (s: string): number | undefined => (s.trim() === '' ? undefined : Number(s))

export function benefitOf(d: Draft): Benefit {
  const b: Benefit = { type: d.benefitType }
  if (d.benefitType === 'percent_off') { b.percent = Number(d.percent); const m = num(d.maxDiscount); if (m != null) b.maxDiscount = m }
  else if (d.benefitType === 'flat_off') b.amount = Number(d.amount)
  else if (d.benefitType === 'cashback_percent') { b.percent = Number(d.percent); const m = num(d.maxCashback); if (m != null) b.maxCashback = m; b.expiresInDays = Number(d.expiresInDays) }
  else { b.amount = Number(d.amount); b.expiresInDays = Number(d.expiresInDays) }
  return b
}

/** India-time midnight for a date input, as an ISO instant. */
export function istStart(date: string): string { return new Date(`${date}T00:00:00+05:30`).toISOString() }
/** Midnight India time at the START of the day after `date`: the exclusive upper bound for "up to and including `date`". */
export function istNextDayStart(date: string): string { return new Date(new Date(`${date}T00:00:00+05:30`).getTime() + 86_400_000).toISOString() }
/** The instant an offer "ending on" this date stops: the end of that day in India time. */
export function istEndOfDay(date: string): string { return new Date(`${date}T23:59:59+05:30`).toISOString() }

export function toPayload(d: Draft, status: 'draft' | 'active'): OfferPayload {
  const p: OfferPayload = { name: d.name.trim(), kind: d.kind === 'auto' ? 'auto' : 'code', status, rules: d.rules, benefit: benefitOf(d) }
  if (d.kind === 'code') p.code = d.code.trim().toUpperCase()
  const per = num(d.perUserLimit); p.perUserLimit = per ?? null
  const budget = num(d.budgetTotal); p.budgetTotal = budget ?? null
  const limit = num(d.globalLimit); p.globalLimit = limit ?? null
  p.startsAt = d.startsAt ? istStart(d.startsAt) : null
  p.endsAt = d.endsAt ? istEndOfDay(d.endsAt) : null
  return p
}

const istDate = (iso: string | null): string => (iso ? new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : '')

export function draftFromOffer(o: OfferDetail): Draft {
  const v = o.versions[0]
  const b = v?.benefit ?? { type: 'percent_off' as const }
  return {
    name: o.name, kind: o.kind, code: o.code ?? '', benefitType: b.type,
    percent: b.percent != null ? String(b.percent) : '', amount: b.amount != null ? String(b.amount) : '',
    maxDiscount: b.maxDiscount != null ? String(b.maxDiscount) : '', maxCashback: b.maxCashback != null ? String(b.maxCashback) : '',
    expiresInDays: b.expiresInDays != null ? String(b.expiresInDays) : '30',
    rules: (v?.rules ?? []) as Rule[], perUserLimit: v?.per_user_limit != null ? String(v.per_user_limit) : '',
    budgetTotal: o.budget_total != null ? String(parseFloat(o.budget_total)) : '', globalLimit: o.global_limit != null ? String(o.global_limit) : '',
    startsAt: istDate(o.starts_at), endsAt: istDate(o.ends_at),
  }
}

/** True when the terms (rules, benefit, per-rider limit) differ: those need a new version; the rest edit in place. */
export function termsChanged(a: Draft, b: Draft): boolean {
  return JSON.stringify([a.rules, benefitOf(a), num(a.perUserLimit) ?? null]) !== JSON.stringify([b.rules, benefitOf(b), num(b.perUserLimit) ?? null])
}

// ── Validation ───────────────────────────────────────────────────────────────

const positive = (s: string) => s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) > 0

/** Plain messages for everything wrong with a draft. Empty means it can be sent. The server validates again. */
export function validateDraft(d: Draft, meta: OffersMeta, opts: { checkBenefit?: boolean } = {}): string[] {
  const checkBenefit = opts.checkBenefit ?? true
  const errs: string[] = []
  if (!d.name.trim()) errs.push('Give the offer a name.')
  if (d.kind === 'code') {
    if (!d.code.trim()) errs.push('A code offer needs a code.')
    else if (!/^[A-Za-z0-9_-]{3,24}$/.test(d.code.trim())) errs.push('The code must be 3 to 24 letters, numbers, - or _ with no spaces.')
  }
  const cap = meta.capabilities.maxDiscountPercent
  // An existing offer is judged against today's limits only when its terms change: lowering the cap or switching
  // cashback off must not stop an admin renaming it, extending it or topping up its budget.
  if (checkBenefit) {
  if (d.benefitType === 'percent_off') {
    if (!positive(d.percent)) errs.push('Enter the percent off.')
    else if (Number(d.percent) > 100) errs.push('Percent off cannot be more than 100.')
    else if (Number(d.percent) > cap) errs.push(`Percent off cannot be more than ${cap}% (the driver-safe limit set in System Config).`)
    if (d.maxDiscount.trim() !== '' && !positive(d.maxDiscount)) errs.push('Maximum discount must be more than 0.')
  } else if (d.benefitType === 'flat_off') {
    if (!positive(d.amount)) errs.push('Enter the amount off.')
    else {
      const minFare = d.rules.find((r) => r.kind === 'min_fare')?.['amount']
      const needed = Math.ceil((Number(d.amount) * 100) / (cap > 0 ? cap : 15))
      if (typeof minFare !== 'number' || minFare < needed) errs.push(`₹${d.amount} off needs a minimum fare of at least ₹${needed} to stay within ${cap}% of the fare.`)
    }
  } else {
    if (!meta.capabilities.cashback) errs.push('Cashback offers are not switched on yet.')
    if (!positive(d.benefitType === 'cashback_percent' ? d.percent : d.amount)) errs.push('Enter the cashback value.')
    if (!positive(d.expiresInDays)) errs.push('Enter how many days the cashback lasts.')
  }
  }
  for (const r of d.rules) errs.push(...validateRule(r, meta))
  if (d.perUserLimit.trim() !== '' && !(Number.isInteger(Number(d.perUserLimit)) && Number(d.perUserLimit) > 0)) errs.push('Uses per rider must be a whole number, 1 or more.')
  if (d.globalLimit.trim() !== '' && !(Number.isInteger(Number(d.globalLimit)) && Number(d.globalLimit) > 0)) errs.push('Total uses must be a whole number, 1 or more.')
  if (d.budgetTotal.trim() !== '' && !(Number.isFinite(Number(d.budgetTotal)) && Number(d.budgetTotal) >= 0)) errs.push('Budget cannot be negative.')
  if (d.startsAt && d.endsAt && d.endsAt < d.startsAt) errs.push('The end date must be on or after the start date.')
  return errs
}

function validateRule(r: Rule, meta: OffersMeta): string[] {
  const def = meta.rules.find((c) => c.kind === r.kind)
  if (!def) return [`This form does not know the condition "${r.kind}".`]
  const label = def.label
  if (r.kind === 'schedule') {
    const e: string[] = []
    const hasAny = r['startDate'] || r['endDate'] || (Array.isArray(r['weekdays']) && r['weekdays'].length) || r['hours']
    if (!hasAny) e.push(`${label}: choose at least a date, a day or an hour range.`)
    if (r['startDate'] && r['endDate'] && String(r['endDate']) < String(r['startDate'])) e.push(`${label}: the end date comes before the start date.`)
    const h = r['hours'] as { from?: number; to?: number } | undefined
    if (h && !(Number.isInteger(h.from) && Number.isInteger(h.to) && (h.to as number) > (h.from as number))) e.push(`${label}: the hours must end after they start.`)
    return e
  }
  const e: string[] = []
  if (r.kind === 'route') {
    const pairs = (Array.isArray(r['pairs']) ? r['pairs'] : []) as { originCityId?: number; destinationCityId?: number }[]
    if (pairs.length === 0 || pairs.some((p) => !((p.originCityId ?? 0) > 0) || !((p.destinationCityId ?? 0) > 0))) e.push(`${label}: pick a from and a to city for every route.`)
  }
  for (const f of def.fields) {
    const v = r[f.key]
    if (f.type === 'number' && !(typeof v === 'number' && Number.isFinite(v) && v > 0)) e.push(`${label}: enter ${f.label.toLowerCase()}.`)
    if (f.type === 'multi' && f.key !== 'bothDirections' && !(r.kind === 'route' && f.key === 'pairs') && !(Array.isArray(v) && v.length > 0)) e.push(`${label}: choose at least one.`)
  }
  return e
}

// ── Pre-publish checklist (a warning, never a block) ─────────────────────────

export type CheckItem = { id: string; ok: boolean; text: string }

export function publishChecklist(d: Draft, meta: OffersMeta): CheckItem[] {
  const cashRule = d.rules.find((r) => r.kind === 'payment_channel')
  const cashIncluded = !cashRule || (Array.isArray(cashRule['channels']) && (cashRule['channels'] as string[]).includes('cash'))
  return [
    { id: 'budget', ok: d.budgetTotal.trim() !== '', text: d.budgetTotal.trim() !== '' ? `Budget is ₹${Number(d.budgetTotal).toLocaleString('en-IN')}.` : 'No budget set. The offer can give away discounts without a limit.' },
    { id: 'end', ok: d.endsAt !== '', text: d.endsAt ? `Ends on ${d.endsAt}.` : 'No end date. It runs until someone pauses it.' },
    {
      id: 'cash', ok: !(cashIncluded && !meta.capabilities.cashDiscounts),
      text: cashIncluded && !meta.capabilities.cashDiscounts
        ? 'Cash rides will not get this yet: cash discounts are switched off in System Config. Online and wallet rides will.'
        : 'Payment methods are covered.',
    },
    { id: 'limit', ok: d.perUserLimit.trim() !== '' || d.rules.some((r) => r.kind === 'new_user' || r.kind === 'first_n_rides'), text: d.perUserLimit.trim() !== '' || d.rules.some((r) => r.kind === 'new_user' || r.kind === 'first_n_rides') ? 'Each rider is limited.' : 'No limit per rider. One rider can use it on every ride.' },
  ]
}

// ── Display helpers ──────────────────────────────────────────────────────────

/** How much of the budget is used, 0 to 100, or null when there is no budget. */
export function budgetUsedPercent(spent: string | number, total: string | number | null): number | null {
  if (total == null) return null
  const t = Number(total)
  if (!(t > 0)) return null
  return Math.min(100, Math.round((Number(spent) / t) * 100))
}

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The rows on screen as CSV (what the admin has filtered to). */
export function redemptionsCsv(rows: Redemption[]): string {
  const head = ['Redemption', 'Ride', 'Rider', 'Status', 'Discount', 'Cashback', 'Reserved at', 'Consumed at', 'Released at', 'Reason']
  const lines = rows.map((r) => [r.id, r.ride_id, r.user_id, r.status, r.discount_amount, r.cashback_amount, r.reserved_at, r.consumed_at, r.released_at, r.reason].map(csvCell).join(','))
  return [head.join(','), ...lines].join('\n')
}
