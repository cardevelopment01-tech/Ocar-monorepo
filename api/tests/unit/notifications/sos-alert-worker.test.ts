import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  processor: null as null | ((job: unknown) => Promise<void>),
  config: { ADMIN_PHONE: '+919999999999' as string | undefined },
  sendSms: vi.fn(),
  notifService: {
    logNotification: vi.fn(),
    markSent: vi.fn(),
    markFailed: vi.fn(),
    notifyAllAdmins: vi.fn(),
    notifyOwner: vi.fn(),
  },
  renderTemplate: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(_name: string, processor: (job: unknown) => Promise<void>) { h.processor = processor }
    on() { return this }
  },
}))
vi.mock('@/jobs/queues', () => ({ QUEUE_NAMES: { NOTIFICATIONS: 'notifications' }, redisConnection: {} }))
vi.mock('@/config', () => ({ config: h.config }))
vi.mock('@/providers/sms.provider', () => ({ sendSms: h.sendSms }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn() }))
vi.mock('@/modules/notifications/notifications.service', () => h.notifService)
vi.mock('@/modules/notifications/templates.service', () => ({ renderTemplate: h.renderTemplate }))
vi.mock('@/db/client', () => ({ workerPool: { query: vi.fn() } }))
vi.mock('@/lib/worker-logger', () => ({ createWorkerLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }))

await import('@/jobs/workers/notifications.worker')

const job = (attemptsMade: number) => ({
  name: 'sos_alert',
  attemptsMade,
  data: { rideId: '16', userId: '4', userPhone: '+919876543210', lat: 20.29, lng: 85.82, triggeredAt: '2026-09-26T00:00:00Z' },
})

beforeEach(() => {
  h.config.ADMIN_PHONE = '+919999999999'
  Object.values(h.notifService).forEach((f) => f.mockReset())
  h.sendSms.mockReset()
  h.renderTemplate.mockReset()
  h.renderTemplate.mockResolvedValue({ subject: 'SOS ALERT', body: 'body' })
  h.notifService.logNotification.mockResolvedValue(1)
})

describe('sos_alert worker', () => {
  it('still alerts every admin when the SMS vendor fails, and lets the job retry', async () => {
    h.sendSms.mockRejectedValue(new Error('vendor down'))
    await expect(h.processor!(job(0))).rejects.toThrow('vendor down')
    expect(h.notifService.notifyAllAdmins).toHaveBeenCalledTimes(1)
    expect(h.notifService.markFailed).toHaveBeenCalledWith(1, 'vendor down')
  })

  it('does not page the admins again on an SMS retry', async () => {
    h.sendSms.mockResolvedValue(undefined)
    await h.processor!(job(1))
    expect(h.notifService.notifyAllAdmins).not.toHaveBeenCalled()
    expect(h.notifService.markSent).toHaveBeenCalledWith(1)
  })

  it('records a failure, not "sent", when ADMIN_PHONE is not configured', async () => {
    h.config.ADMIN_PHONE = undefined
    await expect(h.processor!(job(0))).resolves.toBeUndefined()
    expect(h.sendSms).not.toHaveBeenCalled()
    expect(h.notifService.markSent).not.toHaveBeenCalled()
    expect(h.notifService.markFailed).toHaveBeenCalledWith(1, 'ADMIN_PHONE not configured')
    expect(h.notifService.notifyAllAdmins).toHaveBeenCalledTimes(1)
  })
})
