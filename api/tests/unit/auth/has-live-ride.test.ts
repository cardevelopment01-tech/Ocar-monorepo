import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn()
vi.mock('@/db/client', () => ({ query: (...a: unknown[]) => query(...a), withTransaction: vi.fn() }))

import { hasLiveRide } from '@/modules/auth/auth.repository'

describe('hasLiveRide - the SQL behind the suspended-account refresh grace', () => {
  beforeEach(() => vi.clearAllMocks())

  it('looks at the DRIVER column for a driver and the USER column for a rider', async () => {
    query.mockResolvedValue([])
    await hasLiveRide('driver' as never, 7n)
    await hasLiveRide('user' as never, 7n)
    expect(query.mock.calls[0]![0]).toContain('driver_id = $1')
    expect(query.mock.calls[1]![0]).toContain('user_id = $1')
    expect(query.mock.calls[0]![1]).toEqual(['7'])
  })

  it('counts exactly the under-way statuses - not requested, scheduled, completed or cancelled', async () => {
    query.mockResolvedValue([])
    await hasLiveRide('user' as never, 7n)
    const sql = query.mock.calls[0]![0] as string
    expect(sql).toContain("status IN ('accepted', 'driver_arrived', 'in_progress', 'returning')")
    for (const s of ['requested', 'scheduled', 'completed', 'cancelled', 'no_drivers']) expect(sql).not.toContain(`'${s}'`)
  })

  it('is true only when a row comes back', async () => {
    query.mockResolvedValueOnce([{ one: 1 }])
    expect(await hasLiveRide('user' as never, 7n)).toBe(true)
    query.mockResolvedValueOnce([])
    expect(await hasLiveRide('user' as never, 7n)).toBe(false)
  })
})
