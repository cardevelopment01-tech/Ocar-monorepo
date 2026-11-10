import { describe, it, expect } from 'vitest'
import { getConfigBounds, validateConfigBounds } from '@/lib/system-config-bounds'

describe('validateConfigBounds', () => {
  it('accepts values inside the range, including the edges', () => {
    expect(validateConfigBounds('commission_percent', '15')).toBeNull()
    expect(validateConfigBounds('commission_percent', '0')).toBeNull()
    expect(validateConfigBounds('commission_percent', '50')).toBeNull()
  })
  it('rejects a typo that would parse fine as a number', () => {
    expect(validateConfigBounds('commission_percent', '1500')).toMatch(/between 0 and 50/)
    expect(validateConfigBounds('commission_percent', '-1')).toMatch(/between 0 and 50/)
  })
  it('allows the negative driver_minimum_balance ops uses to disable the recharge gate', () => {
    expect(validateConfigBounds('driver_minimum_balance', '-999999')).toBeNull()
    expect(validateConfigBounds('driver_minimum_balance', '-2000000')).not.toBeNull()
  })
  it('treats string-typed booleans as true/false only', () => {
    expect(validateConfigBounds('cash_collection_enabled', 'true')).toBeNull()
    expect(validateConfigBounds('cash_collection_enabled', 'maybe')).toMatch(/one of: true, false/)
    expect(validateConfigBounds('mobile_payments_enabled', 'true')).toBeNull()
    expect(validateConfigBounds('mobile_payments_enabled', 'false')).toBeNull()
    expect(validateConfigBounds('mobile_payments_enabled', 'True')).toMatch(/one of: true, false/)
    expect(validateConfigBounds('mobile_payments_enabled', 'yes')).toMatch(/one of: true, false/)
  })
  it('leaves unlisted keys unbounded', () => {
    expect(getConfigBounds('some_future_key')).toBeNull()
    expect(validateConfigBounds('some_future_key', 'anything')).toBeNull()
  })
  it('rejects non-numeric input on a bounded key', () => {
    expect(validateConfigBounds('cash_collection_tolerance', 'abc')).toMatch(/number/)
  })
})

describe('dispatch switches', () => {
  it.each(['dispatch_no_resend_enabled', 'dispatch_head_start_enabled', 'dispatch_spread_enabled', 'dispatch_fast_rounds_enabled', 'dispatch_decision_log_enabled', 'eta_shadow_enabled'])('%s accepts only true or false', (key) => {
    expect(validateConfigBounds(key, 'true')).toBeNull()
    expect(validateConfigBounds(key, 'false')).toBeNull()
    expect(validateConfigBounds(key, 'yes')).not.toBeNull()
  })

  it('dispatch_spread_city_ids is empty or a comma list of ids', () => {
    for (const ok of ['', '1', '1,2,13']) expect(validateConfigBounds('dispatch_spread_city_ids', ok)).toBeNull()
    for (const bad of ['1, 2', 'a', '1,', ',1', '1;2']) expect(validateConfigBounds('dispatch_spread_city_ids', bad)).not.toBeNull()
  })
})

describe('idle driver settings', () => {
  it('accepts values inside the range and refuses typos', () => {
    expect(validateConfigBounds('driver_idle_pause_seconds', '90')).toBeNull()
    expect(validateConfigBounds('driver_idle_pause_seconds', '9')).not.toBeNull()
    expect(validateConfigBounds('driver_idle_offline_minutes', '60')).toBeNull()
    expect(validateConfigBounds('driver_idle_offline_minutes', '6000')).not.toBeNull()
  })
})
