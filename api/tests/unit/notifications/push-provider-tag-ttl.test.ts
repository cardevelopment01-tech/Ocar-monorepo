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

import { sendPush } from '@/modules/notifications/providers/push.provider'

describe('sendPush — tag/renotify/TTL', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets android high priority, webpush Urgency/TTL headers, and tag+renotify when tag is provided', async () => {
    await sendPush(['tok1'], { title: 'Ride', body: 'New request', tag: 'ride-101', ttlSeconds: 25 })

    const msg = sendEachForMulticast.mock.calls[0]?.[0] as Record<string, unknown>
    expect(msg.android).toEqual({ priority: 'high' })
    expect(msg.webpush).toEqual({
      headers: { Urgency: 'high', TTL: '25' },
      notification: { tag: 'ride-101', renotify: true },
    })
  })

  it('omits android/webpush entirely when no tag is provided (existing callers unaffected)', async () => {
    await sendPush(['tok1'], { title: 'Wallet', body: 'Low balance' })

    const msg = sendEachForMulticast.mock.calls[0]?.[0] as Record<string, unknown>
    expect(msg.android).toBeUndefined()
    expect(msg.webpush).toBeUndefined()
  })
})
