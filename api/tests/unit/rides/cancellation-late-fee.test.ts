import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { connect: vi.fn(() => Promise.resolve(client)), query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { incr: vi.fn(async () => 1), expire: vi.fn(), del: vi.fn() } }))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreById: vi.fn(),
  getAdvanceFeeContext: vi.fn(),
  cancelAllAssignments: vi.fn(async () => []),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), sendRequestExpired: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/modules/call-masking/call-masking.service', () => ({ releaseForRide: vi.fn(async () => undefined) }))
const policy = vi.hoisted(() => ({ value: { lateCancelEnabled: true, lateCancelWindowMin: 60, feeMode: 'percent', feePercent: 10, feeCap: 100, feeFlat: 50, rescheduleMax: 3, searchGraceMin: 10 } as Record<string, unknown> }))
vi.mock('@/lib/advance-policy', async (orig) => ({ ...(await orig<object>()), getAdvancePolicy: async () => policy.value }))

import * as repo from '@/modules/rides/rides.repository'
import { cancelRide, getCancelPreview, getAdvanceTerms } from '@/modules/rides/rides.service'

const USER = 42n, DRIVER = 7n, RIDE = 101n
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString()
const ride = (over: Record<string, unknown> = {}) => ({
  id: RIDE, user_id: USER, driver_id: DRIVER, status: 'accepted', ride_type: 'one_way', category_id: 2n, origin_city_id: 1n,
  scheduled_for: inMinutes(30), ...over,
})

function wire(balance = '500') {
  client.query.mockImplementation((sql: string) => {
    if (sql.includes('SELECT cancellation_fee FROM rate_cards')) return Promise.resolve({ rows: [{ cancellation_fee: '50.00' }], rowCount: 1 })
    if (sql.includes('UPDATE rides SET status')) return Promise.resolve({ rows: [{ id: RIDE }], rowCount: 1 })
    if (sql.includes('SELECT id, balance FROM user_wallets')) return Promise.resolve({ rows: [{ id: 9n, balance }], rowCount: 1 })
    if (sql.includes('driver_wallets') && sql.includes('SELECT id, balance')) return Promise.resolve({ rows: [{ id: 3n, balance: '0', is_frozen: false }], rowCount: 1 })
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
}
const sqls = () => client.query.mock.calls.map(c => String(c[0]))
const feeRow = () => client.query.mock.calls.find(c => /INSERT INTO ride_cancellations/.test(String(c[0])))![1] as unknown[]

beforeEach(() => {
  vi.clearAllMocks()
  policy.value = { lateCancelEnabled: true, lateCancelWindowMin: 60, feeMode: 'percent', feePercent: 10, feeCap: 100, feeFlat: 50, rescheduleMax: 3, searchGraceMin: 10 }
  vi.mocked(repo.getRideCoreById).mockResolvedValue(ride() as never)
  vi.mocked(repo.getAdvanceFeeContext).mockResolvedValue({ fare: 1850, isAdvance: true })
  wire()
})

describe('cancelRide: late-cancel fee on an advance booking', () => {
  it('charges the policy fee (not the rate card) when a driver has accepted and pickup is inside the window', async () => {
    await cancelRide(USER, RIDE)
    expect(sqls().some(s => /SELECT cancellation_fee FROM rate_cards/.test(s))).toBe(false)
    expect(feeRow()).toEqual([RIDE, 'after_acceptance', USER, null, null, true, 100]) // 10% of 1850 = 185, capped at 100
    expect(sqls().some(s => /INSERT INTO user_wallet_ledger/.test(s))).toBe(true)
    expect(client.query.mock.calls.some(c => String(c[0]).includes('driver_wallet_ledger'))).toBe(true) // the driver gets their share
  })

  it('is free outside the window', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ scheduled_for: inMinutes(300) }) as never)
    await cancelRide(USER, RIDE)
    expect(feeRow()).toEqual([RIDE, 'after_acceptance', USER, null, null, false, 0])
    expect(sqls().some(s => /user_wallet_ledger/.test(s))).toBe(false)
  })

  it('is free while the policy is off, however close to pickup', async () => {
    policy.value = { ...policy.value, lateCancelEnabled: false }
    await cancelRide(USER, RIDE)
    expect(feeRow()[5]).toBe(false)
  })

  it('is free when no driver has accepted yet (still searching)', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ status: 'requested', driver_id: null }) as never)
    await cancelRide(USER, RIDE)
    expect(feeRow()).toEqual([RIDE, 'before_acceptance', USER, null, null, false, 0])
  })

  it('records the fee as owed, and does not debit, when the wallet cannot cover it (the existing all-or-nothing rule)', async () => {
    wire('20')
    await cancelRide(USER, RIDE)
    expect(feeRow()[5]).toBe(true)
    expect(sqls().some(s => /INSERT INTO user_wallet_ledger/.test(s))).toBe(false)
  })

  it('leaves an ordinary ride alone: no policy lookup, no fee', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ scheduled_for: null }) as never)
    await cancelRide(USER, RIDE)
    expect(repo.getAdvanceFeeContext).not.toHaveBeenCalled()
    expect(feeRow()[5]).toBe(false)
  })

  it('keeps the rate-card fee for a driver who has arrived, as before', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ status: 'driver_arrived' }) as never)
    await cancelRide(USER, RIDE)
    expect(sqls().some(s => /SELECT cancellation_fee FROM rate_cards/.test(s))).toBe(true)
    expect(feeRow()).toEqual([RIDE, 'after_arrival', USER, null, null, true, 50])
  })
})

describe('getCancelPreview', () => {
  it('tells the rider the exact fee, when the free period ended, and why', async () => {
    const p = await getCancelPreview(USER, RIDE)
    expect(p).toMatchObject({ canCancel: true, fee: 100, reason: 'late_cancel', windowMin: 60 })
    expect(p.freeUntil).toBeTruthy()
  })
  it('says free, with the moment the free period ends, before the window opens', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ scheduled_for: inMinutes(300) }) as never)
    const p = await getCancelPreview(USER, RIDE)
    expect(p).toMatchObject({ fee: 0, reason: 'none' })
    expect(new Date(p.freeUntil!).getTime()).toBeGreaterThan(Date.now())
  })
  it('reports the rate-card fee once the driver has arrived', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ status: 'driver_arrived' }) as never)
    expect(await getCancelPreview(USER, RIDE)).toMatchObject({ fee: 50, reason: 'arrived' })
  })
  it('is only for the rider who owns the ride', async () => {
    await expect(getCancelPreview(999n, RIDE)).rejects.toMatchObject({ httpStatus: 403 })
  })
  it('says a ride that can no longer be cancelled cannot be', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ status: 'in_progress' }) as never)
    expect(await getCancelPreview(USER, RIDE)).toMatchObject({ canCancel: false, fee: 0 })
  })
})

describe('getAdvanceTerms', () => {
  it('gives the booking sheet the lead time, limits and the fee rule when it is on', async () => {
    expect(await getAdvanceTerms()).toEqual({
      searchLeadMin: 15, minAheadMin: 60, maxAheadDays: 7, rescheduleMax: 3,
      lateCancel: { windowMin: 60, mode: 'percent', percent: 10, cap: 100, flat: 50 },
    })
  })
  it('says there is no fee (null) while the policy is off', async () => {
    policy.value = { ...policy.value, lateCancelEnabled: false }
    expect((await getAdvanceTerms()).lateCancel).toBeNull()
  })
})
