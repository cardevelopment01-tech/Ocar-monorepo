import { CASH_DUE_MIN_DRIVER_VERSION } from '@/constants/limits'
import { compareVersions } from '@/modules/app-version/app-version.policy'

// Cash discounts change what a DRIVER collects. A driver build older than the one that shows cash_due would tell the
// driver to collect the undiscounted fare, so the switch may only be on while old builds are locked out. The guard
// holds in both directions: you cannot turn the flag on below the version, and you cannot lower the version (or turn the
// update gate off) while the flag is on.
//
// The guard can be lifted on purpose with offers_cash_guard_enforced = 'false' (default 'true'), for internal testing
// before the cash_due driver build is in production. While lifted, a discounted cash ride that reaches a driver on an
// older build shows that driver the undiscounted fare, so lift it only while the rides are the testers' own. It cannot
// be put back on while cash discounts are on and the driver minimum is still below the build (same rule as above).

const MIN_KEY = 'app_update_driver_android_min'
const ENFORCED_KEY = 'offers_cash_guard_enforced'
export const CASH_GUARD_KEYS = ['offers_cash_discounts_enabled', MIN_KEY, 'app_update_enabled', ENFORCED_KEY] as const

export type CashGuardState = {
  cashDiscounts: string
  driverAndroidMin: string
  updateGateEnabled: string
  /** 'false' lifts the guard. Absent reads as enforced. */
  guardEnforced?: string
}

const needs = `app_update_driver_android_min must be at least ${CASH_DUE_MIN_DRIVER_VERSION}`

/**
 * An error message when saving `key = value` would leave cash discounts on with old driver builds still allowed, else
 * null. `current` is what the three settings hold now; the one being saved is replaced by `value`.
 */
export function cashDiscountGuard(key: string, value: string, current: CashGuardState): string | null {
  if (!(CASH_GUARD_KEYS as readonly string[]).includes(key)) return null
  const next: CashGuardState = {
    cashDiscounts: key === 'offers_cash_discounts_enabled' ? value : current.cashDiscounts,
    driverAndroidMin: key === MIN_KEY ? value : current.driverAndroidMin,
    updateGateEnabled: key === 'app_update_enabled' ? value : current.updateGateEnabled,
    guardEnforced: key === ENFORCED_KEY ? value : (current.guardEnforced ?? 'true'),
  }
  if (next.cashDiscounts !== 'true') return null
  if (next.guardEnforced === 'false') return null

  const cmp = compareVersions(next.driverAndroidMin, CASH_DUE_MIN_DRIVER_VERSION)
  if (cmp === null || cmp < 0) {
    if (key === ENFORCED_KEY) return `${needs} (it is ${current.driverAndroidMin} now) before the guard can go back on while cash discounts are on. Switch cash discounts off first.`
    return key === 'offers_cash_discounts_enabled'
      ? `Cash discounts can only be switched on once ${needs} (it is ${current.driverAndroidMin} now), so older driver apps are blocked. Raise it first.`
      : `${needs} while cash discounts are on, or older driver apps would collect the wrong amount. Switch cash discounts off first.`
  }
  if (next.updateGateEnabled !== 'true') {
    if (key === ENFORCED_KEY) return 'The app update gate (app_update_enabled) must be on before the guard can go back on while cash discounts are on. Switch cash discounts off first.'
    return key === 'offers_cash_discounts_enabled'
      ? 'Cash discounts need the app update gate on (app_update_enabled), or the minimum driver version is not enforced.'
      : 'The app update gate must stay on while cash discounts are on, or the minimum driver version is not enforced. Switch cash discounts off first.'
  }
  return null
}
