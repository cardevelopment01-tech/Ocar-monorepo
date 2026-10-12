import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertGpsTracks = vi.fn()
vi.mock('@/db/client', () => ({ workerPool: { tag: 'worker' } }))
vi.mock('@/modules/geo/geo.repository', () => ({ insertGpsTracks: (...a: unknown[]) => insertGpsTracks(...a) }))

import { enqueueBreadcrumb, flushBreadcrumbs, bufferedBreadcrumbCount } from '@/lib/gps-buffer'

const crumb = (n: number) => ({
  ride_id: '1', session_id: '2', driver_id: '3', latitude: 20 + n / 1e4, longitude: 85, recorded_at: new Date().toISOString(),
})

describe('gps-buffer', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    insertGpsTracks.mockReset()
    insertGpsTracks.mockResolvedValue(undefined)
    await flushBreadcrumbs() // drain whatever a previous test left
    insertGpsTracks.mockClear()
  })

  it('writes many pings with ONE insert, on the worker pool', async () => {
    for (let i = 0; i < 25; i++) enqueueBreadcrumb(crumb(i))
    await flushBreadcrumbs()
    expect(insertGpsTracks).toHaveBeenCalledTimes(1)
    expect(insertGpsTracks.mock.calls[0]![0]).toHaveLength(25)
    expect(insertGpsTracks.mock.calls[0]![1]).toEqual({ tag: 'worker' })
    expect(bufferedBreadcrumbCount()).toBe(0)
  })

  it('does nothing when empty', async () => {
    await flushBreadcrumbs()
    expect(insertGpsTracks).not.toHaveBeenCalled()
  })

  it('keeps the rows for another try when the insert fails, and drops them after repeated failure', async () => {
    insertGpsTracks.mockRejectedValue(new Error('db down'))
    enqueueBreadcrumb(crumb(1))
    await flushBreadcrumbs()
    expect(bufferedBreadcrumbCount()).toBe(1) // requeued
    await flushBreadcrumbs()
    await flushBreadcrumbs()
    expect(bufferedBreadcrumbCount()).toBe(0) // gave up after MAX_ATTEMPTS, never grows without bound
  })

  it('flushes immediately once the batch is large', async () => {
    for (let i = 0; i < 200; i++) enqueueBreadcrumb(crumb(i))
    await vi.waitFor(() => expect(insertGpsTracks).toHaveBeenCalled())
    expect(insertGpsTracks.mock.calls[0]![0].length).toBeGreaterThanOrEqual(200)
  })
})
