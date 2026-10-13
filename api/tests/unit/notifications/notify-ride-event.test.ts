import { describe, it, expect, vi, beforeEach } from 'vitest'

const redisSet = vi.fn()
vi.mock('@/db/redis', () => ({ client: { set: (...a: unknown[]) => redisSet(...a) } }))
vi.mock('@/modules/notifications/templates.service', () => ({ renderTemplate: vi.fn() }))
vi.mock('@/modules/notifications/providers/push.provider', () => ({ sendPush: vi.fn().mockResolvedValue({ invalidTokens: [] }) }))
vi.mock('@/modules/notifications/notifications.repository', () => ({
  createInAppNotification: vi.fn(),
  getTokensForOwner: vi.fn(),
  logNotification: vi.fn(), markSent: vi.fn(), markFailed: vi.fn(), deleteDeviceTokens: vi.fn(),
  getAllAdminIds: vi.fn(), getAdminTokens: vi.fn(), listNotifications: vi.fn(), getUnreadCount: vi.fn(),
  markRead: vi.fn(), markAllRead: vi.fn(),
}))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendNotification: vi.fn() } }))

import { renderTemplate } from '@/modules/notifications/templates.service'
import { sendPush } from '@/modules/notifications/providers/push.provider'
import * as repo from '@/modules/notifications/notifications.repository'
import { notifyRideEvent } from '@/modules/notifications/notifications.service'

describe('notifyRideEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    redisSet.mockResolvedValue('OK')
    vi.mocked(repo.createInAppNotification).mockResolvedValue({ id: '1' } as never)
    vi.mocked(repo.getTokensForOwner).mockResolvedValue(['tok'])
  })

  it('sends one feed row + push on the ride-updates channel with a short TTL and a per-ride tag', async () => {
    vi.mocked(renderTemplate).mockResolvedValue({ subject: 'Your driver has arrived', body: 'Share your OTP.' })
    await notifyRideEvent('driver_arrived', 42n, 101n)

    expect(repo.createInAppNotification).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: 'user', ownerId: 42n, type: 'driver_arrived', rideId: 101n }),
    )
    expect(sendPush).toHaveBeenCalledWith(['tok'], expect.objectContaining({
      channelId: 'ride_updates_v1', ttlSeconds: 600, tag: 'ride-101-status',
      data: expect.objectContaining({ type: 'driver_arrived', rideId: '101' }),
    }))
  })

  it('does not notify twice for the same ride + event + recipient (retried status call)', async () => {
    redisSet.mockResolvedValue(null)
    await notifyRideEvent('ride_started', 42n, 101n)
    expect(repo.createInAppNotification).not.toHaveBeenCalled()
    expect(sendPush).not.toHaveBeenCalled()
  })

  it('falls back to built-in copy when the template is missing', async () => {
    vi.mocked(renderTemplate).mockRejectedValue(new Error('No active template'))
    await notifyRideEvent('ride_no_drivers', 42n, 101n)
    expect(repo.createInAppNotification).toHaveBeenCalledWith(expect.objectContaining({ title: 'No drivers found' }))
  })

  it('never throws, so a notification failure cannot fail the ride transition', async () => {
    redisSet.mockRejectedValue(new Error('redis down'))
    await expect(notifyRideEvent('driver_arrived', 42n, 101n)).resolves.toBeUndefined()
  })

  it('notifies the driver (not the rider) when the rider cancels', async () => {
    vi.mocked(renderTemplate).mockRejectedValue(new Error('x'))
    await notifyRideEvent('ride_cancelled_by_rider', 7n, 101n)
    expect(repo.createInAppNotification).toHaveBeenCalledWith(
      expect.objectContaining({ ownerType: 'driver', ownerId: 7n, type: 'ride_cancelled' }),
    )
  })
})
