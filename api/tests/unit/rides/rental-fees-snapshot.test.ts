import { describe, it, expect, vi, beforeEach } from 'vitest'

const client = { query: vi.fn(), release: vi.fn() }
vi.mock('@/db/client', () => ({ pool: { connect: vi.fn(() => Promise.resolve(client)), query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { incr: vi.fn(async () => 1), expire: vi.fn(), del: vi.fn(), set: vi.fn(), get: vi.fn() } }))
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreById: vi.fn(),
  cancelAllAssignments: vi.fn(async () => []),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendRideStatusUpdate: vi.fn(), sendRequestExpired: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/modules/call-masking/call-masking.service', () => ({ releaseForRide: vi.fn(async () => undefined) }))

import * as repo from '@/modules/rides/rides.repository'
import { cancelRide } from '@/modules/rides/rides.service'

const USER_ID = BigInt(42)
const RIDE_ID = BigInt(101)
const RENTAL_RIDE = {
  id: RIDE_ID, user_id: USER_ID, driver_id: BigInt(7), status: 'driver_arrived',
  ride_type: 'rental', category_id: BigInt(2), origin_city_id: BigInt(1),
}

// snapshotFee: what fare_snapshots.rental_cancellation_fee holds for the ride (null = booked before the snapshot existed).
function wireClient(snapshotFee: string | null) {
  client.query.mockImplementation((sql: string) => {
    if (sql.includes('rental_cancellation_fee'))                  return Promise.resolve({ rows: [{ fee: snapshotFee }], rowCount: 1 })
    if (sql.includes('SELECT cancellation_fee FROM rate_cards'))  return Promise.resolve({ rows: [{ cancellation_fee: '50.00' }], rowCount: 1 })
    if (sql.includes('UPDATE rides SET status'))                  return Promise.resolve({ rows: [{ id: RIDE_ID }], rowCount: 1 })
    if (sql.includes('SELECT id, balance FROM user_wallets'))     return Promise.resolve({ rows: [{ id: BigInt(9), balance: '500.00' }], rowCount: 1 })
    if (sql.includes('SELECT id, balance') && sql.includes('driver_wallets')) return Promise.resolve({ rows: [{ id: BigInt(3), balance: '0', is_frozen: false }], rowCount: 1 })
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
}
const cancellationInsert = () => client.query.mock.calls.find((c: unknown[]) => (c[0] as string).includes('INSERT INTO ride_cancellations'))
const rateCardReads = () => client.query.mock.calls.filter((c: unknown[]) => (c[0] as string).includes('SELECT cancellation_fee FROM rate_cards'))

describe('cancelRide: a rental is charged the fee saved on its ride', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideCoreById).mockResolvedValue(RENTAL_RIDE as never)
  })

  it('charges the snapshotted fee and never reads rate_cards', async () => {
    wireClient('75.00')
    await cancelRide(USER_ID, RIDE_ID, 'changed_mind')
    expect(cancellationInsert()![1]).toContain(75)
    expect(rateCardReads()).toHaveLength(0)
  })

  it('falls back to the rate card for a rental booked before the snapshot existed', async () => {
    wireClient(null)
    await cancelRide(USER_ID, RIDE_ID, 'changed_mind')
    expect(cancellationInsert()![1]).toContain(50)
    expect(rateCardReads()).toHaveLength(1)
  })

  it('still reads the rate card for a one-way ride and never the rental snapshot', async () => {
    wireClient('75.00')
    vi.mocked(repo.getRideCoreById).mockResolvedValue({ ...RENTAL_RIDE, ride_type: 'one_way' } as never)
    await cancelRide(USER_ID, RIDE_ID, 'changed_mind')
    expect(cancellationInsert()![1]).toContain(50)
    expect(client.query.mock.calls.some((c: unknown[]) => (c[0] as string).includes('rental_cancellation_fee'))).toBe(false)
  })
})
