import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/notifications/templates.service', () => ({ renderTemplate: vi.fn() }))
vi.mock('@/modules/notifications/notifications.repository', () => ({
  createInAppNotification: vi.fn(),
  getTokensForOwner: vi.fn(),
  // notifications.service re-exports these at module-eval time, so the mock
  // must define them even though this test never exercises them.
  logNotification: vi.fn(),
  markSent: vi.fn(),
  markFailed: vi.fn(),
  deleteDeviceTokens: vi.fn(),
  getAllAdminIds: vi.fn(),
  getAdminTokens: vi.fn(),
  listNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendNotification: vi.fn() } }))

import { renderTemplate } from '@/modules/notifications/templates.service'
import * as repo from '@/modules/notifications/notifications.repository'
import { notifyRidePaymentFailed } from '@/modules/notifications/notifications.service'

describe('notifyRidePaymentFailed', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the payment_failed push template and persists an in-app feed row', async () => {
    vi.mocked(renderTemplate).mockResolvedValue({ subject: 'Payment failed', body: 'Your ₹500 ride payment didn’t go through. Tap to pay now.' })
    vi.mocked(repo.createInAppNotification).mockResolvedValue({ id: '1' } as never)
    vi.mocked(repo.getTokensForOwner).mockResolvedValue([]) // no tokens → push leg is a no-op

    await notifyRidePaymentFailed(BigInt(42), BigInt(101), 500)

    expect(renderTemplate).toHaveBeenCalledWith('payment_failed', 'push', { amount: '500' })
    expect(repo.createInAppNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerType: 'user',
        ownerId: BigInt(42),
        type: 'payment_failed',
        title: 'Payment failed',
        rideId: BigInt(101),
      })
    )
  })
})
