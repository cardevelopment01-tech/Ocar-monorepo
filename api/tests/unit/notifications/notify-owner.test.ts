import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendEachForMulticast = vi.fn().mockResolvedValue({ responses: [{ success: true }], successCount: 1, failureCount: 0 })
const queueAdd = vi.fn().mockResolvedValue(undefined)
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({})),
  cert: vi.fn((x: unknown) => x),
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => ({})),
}))
vi.mock('firebase-admin/messaging', () => ({ getMessaging: vi.fn(() => ({ sendEachForMulticast })) }))
vi.mock('@/config', () => ({ config: { FCM_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: 'test' }) } }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn() } }))
vi.mock('@/jobs/queues', () => ({ pushQueue: { add: (...a: unknown[]) => queueAdd(...a) } }))
vi.mock('@/modules/notifications/notifications.repository', () => ({
  createInAppNotification: vi.fn().mockResolvedValue({ id: '77' }),
  getTokensForOwner: vi.fn().mockResolvedValue(['tok1']),
  deleteDeviceTokens: vi.fn(),
  logNotification: vi.fn(), markSent: vi.fn(), markFailed: vi.fn(), getAllAdminIds: vi.fn(), getAdminTokens: vi.fn(),
  listNotifications: vi.fn(), getUnreadCount: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(),
}))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendNotification: vi.fn() } }))

import { notifyOwner } from '@/modules/notifications/notifications.service'

type Job = { ownerId: string; notificationId: string; msg: Record<string, unknown> & { data: Record<string, string> } }
const jobData = () => queueAdd.mock.calls[0]?.[1] as Job

describe('notifyOwner', () => {
  beforeEach(() => { vi.clearAllMocks(); queueAdd.mockResolvedValue(undefined) })

  it('enqueues the push with channel, TTL and collapse tag from the registry', async () => {
    await notifyOwner({ ownerType: 'user', ownerId: 5n, type: 'driver_arrived', title: 'Arrived', body: 'b', rideId: 12n })

    expect(queueAdd).toHaveBeenCalledWith('push_send', expect.anything(), { attempts: 3, backoff: { type: 'exponential', delay: 2000 } })
    expect(jobData().notificationId).toBe('77')
    expect(jobData().msg).toMatchObject({ channelId: 'ride_updates_v1', ttlSeconds: 600, tag: 'ride-12-status' })
  })

  it('every push carries the payload contract: type, notificationId, sentAt, rideId', async () => {
    await notifyOwner({ ownerType: 'driver', ownerId: 9n, type: 'stop_added', title: 't', body: 'b', rideId: 1n, payload: { path: '/x' } })
    const { data } = jobData().msg
    expect(data).toMatchObject({ type: 'stop_added', notificationId: '77', rideId: '1', path: '/x' })
    expect(Number.isNaN(Date.parse(data['sentAt']!))).toBe(false)
  })

  it('a caller-supplied tag overrides the registry default', async () => {
    await notifyOwner({ ownerType: 'driver', ownerId: 9n, type: 'stop_added', title: 't', body: 'b', rideId: 1n, tag: 'stop:1' })
    expect(jobData().msg['tag']).toBe('stop:1')
  })

  it('types with no channel use the app default channel; one-slot types collapse by type', async () => {
    await notifyOwner({ ownerType: 'driver', ownerId: 9n, type: 'session_ended_stale', title: 't', body: 'b' })
    expect(jobData().msg['channelId']).toBeUndefined()
    expect(jobData().msg['tag']).toBe('session_ended_stale')
  })

  it('sends inline when the queue is unavailable, so the push is not lost', async () => {
    queueAdd.mockRejectedValue(new Error('redis down'))
    await notifyOwner({ ownerType: 'user', ownerId: 5n, type: 'ride_accepted', title: 't', body: 'b', rideId: 3n })

    const msg = sendEachForMulticast.mock.calls[0]?.[0] as Record<string, unknown>
    expect(msg).toBeDefined()
    expect(msg['android']).toMatchObject({ collapseKey: 'ride-3-status', ttl: 3_600_000 })
  })
})
