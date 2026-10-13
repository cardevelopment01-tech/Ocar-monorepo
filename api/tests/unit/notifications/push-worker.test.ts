import { describe, it, expect, vi, beforeEach } from 'vitest'

let processor: (job: unknown) => Promise<void>
vi.mock('bullmq', () => ({
  Worker: class { constructor(_n: string, p: (job: unknown) => Promise<void>) { processor = p } on() { return this } },
}))
vi.mock('@/jobs/queues', () => ({ QUEUE_NAMES: { PUSH: 'push' }, redisConnection: {} }))
vi.mock('@/lib/worker-logger', () => ({ createWorkerLogger: () => ({ error: vi.fn(), info: vi.fn() }) }))
const deliverPush = vi.fn()
vi.mock('@/modules/notifications/notifications.service', () => ({ deliverPush: (...a: unknown[]) => deliverPush(...a) }))
const recordPushResult = vi.fn()
vi.mock('@/modules/notifications/notifications.repository', () => ({ recordPushResult: (...a: unknown[]) => recordPushResult(...a) }))

await import('@/jobs/workers/push.worker')

const job = (over: Record<string, unknown> = {}) => ({
  data: { notificationId: '9', ownerType: 'user', ownerId: '1', msg: { title: 't', body: 'b', ttlSeconds: 600 } },
  timestamp: Date.now(), attemptsMade: 0, opts: { attempts: 3 }, ...over,
})
const result = (over: Record<string, unknown> = {}) =>
  ({ invalidTokens: [], successCount: 1, failureCount: 0, transientFailure: false, ...over })

describe('push worker', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records a successful send', async () => {
    deliverPush.mockResolvedValue(result())
    await processor(job())
    expect(recordPushResult).toHaveBeenCalledWith('9', { successCount: 1, failureCount: 0, invalidTokens: 0 })
  })

  it('drops a push that outlived its TTL without sending it', async () => {
    await processor(job({ timestamp: Date.now() - 601_000 }))
    expect(deliverPush).not.toHaveBeenCalled()
    expect(recordPushResult).toHaveBeenCalledWith('9', expect.objectContaining({ failureReason: 'expired_before_send' }))
  })

  it('throws to retry when nothing got through because of FCM trouble', async () => {
    deliverPush.mockResolvedValue(result({ successCount: 0, failureCount: 1, transientFailure: true }))
    await expect(processor(job())).rejects.toThrow('fcm transient failure')
    expect(recordPushResult).not.toHaveBeenCalled()
  })

  it('records the failure on the last attempt instead of retrying again', async () => {
    deliverPush.mockResolvedValue(result({ successCount: 0, failureCount: 1, transientFailure: true }))
    await processor(job({ attemptsMade: 2 }))
    expect(recordPushResult).toHaveBeenCalledWith('9', expect.objectContaining({ failureReason: 'fcm_unavailable' }))
  })

  it('does not retry a partial success (the devices that got it would be notified twice)', async () => {
    deliverPush.mockResolvedValue(result({ successCount: 1, failureCount: 1, transientFailure: true }))
    await expect(processor(job())).resolves.toBeUndefined()
  })

  it('a user with no tokens is not a failure', async () => {
    deliverPush.mockResolvedValue(null)
    await expect(processor(job())).resolves.toBeUndefined()
    expect(recordPushResult).not.toHaveBeenCalled()
  })
})
