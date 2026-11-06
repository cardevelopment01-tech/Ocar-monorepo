import { describe, it, expect, vi, beforeEach } from 'vitest'

// Value: protects=an SOS press texts the rider's saved contacts and one bad number or vendor error never blocks the others or
// the admin SMS; fails_when=the contact loop is edited and a contact is skipped, a driver-triggered alert texts a rider's
// family, a retry texts them twice, or an attempt stops being logged; why_new=no test pinned this fan-out before the live
// trip link change; seam=bullmq Worker capture + mocked pool/SMS (same harness as sos-alert-worker.test.ts);
// no_claim=real SMS vendor delivery (mocked provider).
const h = vi.hoisted(() => ({
  processor: null as null | ((job: unknown) => Promise<void>),
  config: { ADMIN_PHONE: '+919999999999' as string | undefined },
  sendSms: vi.fn(),
  query: vi.fn(),
  notifService: {
    logNotification: vi.fn(),
    markSent: vi.fn(),
    markFailed: vi.fn(),
    notifyAllAdmins: vi.fn(),
    notifyOwner: vi.fn(),
  },
  renderTemplate: vi.fn(),
  createSosShare: vi.fn(),
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
vi.mock('@/db/client', () => ({ workerPool: { query: h.query } }))
vi.mock('@/lib/worker-logger', () => ({ createWorkerLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }))
vi.mock('@/modules/ride-shares/ride-shares.service', () => ({ createSosShare: h.createSosShare }))

await import('@/jobs/workers/notifications.worker')

const contacts = [
  { name: 'Mum', phone: '+919811111111', rider_name: 'Asha' },
  { name: 'Dad', phone: '+919822222222', rider_name: 'Asha' },
  { name: 'Sis', phone: '+919833333333', rider_name: 'Asha' },
]
const job = (over: Record<string, unknown> = {}, attemptsMade = 0) => ({
  name: 'sos_alert',
  attemptsMade,
  data: { rideId: '16', userId: '4', userPhone: '+919876543210', lat: 20.29, lng: 85.82, triggeredByRole: 'user', triggeredAt: '2026-09-26T00:00:00Z', ...over },
})
const smsTo = () => h.sendSms.mock.calls.map((c) => c[0] as string)

beforeEach(() => {
  h.config.ADMIN_PHONE = '+919999999999'
  Object.values(h.notifService).forEach((f) => f.mockReset())
  h.sendSms.mockReset().mockResolvedValue(undefined)
  h.query.mockReset().mockResolvedValue({ rows: contacts })
  h.renderTemplate.mockReset().mockImplementation(async (slug: string) => ({ subject: 'SOS', body: `body:${slug}` }))
  h.notifService.logNotification.mockResolvedValue(1)
  h.createSosShare.mockReset().mockResolvedValue(null)
})

describe('sos_alert: texting the rider\'s emergency contacts (existing behavior)', () => {
  it('texts every saved contact when the rider pressed SOS, with the rider name and the alert location', async () => {
    await h.processor!(job())
    expect(smsTo()).toEqual(expect.arrayContaining(['+919811111111', '+919822222222', '+919833333333']))
    expect(h.renderTemplate).toHaveBeenCalledWith('sos_contact', 'sms', { riderName: 'Asha', lat: '20.29', lng: '85.82' })
    expect(h.renderTemplate.mock.calls.filter((c) => c[0] === 'sos_contact')).toHaveLength(3)
  })

  it('never texts the rider\'s family for a driver-triggered alert', async () => {
    await h.processor!(job({ triggeredByRole: 'driver' }))
    expect(h.query).not.toHaveBeenCalled()
    expect(smsTo()).toEqual(['+919999999999'])
  })

  it('one failing contact does not stop the others or the admin SMS, and the failure is logged', async () => {
    h.sendSms.mockImplementation(async (to: string) => { if (to === '+919822222222') throw new Error('bad number') })
    await h.processor!(job())
    expect(smsTo()).toEqual(expect.arrayContaining(['+919811111111', '+919822222222', '+919833333333', '+919999999999']))
    expect(h.notifService.markFailed).toHaveBeenCalledWith(1, 'bad number')
    expect(h.notifService.markSent).toHaveBeenCalled()
  })

  it('logs every contact attempt as an sos_contact notification for that ride', async () => {
    await h.processor!(job())
    const logged = h.notifService.logNotification.mock.calls.map((c) => c[0]).filter((p) => p.jobName === 'sos_contact')
    expect(logged.map((p) => p.recipientPhone)).toEqual(['+919811111111', '+919822222222', '+919833333333'])
    expect(logged.every((p) => p.payload.rideId === '16')).toBe(true)
  })

  it('a failure reading the contacts never blocks the admin SMS', async () => {
    h.query.mockRejectedValue(new Error('db down'))
    await expect(h.processor!(job())).resolves.toBeUndefined()
    expect(smsTo()).toEqual(['+919999999999'])
  })

  it('does not text the contacts again on a retry', async () => {
    await h.processor!(job({}, 1))
    expect(h.query).not.toHaveBeenCalled()
  })
})
