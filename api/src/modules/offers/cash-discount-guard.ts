import { CASH_DUE_MIN_DRIVER_VERSION } from '@/constants/limits'
import { compareVersions } from '@/modules/app-version/app-version.policy'

// Cash discounts change what a DRIVER collects. A driver build older than the one that shows cash_due would tell the
// driver to collect the undiscounted fare, so the switch may only be on while old builds are locked out. The guard
// holds in both directions: you cannot turn the flag on below the version, and you cannot lower the version (or turn the
// update gate off) while the flag is on.

const MIN_KEY = 'app_update_driver_android_min'
export const CASH_GUARD_KEYS = ['offers_cash_discounts_enabled', MIN_KEY, 'app_update_enabled'] as const

export type CashGuardState = {
  cashDiscounts: string
  driverAndroidMin: string
  updateGateEnabled: string
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
  }
  if (next.cashDiscounts !== 'true') return null

  const cmp = compareVersions(next.driverAndroidMin, CASH_DUE_MIN_DRIVER_VERSION)
  if (cmp === null || cmp < 0) {
    return key === 'offers_cash_discounts_enabled'
      ? `Cash discounts can only be switched on once ${needs} (it is ${current.driverAndroidMin} now), so older driver apps are blocked. Raise it first.`
      : `${needs} while cash discounts are on, or older driver apps would collect the wrong amount. Switch cash discounts off first.`
  }
  if (next.updateGateEnabled !== 'true') {
    return key === 'offers_cash_discounts_enabled'
      ? 'Cash discounts need the app update gate on (app_update_enabled), or the minimum driver version is not enforced.'
      : 'The app update gate must stay on while cash discounts are on, or the minimum driver version is not enforced. Switch cash discounts off first.'
  }
  return null
}
