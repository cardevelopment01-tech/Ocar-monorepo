import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/safety/safety.repository', () => ({
  getStaleSosAlerts: vi.fn(),
  markSosEscalated: vi.fn(),
  getBreachedDisputes: vi.fn(),
  markDisputeSlaEscalated: vi.fn(),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyAllAdmins: vi.fn() }))

import * as repo from '@/modules/safety/safety.repository'
import { notifyAllAdmins } from '@/modules/notifications/notifications.service'
import { sweepStaleSosAlerts, sweepBreachedDisputeSlas } from '@/modules/safety/safety.sweeps'

describe('sweepStaleSosAlerts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('notifies admins once per stale alert and marks each escalated', async () => {
    vi.mocked(repo.getStaleSosAlerts).mockResolvedValue([
      { id: '10', ride_id: '5', created_at: new Date('2026-08-24T10:00:00Z') },
      { id: '11', ride_id: '6', created_at: new Date('2026-08-24T10:01:00Z') },
    ] as never)

    await sweepStaleSosAlerts()

    expect(repo.getStaleSosAlerts).toHaveBeenCalledWith(5)
    expect(notifyAllAdmins).toHaveBeenCalledTimes(2)
    expect(notifyAllAdmins).toHaveBeenCalledWith(expect.objectContaining({ type: 'sos_unacknowledged', rideId: 5n }))
    expect(repo.markSosEscalated).toHaveBeenCalledWith(10n)
    expect(repo.markSosEscalated).toHaveBeenCalledWith(11n)
  })

  it('does nothing when there are no stale alerts', async () => {
    vi.mocked(repo.getStaleSosAlerts).mockResolvedValue([] as never)
    await sweepStaleSosAlerts()
    expect(notifyAllAdmins).not.toHaveBeenCalled()
    expect(repo.markSosEscalated).not.toHaveBeenCalled()
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
})
