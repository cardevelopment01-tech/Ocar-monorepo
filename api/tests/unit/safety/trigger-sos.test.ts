import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/safety/safety.repository', () => ({
  getRideBasic: vi.fn(),
  insertSosAlert: vi.fn(),
  markRideSosTriggered: vi.fn(),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/jobs/queues', () => ({ notificationsQueue: { add: vi.fn(() => Promise.resolve()) } }))
vi.mock('@/websocket/socket.server', () => ({ getIO: vi.fn() }))

import * as repo from '@/modules/safety/safety.repository'
import { pool } from '@/db/client'
import { getIO } from '@/websocket/socket.server'
import { triggerSos } from '@/modules/safety/sos.service'

describe('triggerSos', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ phone: '9876543210' }] } as never)
    vi.mocked(repo.insertSosAlert).mockResolvedValue({
      id: 1n, severity: 'medium', created_at: new Date('2026-01-01'),
    } as never)
  })

  it('throws 404 when the ride does not exist', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue(null)

    await expect(triggerSos({ rideId: 999n, triggeredByUserId: 1n })).rejects.toMatchObject({
      httpStatus: 404,
    })
    expect(repo.insertSosAlert).not.toHaveBeenCalled()
  })

  it.each(['requested', 'accepted', 'completed', 'cancelled', 'no_drivers'])(
    'throws 400 RIDE_NOT_ACTIVE for ride status "%s" and inserts no alert',
    async (status) => {
      vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status, user_id: 1n } as never)

      await expect(triggerSos({ rideId: 5n, triggeredByUserId: 1n })).rejects.toMatchObject({
        httpStatus: 400, code: 'RIDE_NOT_ACTIVE',
      })
      expect(repo.insertSosAlert).not.toHaveBeenCalled()
    }
  )

  it.each(['in_progress', 'driver_arrived', 'returning'])(
    'accepts SOS for ride status "%s": inserts the alert and marks the ride sos-triggered',
    async (status) => {
      vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status, user_id: 1n } as never)
      vi.mocked(getIO).mockReturnValue({ to: () => ({ emit: vi.fn() }) } as never)

      const alert = await triggerSos({ rideId: 5n, triggeredByUserId: 1n, severity: 'high' })

      expect(alert.id).toBe(1n)
      expect(repo.insertSosAlert).toHaveBeenCalledWith(expect.objectContaining({ ride_id: 5n, severity: 'high' }))
      expect(repo.markRideSosTriggered).toHaveBeenCalledWith(5n)
    }
  )

  it('still returns the alert successfully even if the admin:ops socket emit throws', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 1n } as never)
    vi.mocked(getIO).mockImplementation(() => { throw new Error('socket server not initialized') })

    const alert = await triggerSos({ rideId: 5n, triggeredByUserId: 1n })

    expect(alert.id).toBe(1n)
    expect(repo.markRideSosTriggered).toHaveBeenCalledWith(5n)
  })

  it('defaults severity to "medium" when not provided', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 1n } as never)
    vi.mocked(getIO).mockReturnValue({ to: () => ({ emit: vi.fn() }) } as never)

    await triggerSos({ rideId: 5n, triggeredByUserId: 1n })

    expect(repo.insertSosAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'medium' }))
  })
})
