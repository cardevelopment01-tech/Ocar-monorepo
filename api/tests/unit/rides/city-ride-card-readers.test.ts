import { describe, it, expect, vi, beforeEach } from 'vitest'

// Everything that reads "the rate card of a ride" must read the CITY card for a city ride and the standard card otherwise.

const client = { query: vi.fn(), release: vi.fn() }
const poolQuery = vi.hoisted(() => vi.fn())
vi.mock('@/db/client', () => ({ pool: { connect: vi.fn(() => Promise.resolve(client)), query: (...a: unknown[]) => poolQuery(...a) } }))
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
const ARRIVED = { id: RIDE_ID, user_id: USER_ID, driver_id: BigInt(7), status: 'driver_arrived', ride_type: 'one_way', category_id: BigInt(2), origin_city_id: BigInt(1) }

function wire(cityFee: string, standardFee: string) {
  client.query.mockImplementation((sql: string, params?: unknown[]) => {
    if (sql.includes('SELECT cancellation_fee FROM rate_cards')) {
      const mode = (params as unknown[])[3]
      return Promise.resolve({ rows: [{ cancellation_fee: mode === 'city' ? cityFee : standardFee }], rowCount: 1 })
    }
    if (sql.includes('UPDATE rides SET status')) return Promise.resolve({ rows: [{ id: RIDE_ID }], rowCount: 1 })
    if (sql.includes('SELECT id, balance FROM user_wallets')) return Promise.resolve({ rows: [{ id: BigInt(9), balance: '500.00' }], rowCount: 1 })
    if (sql.includes('SELECT id, balance') && sql.includes('driver_wallets')) return Promise.resolve({ rows: [{ id: BigInt(3), balance: '0', is_frozen: false }], rowCount: 1 })
    return Promise.resolve({ rows: [], rowCount: 0 })
  })
}
const feeCharged = () => (client.query.mock.calls.find((c: unknown[]) => String(c[0]).includes('INSERT INTO ride_cancellations'))![1] as unknown[])

describe('cancelRide: the cancellation fee comes from the ride\'s own card', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('a city ride after arrival is charged the city card fee, not the intercity one-way fee', async () => {
    wire('30.00', '50.00')
    vi.mocked(repo.getRideCoreById).mockResolvedValue({ ...ARRIVED, trip_mode: 'city' } as never)
    await cancelRide(USER_ID, RIDE_ID, 'changed_mind')
    expect(feeCharged()).toContain(30)
  })

  it('a standard one-way ride (and a row with no trip_mode, from before migration 137) is charged the standard fee', async () => {
    wire('30.00', '50.00')
    vi.mocked(repo.getRideCoreById).mockResolvedValue({ ...ARRIVED, trip_mode: 'standard' } as never)
    await cancelRide(USER_ID, RIDE_ID, 'changed_mind')
    expect(feeCharged()).toContain(50)

    vi.clearAllMocks(); wire('30.00', '50.00')
    vi.mocked(repo.getRideCoreById).mockResolvedValue({ ...ARRIVED } as never)
    await cancelRide(USER_ID, RIDE_ID, 'changed_mind')
    expect(feeCharged()).toContain(50)
  })
})
