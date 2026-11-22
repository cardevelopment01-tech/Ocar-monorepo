import { describe, it, expect, vi, beforeEach } from 'vitest'

const poolQuery = vi.fn()
vi.mock('@/db/client', () => ({ pool: { query: (...a: unknown[]) => poolQuery(...a), connect: vi.fn() } }))
vi.mock('@/db/redis', () => ({ getJSON: vi.fn(), setWithTTL: vi.fn(), withTimeout: vi.fn(async (p: Promise<unknown>) => p), client: {} }))

import { getAssignCandidates } from '@/modules/rides/rides.repository'

const base = { cityId: 1n, rideLat: 20.2, rideLng: 85.8, categoryIds: [1n], minWalletBalance: 100 }
const lastSql = () => String(poolQuery.mock.calls.at(-1)![0])
const lastValues = () => poolQuery.mock.calls.at(-1)![1] as unknown[]

beforeEach(() => { vi.clearAllMocks(); poolQuery.mockResolvedValue({ rows: [] }) })

describe('getAssignCandidates options', () => {
  it('with no options behaves as before: every active driver in the city, nearest 50', async () => {
    await getAssignCandidates(base)
    expect(lastSql()).toMatch(/LIMIT 50/)
    expect(lastSql()).not.toMatch(/AND ds\.id IS NOT NULL/)
    expect(lastValues()).toHaveLength(5)
  })

  it('onlineOnly leaves out drivers with no live session (they cannot be assigned anyway)', async () => {
    await getAssignCandidates({ ...base, onlineOnly: true })
    expect(lastSql()).toMatch(/AND ds\.id IS NOT NULL/)
  })

  it('search matches name or phone in SQL, as a bound parameter', async () => {
    await getAssignCandidates({ ...base, search: 'ravi' })
    expect(lastSql()).toMatch(/d\.full_name ILIKE \$6 OR d\.phone ILIKE \$6/)
    expect(lastValues()[5]).toBe('%ravi%')
    expect(lastSql()).not.toContain('ravi')
  })

  it('driverId finds exactly one driver whatever their rank by distance', async () => {
    await getAssignCandidates({ ...base, driverId: 77n })
    expect(lastSql()).toMatch(/AND d\.id = \$6/)
    expect(lastValues()[5]).toBe(77n)
  })

  it('limit is clamped between 1 and 50', async () => {
    await getAssignCandidates({ ...base, limit: 500 })
    expect(lastSql()).toMatch(/LIMIT 50/)
    await getAssignCandidates({ ...base, limit: 0 })
    expect(lastSql()).toMatch(/LIMIT 1\b/)
    await getAssignCandidates({ ...base, limit: 12 })
    expect(lastSql()).toMatch(/LIMIT 12/)
  })

  it('combines filters with consecutive parameter numbers', async () => {
    await getAssignCandidates({ ...base, driverId: 5n, search: 'x', onlineOnly: true })
    expect(lastSql()).toMatch(/d\.id = \$6/)
    expect(lastSql()).toMatch(/ILIKE \$7/)
    expect(lastValues()).toHaveLength(7)
  })
})
