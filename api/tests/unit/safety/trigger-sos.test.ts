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

  it.each(['requested', 'accepted', 'completed', 'cancelled', 'no_drivers', 'scheduled'])(
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

  it('accepts a driver-triggered SOS: looks up the ride\'s own rider phone and tags triggeredBy as driver', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 7n, driver_id: 42n } as never)
    let emitted: unknown
    vi.mocked(getIO).mockReturnValue({ to: () => ({ emit: (_event: string, payload: unknown) => { emitted = payload } }) } as never)

    const alert = await triggerSos({ rideId: 5n, triggeredByDriverId: 42n })

    expect(alert.id).toBe(1n)
    expect(repo.insertSosAlert).toHaveBeenCalledWith(
      expect.objectContaining({ triggered_by_driver: 42n, triggered_by_user: null })
    )
    // triggeredUserId falls back to the ride's own user_id even for a driver-triggered SOS,
    // so the phone lookup still runs against that rider.
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [7n])
    expect(emitted).toMatchObject({ triggeredBy: { role: 'driver', id: '42' } })
  })

  it('skips the phone lookup for a driver-triggered SOS when the ride has no user_id', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: null, driver_id: 42n } as never)
    vi.mocked(getIO).mockReturnValue({ to: () => ({ emit: vi.fn() }) } as never)

    const alert = await triggerSos({ rideId: 5n, triggeredByDriverId: 42n })

    expect(alert.id).toBe(1n)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('defaults severity to "medium" when not provided', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 1n } as never)
    vi.mocked(getIO).mockReturnValue({ to: () => ({ emit: vi.fn() }) } as never)

    await triggerSos({ rideId: 5n, triggeredByUserId: 1n })

    expect(repo.insertSosAlert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'medium' }))
  })

  it('throws 403 NOT_RIDE_PARTICIPANT when the caller is not on the ride', async () => {
    vi.mocked(repo.getRideBasic).mockResolvedValue({ id: 5n, status: 'in_progress', user_id: 7n, driver_id: 42n } as never)
    vi.mocked(getIO).mockReturnValue({ to: () => ({ emit: vi.fn() }) } as never)

    await expect(triggerSos({ rideId: 5n, triggeredByUserId: 999n })).rejects.toMatchObject({
      httpStatus: 403, code: 'NOT_RIDE_PARTICIPANT',
    })
    expect(repo.insertSosAlert).not.toHaveBeenCalled()
  })
})
