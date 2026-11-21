import type { PackageTier } from './package-api'

// The logic behind the Package Tiers page, kept out of the component so it is unit-tested. The server (api package-tier-rules.ts) is the one
// that decides what can be saved; these checks say the same things early, field by field, so the admin does not wait for a rejected save.

export type Group = 'cab' | 'auto'
export const GROUP_LABEL: Record<Group, string> = { cab: 'Cabs', auto: 'Autos' }

export interface TierForm {
  label: string
  price: string
  thresholdValue: string
  vehicleGroup: Group
  validityDays: string
}

export const EMPTY_FORM: TierForm = { label: '', price: '', thresholdValue: '', vehicleGroup: 'cab', validityDays: '365' }

export const MAX_LABEL_LENGTH = 100
export const MAX_AMOUNT = 10_000_000
export const MAX_VALIDITY_DAYS = 3650
export const VALIDITY_SHORTCUTS = [30, 90, 180, 365] as const

export function formFromTier(t: PackageTier): TierForm {
  return {
    label: t.label, price: String(parseFloat(t.price)), thresholdValue: String(parseFloat(t.threshold_value)),
    vehicleGroup: t.vehicle_group, validityDays: String(t.validity_days),
  }
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** What the driver is charged, worked out exactly as the server does it (GST on top of the price, to the paisa). */
export function pricing(price: number, gstPercent: number): { price: number; gst: number; total: number } {
  const p = r2(price)
  const gst = r2((p * gstPercent) / 100)
  return { price: p, gst, total: r2(p + gst) }
}

/** Ride value per rupee of price: 5500 for 250 is 22. */
export function multiple(price: number, value: number): number {
  return price > 0 ? value / price : 0
}

/** '22×', '13.8×': one decimal only when it is not a whole number. */
export function formatMultiple(m: number): string {
  return `${Number.isInteger(m) ? m : m.toFixed(1)}×`
}

/** Indian grouping. Whole rupees drop the paise ('₹5,500'); anything else keeps two decimals ('₹47.20'); `paise: true` always shows them. */
export function inr(v: number | string, opts: { paise?: boolean } = {}): string {
  const n = typeof v === 'number' ? v : parseFloat(v)
  if (!Number.isFinite(n)) return '₹—'
  const whole = Math.abs(n - Math.round(n)) < 0.005 && !opts.paise
  return `₹${n.toLocaleString('en-IN', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const hasAtMostPaise = (n: number) => Number.isFinite(n) && Math.abs(Math.round(n * 100) - n * 100) < 1e-6
const num = (s: string) => (s.trim() === '' ? NaN : Number(s))

export interface FormCheck {
  errors: Partial<Record<'label' | 'price' | 'thresholdValue' | 'validityDays' | 'form', string>>
  warnings: string[]
}

/**
 * Field-by-field problems (errors stop the save) and things worth a second look (warnings do not).
 * `tiers` are the saved plans; `editingId` is the plan being edited, so it does not count as its own duplicate or neighbour.
 */
export function checkForm(form: TierForm, tiers: readonly PackageTier[], editingId: number | null): FormCheck {
  const errors: FormCheck['errors'] = {}
  const warnings: string[] = []
  const label = form.label.trim()
  const price = num(form.price), value = num(form.thresholdValue), days = num(form.validityDays)

  if (!label) errors.label = 'Give the plan a name.'
  else if (label.length > MAX_LABEL_LENGTH) errors.label = `The name can be at most ${MAX_LABEL_LENGTH} characters.`

  if (form.price.trim() === '' || !Number.isFinite(price) || price <= 0) errors.price = 'Enter a price above zero.'
  else if (price > MAX_AMOUNT) errors.price = 'That price is too large.'
  else if (!hasAtMostPaise(price)) errors.price = 'The price can have at most two decimal places.'

  if (form.thresholdValue.trim() === '' || !Number.isFinite(value) || value <= 0) errors.thresholdValue = 'Enter the ride value above zero.'
  else if (value > MAX_AMOUNT) errors.thresholdValue = 'That ride value is too large.'
  else if (!hasAtMostPaise(value)) errors.thresholdValue = 'The ride value can have at most two decimal places.'
  else if (!errors.price && value < price) errors.thresholdValue = 'The ride value must be at least the price: the driver would pay more than they can spend.'

  if (!Number.isInteger(days) || days < 1 || days > MAX_VALIDITY_DAYS) errors.validityDays = `Whole days, from 1 to ${MAX_VALIDITY_DAYS}.`

  if (!errors.price && !errors.thresholdValue) {
    const others = tiers.filter((t) => t.id !== editingId && t.is_active && t.vehicle_group === form.vehicleGroup)
    if (others.some((t) => parseFloat(t.price) === price && parseFloat(t.threshold_value) === value)) {
      errors.form = 'An active plan with the same price and ride value already exists for these drivers.'
    }
    if (value === price) warnings.push('No bonus: the driver gets exactly the ride value they pay for.')
    // Compare with the closest cheaper plan: a bigger plan should not give less ride value per rupee.
    const cheaper = others.filter((t) => parseFloat(t.price) < price).sort((a, b) => parseFloat(b.price) - parseFloat(a.price))[0]
    if (cheaper) {
      const m = multiple(price, value), cm = multiple(parseFloat(cheaper.price), parseFloat(cheaper.threshold_value))
      if (m < cm) warnings.push(`Gives ${formatMultiple(m)} ride value per ₹ of price, less than the ${inr(cheaper.price)} plan (${formatMultiple(cm)}). Bigger plans usually give more.`)
    }
  }
  return { errors, warnings }
}

export const hasErrors = (c: FormCheck) => Object.keys(c.errors).length > 0

/** Active plans that give less ride value per ₹ than the closest cheaper active plan for the same drivers: usually a typo or a pricing slip. */
export function lowerValueIds(tiers: readonly PackageTier[]): Set<number> {
  const out = new Set<number>()
  for (const group of ['cab', 'auto'] as const) {
    const active = tiers.filter((t) => t.is_active && t.vehicle_group === group).sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
    for (let i = 1; i < active.length; i++) {
      const prev = active[i - 1]!, cur = active[i]!
      if (parseFloat(cur.price) === parseFloat(prev.price)) continue
      if (multiple(parseFloat(cur.price), parseFloat(cur.threshold_value)) < multiple(parseFloat(prev.price), parseFloat(prev.threshold_value))) out.add(cur.id)
    }
  }
  return out
}

export interface Summary {
  active: number; total: number; gstPercent: number | null
  /** The validity most live plans share (the longer one when tied), or null with no live plans. */
  usualValidityDays: number | null
  byGroup: Record<Group, { total: number; active: number }>
}

export function summarize(tiers: readonly PackageTier[]): Summary {
  const byGroup: Summary['byGroup'] = { cab: { total: 0, active: 0 }, auto: { total: 0, active: 0 } }
  const days = new Map<number, number>()
  for (const t of tiers) {
    byGroup[t.vehicle_group].total++
    if (t.is_active) { byGroup[t.vehicle_group].active++; days.set(t.validity_days, (days.get(t.validity_days) ?? 0) + 1) }
  }
  const usual = [...days.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null
  return { active: tiers.filter((t) => t.is_active).length, total: tiers.length, gstPercent: tiers[0]?.gst_percent ?? null, usualValidityDays: usual, byGroup }
}

/** The message to show for a failed request: the server's own words when it sent any, else a plain fallback. */
export function errorMessage(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error
  return typeof msg === 'string' && msg.trim() ? msg : fallback
}
