import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendEachForMulticast = vi.fn().mockResolvedValue({ responses: [{ success: true }] })
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({})),
  cert: vi.fn((x: unknown) => x),
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => ({})),
}))
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: vi.fn(() => ({ sendEachForMulticast })),
}))
vi.mock('@/config', () => ({
  config: { FCM_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: 'test' }) },
}))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn() } }))
vi.mock('@/modules/notifications/notifications.repository', () => ({
  createInAppNotification: vi.fn().mockResolvedValue({ id: '1' }),
  getTokensForOwner: vi.fn().mockResolvedValue(['tok1']),
  deleteDeviceTokens: vi.fn(),
  // notifications.service re-exports these at module-eval time, so the mock
  // must define them even though this test never exercises them.
  logNotification: vi.fn(),
  markSent: vi.fn(),
  markFailed: vi.fn(),
  getAllAdminIds: vi.fn(),
  getAdminTokens: vi.fn(),
  listNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendNotification: vi.fn() } }))

import { notifyOwner } from '@/modules/notifications/notifications.service'

describe('notifyOwner — tag pass-through', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards tag to the push payload when provided', async () => {
    await notifyOwner({
      ownerType: 'driver', ownerId: 9n, type: 'stop_added',
      title: 'New stop added', body: 'A stop was added', rideId: 1n, tag: 'stop:1',
    })

    const msg = sendEachForMulticast.mock.calls[0]?.[0] as Record<string, unknown>
    expect(msg.webpush).toMatchObject({ notification: { tag: 'stop:1', renotify: true } })
  })

  it('omits tag when not provided (existing callers unaffected)', async () => {
    await notifyOwner({
      ownerType: 'user', ownerId: 5n, type: 'ride_accepted',
      title: 'Driver on the way', body: 'Your driver is coming',
    })

    const msg = sendEachForMulticast.mock.calls[0]?.[0] as Record<string, unknown>
    expect(msg.webpush).toBeUndefined()
  })
})
