import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({ getRideCoreById: vi.fn() }))
vi.mock('@/modules/notifications/templates.service', () => ({ renderTemplate: vi.fn() }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyOwner: vi.fn() }))

import * as repo from '@/modules/rides/rides.repository'
import { renderTemplate } from '@/modules/notifications/templates.service'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { processTripWindowNudge } from '@/jobs/processors/trip-window-nudge.processor'

const ride = (status: string, over: Record<string, unknown> = {}) =>
  ({ id: BigInt(101), user_id: 42, driver_id: 9, status, ...over }) as never

describe('processTripWindowNudge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(renderTemplate).mockImplementation((async (slug: string) => ({ subject: `S:${slug}`, body: `B:${slug}` })) as never)
    vi.mocked(notifyOwner).mockResolvedValue(undefined)
  })

  it('T-15: pushes the driver and the rider their own copy, collapsing under one tag', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('in_progress'))
    await processTripWindowNudge({ rideId: '101', kind: 't15' })
    expect(renderTemplate).toHaveBeenCalledWith('trip_window_t15_driver', 'push', {})
    expect(renderTemplate).toHaveBeenCalledWith('trip_window_t15_rider', 'push', {})
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({
      ownerType: 'driver', ownerId: BigInt(9), type: 'trip_window_ending', tag: 'trip-window:101',
    }))
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({
      ownerType: 'user', ownerId: BigInt(42), type: 'trip_window_ending',
    }))
  })

  it('end: sends the grace from the server constant to both roles', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('returning'))
    await processTripWindowNudge({ rideId: '101', kind: 'end' })
    expect(renderTemplate).toHaveBeenCalledWith('trip_window_end_driver', 'push', { graceMin: '5' })
    expect(renderTemplate).toHaveBeenCalledWith('trip_window_end_rider', 'push', { graceMin: '5' })
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ type: 'trip_window_ended' }))
  })

  it.each(['completed', 'cancelled', 'accepted'])('no-ops when the ride is %s', async status => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride(status))
    await processTripWindowNudge({ rideId: '101', kind: 't15' })
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('no-ops when the ride is gone', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(null)
    await processTripWindowNudge({ rideId: '101', kind: 'end' })
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('one failing recipient does not block the other', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('in_progress'))
    vi.mocked(notifyOwner).mockRejectedValueOnce(new Error('fcm down'))
    await expect(processTripWindowNudge({ rideId: '101', kind: 't15' })).resolves.toBeUndefined()
    expect(notifyOwner).toHaveBeenCalledTimes(2)
  })

  it('skips the driver when none is assigned', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride('in_progress', { driver_id: null }))
    await processTripWindowNudge({ rideId: '101', kind: 't15' })
    expect(notifyOwner).toHaveBeenCalledTimes(1)
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'user' }))
  })
})
