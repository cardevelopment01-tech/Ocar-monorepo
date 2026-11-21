import { describe, it, expect, vi, beforeEach } from 'vitest'

// Value: protects=a stop with a missing coordinate is never counted as "inside the city" (ST_Contains is NULL for it, and a bare
// NOT EXISTS would pass it), while real coordinates are sent as two parallel arrays in order and an empty list is trivially fine;
// fails_when=the COALESCE guard is dropped from the query, the arrays are sent out of order (lat/lng swapped), or a row count of zero
// is read as inside; why_new=city rides now require every stop inside the boundary and booking has no schema validation for stops;
// seam=pool.query mocked, so the guard is checked as a contract on the query text; no_claim=PostGIS itself (proved separately against a
// real database: a NULL point returns no city, three Bhubaneswar points return one, a Cuttack point returns none).

const query = vi.hoisted(() => vi.fn())
vi.mock('@/db/client', () => ({ pool: { query } }))
vi.mock('@/lib/cache/reference-cache', () => ({ cachedRead: vi.fn(), invalidate: vi.fn() }))

import { activeCityContainsAll } from '@/modules/geo/geo.repository'

describe('activeCityContainsAll', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('treats a NULL ST_Contains as outside: the query wraps it in COALESCE(..., false)', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 })
    await activeCityContainsAll([{ lat: 20.29, lng: 85.82 }])
    const sql = String(query.mock.calls[0]![0])
    expect(sql).toMatch(/NOT COALESCE\(\s*ST_Contains\(/)
    expect(sql).toContain('unnest($1::float8[], $2::float8[])')
  })

  it('sends latitudes and longitudes as two parallel arrays in the same order, never string-built into the SQL', async () => {
    query.mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 })
    await activeCityContainsAll([{ lat: 20.29, lng: 85.82 }, { lat: 20.27, lng: 85.84 }])
    expect(query.mock.calls[0]![1]).toEqual([[20.29, 20.27], [85.82, 85.84]])
    expect(String(query.mock.calls[0]![0])).not.toMatch(/20\.29|85\.82/)
  })

  it('is inside only when a city row comes back', async () => {
    query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 })
    expect(await activeCityContainsAll([{ lat: 20.29, lng: 85.82 }])).toBe(true)
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 })
    expect(await activeCityContainsAll([{ lat: 20.46, lng: 85.88 }])).toBe(false)
  })

  it('an empty list is trivially inside and does not query', async () => {
    expect(await activeCityContainsAll([])).toBe(true)
    expect(query).not.toHaveBeenCalled()
  })
})
