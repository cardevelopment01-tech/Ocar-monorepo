// What a ride-credit plan must look like to be saved. Pure, so the admin API enforces it the same way whatever sends the request
// (the admin page checks the same rules before it sends, to tell the admin early, but the server is the one that decides).

export const MAX_LABEL_LENGTH = 100        // package_tiers.label is VARCHAR(100)
export const MAX_AMOUNT = 10_000_000       // far above any plan, far below the NUMERIC(10,2) overflow (99,999,999.99)
export const MAX_VALIDITY_DAYS = 3650      // package_tiers_validity_days_check

export interface TierFields {
  label: string
  price: number
  thresholdValue: number
  validityDays: number
}

/** True when the amount has at most two decimal places (paise). A third decimal would be rounded away by the database without telling anyone. */
export function hasAtMostPaise(n: number): boolean {
  return Number.isFinite(n) && Math.abs(Math.round(n * 100) - n * 100) < 1e-6
}

/**
 * The first reason a plan cannot be saved, in words an admin can act on, or null when it is fine.
 * A plan must give the driver at least as much ride value as the price they pay: a plan worth less than its price is a typo, not a plan.
 */
export function validateTierFields(t: TierFields): string | null {
  const label = t.label.trim()
  if (!label) return 'Give the plan a name.'
  if (label.length > MAX_LABEL_LENGTH) return `The name can be at most ${MAX_LABEL_LENGTH} characters.`
  if (!Number.isFinite(t.price) || t.price <= 0) return 'Enter a price above zero.'
  if (t.price > MAX_AMOUNT) return 'That price is too large.'
  if (!hasAtMostPaise(t.price)) return 'The price can have at most two decimal places.'
  if (!Number.isFinite(t.thresholdValue) || t.thresholdValue <= 0) return 'Enter the ride value above zero.'
  if (t.thresholdValue > MAX_AMOUNT) return 'That ride value is too large.'
  if (!hasAtMostPaise(t.thresholdValue)) return 'The ride value can have at most two decimal places.'
  if (t.thresholdValue < t.price) return 'The ride value must be at least the price: the driver would pay more than they can spend.'
  if (!Number.isInteger(t.validityDays) || t.validityDays < 1 || t.validityDays > MAX_VALIDITY_DAYS) {
    return `Validity must be a whole number of days from 1 to ${MAX_VALIDITY_DAYS}.`
  }
  return null
}

/** Ride value per rupee of price: 5500 for 250 is 22. Used to spot a plan that is a worse deal than a cheaper one. */
export function valueMultiple(price: number, thresholdValue: number): number {
  return price > 0 ? thresholdValue / price : 0
}
