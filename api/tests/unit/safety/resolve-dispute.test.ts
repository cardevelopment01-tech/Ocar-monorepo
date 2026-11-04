import { describe, it, expect, vi, beforeEach } from 'vitest'

const fakeClient = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { connect: vi.fn(() => Promise.resolve(fakeClient)) } }))
vi.mock('@/modules/safety/safety.repository', () => ({
  getDisputeById: vi.fn(),
  getDisputeCoreById: vi.fn(),
  getRideBasic: vi.fn(),
  insertDriverWarning: vi.fn(),
  countRecentDriverWarnings: vi.fn(),
  getDriverStatus: vi.fn(),
}))
vi.mock('@/modules/geo/geo.service', () => ({ getRoute: vi.fn() }))
vi.mock('@/modules/admin/admin.repository', () => ({ updateDriverStatus: vi.fn() }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyOwner: vi.fn(), notifyAllAdmins: vi.fn() }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('3') }))

import * as repo from '@/modules/safety/safety.repository'
import { resolveDispute } from '@/modules/safety/disputes.service'

// Client answers by SQL shape: payment lookup (FOR UPDATE), prior-refund SUM,
// and everything else (BEGIN/UPDATE disputes/INSERT dispute_actions/INSERT refunds/COMMIT).
function scriptClient(paymentAmount: string, alreadyRefunded: string) {
  fakeClient.query.mockReset()
  fakeClient.query.mockImplementation((sql: string) => {
    if (/SELECT id, amount FROM payments/.test(sql)) return Promise.resolve({ rows: [{ id: 55, amount: paymentAmount }], rowCount: 1 })
    if (/SUM\(amount\)/.test(sql)) return Promise.resolve({ rows: [{ sum: alreadyRefunded }], rowCount: 1 })
    return Promise.resolve({ rows: [], rowCount: 1 })
  })
}

const base = { adminId: 1n, note: 'resolved via test' }

describe('resolveDispute — refund cap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getDisputeCoreById).mockResolvedValue({ id: 10n, ride_id: 500n, driver_id: 42n } as never)
    vi.mocked(repo.getDisputeById).mockResolvedValue({ id: 10n, ride_id: 500n, driver_id: 42n } as never)
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 500n, driver_id: 42n } as never)
  })

  it('refund within the remaining balance → inserts the refund row', async () => {
    scriptClient('500.00', '0')
    await resolveDispute(10n, { ...base, outcome: 'partial_refund', refundAmount: 100 })

    const insert = fakeClient.query.mock.calls.find(c => (c[0] as string).includes('INSERT INTO refunds'))
    expect(insert, 'expected a refund insert').toBeDefined()
    expect((insert![1] as unknown[])).toContain(100)
    const sqls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => s.includes('COMMIT'))).toBe(true)
  })

  it('refund exceeding the payment total → throws REFUND_EXCEEDS_PAYMENT, inserts nothing, rolls back', async () => {
    scriptClient('500.00', '0')
    await expect(
      resolveDispute(10n, { ...base, outcome: 'full_refund', refundAmount: 600 })
    ).rejects.toMatchObject({ httpStatus: 400, appCode: 'REFUND_EXCEEDS_PAYMENT' })

    const sqls = fakeClient.query.mock.calls.map(c => c[0] as string)
    expect(sqls.some(s => s.includes('INSERT INTO refunds'))).toBe(false)
    expect(sqls.some(s => s.includes('ROLLBACK'))).toBe(true)
    expect(sqls.some(s => s.includes('COMMIT'))).toBe(false)
  })

  it('refund exceeding the REMAINING balance after prior refunds → throws', async () => {
    scriptClient('500.00', '400') // only ₹100 left refundable
    await expect(
      resolveDispute(10n, { ...base, outcome: 'partial_refund', refundAmount: 150 })
    ).rejects.toMatchObject({ httpStatus: 400, appCode: 'REFUND_EXCEEDS_PAYMENT' })
  })

  it('refund exactly at the remaining balance → allowed', async () => {
    scriptClient('500.00', '0')
    await resolveDispute(10n, { ...base, outcome: 'full_refund', refundAmount: 500 })
    const insert = fakeClient.query.mock.calls.find(c => (c[0] as string).includes('INSERT INTO refunds'))
    expect(insert).toBeDefined()
  })
})

// payments.amount is what the rider paid (the payable) since offers: a dispute can never refund more than that, so no
// code change was needed -- this pins it. Gross fare 454, rider paid 363.20 after a 90.80 offer.
describe('resolveDispute — refund cap on a discounted ride', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getDisputeCoreById).mockResolvedValue({ id: 10n, ride_id: 500n, driver_id: 42n } as never)
    vi.mocked(repo.getDisputeById).mockResolvedValue({ id: 10n, ride_id: 500n, driver_id: 42n } as never)
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 500n, driver_id: 42n } as never)
  })
  it('rejects a refund of the gross fare and accepts exactly what was paid', async () => {
    scriptClient('363.20', '0')
    await expect(resolveDispute(10n, { ...base, outcome: 'full_refund', refundAmount: 400 })).rejects.toMatchObject({ appCode: 'REFUND_EXCEEDS_PAYMENT' })
    scriptClient('363.20', '0')
    await resolveDispute(10n, { ...base, outcome: 'full_refund', refundAmount: 363.2 })
    expect(fakeClient.query.mock.calls.some(c => (c[0] as string).includes('INSERT INTO refunds'))).toBe(true)
  })
  it('after 300 was refunded only 63.20 remains', async () => {
    scriptClient('363.20', '300')
    await expect(resolveDispute(10n, { ...base, outcome: 'partial_refund', refundAmount: 64 })).rejects.toMatchObject({ appCode: 'REFUND_EXCEEDS_PAYMENT' })
    scriptClient('363.20', '300')
    await resolveDispute(10n, { ...base, outcome: 'partial_refund', refundAmount: 63.2 })
  })
})
