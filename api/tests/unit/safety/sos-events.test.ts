import { describe, it, expect, vi, beforeEach } from 'vitest'

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
const audit = vi.hoisted(() => ({ recordAuditLog: vi.fn() }))
const notif = vi.hoisted(() => ({ notifyOwner: vi.fn() }))
vi.mock('@/modules/notifications/notifications.service', () => notif)
vi.mock('@/lib/logger', () => ({ logger: { child: () => log } }))
vi.mock('@/lib/audit-log', () => audit)
vi.mock('@/modules/safety/safety.repository', () => ({ updateSosStatus: vi.fn(), getSosStatus: vi.fn(), getOnCallAdmins: vi.fn(), setAdminOnCall: vi.fn() }))
vi.mock('@/websocket/socket.server', () => ({ getIO: vi.fn() }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: {} }))

import * as repo from '@/modules/safety/safety.repository'
import { acknowledgeSosAlert, resolveSosAlert, setOnCall } from '@/modules/safety/sos.service'

describe('SOS lifecycle events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    audit.recordAuditLog.mockResolvedValue(undefined)
  })

  it('logs who acknowledged an alert', async () => {
    vi.mocked(repo.updateSosStatus).mockResolvedValue({ id: 5 } as never)
    await acknowledgeSosAlert(5n, 2n)
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ event: 'sos.acknowledged', sos_id: '5', admin_id: '2' }), 'sos.acknowledged')
  })

  it('logs who resolved an alert and how', async () => {
    vi.mocked(repo.updateSosStatus).mockResolvedValue({ id: 5 } as never)
    await resolveSosAlert(5n, 2n, 'false_alarm', 'test press')
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ event: 'sos.resolved', sos_id: '5', admin_id: '2', status: 'false_alarm' }), 'sos.resolved')
    // the note can contain personal details: it stays in the database row, not in the log
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('test press')
  })

  it('logs nothing when the alert does not exist', async () => {
    vi.mocked(repo.updateSosStatus).mockResolvedValue(null as never)
    vi.mocked(repo.getSosStatus).mockResolvedValue(null)
    await expect(acknowledgeSosAlert(99n, 2n)).rejects.toMatchObject({ httpStatus: 404, appCode: 'SOS_ALERT_NOT_FOUND' })
    expect(log.info).not.toHaveBeenCalled()
    expect(audit.recordAuditLog).not.toHaveBeenCalled()
  })
})

describe('SOS state guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    audit.recordAuditLog.mockResolvedValue(undefined)
  })

  it('answers 409, not 404, when someone already acknowledged the alert', async () => {
    vi.mocked(repo.updateSosStatus).mockResolvedValue(null as never)
    vi.mocked(repo.getSosStatus).mockResolvedValue('acknowledged')
    await expect(acknowledgeSosAlert(5n, 2n)).rejects.toMatchObject({ httpStatus: 409, appCode: 'SOS_STATE_CONFLICT' })
    expect(audit.recordAuditLog).not.toHaveBeenCalled()
  })

  it('answers 409 when resolving an alert that is already closed', async () => {
    vi.mocked(repo.updateSosStatus).mockResolvedValue(null as never)
    vi.mocked(repo.getSosStatus).mockResolvedValue('false_alarm')
    await expect(resolveSosAlert(5n, 2n, 'resolved')).rejects.toMatchObject({ httpStatus: 409, message: 'This alert is already false alarm' })
  })
})

describe('SOS resolution notes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    audit.recordAuditLog.mockResolvedValue(undefined)
    vi.mocked(repo.updateSosStatus).mockResolvedValue({ id: 5 } as never)
  })

  it('refuses a false alarm with no note, and never touches the alert', async () => {
    await expect(resolveSosAlert(5n, 2n, 'false_alarm')).rejects.toMatchObject({ httpStatus: 400, appCode: 'SOS_NOTE_REQUIRED' })
    await expect(resolveSosAlert(5n, 2n, 'false_alarm', '   ')).rejects.toMatchObject({ appCode: 'SOS_NOTE_REQUIRED' })
    expect(repo.updateSosStatus).not.toHaveBeenCalled()
  })

  it('a plain resolve needs no note', async () => {
    await resolveSosAlert(5n, 2n, 'resolved')
    expect(repo.updateSosStatus).toHaveBeenCalledWith(5n, 'resolved', 2n, undefined)
  })

  it('trims the note and caps it at 500 characters', async () => {
    await resolveSosAlert(5n, 2n, 'resolved', `  ${'x'.repeat(600)}  `)
    const note = vi.mocked(repo.updateSosStatus).mock.calls[0]![3] as string
    expect(note).toHaveLength(500)
  })
})

describe('SOS audit trail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.updateSosStatus).mockResolvedValue({ id: 5 } as never)
  })

  it('records the acknowledge and the resolve against the alert, with the admin, note and ip', async () => {
    audit.recordAuditLog.mockResolvedValue(undefined)
    await acknowledgeSosAlert(5n, 2n, '10.0.0.1')
    await resolveSosAlert(5n, 2n, 'resolved', 'rider is safe', '10.0.0.1')
    expect(audit.recordAuditLog).toHaveBeenNthCalledWith(1, expect.objectContaining({ adminId: 2n, action: 'sos.acknowledge', targetTable: 'sos_alerts', targetId: 5n, ipAddress: '10.0.0.1' }))
    expect(audit.recordAuditLog).toHaveBeenNthCalledWith(2, expect.objectContaining({ action: 'sos.resolve', reason: 'rider is safe', afterState: { status: 'resolved' } }))
  })

  it('still completes the action when the audit queue is down', async () => {
    audit.recordAuditLog.mockRejectedValue(new Error('redis down'))
    await expect(acknowledgeSosAlert(5n, 2n)).resolves.toEqual({ id: 5 })
    expect(log.error).toHaveBeenCalled()
  })
})

describe('SOS acknowledged notice and on-call duty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    audit.recordAuditLog.mockResolvedValue(undefined)
    notif.notifyOwner.mockResolvedValue(undefined)
  })

  it('tells a rider who pressed SOS that the safety team has it', async () => {
    vi.mocked(repo.updateSosStatus).mockResolvedValue({ id: 5, ride_id: 9, triggered_by_user: 7, triggered_by_driver: null } as never)
    await acknowledgeSosAlert(5n, 2n)
    expect(notif.notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'user', ownerId: 7n, type: 'sos_acknowledged', rideId: 9n }))
  })

  it('tells a driver who pressed SOS, not the rider', async () => {
    vi.mocked(repo.updateSosStatus).mockResolvedValue({ id: 5, ride_id: 9, triggered_by_user: null, triggered_by_driver: 42 } as never)
    await acknowledgeSosAlert(5n, 2n)
    expect(notif.notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'driver', ownerId: 42n }))
  })

  it('still acknowledges when the notice cannot be sent', async () => {
    vi.mocked(repo.updateSosStatus).mockResolvedValue({ id: 5, ride_id: 9, triggered_by_user: 7, triggered_by_driver: null } as never)
    notif.notifyOwner.mockRejectedValue(new Error('push down'))
    await expect(acknowledgeSosAlert(5n, 2n)).resolves.toMatchObject({ id: 5 })
  })

  it('sends no notice when the alert could not be acknowledged', async () => {
    vi.mocked(repo.updateSosStatus).mockResolvedValue(null as never)
    vi.mocked(repo.getSosStatus).mockResolvedValue('resolved')
    await expect(acknowledgeSosAlert(5n, 2n)).rejects.toMatchObject({ httpStatus: 409 })
    expect(notif.notifyOwner).not.toHaveBeenCalled()
  })

  it('setting on-call updates only the caller, audits it, and reports who is on call', async () => {
    vi.mocked(repo.getOnCallAdmins).mockResolvedValue([{ id: '2', email: 'me@x.com' }, { id: '3', email: 'o@x.com' }])
    const r = await setOnCall(2n, true, '1.1.1.1')
    expect(repo.setAdminOnCall).toHaveBeenCalledWith(2n, true)
    expect(audit.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'sos.on_call_start', adminId: 2n }))
    expect(r).toEqual({ admins: [{ id: '2', email: 'me@x.com' }, { id: '3', email: 'o@x.com' }], me: true })
  })
})
