import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreById: vi.fn(),
  getPickupWaitTerms: vi.fn(),
  getPickupWaitStartedAt: vi.fn(),
}))
vi.mock('@/modules/notifications/templates.service', () => ({ renderTemplate: vi.fn() }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyOwner: vi.fn() }))
vi.mock('@/jobs/queues', () => ({
  queues: { scheduler: { add: vi.fn().mockResolvedValue(undefined) } },
  QUEUE_NAMES: { SCHEDULER: 'scheduler' },
}))

import * as repo from '@/modules/rides/rides.repository'
import { renderTemplate } from '@/modules/notifications/templates.service'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { queues } from '@/jobs/queues'
import { processPickupWaitNudge } from '@/jobs/processors/pickup-wait-nudge.processor'
import { PICKUP_WAIT_RADIUS_METRES } from '@/constants/limits'

const NOW = new Date('2026-10-01T06:00:00Z')
const ARRIVED = '2026-10-01T05:56:00.000Z' // 4 minutes ago
const add = () => vi.mocked((queues as unknown as { scheduler: { add: ReturnType<typeof vi.fn> } }).scheduler.add)
const job = (attempt = 0) => ({ rideId: '303', attempt })

const arrivedRide = (over: Record<string, unknown> = {}) => ({
  id: 303n, user_id: 42, status: 'driver_arrived', driver_arrived_at: ARRIVED, origin_lat: 20.3, origin_lng: 85.8, ...over,
})

describe('processPickupWaitNudge: tell the rider once when the free minutes are over', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.mocked(repo.getRideCoreById).mockResolvedValue(arrivedRide() as never)
    vi.mocked(repo.getPickupWaitTerms).mockResolvedValue({ freeMin: 3, perMin: 3 })
    vi.mocked(repo.getPickupWaitStartedAt).mockResolvedValue(ARRIVED)
    vi.mocked(renderTemplate).mockResolvedValue({ subject: 'Free waiting is over', body: 'Your driver is still waiting at the pickup. ₹3 a minute now applies.' } as never)
  })
  afterEach(() => vi.useRealTimers())

  it('pushes the rider once, with the booked rate, when the free minutes have ended', async () => {
    await processPickupWaitNudge(job())
    expect(renderTemplate).toHaveBeenCalledWith('pickup_wait_started_rider', 'push', { rate: '₹3' })
    expect(notifyOwner).toHaveBeenCalledTimes(1)
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({
      ownerType: 'user', ownerId: 42n, type: 'pickup_wait_started', rideId: 303n, tag: 'pickup-wait:303',
    }))
    expect(add()).not.toHaveBeenCalled()
  })

  it('states a fractional rate to the paisa', async () => {
    vi.mocked(repo.getPickupWaitTerms).mockResolvedValue({ freeMin: 3, perMin: 2.5 })
    await processPickupWaitNudge(job())
    expect(renderTemplate).toHaveBeenCalledWith('pickup_wait_started_rider', 'push', { rate: '₹2.50' })
  })

  it('looks at the pickup the ride was booked for, within the allowed distance', async () => {
    await processPickupWaitNudge(job())
    expect(repo.getPickupWaitStartedAt).toHaveBeenCalledWith(303n, new Date(ARRIVED), 20.3, 85.8, PICKUP_WAIT_RADIUS_METRES)
  })

  it('an advance ride: counts the free minutes from the booked pickup time, so an early driver does not trigger the "waiting" note', async () => {
    const booked = '2026-10-01T06:05:00.000Z'
    vi.mocked(repo.getRideCoreById).mockResolvedValue(arrivedRide({ scheduled_for: booked }) as never)
    vi.mocked(repo.getPickupWaitStartedAt).mockResolvedValue(booked) // the clock starts at the booked time, later than the arrival
    await processPickupWaitNudge(job())
    expect(repo.getPickupWaitStartedAt).toHaveBeenCalledWith(303n, new Date(ARRIVED), 20.3, 85.8, PICKUP_WAIT_RADIUS_METRES, new Date(booked))
    expect(notifyOwner).not.toHaveBeenCalled()
    expect(add()).toHaveBeenCalled() // looks again when the free minutes (from the booked time) really end
  })

  it('does not push yet when the clock started after the tap: it comes back when the free minutes really end', async () => {
    // The driver reached the pickup 1 minute ago, so 2 of the 3 free minutes are left.
    vi.mocked(repo.getPickupWaitStartedAt).mockResolvedValue('2026-10-01T05:59:00.000Z')
    await processPickupWaitNudge(job())
    expect(notifyOwner).not.toHaveBeenCalled()
    expect(add()).toHaveBeenCalledWith('pickup_wait_nudge', { rideId: '303', attempt: 1 },
      expect.objectContaining({ delay: 120_000, jobId: 'pickup-wait-303-1' }))
  })

  it('does not push while the driver is not at the pickup, and looks again in 30 s', async () => {
    vi.mocked(repo.getPickupWaitStartedAt).mockResolvedValue(null)
    await processPickupWaitNudge(job(2))
    expect(notifyOwner).not.toHaveBeenCalled()
    expect(add()).toHaveBeenCalledWith('pickup_wait_nudge', { rideId: '303', attempt: 3 },
      expect.objectContaining({ delay: 30_000, jobId: 'pickup-wait-303-3' }))
  })

  it('gives up on a clock that never starts', async () => {
    vi.mocked(repo.getPickupWaitStartedAt).mockResolvedValue(null)
    await processPickupWaitNudge(job(24))
    expect(add()).not.toHaveBeenCalled()
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it.each([
    ['the trip has started', { status: 'in_progress' }],
    ['the ride was cancelled', { status: 'cancelled' }],
    ['there is no arrival time', { driver_arrived_at: null }],
  ])('sends nothing when %s', async (_n, over) => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(arrivedRide(over) as never)
    await processPickupWaitNudge(job())
    expect(notifyOwner).not.toHaveBeenCalled()
    expect(add()).not.toHaveBeenCalled()
  })

  it('sends nothing for a ride that no longer exists', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(null as never)
    await processPickupWaitNudge(job())
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it.each([
    ['booked before waiting charges', null],
    ['no free minutes to announce the end of', { freeMin: 0, perMin: 3 }],
    ['waiting is free after the window', { freeMin: 3, perMin: 0 }],
  ])('sends nothing for a ride with %s', async (_n, terms) => {
    vi.mocked(repo.getPickupWaitTerms).mockResolvedValue(terms as never)
    await processPickupWaitNudge(job())
    expect(notifyOwner).not.toHaveBeenCalled()
    expect(repo.getPickupWaitStartedAt).not.toHaveBeenCalled()
  })

  it('a push failure is logged, never thrown (so the job does not retry into a duplicate)', async () => {
    vi.mocked(notifyOwner).mockRejectedValue(new Error('fcm down'))
    await expect(processPickupWaitNudge(job())).resolves.toBeUndefined()
  })
})
