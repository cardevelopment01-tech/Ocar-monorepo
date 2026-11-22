import { describe, it, expect, vi } from 'vitest'
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: {}, getJSON: vi.fn(), setWithTTL: vi.fn(), withTimeout: vi.fn() }))
vi.mock('@/lib/audit-log', () => ({ recordAuditLog: vi.fn() }))
import { validatePolicyChanges } from '@/modules/admin/advance-policy.admin'
import { fmtPickup, fmtClock } from '@/lib/ist-format'

describe('validatePolicyChanges', () => {
  it('turns a form into config strings under the right keys', () => {
    expect(validatePolicyChanges({ lateCancelEnabled: true, feeMode: 'flat', feeFlat: 75, lateCancelWindowMin: 90 })).toEqual([
      { field: 'lateCancelEnabled', key: 'advance_late_cancel_enabled', value: 'true' },
      { field: 'feeMode', key: 'advance_late_cancel_fee_mode', value: 'flat' },
      { field: 'feeFlat', key: 'advance_late_cancel_fee_flat', value: '75' },
      { field: 'lateCancelWindowMin', key: 'advance_late_cancel_window_min', value: '90' },
    ])
  })
  it.each([
    ['an unknown setting', { nope: 1 }],
    ['a percent over 100', { feePercent: 101 }],
    ['a negative flat fee', { feeFlat: -1 }],
    ['a fee above the cap of 5000', { feeFlat: 5001 }],
    ['a fractional window', { lateCancelWindowMin: 30.5 }],
    ['a window over a day', { lateCancelWindowMin: 1441 }],
    ['a reschedule limit over 10', { rescheduleMax: 11 }],
    ['a search grace over an hour', { searchGraceMin: 61 }],
    ['text where a number goes', { feePercent: '10' }],
    ['a mode that is not offered', { feeMode: 'tiered' }],
    ['a string for the switch', { lateCancelEnabled: 'true' }],
    ['a list', []],
    ['nothing at all (null)', null],
  ])('refuses %s', (_l, input) => { expect(() => validatePolicyChanges(input)).toThrow() })
  it('accepts the edges of every range', () => {
    expect(() => validatePolicyChanges({ feePercent: 0, feeCap: 5000, lateCancelWindowMin: 0, rescheduleMax: 10, searchGraceMin: 60 })).not.toThrow()
  })
})

describe('IST formatting', () => {
  it('shows India time whatever the server zone is', () => {
    expect(fmtPickup(new Date('2026-11-26T13:00:00Z'))).toBe('Thu 26 Nov, 6:30 pm')
    expect(fmtClock(new Date('2026-11-26T18:30:00Z'))).toBe('12:00 am')
  })
})
