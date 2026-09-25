// Server-side guardrails for system_config edits. `validateConfigValue` only checks that a
// value parses as its declared type; a typo like commission_percent = 1500 parses fine but
// would break payments. Bounds are the source of truth — the admin UI reads them from the
// list response (min/max) for inline validation, and the PATCH route enforces them here.
//
// Keys not listed are unbounded (type check only), so a newly added key is editable
// without touching this file.

export interface ConfigBounds { min: number; max: number }

const BOUNDS: Record<string, ConfigBounds> = {
  commission_percent:               { min: 0, max: 50 },
  instant_payout_fee:               { min: 0, max: 1_000 },
  tds_rate_with_pan_pct:            { min: 0, max: 100 },
  tds_rate_without_pan_pct:         { min: 0, max: 100 },
  payout_hold_hours:                { min: 0, max: 720 },
  settlement_auto_approve_limit:    { min: 0, max: 10_000_000 },
  // Negative on purpose: ops uses -999999 to disable the recharge gate entirely.
  driver_minimum_balance:           { min: -1_000_000, max: 100_000 },
  cash_collection_tolerance:        { min: 0, max: 1_000 },
  driver_warning_suspend_threshold: { min: 1, max: 20 },
  driver_warning_window_days:       { min: 1, max: 365 },
  call_masking_max_calls_per_ride:  { min: 1, max: 50 },
  call_masking_credit_floor:        { min: 0, max: 100_000 },
  cashback_ride_percent:            { min: 0, max: 50 },
  cashback_expiry_days:             { min: 1, max: 3_650 },
  referral_referrer_bonus:          { min: 0, max: 10_000 },
  referral_referee_bonus:           { min: 0, max: 10_000 },
  exotel_max_calls_per_ride:        { min: 1, max: 50 },
  exotel_call_time_limit_seconds:   { min: 30, max: 3_600 },
  exotel_daily_budget_inr:          { min: 0, max: 100_000 },
}

// Typed `string` in the table but really booleans — free text here would silently break the reader.
const ALLOWED_VALUES: Record<string, readonly string[]> = {
  cash_collection_enabled: ['true', 'false'],
}

export function getConfigBounds(key: string): ConfigBounds | null {
  return BOUNDS[key] ?? null
}

export function validateConfigBounds(key: string, value: string): string | null {
  const allowed = ALLOWED_VALUES[key]
  if (allowed && !allowed.includes(value)) return `value must be one of: ${allowed.join(', ')}`

  const bounds = BOUNDS[key]
  if (!bounds) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return 'value must be a number'
  if (n < bounds.min || n > bounds.max) return `value must be between ${bounds.min} and ${bounds.max}`
  return null
}
