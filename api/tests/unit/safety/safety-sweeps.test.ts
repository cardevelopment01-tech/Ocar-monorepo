import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/safety/safety.repository', () => ({
  getUnackedSosAlerts: vi.fn(),
  markSosEscalated: vi.fn(),
  getOnCallAdmins: vi.fn(),
  getBreachedDisputes: vi.fn(),
  markDisputeSlaEscalated: vi.fn(),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyAllAdmins: vi.fn() }))

import * as repo from '@/modules/safety/safety.repository'
import { notifyAllAdmins } from '@/modules/notifications/notifications.service'
import { sweepStaleSosAlerts, sweepBreachedDisputeSlas } from '@/modules/safety/safety.sweeps'

const alertRow = (id: string, rideId: string) => ({ id, ride_id: rideId, created_at: new Date(Date.now() - 4 * 60_000) })

describe('sweepStaleSosAlerts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getUnackedSosAlerts).mockResolvedValue([] as never)
    vi.mocked(repo.getOnCallAdmins).mockResolvedValue([])
  })

  it('asks for the 3 min step first and the 1 min step second', async () => {
    await sweepStaleSosAlerts()
    expect(vi.mocked(repo.getUnackedSosAlerts).mock.calls).toEqual([[2, 180], [1, 60]])
  })

  it('pages everyone at the 3 min step and records level 2', async () => {
    vi.mocked(repo.getUnackedSosAlerts).mockImplementation(async (level: number) => (level === 2 ? [alertRow('10', '5')] : []) as never)
    await sweepStaleSosAlerts()
    expect(notifyAllAdmins).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(notifyAllAdmins).mock.calls[0]![0]
    expect(arg).toMatchObject({ type: 'sos_unacknowledged', rideId: 5n })
    expect(arg).not.toHaveProperty('adminIds')
    expect(repo.markSosEscalated).toHaveBeenCalledWith(10n, 2)
  })

  it('at the 1 min step reminds only the admins on call', async () => {
    vi.mocked(repo.getUnackedSosAlerts).mockImplementation(async (level: number) => (level === 1 ? [alertRow('11', '6')] : []) as never)
    vi.mocked(repo.getOnCallAdmins).mockResolvedValue([{ id: '3', email: 'a@x.com' }, { id: '4', email: 'b@x.com' }])
    await sweepStaleSosAlerts()
    expect(notifyAllAdmins).toHaveBeenCalledWith(expect.objectContaining({ adminIds: [3n, 4n], rideId: 6n }))
    expect(repo.markSosEscalated).toHaveBeenCalledWith(11n, 1)
  })

  it('at the 1 min step pages everyone when nobody is on call', async () => {
    vi.mocked(repo.getUnackedSosAlerts).mockImplementation(async (level: number) => (level === 1 ? [alertRow('11', '6')] : []) as never)
    await sweepStaleSosAlerts()
    expect(vi.mocked(notifyAllAdmins).mock.calls[0]![0]).not.toHaveProperty('adminIds')
  })

  it('does nothing when there is nothing waiting', async () => {
    await sweepStaleSosAlerts()
    expect(notifyAllAdmins).not.toHaveBeenCalled()
    expect(repo.markSosEscalated).not.toHaveBeenCalled()
  })

  it('does not record a step whose page failed, so the next tick retries it, and carries on with the rest', async () => {
    vi.mocked(repo.getUnackedSosAlerts).mockImplementation(async (level: number) => (level === 2 ? [alertRow('10', '5'), alertRow('12', '7')] : []) as never)
    vi.mocked(notifyAllAdmins).mockRejectedValueOnce(new Error('push down'))
    await sweepStaleSosAlerts()
    expect(repo.markSosEscalated).toHaveBeenCalledTimes(1)
    expect(repo.markSosEscalated).toHaveBeenCalledWith(12n, 2)
  })
})

describe('sweepBreachedDisputeSlas', () => {
  beforeEach(() => vi.clearAllMocks())

  it('notifies admins once per breached dispute and marks each escalated', async () => {
    vi.mocked(repo.getBreachedDisputes).mockResolvedValue([{ id: '3' }, { id: '4' }] as never)

    await sweepBreachedDisputeSlas()

    expect(notifyAllAdmins).toHaveBeenCalledTimes(2)
    expect(notifyAllAdmins).toHaveBeenCalledWith(expect.objectContaining({ type: 'dispute_sla_breached' }))
    expect(repo.markDisputeSlaEscalated).toHaveBeenCalledWith(3n)
    expect(repo.markDisputeSlaEscalated).toHaveBeenCalledWith(4n)
  })

  it('does nothing when there are no breached disputes', async () => {
    vi.mocked(repo.getBreachedDisputes).mockResolvedValue([] as never)
    await sweepBreachedDisputeSlas()
    expect(notifyAllAdmins).not.toHaveBeenCalled()
    expect(repo.markDisputeSlaEscalated).not.toHaveBeenCalled()
  })
})
