import { describe, it, expect, vi, beforeEach } from 'vitest'

const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => log } }))
vi.mock('@/modules/safety/safety.repository', () => ({ updateSosStatus: vi.fn() }))
vi.mock('@/websocket/socket.server', () => ({ getIO: vi.fn() }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: {} }))

import * as repo from '@/modules/safety/safety.repository'
import { acknowledgeSosAlert, resolveSosAlert } from '@/modules/safety/sos.service'

describe('SOS lifecycle events', () => {
  beforeEach(() => vi.clearAllMocks())

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
    await expect(acknowledgeSosAlert(99n, 2n)).rejects.toMatchObject({ appCode: 'SOS_ALERT_NOT_FOUND' })
    expect(log.info).not.toHaveBeenCalled()
  })
})
