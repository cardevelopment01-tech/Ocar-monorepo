import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendEachForMulticast = vi.fn()
const sendEach = vi.fn()
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({})),
  cert: vi.fn((x: unknown) => x),
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => ({})),
}))
vi.mock('firebase-admin/messaging', () => ({ getMessaging: vi.fn(() => ({ sendEachForMulticast, sendEach })) }))
vi.mock('@/config', () => ({ config: { FCM_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: 'test' }) } }))

import { sendPush } from '@/modules/notifications/providers/push.provider'

// Value: protects=a caller that sends one message to many phones learns what happened to EACH phone (accepted, dead, or worth retrying), a
// message that needs a different data field per phone still goes as one call, and everything existing callers rely on is unchanged;
// fails_when=the per-phone results are out of order or mislabel a dead phone as retryable (or the reverse), the per-phone data lands on the
// wrong phone, or the multicast path changes shape; why_new=a broadcast to 100,000 people made one Firebase call per person because
// the provider only reported totals; seam=firebase-admin is replaced; no_claim=real Firebase behaviour.

const ok = { success: true }
const dead = { success: false, error: { code: 'messaging/registration-token-not-registered' } }
const badArg = { success: false, error: { code: 'messaging/invalid-argument' } }
const flaky = { success: false, error: { code: 'messaging/server-unavailable' } }

describe('sendPush: what happened to each phone', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reports each phone in the order given: accepted, dead, dead (bad argument) or worth retrying', async () => {
    sendEachForMulticast.mockResolvedValue({ successCount: 1, failureCount: 3, responses: [ok, dead, flaky, badArg] })
    const res = await sendPush(['a', 'b', 'c', 'd'], { title: 'T', body: 'B' })
    expect(res.tokenResults).toEqual(['ok', 'invalid', 'retry', 'invalid'])
    expect(res.invalidTokens).toEqual(['b', 'd'])
    expect(res).toMatchObject({ successCount: 1, failureCount: 3, transientFailure: true })
  })

  it('a whole-call failure marks every phone as worth retrying', async () => {
    sendEachForMulticast.mockRejectedValue(new Error('network'))
    const res = await sendPush(['a', 'b'], { title: 'T', body: 'B' })
    expect(res.tokenResults).toEqual(['retry', 'retry'])
    expect(res).toMatchObject({ transientFailure: true, failureCount: 2, successCount: 0 })
  })

  it('no phones: nothing sent, and no per-phone answer', async () => {
    const res = await sendPush([], { title: 'T', body: 'B' })
    expect(res.tokenResults).toBeUndefined()
    expect(sendEachForMulticast).not.toHaveBeenCalled()
  })

  it('without per-phone data it is one multicast, as before', async () => {
    sendEachForMulticast.mockResolvedValue({ successCount: 2, failureCount: 0, responses: [ok, ok] })
    await sendPush(['a', 'b'], { title: 'T', body: 'B', data: { type: 'announcement' } })
    expect(sendEach).not.toHaveBeenCalled()
    expect((sendEachForMulticast.mock.calls[0]![0] as { tokens: string[] }).tokens).toEqual(['a', 'b'])
  })
})

describe('sendPush: a different data field per phone, still one call', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends one message per phone through one sendEach call, each with its own data merged over the shared data', async () => {
    sendEach.mockResolvedValue({ successCount: 2, failureCount: 0, responses: [ok, ok] })
    const res = await sendPush(
      ['a', 'b'],
      { title: 'T', body: 'B', ttlSeconds: 86400, channelId: 'announcements_v1', data: { type: 'announcement' } },
      [{ notificationId: '11' }, { notificationId: '12' }],
    )
    expect(sendEachForMulticast).not.toHaveBeenCalled()
    expect(sendEach).toHaveBeenCalledTimes(1)
    const msgs = sendEach.mock.calls[0]![0] as Array<Record<string, unknown>>
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ token: 'a', notification: { title: 'T', body: 'B' }, data: { type: 'announcement', notificationId: '11' } })
    expect(msgs[1]).toMatchObject({ token: 'b', data: { type: 'announcement', notificationId: '12' } })
    expect(msgs[0]).not.toHaveProperty('tokens')
    expect(msgs[0]!['android']).toMatchObject({ priority: 'high', ttl: 86_400_000, notification: { channelId: 'announcements_v1' } })
    expect(res.tokenResults).toEqual(['ok', 'ok'])
  })

  it('per-phone results and dead phones are reported for the same positions', async () => {
    sendEach.mockResolvedValue({ successCount: 1, failureCount: 1, responses: [dead, ok] })
    const res = await sendPush(['a', 'b'], { title: 'T', body: 'B' }, [{ notificationId: '1' }, { notificationId: '2' }])
    expect(res.tokenResults).toEqual(['invalid', 'ok'])
    expect(res.invalidTokens).toEqual(['a'])
  })

  it('shared data is optional: per-phone data alone is enough', async () => {
    sendEach.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [ok] })
    await sendPush(['a'], { title: 'T', body: 'B' }, [{ notificationId: '7' }])
    expect((sendEach.mock.calls[0]![0] as Array<{ data: unknown }>)[0]!.data).toEqual({ notificationId: '7' })
  })
})

describe('sendPush: a picture', () => {
  beforeEach(() => vi.clearAllMocks())

  it('puts the picture on the Android notification and the iOS options, for both the multicast and the per-phone call', async () => {
    sendEachForMulticast.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [ok] })
    await sendPush(['a'], { title: 'T', body: 'B', imageUrl: 'https://cdn.example.com/a.jpg' })
    const m = sendEachForMulticast.mock.calls[0]![0] as { android: { notification: { imageUrl?: string } }; apns: { fcmOptions?: { imageUrl: string } } }
    expect(m.android.notification.imageUrl).toBe('https://cdn.example.com/a.jpg')
    expect(m.apns.fcmOptions).toEqual({ imageUrl: 'https://cdn.example.com/a.jpg' })

    sendEach.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [ok] })
    await sendPush(['a'], { title: 'T', body: 'B', imageUrl: 'https://cdn.example.com/a.jpg' }, [{ notificationId: '1' }])
    const one = (sendEach.mock.calls[0]![0] as Array<{ android: { notification: { imageUrl?: string } } }>)[0]!
    expect(one.android.notification.imageUrl).toBe('https://cdn.example.com/a.jpg')
  })

  it('without a picture nothing about an image is sent', async () => {
    sendEachForMulticast.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [ok] })
    await sendPush(['a'], { title: 'T', body: 'B' })
    const m = sendEachForMulticast.mock.calls[0]![0] as { android: { notification: Record<string, unknown> }; apns: Record<string, unknown> }
    expect(m.android.notification).not.toHaveProperty('imageUrl')
    expect(m.apns).not.toHaveProperty('fcmOptions')
  })
})
