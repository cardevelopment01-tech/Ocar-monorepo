import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({ findSilentOnTripDrivers: vi.fn() }))
vi.mock('@/modules/notifications/notifications.service', () => ({ notifyAllAdmins: vi.fn(), notifyOwner: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn() } }))

import * as repo from '@/modules/rides/rides.repository'
import { notifyAllAdmins, notifyOwner } from '@/modules/notifications/notifications.service'
import { client as redis } from '@/db/redis'
import { alertSilentDrivers, SILENT_ALERT_SECONDS } from '@/modules/rides/silent-drivers'

const row = { ride_id: '1212', driver_id: '615', driver_name: 'Tapas Ray', silent_seconds: 4 * 60, last_fix_epoch: 1_000 }

describe('alertSilentDrivers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.findSilentOnTripDrivers).mockResolvedValue([row])
    vi.mocked(redis.set).mockResolvedValue('OK' as never)
    vi.mocked(notifyAllAdmins).mockResolvedValue(undefined)
    vi.mocked(notifyOwner).mockResolvedValue(undefined)
  })

  it('asks for drivers silent for 3 minutes', async () => {
    await alertSilentDrivers()
    expect(repo.findSilentOnTripDrivers).toHaveBeenCalledWith(SILENT_ALERT_SECONDS)
    expect(SILENT_ALERT_SECONDS).toBe(180)
  })

  it('pages every admin and nudges the driver the first time', async () => {
    await alertSilentDrivers()
    expect(notifyAllAdmins).toHaveBeenCalledWith(expect.objectContaining({ type: 'driver_gps_silent', rideId: 1212n }))
    expect(vi.mocked(notifyAllAdmins).mock.calls[0]![0].body).toContain('Tapas Ray')
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'driver', ownerId: 615n, type: 'location_paused' }))
  })

  it('keys the alert on the ride and its last fix, so a recovered-then-silent-again driver is a new episode', async () => {
    await alertSilentDrivers()
    vi.mocked(repo.findSilentOnTripDrivers).mockResolvedValue([{ ...row, last_fix_epoch: 2_000 }])
    await alertSilentDrivers()
    const keys = vi.mocked(redis.set).mock.calls.map(c => c[0])
    expect(keys).toEqual(['ride:gps-silent:1212:1000', 'ride:gps-silent:1212:2000'])
    expect(vi.mocked(redis.set).mock.calls[0]![4]).toBe('NX')
  })

  it('does nothing again while the same silence is already alerted', async () => {
    vi.mocked(redis.set).mockResolvedValue(null as never)
    await alertSilentDrivers()
    expect(notifyAllAdmins).not.toHaveBeenCalled()
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('still pages admins when the driver nudge fails, and keeps going to the next driver', async () => {
    vi.mocked(repo.findSilentOnTripDrivers).mockResolvedValue([row, { ...row, ride_id: '9', driver_id: '7' }])
    vi.mocked(notifyOwner).mockRejectedValueOnce(new Error('push down'))
    await alertSilentDrivers()
    expect(notifyAllAdmins).toHaveBeenCalledTimes(2)
  })

  it('one failing ride does not stop the rest', async () => {
    vi.mocked(repo.findSilentOnTripDrivers).mockResolvedValue([row, { ...row, ride_id: '9', driver_id: '7' }])
    vi.mocked(notifyAllAdmins).mockRejectedValueOnce(new Error('db down'))
    await alertSilentDrivers()
    expect(notifyAllAdmins).toHaveBeenCalledTimes(2)
  })
})
