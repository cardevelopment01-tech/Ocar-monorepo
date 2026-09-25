import { describe, it, expect } from 'vitest'
import type { SystemConfig } from '../system-config-api'
import { buildSections, formatValue, relativeTime, resolve, validateDraft } from '../system-config-model'

let seq = 0
function cfg(over: Partial<SystemConfig> & { key: string }): SystemConfig {
  return {
    id: String(++seq), value: '1', valueType: 'integer', description: 'db description', isPublic: false,
    status: 'active', updatedAt: '2026-09-01T00:00:00.000Z', min: null, max: null, ...over,
  }
}

describe('resolve', () => {
  it('uses the registry for known keys', () => {
    const r = resolve(cfg({ key: 'commission_percent', valueType: 'decimal' }))
    expect(r).toMatchObject({ title: 'Platform commission', group: 'payments', kind: 'number', suffix: '%', critical: true })
  })
  it('treats string-typed cash_collection_enabled as a switch (the DB type is misleading)', () => {
    expect(resolve(cfg({ key: 'cash_collection_enabled', valueType: 'string', value: 'true' })).kind).toBe('switch')
  })
  it('never hides an unknown key: humanised title, DB description, "Other" group, control from valueType', () => {
    const r = resolve(cfg({ key: 'brand_new_flag', valueType: 'boolean', description: 'Does a new thing' }))
    expect(r).toMatchObject({ title: 'Brand new flag', help: 'Does a new thing', group: 'other', kind: 'switch', critical: false })
  })
})

describe('buildSections', () => {
  const all = [
    cfg({ key: 'exotel_masking_enabled', valueType: 'boolean' }),
    cfg({ key: 'brand_new_flag', valueType: 'boolean' }),
    cfg({ key: 'instant_payout_fee', valueType: 'decimal' }),
    cfg({ key: 'commission_percent', valueType: 'decimal' }),
    cfg({ key: 'payout_hold_hours' }),
  ]

  it('orders groups by the registry, legacy last, and items by their defined order', () => {
    const s = buildSections(all, '')
    expect(s.map(x => x.group.id)).toEqual(['payments', 'payouts', 'other', 'legacy'])
    expect(s[0]!.items.map(i => i.config.key)).toEqual(['commission_percent', 'instant_payout_fee'])
  })
  it('search matches title, key, help and group name, and drops empty groups', () => {
    expect(buildSections(all, 'commission').flatMap(s => s.items.map(i => i.config.key))).toEqual(['commission_percent'])
    expect(buildSections(all, 'PAYOUT').flatMap(s => s.items.map(i => i.config.key)).sort())
      .toEqual(['instant_payout_fee', 'payout_hold_hours']) // key match + group-name match are both fine
    expect(buildSections(all, 'no such thing')).toEqual([])
  })
})

describe('validateDraft', () => {
  const pct = resolve(cfg({ key: 'commission_percent', valueType: 'decimal', min: 0, max: 50 }))
  const whole = resolve(cfg({ key: 'payout_hold_hours', valueType: 'integer', min: 0, max: 720 }))
  const sw = resolve(cfg({ key: 'razorpay_enabled', valueType: 'boolean' }))

  it('enforces the API-provided range and formats it for humans', () => {
    expect(validateDraft(pct, '15')).toBeNull()
    expect(validateDraft(pct, '1500')).toBe('Must be between 0 and 50')
    expect(validateDraft(pct, '-1')).toBe('Must be between 0 and 50')
  })
  it('rejects empty and non-numeric input; integers reject decimals', () => {
    expect(validateDraft(pct, '  ')).toBe('Enter a value')
    expect(validateDraft(pct, 'abc')).toBe('Enter a number')
    expect(validateDraft(whole, '2.5')).toBe('Whole numbers only')
  })
  it('accepts negatives where the range allows them', () => {
    const bal = resolve(cfg({ key: 'driver_minimum_balance', min: -1_000_000, max: 100_000 }))
    expect(validateDraft(bal, '-999999')).toBeNull()
  })
  it('switches only take true/false', () => {
    expect(validateDraft(sw, 'true')).toBeNull()
    expect(validateDraft(sw, 'maybe')).toBe('Choose on or off')
  })
  it('json must parse', () => {
    const j = resolve(cfg({ key: 'x_json', valueType: 'json' }))
    expect(validateDraft(j, '{"a":1}')).toBeNull()
    expect(validateDraft(j, '{oops')).toBe('Must be valid JSON')
  })
})

describe('formatValue', () => {
  it('adds units and Indian digit grouping', () => {
    expect(formatValue(resolve(cfg({ key: 'commission_percent' })), '15')).toBe('15%')
    expect(formatValue(resolve(cfg({ key: 'settlement_auto_approve_limit' })), '5000000')).toBe('₹50,00,000')
    expect(formatValue(resolve(cfg({ key: 'payout_hold_hours' })), '24')).toBe('24 hours')
  })
  it('renders switches as On/Off', () => {
    const r = resolve(cfg({ key: 'razorpay_enabled', valueType: 'boolean' }))
    expect([formatValue(r, 'true'), formatValue(r, 'false')]).toEqual(['On', 'Off'])
  })
})

describe('relativeTime', () => {
  const now = Date.parse('2026-09-10T12:00:00.000Z')
  it('is human at every scale', () => {
    expect(relativeTime('2026-09-10T11:59:40.000Z', now)).toBe('just now')
    expect(relativeTime('2026-09-10T11:15:00.000Z', now)).toBe('45 min ago')
    expect(relativeTime('2026-09-10T07:00:00.000Z', now)).toBe('5 h ago')
    expect(relativeTime('2026-09-01T12:00:00.000Z', now)).toBe('9 d ago')
  })
})
