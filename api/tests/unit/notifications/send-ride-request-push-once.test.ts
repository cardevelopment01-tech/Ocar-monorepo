import { describe, it, expect, vi, beforeEach } from 'vitest'

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, string>()
  const redisMock = {
    del: vi.fn(async (key: string) => { store.delete(key); return 1 }),
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
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
  getDriverTokensByRideAlert: vi.fn().mockResolvedValue({ v3: [], legacy: ['device-token-1'] }),
  deleteDeviceTokens: vi.fn(),
  markRideOfferPushed: vi.fn().mockResolvedValue(undefined),
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

import { getDriverTokensByRideAlert, markRideOfferPushed } from '@/modules/notifications/notifications.repository'
import { sendRideRequestPushOnce, sendRideRequestGonePush, rideRequestPushText } from '@/modules/notifications/notifications.service'
import * as pushProvider from '@/modules/notifications/providers/push.provider'

describe('sendRideRequestPushOnce — one-shot per ride+driver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.clear()
    vi.mocked(getDriverTokensByRideAlert).mockResolvedValue({ v3: [], legacy: ['device-token-1'] })
  })

  it('sends a tagged push the first time it is called for a ride+driver', async () => {
    await sendRideRequestPushOnce('101', '55', 'Bhubaneswar Station', 'Cuttack Bus Stand', 20)

    expect(getDriverTokensByRideAlert).toHaveBeenCalledWith(55n)
    // Delivery tracking: the offer is stamped as pushed, once (a repeat call is a no-op below).
    expect(markRideOfferPushed).toHaveBeenCalledTimes(1)
    expect(markRideOfferPushed).toHaveBeenCalledWith(101n, 55n)
  })

  it('a failing delivery stamp never fails the push', async () => {
    vi.mocked(markRideOfferPushed).mockRejectedValueOnce(new Error('db down'))
    await expect(sendRideRequestPushOnce('103', '55', 'A', 'B', 20)).resolves.toBeUndefined()
  })

  it('does not stamp or send again on a second call for the same ride+driver', async () => {
    await sendRideRequestPushOnce('104', '55', 'A', 'B', 20)
    vi.mocked(markRideOfferPushed).mockClear()
    await sendRideRequestPushOnce('104', '55', 'A', 'B', 20)
    expect(markRideOfferPushed).not.toHaveBeenCalled()
  })

  it('does not send again on a second call for the same ride+driver', async () => {
    await sendRideRequestPushOnce('101', '55', 'Bhubaneswar Station', 'Cuttack Bus Stand', 20)
    vi.mocked(getDriverTokensByRideAlert).mockClear()

    await sendRideRequestPushOnce('101', '55', 'Bhubaneswar Station', 'Cuttack Bus Stand', 20)

    expect(getDriverTokensByRideAlert).not.toHaveBeenCalled()
  })

  it('sends independently for a different driver on the same ride', async () => {
    await sendRideRequestPushOnce('101', '55', 'Bhubaneswar Station', 'Cuttack Bus Stand', 20)
    vi.mocked(getDriverTokensByRideAlert).mockClear()

    await sendRideRequestPushOnce('101', '56', 'Bhubaneswar Station', 'Cuttack Bus Stand', 20)

    expect(getDriverTokensByRideAlert).toHaveBeenCalledWith(56n)
  })
})

const details = { rideType: 'one_way', estimatedFare: 449.6, distanceToPickup: 1240, paymentChannel: 'cash', tripKm: 28 }

describe('sendRideRequestPushOnce — loud channel per device', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.clear()
  })

  it('an older build keeps the v2 channel and the plain text; a new build gets v3, the long ring and the details', async () => {
    const sendSpy = vi.spyOn(pushProvider, 'sendPush').mockResolvedValue({ invalidTokens: [], successCount: 1, failureCount: 0, transientFailure: false })
    vi.mocked(getDriverTokensByRideAlert).mockResolvedValue({ v3: ['new-device'], legacy: ['old-device'] })

    await sendRideRequestPushOnce('201', '55', 'Saheed Nagar', 'Cuttack', 20, details)

    const calls = sendSpy.mock.calls
    const legacy = calls.find(([tokens]) => tokens.includes('old-device'))!
    const loud = calls.find(([tokens]) => tokens.includes('new-device'))!
    expect(legacy[1]).toMatchObject({ channelId: 'ride_requests_v2', title: 'New ride request' })
    expect(legacy[1].sound).toBeUndefined()
    expect(loud[1]).toMatchObject({
      channelId: 'ride_requests_v3',
      timeSensitive: true,
      sound: { android: 'ride_request_long', ios: 'ride_request_long.wav' },
      title: 'New ride request · ₹450',
      data: { type: 'ride_request', rideId: '201', rideType: 'one_way', estimatedFare: '450', distanceToPickup: '1240', tripKm: '28', paymentChannel: 'cash' },
    })
    sendSpy.mockRestore()
  })

  it('sends nothing to a group with no devices', async () => {
    const sendSpy = vi.spyOn(pushProvider, 'sendPush').mockResolvedValue({ invalidTokens: [], successCount: 0, failureCount: 0, transientFailure: false })
    vi.mocked(getDriverTokensByRideAlert).mockResolvedValue({ v3: [], legacy: ['old-device'] })
    await sendRideRequestPushOnce('202', '55', 'A', 'B', 20, details)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    sendSpy.mockRestore()
  })
})

describe('rideRequestPushText', () => {
  it('shows type, distance, fare and the route at a glance', () => {
    expect(rideRequestPushText('Saheed Nagar', 'Cuttack', details)).toEqual({ title: 'New ride request · ₹450', body: 'One way · 1.2 km away\nSaheed Nagar → Cuttack' })
  })
  it('metres under a kilometre, return cab and rental labels, no fare when unknown', () => {
    expect(rideRequestPushText('A', 'B', { ...details, distanceToPickup: 480, isReturnCab: true, estimatedFare: 0 })).toEqual({ title: 'New ride request', body: 'Return cab · 480 m away\nA → B' })
    expect(rideRequestPushText('A', 'B', { ...details, rideType: 'rental' }).body.startsWith('Rental')).toBe(true)
  })
})

describe('sendRideRequestPushOnce — token lookup failure', () => {
  it('frees the one-shot guard so the fallback push can still reach the driver', async () => {
    vi.clearAllMocks()
    store.clear()
    vi.mocked(getDriverTokensByRideAlert).mockRejectedValueOnce(new Error('db down'))
    await sendRideRequestPushOnce('301', '55', 'A', 'B', 20, details)
    expect(store.size).toBe(0)
    vi.mocked(getDriverTokensByRideAlert).mockResolvedValue({ v3: [], legacy: ['d'] })
    await sendRideRequestPushOnce('301', '55', 'A', 'B', 20, details)
    expect(getDriverTokensByRideAlert).toHaveBeenCalledTimes(2)
  })
})

describe('sendRideRequestGonePush — silence the ring on drivers who were pushed', () => {
  beforeEach(() => { vi.clearAllMocks(); store.clear() })

  it('replaces the ringing notification (same tag) with a silent one, only for loud-channel devices of drivers we pushed', async () => {
    const sendSpy = vi.spyOn(pushProvider, 'sendPush').mockResolvedValue({ invalidTokens: [], successCount: 1, failureCount: 0, transientFailure: false })
    vi.mocked(getDriverTokensByRideAlert).mockResolvedValue({ v3: ['new-device'], legacy: ['old-device'] })
    await sendRideRequestPushOnce('401', '55', 'A', 'B', 20, details) // marks driver 55 as pushed
    sendSpy.mockClear()

    await sendRideRequestGonePush('401', ['55', '99'], 'accepted') // 99 was never pushed

    expect(sendSpy).toHaveBeenCalledTimes(1)
    const [tokens, msg] = sendSpy.mock.calls[0]!
    expect(tokens).toEqual(['new-device']) // an older build has no silent channel: leave it alone
    expect(msg).toMatchObject({ tag: 'ride-401', silent: true, channelId: 'ride_gone_v1', data: { type: 'ride_request_gone', rideId: '401', reason: 'accepted' } })
    expect(msg.sound).toBeUndefined()
    sendSpy.mockRestore()
  })

  it('a failure for one driver never throws or blocks the others', async () => {
    store.set('ride-push-sent:x', '1')
    vi.mocked(getDriverTokensByRideAlert).mockRejectedValue(new Error('db'))
    await expect(sendRideRequestGonePush('402', ['1', '2'], 'cancelled')).resolves.toBeUndefined()
  })
})

describe('race between the ring and its cancellation', () => {
  beforeEach(() => { vi.clearAllMocks(); store.clear() })

  it('a request that ended before its push went out is never rung', async () => {
    const sendSpy = vi.spyOn(pushProvider, 'sendPush').mockResolvedValue({ invalidTokens: [], successCount: 1, failureCount: 0, transientFailure: false })
    vi.mocked(getDriverTokensByRideAlert).mockResolvedValue({ v3: ['new-device'], legacy: [] })
    await sendRideRequestGonePush('501', ['55'], 'accepted') // runs first: nothing sent yet
    expect(sendSpy).not.toHaveBeenCalled()
    await sendRideRequestPushOnce('501', '55', 'A', 'B', 20, details)
    expect(sendSpy).not.toHaveBeenCalled()
    sendSpy.mockRestore()
  })

  it('distance text never says 0 m or 1000 m', () => {
    expect(rideRequestPushText('A', 'B', { ...details, distanceToPickup: 2 }).body).toContain('10 m away')
    expect(rideRequestPushText('A', 'B', { ...details, distanceToPickup: 998 }).body).toContain('1.0 km away')
  })
})
