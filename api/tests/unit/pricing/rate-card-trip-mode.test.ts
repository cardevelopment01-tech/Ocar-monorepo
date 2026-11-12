import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
const client = { query, release: vi.fn() }
const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({
  pool: { connect: vi.fn(async () => client), query: (...a: unknown[]) => poolQuery(...a) },
  withTransaction: vi.fn(),
}))
vi.mock('@/db/redis', () => ({
  getJSON: vi.fn().mockResolvedValue(null),
  setWithTTL: vi.fn().mockResolvedValue(undefined),
  withTimeout: vi.fn(async (p: Promise<unknown>) => p),
  client: { incr: vi.fn().mockResolvedValue(1), del: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue('3') },
}))

import { getCurrentRateCard, createRateCard, getAllCurrentRateCards } from '@/modules/pricing/pricing.repository'
import { createAdminRateCard, listAdminRateCards } from '@/modules/admin/admin.repository'
import { rateCardKey } from '@/constants/redis-keys'
import { getJSON } from '@/db/redis'

const BASE = { categoryId: 2, rideType: 'one_way', ratePerKm: 9, ratePerMin: 1, minFare: 100, adminId: 9 }
const OLD_STANDARD = { id: 5, rate_per_km: '13', rate_per_min: '2', min_fare: '250', city_id: null, stop_charge: '0', cancellation_fee: '50', base_fare: '0', trip_mode: 'standard' }
const OLD_CITY = { id: 6, rate_per_km: '9', rate_per_min: '1', min_fare: '100', city_id: null, stop_charge: '10', cancellation_fee: '40', base_fare: '5', trip_mode: 'city' }

function wire(expired: unknown[]) {
  query.mockReset()
  query.mockImplementation(async (sql: string) => {
    if (/^\s*UPDATE rate_cards/.test(sql)) return { rows: expired }
    if (/^\s*INSERT INTO rate_cards/.test(sql)) return { rows: [{ id: 7 }] }
    return { rows: [] }
  })
}
const call = (re: RegExp) => query.mock.calls.find((c) => re.test(String(c[0])))!

describe('rateCardKey', () => {
  it('differs for a standard and a city card with identical other arguments, so they never share a cache entry', () => {
    const std = rateCardKey('3', 2, 'one_way', 1, 'standard')
    const city = rateCardKey('3', 2, 'one_way', 1, 'city')
    expect(std).not.toBe(city)
  })
  it('defaults to the standard card', () => {
    expect(rateCardKey('3', 2, 'one_way', null)).toBe(rateCardKey('3', 2, 'one_way', null, 'standard'))
  })
})

describe('getCurrentRateCard: trip mode', () => {
  beforeEach(() => { vi.clearAllMocks(); poolQuery.mockResolvedValue({ rows: [{ id: 1, base_fare: '0', trip_mode: 'standard' }] }) })

  it('reads the standard card by default, so every existing caller is unchanged', async () => {
    await getCurrentRateCard(2, 'one_way', null)
    expect(String(poolQuery.mock.calls[0]![0])).toMatch(/rc\.trip_mode = \$4/)
    expect(poolQuery.mock.calls[0]![1]).toEqual([2, 'one_way', null, 'standard'])
  })

  it('reads the city card when asked', async () => {
    poolQuery.mockResolvedValue({ rows: [{ id: 2, base_fare: '0', trip_mode: 'city' }] })
    await getCurrentRateCard(2, 'one_way', 1, 'city')
    expect(poolQuery.mock.calls[0]![1]).toEqual([2, 'one_way', 1, 'city'])
  })

  it('reads through to the database when a cached card predates trip_mode', async () => {
    vi.mocked(getJSON).mockResolvedValueOnce({ id: 1, base_fare: '0' } as never)
    await getCurrentRateCard(2, 'one_way', null)
    expect(poolQuery).toHaveBeenCalledTimes(1)
  })
})

describe('createRateCard: a standard and a city card never close each other', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('creating a standard card expires only the standard card', async () => {
    wire([OLD_STANDARD])
    await createRateCard(BASE)
    const expire = call(/^\s*UPDATE rate_cards/)
    expect(String(expire[0])).toMatch(/trip_mode = \$4/)
    expect(expire[1]).toEqual([2, 'one_way', null, 'standard'])
    expect(call(/INSERT INTO rate_cards/)[1].at(-1)).toBe('standard')
  })

  it('creating a city card expires only the city card and carries ITS fees forward', async () => {
    wire([OLD_CITY])
    await createRateCard({ ...BASE, tripMode: 'city' })
    expect(call(/^\s*UPDATE rate_cards/)[1]).toEqual([2, 'one_way', null, 'city'])
    const insert = call(/INSERT INTO rate_cards/)[1] as unknown[]
    expect(insert.at(-1)).toBe('city')
    expect(insert.at(-4)).toBe(10) // stop_charge carried from the city card
    expect(insert.at(-3)).toBe('40') // cancellation_fee carried from the city card
    expect(insert.at(-2)).toBe(5) // base_fare carried from the city card
  })
})

describe('createAdminRateCard: a standard and a city card never close each other', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('expires only the card of the same trip mode', async () => {
    wire([OLD_CITY])
    await createAdminRateCard({ ...BASE, adminId: 9n, tripMode: 'city' })
    expect(call(/^\s*UPDATE rate_cards/)[1]).toEqual([2, 'one_way', null, 'city'])
    expect((call(/INSERT INTO rate_cards/)[1] as unknown[]).at(-1)).toBe('city')
  })

  it('defaults to standard when no trip mode is sent (old admin clients)', async () => {
    wire([OLD_STANDARD])
    await createAdminRateCard({ ...BASE, adminId: 9n })
    expect(call(/^\s*UPDATE rate_cards/)[1]).toEqual([2, 'one_way', null, 'standard'])
  })
})

describe('rate card lists tell a standard card from a city card', () => {
  beforeEach(() => { vi.clearAllMocks(); poolQuery.mockResolvedValue({ rows: [] }) })

  it('the admin list returns every card with its trip_mode, so duplicate one-way rows are distinguishable', async () => {
    await listAdminRateCards()
    const sql = String(poolQuery.mock.calls[0]![0])
    expect(sql).toMatch(/rc\.trip_mode/)
    expect(sql).not.toMatch(/trip_mode\s*=/)
  })

  it('the public list returns standard cards only, so old web builds never show a city card as the one-way price', async () => {
    await getAllCurrentRateCards()
    expect(String(poolQuery.mock.calls[0]![0])).toMatch(/rc\.trip_mode = 'standard'/)
  })
})
