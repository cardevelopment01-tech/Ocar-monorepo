import type { SystemConfig } from './system-config-api'

// Presentation + validation model for the System Config page. The database only knows
// key / value / valueType / description; everything an admin actually needs to act safely
// (a human name, which group it belongs to, its unit, whether it hits live money) lives
// here. Keys missing from META still appear, under "Other" and humanised, so adding a key
// in a migration never makes it disappear from the admin UI.
//
// Numeric ranges are NOT duplicated here: the API owns them (api/src/lib/system-config-bounds.ts)
// and returns min/max on each row.

export type GroupId = 'payments' | 'payouts' | 'cash' | 'masking' | 'drivers' | 'rewards' | 'other' | 'legacy'
export type Kind = 'switch' | 'number' | 'text' | 'json'

export interface Group { id: GroupId; title: string; blurb: string }

export const GROUPS: readonly Group[] = [
  { id: 'payments', title: 'Payments & fees',         blurb: 'Commission, the payment gateway and tax withholding.' },
  { id: 'payouts',  title: 'Driver payouts & wallet', blurb: 'How and when drivers get paid.' },
  { id: 'cash',     title: 'Cash collection',         blurb: 'Rules for rides paid in cash.' },
  { id: 'masking',  title: 'Call masking',            blurb: 'Private calls between riders and drivers.' },
  { id: 'drivers',  title: 'Driver conduct',          blurb: 'Warnings and automatic suspension.' },
  { id: 'rewards',  title: 'Rewards & referrals',     blurb: 'Cashback and sign-up bonuses.' },
  { id: 'other',    title: 'Other',                   blurb: 'Settings without a dedicated group yet.' },
  { id: 'legacy',   title: 'Unused (legacy)',         blurb: 'Kept in the database but no longer read by the platform.' },
]

interface Meta {
  title: string
  help: string
  group: GroupId
  /** Override when the DB valueType is misleading (e.g. a boolean stored as `string`). */
  kind?: Kind
  prefix?: string
  suffix?: string
  /** Changes take effect on live rides / payments, so review asks for an extra acknowledgement. */
  critical?: boolean
}

const LEGACY_HELP = 'Not read by the platform since call masking moved to bulksmsplans.'

// Order of definition = display order inside a group.
const META: Record<string, Meta> = {
  commission_percent:       { group: 'payments', title: 'Platform commission', help: 'Share of each fare that Ocar keeps.', suffix: '%', critical: true },
  instant_payout_fee:       { group: 'payments', title: 'Instant cash-out fee', help: 'Flat fee charged when a driver cashes out instantly.', prefix: '₹' },
  razorpay_enabled:         { group: 'payments', title: 'Razorpay payments', help: 'Lets riders pay online through Razorpay.', critical: true },
  tds_rate_with_pan_pct:    { group: 'payments', title: 'TDS rate (PAN verified)', help: 'Section 194-O tax withheld when the driver’s PAN is verified.', suffix: '%', critical: true },
  tds_rate_without_pan_pct: { group: 'payments', title: 'TDS rate (no PAN)', help: 'Section 194-O tax withheld when PAN isn’t verified or on file.', suffix: '%', critical: true },

  driver_payouts_enabled:        { group: 'payouts', title: 'Instant cash-out', help: 'Shows “Cash Out Now” in the driver app and accepts payout requests. Keep off until RazorpayX payouts are verified.', critical: true },
  payout_hold_hours:             { group: 'payouts', title: 'Earnings hold period', help: 'Hours before cleared earnings become payable.', suffix: ' hours' },
  settlement_auto_approve_limit: { group: 'payouts', title: 'Auto-approve settlement limit', help: 'Scheduled settlement batches below this total advance without manual approval.', prefix: '₹', critical: true },
  driver_minimum_balance:        { group: 'payouts', title: 'Minimum wallet balance to go online', help: 'A driver below this balance can’t go online. A large negative number turns the check off.', prefix: '₹', critical: true },

  cash_collection_enabled:   { group: 'cash', kind: 'switch', title: 'Confirm cash collection', help: 'Cash rides need the driver to confirm the amount collected before settling. Off settles automatically at trip end.', critical: true },
  cash_collection_tolerance: { group: 'cash', kind: 'number', title: 'Cash discrepancy tolerance', help: 'A difference between collected cash and the fare above this many rupees is flagged for review.', prefix: '₹' },

  call_masking_enabled:            { group: 'masking', title: 'Masked calling', help: 'Kill switch. Keep off until bulksmsplans IVR credit is loaded and verified end to end.', critical: true },
  call_masking_max_calls_per_ride: { group: 'masking', title: 'Calls per ride', help: 'Maximum masked-call attempts for one ride, to blunt repeat-dial abuse.', suffix: ' calls' },
  call_masking_credit_floor:       { group: 'masking', title: 'Credit floor', help: 'If IVR credit drops below this, masking switches itself off until re-enabled.', prefix: '₹' },

  driver_warning_suspend_threshold: { group: 'drivers', title: 'Warnings before auto-suspension', help: 'Warnings inside the window that automatically suspend a driver.', suffix: ' warnings' },
  driver_warning_window_days:       { group: 'drivers', title: 'Warning window', help: 'How far back warnings are counted.', suffix: ' days' },

  cashback_ride_percent:   { group: 'rewards', title: 'Cashback per ride', help: 'Cashback credited to riders on each completed ride.', suffix: '%' },
  cashback_expiry_days:    { group: 'rewards', title: 'Cashback expiry', help: 'Days before unused cashback credits expire.', suffix: ' days' },
  referral_referrer_bonus: { group: 'rewards', title: 'Referrer bonus', help: 'Credited to the existing user when their referral takes a first ride.', prefix: '₹' },
  referral_referee_bonus:  { group: 'rewards', title: 'New-user bonus', help: 'Credited to the new user on their first ride.', prefix: '₹' },

  exotel_masking_enabled:         { group: 'legacy', title: 'Exotel masked calling', help: LEGACY_HELP },
  exotel_max_calls_per_ride:      { group: 'legacy', title: 'Exotel calls per ride', help: LEGACY_HELP, suffix: ' calls' },
  exotel_call_time_limit_seconds: { group: 'legacy', title: 'Exotel call time limit', help: LEGACY_HELP, suffix: ' seconds' },
  exotel_daily_budget_inr:        { group: 'legacy', title: 'Exotel daily budget', help: LEGACY_HELP, prefix: '₹' },
}

const META_ORDER = new Map(Object.keys(META).map((k, i) => [k, i]))

export interface Resolved {
  config: SystemConfig
  title: string
  help: string
  group: GroupId
  kind: Kind
  prefix: string
  suffix: string
  critical: boolean
}

function humanise(key: string): string {
  const s = key.replace(/_/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function resolve(config: SystemConfig): Resolved {
  const meta = META[config.key]
  const inferred: Kind =
    config.valueType === 'boolean' ? 'switch'
    : config.valueType === 'integer' || config.valueType === 'decimal' ? 'number'
    : config.valueType === 'json' ? 'json'
    : 'text'
  return {
    config,
    title: meta?.title ?? humanise(config.key),
    help: meta?.help ?? config.description ?? '',
    group: meta?.group ?? 'other',
    kind: meta?.kind ?? inferred,
    prefix: meta?.prefix ?? '',
    suffix: meta?.suffix ?? '',
    critical: meta?.critical ?? false,
  }
}

/** Grouped, ordered, optionally search-filtered. Empty groups are dropped. */
export function buildSections(configs: SystemConfig[], query: string): Array<{ group: Group; items: Resolved[] }> {
  const q = query.trim().toLowerCase()
  const resolved = configs.map(resolve)
  return GROUPS.map(group => {
    const items = resolved
      .filter(r => r.group === group.id)
      .filter(r => q === '' || [r.title, r.help, r.config.key, group.title].some(s => s.toLowerCase().includes(q)))
      .sort((a, b) =>
        (META_ORDER.get(a.config.key) ?? 1e6) - (META_ORDER.get(b.config.key) ?? 1e6) ||
        a.config.key.localeCompare(b.config.key))
    return { group, items }
  }).filter(s => s.items.length > 0)
}

/** Inline validation for a draft value; null = OK. Mirrors (never replaces) the API's checks. */
export function validateDraft(r: Resolved, draft: string): string | null {
  const { config } = r
  switch (r.kind) {
    case 'switch':
      return draft === 'true' || draft === 'false' ? null : 'Choose on or off'
    case 'number': {
      const t = draft.trim()
      if (t === '') return 'Enter a value'
      const whole = config.valueType === 'integer'
      if (!(whole ? /^-?\d+$/.test(t) : /^-?\d+(\.\d+)?$/.test(t))) return whole ? 'Whole numbers only' : 'Enter a number'
      const n = Number(t)
      if (config.min !== null && config.max !== null && (n < config.min || n > config.max)) {
        return `Must be between ${config.min.toLocaleString('en-IN')} and ${config.max.toLocaleString('en-IN')}`
      }
      return null
    }
    case 'json':
      try { JSON.parse(draft); return null } catch { return 'Must be valid JSON' }
    default:
      return draft.trim() === '' ? 'Enter a value' : null
  }
}

/** Human display of a stored value, with its unit. */
export function formatValue(r: Resolved, value: string): string {
  if (r.kind === 'switch') return value === 'true' ? 'On' : 'Off'
  if (r.kind === 'number') {
    const n = Number(value)
    const shown = Number.isFinite(n) ? n.toLocaleString('en-IN') : value
    return `${r.prefix}${shown}${r.suffix}`
  }
  return value.length > 48 ? `${value.slice(0, 47)}…` : value
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime()
  if (!Number.isFinite(diff)) return ''
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
