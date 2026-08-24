import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { connect: vi.fn(() => Promise.resolve(client)), query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { incr: vi.fn(async () => 1), expire: vi.fn(), del: vi.fn() } }))

vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById:        vi.fn(),
  cancelAllAssignments: vi.fn(async () => []),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), sendRequestExpired: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/modules/call-masking/call-masking.service', () => ({ releaseForRide: vi.fn(async () => undefined) }))

import * as repo from '@/modules/rides/rides.repository'
import { client as redis } from '@/db/redis'
import { cancelRide } from '@/modules/rides/rides.service'

const USER_ID   = BigInt(42)
const DRIVER_ID = BigInt(7)
const RIDE_ID   = BigInt(101)

// stage 'accepted' → after_acceptance → feeApplicable = true, driver assigned
const ACCEPTED_RIDE = {
  id: RIDE_ID, user_id: USER_ID, driver_id: DRIVER_ID, status: 'accepted',
  ride_type: 'one_way', category_id: BigInt(2), origin_city_id: BigInt(1),
}

// Route every SQL the transaction issues. `balance` controls whether the wallet can
// cover the fee. Returns rowCount 1 for the ride UPDATE so the CAS guard passes.
function wireClient(balance: string) {
  client.query.mockImplementation((sql: string) => {
    if (sql.includes('SELECT cancellation_fee FROM rate_cards'))     return Promise.resolve({ rows: [{ cancellation_fee: '50.00' }], rowCount: 1 })
    if (sql.includes('UPDATE rides SET status'))                     return Promise.resolve({ rows: [{ id: RIDE_ID }], rowCount: 1 })
    if (sql.includes('SELECT id, balance FROM user_wallets'))        return Promise.resolve({ rows: [{ id: BigInt(9), balance }], rowCount: 1 })
    if (sql.includes('SELECT id, balance') && sql.includes('driver_wallets')) return Promise.resolve({ rows: [{ id: BigInt(3), balance: '0', is_frozen: false }], rowCount: 1 })
    return Promise.resolve({ rows: [], rowCount: 0 }) // BEGIN/COMMIT/INSERTs/UPDATEs
  })
}

describe('cancelRide — cancellation fee', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideById).mockResolvedValue(ACCEPTED_RIDE as never)
    vi.mocked(redis.incr).mockResolvedValue(1 as never)
  })

  it('records the rate-card fee and debits the user wallet when funds cover it', async () => {
    wireClient('500.00')
    await cancelRide(USER_ID, RIDE_ID, 'changed_mind')

    const cancelInsert = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('INSERT INTO ride_cancellations'))
    expect(cancelInsert).toBeDefined()
    expect(cancelInsert![1]).toContain(50) // fee_amount param is 50, not 0

    const userDebit = client.query.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes('INSERT INTO user_wallet_ledger'))
    expect(userDebit).toBeDefined()
    expect((userDebit![0] as string)).toContain("'adjustment_debit'")

    const driverCredit = client.query.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes('INSERT INTO driver_wallet_ledger'))
    expect(driverCredit).toBeDefined()
    expect((driverCredit![0] as string)).toContain("'adjustment_credit'")
    expect(driverCredit![1]).toContain(35) // 50 * 0.7 compensation share
  })

  it('records the fee as owed but does NOT debit when the wallet cannot cover it', async () => {
    wireClient('10.00')
    await cancelRide(USER_ID, RIDE_ID, 'changed_mind')

    const cancelInsert = client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('INSERT INTO ride_cancellations'))
    expect(cancelInsert![1]).toContain(50) // still recorded as owed

    const userDebit = client.query.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes('INSERT INTO user_wallet_ledger'))
    expect(userDebit).toBeUndefined() // all-or-nothing: no partial debit
  })

  it('increments the per-user daily cancellation counter', async () => {
    wireClient('500.00')
    await cancelRide(USER_ID, RIDE_ID, 'changed_mind')
    expect(redis.incr).toHaveBeenCalledWith(`cancel:daily:user:${USER_ID}`)
  })
})
