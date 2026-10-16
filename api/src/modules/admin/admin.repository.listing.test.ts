import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.fn()
vi.mock('@/db/redis', () => ({ getJSON: vi.fn().mockResolvedValue(null), setWithTTL: vi.fn().mockResolvedValue(undefined), client: { del: vi.fn().mockResolvedValue(1) } }))
vi.mock('@/db/client', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args), connect: vi.fn() },
}))

import { capTotal, COUNT_CAP, listAdminRides, listAdminPayments, getAdminRideStats } from './admin.repository'

describe('capTotal', () => {
  it('is exact below the cap and flags capped above it', () => {
    expect(capTotal(0)).toEqual({ total: 0, totalCapped: false })
    expect(capTotal(COUNT_CAP)).toEqual({ total: COUNT_CAP, totalCapped: false })
    expect(capTotal(COUNT_CAP + 1)).toEqual({ total: COUNT_CAP, totalCapped: true })
  })
})

describe('listAdminRides query shape', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockQuery.mockImplementation((sql: string) => {
      if (/COUNT\(\*\)::int AS n/.test(sql)) return Promise.resolve({ rows: [{ n: 12345 }] })
      if (/array_agg/.test(sql)) return Promise.resolve({ rows: [{ ids: ['5', '6'] }] })
      return Promise.resolve({ rows: [] })
    })
  })

  it('caps the count at COUNT_CAP + 1 rows and reports it', async () => {
    const res = await listAdminRides({ limit: 20, offset: 0 })
    expect(res.total).toBe(COUNT_CAP)
    expect(res.totalCapped).toBe(true)
    const countSql = String(mockQuery.mock.calls.find((c) => /COUNT\(\*\)::int/.test(String(c[0])))![0])
    expect(countSql).toContain(`LIMIT ${COUNT_CAP + 1}`)
  })

  it('pages the bare candidates before joining, with a unique id tie-break', async () => {
    await listAdminRides({ limit: 20, offset: 100000 })
    const dataSql = String(mockQuery.mock.calls[mockQuery.mock.calls.length - 1]![0])
    expect(dataSql).toMatch(/ORDER BY requested_at DESC, id DESC\s+LIMIT \$1 OFFSET \$2/)
    expect(dataSql.indexOf('LIMIT $1')).toBeLessThan(dataSql.indexOf('JOIN users u'))
  })

  it('uses timestamp bounds, not ::date casts, for the date filters', async () => {
    await listAdminRides({ limit: 20, offset: 0, date_from: '2026-10-01', date_to: '2026-10-07' })
    const dataSql = String(mockQuery.mock.calls[mockQuery.mock.calls.length - 1]![0])
    expect(dataSql).toContain('r.requested_at >= $1::date')
    expect(dataSql).toContain('r.requested_at < ($2::date + 1)')
    expect(dataSql).not.toContain('requested_at::date')
  })

  it('searches matching users and drivers first, then their rides (no ILIKE after the joins)', async () => {
    await listAdminRides({ limit: 20, offset: 0, search: 'rahul' })
    const lookups = mockQuery.mock.calls.filter((c) => /array_agg/.test(String(c[0])))
    expect(lookups).toHaveLength(2)
    expect(lookups[0]![1]).toEqual(['%rahul%'])
    const dataSql = String(mockQuery.mock.calls[mockQuery.mock.calls.length - 1]![0])
    expect(dataSql).toContain('r.user_id = ANY($1::bigint[])')
    expect(dataSql).toContain('r.driver_id = ANY($2::bigint[])')
    expect(dataSql).not.toMatch(/ILIKE/)
    expect(dataSql).not.toContain('r.id = $3') // 'rahul' is not an id
  })

  it('adds an exact ride-id branch only for a canonical integer', async () => {
    await listAdminRides({ limit: 20, offset: 0, search: '500000' })
    expect(String(mockQuery.mock.calls[mockQuery.mock.calls.length - 1]![0])).toContain('r.id = $3::bigint')
    mockQuery.mockClear()
    await listAdminRides({ limit: 20, offset: 0, search: '0123' })
    expect(String(mockQuery.mock.calls[mockQuery.mock.calls.length - 1]![0])).not.toContain('r.id = $3::bigint')
  })
})

describe('listAdminPayments / stats query shape', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockQuery.mockImplementation((sql: string) => (/COUNT\(\*\)::int AS n/.test(sql) ? Promise.resolve({ rows: [{ n: 3 }] }) : Promise.resolve({ rows: [], })))
  })

  it('counts payments without joins and pages before joining', async () => {
    const res = await listAdminPayments({ limit: 20, offset: 0 })
    expect(res).toMatchObject({ total: 3, totalCapped: false })
    const countSql = String(mockQuery.mock.calls[0]![0])
    expect(countSql).not.toMatch(/JOIN/)
    expect(countSql).toContain(`LIMIT ${COUNT_CAP + 1}`)
    expect(String(mockQuery.mock.calls[1]![0])).toMatch(/ORDER BY p\.created_at DESC, p\.id DESC/)
  })

  it('ride stats tiles use half-open ranges', async () => {
    mockQuery.mockResolvedValue({ rows: [{}] })
    await getAdminRideStats()
    const sql = String(mockQuery.mock.calls[0]![0])
    expect(sql).not.toContain('::date')
    expect(sql).toContain('requested_at >= CURRENT_DATE AND requested_at < CURRENT_DATE + 1')
  })
})
