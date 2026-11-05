import { describe, it, expect, vi } from 'vitest'

vi.mock('@/config', () => ({ config: { NODE_ENV: 'test' } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn() }))

import { cashDiscountGuard, type CashGuardState } from '@/modules/offers/cash-discount-guard'
import { CASH_DUE_MIN_DRIVER_VERSION } from '@/constants/limits'

// Value: protects=cash discounts can never be on while an old driver build (which would tell the driver to collect the
// undiscounted fare) is still allowed, and the update gate that enforces it cannot be turned off under them; fails_when=a
// direction of the guard is dropped; why_new=review decision D18, the go-live safety; seam=none; no_claim=the route wiring
// (admin config route test).
const V = CASH_DUE_MIN_DRIVER_VERSION
const state = (o: Partial<CashGuardState> = {}): CashGuardState => ({ cashDiscounts: 'false', driverAndroidMin: '0.0.0', updateGateEnabled: 'true', ...o })

describe('cashDiscountGuard', () => {
  it('can be lifted on purpose: with the switch off, cash discounts may be on below the build, and the minimum may be lowered', () => {
    const lifted = state({ driverAndroidMin: '0.0.0', guardEnforced: 'false' })
    expect(cashDiscountGuard('offers_cash_discounts_enabled', 'true', lifted)).toBeNull()
    expect(cashDiscountGuard('app_update_driver_android_min', '0.0.0', state({ cashDiscounts: 'true', guardEnforced: 'false' }))).toBeNull()
  })
  it('lifting it (turning the switch off) is allowed at any time, even with cash discounts on', () => {
    expect(cashDiscountGuard('offers_cash_guard_enforced', 'false', state({ cashDiscounts: 'true', driverAndroidMin: '0.0.0' }))).toBeNull()
  })
  it('putting it back is refused while cash discounts are on and the minimum is still low, and allowed once it is raised or cash discounts are off', () => {
    const on = state({ cashDiscounts: 'true', driverAndroidMin: '1.0.0', guardEnforced: 'false' })
    expect(cashDiscountGuard('offers_cash_guard_enforced', 'true', on)).toMatch(/before the guard can go back on/)
    expect(cashDiscountGuard('offers_cash_guard_enforced', 'true', { ...on, driverAndroidMin: V })).toBeNull()
    expect(cashDiscountGuard('offers_cash_guard_enforced', 'true', { ...on, cashDiscounts: 'false' })).toBeNull()
  })
  it('is enforced when the switch is absent (older callers)', () => {
    expect(cashDiscountGuard('offers_cash_discounts_enabled', 'true', state({ driverAndroidMin: '1.1.0' }))).not.toBeNull()
  })
  it('ignores every other setting', () => {
    expect(cashDiscountGuard('commission_percent', '15', state())).toBeNull()
    expect(cashDiscountGuard('app_update_rider_android_min', '0.0.0', state({ cashDiscounts: 'true' }))).toBeNull()
  })

  it('refuses switching cash discounts on while the driver minimum is below the cash_due build, naming what to raise', () => {
    const msg = cashDiscountGuard('offers_cash_discounts_enabled', 'true', state({ driverAndroidMin: '1.1.0' }))
    expect(msg).toMatch(new RegExp(`at least ${V.replace(/\./g, '\\.')}`))
    expect(msg).toMatch(/Raise it first/)
  })

  it('allows it once the minimum is at or above the build', () => {
    expect(cashDiscountGuard('offers_cash_discounts_enabled', 'true', state({ driverAndroidMin: V }))).toBeNull()
    expect(cashDiscountGuard('offers_cash_discounts_enabled', 'true', state({ driverAndroidMin: '2.0.0' }))).toBeNull()
  })

  it('refuses lowering the minimum while cash discounts are on, and allows raising it', () => {
    const on = state({ cashDiscounts: 'true', driverAndroidMin: V })
    expect(cashDiscountGuard('app_update_driver_android_min', '1.1.0', on)).toMatch(/Switch cash discounts off first/)
    expect(cashDiscountGuard('app_update_driver_android_min', '0.0.0', on)).not.toBeNull()
    expect(cashDiscountGuard('app_update_driver_android_min', '1.9.0', on)).toBeNull()
  })

  it('lowering the minimum is fine while cash discounts are off', () => {
    expect(cashDiscountGuard('app_update_driver_android_min', '0.0.0', state({ driverAndroidMin: V }))).toBeNull()
  })

  it('needs the update gate on, both when enabling and when trying to turn the gate off', () => {
    const gateOff = state({ driverAndroidMin: V, updateGateEnabled: 'false' })
    expect(cashDiscountGuard('offers_cash_discounts_enabled', 'true', gateOff)).toMatch(/update gate/)
    const on = state({ cashDiscounts: 'true', driverAndroidMin: V })
    expect(cashDiscountGuard('app_update_enabled', 'false', on)).toMatch(/must stay on/)
    expect(cashDiscountGuard('app_update_enabled', 'true', on)).toBeNull()
  })

  it('switching cash discounts off is always allowed', () => {
    expect(cashDiscountGuard('offers_cash_discounts_enabled', 'false', state({ cashDiscounts: 'true', driverAndroidMin: '0.0.0', updateGateEnabled: 'false' }))).toBeNull()
  })

  it('a malformed minimum counts as below the build', () => {
    expect(cashDiscountGuard('offers_cash_discounts_enabled', 'true', state({ driverAndroidMin: 'oops' }))).not.toBeNull()
  })
})
