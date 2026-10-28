import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import { getDriverEarningsSummary } from '@/modules/rides/rides.repository'

// The rides/payments/fare_snapshots join runs ONCE (GROUP BY ROLLUP): per-bucket rows for the chart plus a grand-total row
// (is_total = 1) for the headline numbers. These tests pin how those rows become the response.
function mockQueries(points: unknown[], onlineHours = '2.5', rating: string | null = '4.8') {
  vi.mocked(pool.query).mockImplementation(((sql: string) => {
    if (sql.includes('FROM driver_sessions')) return Promise.resolve({ rows: [{ online_hours: onlineHours }] })
    if (sql.includes('FROM drivers WHERE id')) return Promise.resolve({ rows: [{ rating_avg: rating }] })
    return Promise.resolve({ rows: points })
  }) as never)
}

describe('getDriverEarningsSummary (single pass)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the headline numbers from the grand-total row and the chart from the bucket rows', async () => {
    mockQueries([
      { bucket: '2026-10-27', is_total: 0, earnings: '300.50', trips: '3', fare: '400.00' },
      { bucket: '2026-10-28', is_total: 0, earnings: '100.00', trips: '1', fare: '140.00' },
      { bucket: null, is_total: 1, earnings: '400.50', trips: '4', fare: '540.00' },
    ])
    const s = await getDriverEarningsSummary(BigInt(7), 'week')
    expect(s.total_earnings).toBe(400.5)
    expect(s.trip_count).toBe(4)
    expect(s.breakdown.base_fare).toBe(540)
    expect(s.breakdown.platform_fee).toBe(139.5)
    expect(s.chart).toHaveLength(7)
    expect(s.chart.reduce((a, b) => a + b, 0)).toBeCloseTo(400.5, 5) // the total row is not counted twice in the chart
    expect(s.online_hours).toBe('2h 30m')
    expect(s.rating).toBe(4.8)
  })

  it('runs the rides join once: one points query, not a totals query plus a chart query', async () => {
    mockQueries([{ bucket: null, is_total: 1, earnings: '0', trips: '0', fare: '0' }])
    await getDriverEarningsSummary(BigInt(7), 'month')
    const sqls = vi.mocked(pool.query).mock.calls.map(c => c[0] as string)
    expect(sqls).toHaveLength(3) // driver_sessions, the single rides query, drivers.rating_avg
    expect(sqls.filter(q => q.includes('FROM rides r'))).toHaveLength(1)
    expect(sqls.find(q => q.includes('FROM rides r'))).toContain('GROUP BY ROLLUP')
  })

  it('returns zeros and an empty chart for a driver with no completed rides (only the total row comes back)', async () => {
    mockQueries([{ bucket: null, is_total: 1, earnings: '0', trips: '0', fare: '0' }], '0', null)
    const s = await getDriverEarningsSummary(BigInt(7), 'week')
    expect(s).toMatchObject({ total_earnings: 0, trip_count: 0, online_hours: '0m', rating: null })
    expect(s.chart).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(s.breakdown).toEqual({ base_fare: 0, tips: 0, incentives: 0, platform_fee: 0 })
  })

  it('buckets "today" by hour into eight 3-hour slots', async () => {
    mockQueries([
      { bucket: 9, is_total: 0, earnings: '50', trips: '1', fare: '60' },
      { bucket: 10, is_total: 0, earnings: '25', trips: '1', fare: '30' },
      { bucket: 20, is_total: 0, earnings: '10', trips: '1', fare: '12' },
      { bucket: null, is_total: 1, earnings: '85', trips: '3', fare: '102' },
    ])
    const s = await getDriverEarningsSummary(BigInt(7), 'today')
    expect(s.chart).toEqual([0, 0, 0, 75, 0, 0, 10, 0]) // slot = floor(hour / 3): hours 9 and 10 -> slot 3, hour 20 -> slot 6
  })
})
