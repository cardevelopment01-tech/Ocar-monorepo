import { describe, it, expect, vi, beforeEach } from 'vitest'

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, string>()
  const redisMock = {
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null
      store.set(key, value)
      return 'OK'
    }),
  }
  return { store, redisMock }
})
vi.mock('@/db/redis', () => ({ client: redisMock }))
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({})),
  cert: vi.fn((x: unknown) => x),
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => ({})),
}))
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: vi.fn(() => ({ sendEachForMulticast: vi.fn().mockResolvedValue({ responses: [{ success: true }] }) })),
}))
vi.mock('@/config', () => ({
  config: { FCM_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: 'test' }) },
}))
vi.mock('@/modules/notifications/notifications.repository', () => ({
  getTokensForOwner: vi.fn().mockResolvedValue(['device-token-1']),
  deleteDeviceTokens: vi.fn(),
  createInAppNotification: vi.fn(),
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

import { getTokensForOwner } from '@/modules/notifications/notifications.repository'
import { sendRideRequestPushOnce } from '@/modules/notifications/notifications.service'

describe('sendRideRequestPushOnce — one-shot per ride+driver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.clear()
    vi.mocked(getTokensForOwner).mockResolvedValue(['device-token-1'])
  })

  it('sends a tagged push the first time it is called for a ride+driver', async () => {
    await sendRideRequestPushOnce('101', '55', 'Bhubaneswar Station', 'Cuttack Bus Stand', 20)

    expect(getTokensForOwner).toHaveBeenCalledWith('driver', 55n)
  })

  it('does not send again on a second call for the same ride+driver', async () => {
    await sendRideRequestPushOnce('101', '55', 'Bhubaneswar Station', 'Cuttack Bus Stand', 20)
    vi.mocked(getTokensForOwner).mockClear()

    await sendRideRequestPushOnce('101', '55', 'Bhubaneswar Station', 'Cuttack Bus Stand', 20)

    expect(getTokensForOwner).not.toHaveBeenCalled()
  })

  it('sends independently for a different driver on the same ride', async () => {
    await sendRideRequestPushOnce('101', '55', 'Bhubaneswar Station', 'Cuttack Bus Stand', 20)
    vi.mocked(getTokensForOwner).mockClear()

    await sendRideRequestPushOnce('101', '56', 'Bhubaneswar Station', 'Cuttack Bus Stand', 20)

    expect(getTokensForOwner).toHaveBeenCalledWith('driver', 56n)
  })
})
