import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('@/modules/rides/rides.repository')
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: {
    sendPickupUpdated: vi.fn(),
  },
}))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(),
}))

import * as repo from '@/modules/rides/rides.repository'
import { socketEvents } from '@/websocket/socket.server'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { updateRidePickup } from './rides.service'

const baseRide = {
  id: 5n,
  user_id: 3n,
  driver_id: null,
  status: 'requested',
  origin_lat: 20.29,
  origin_lng: 85.82,
}

describe('updateRidePickup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideCoreById).mockResolvedValue(baseRide as never)
  })

  it('rejects when the ride does not exist', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(null)
    await expect(updateRidePickup(3n, 5n, 20.291, 85.821, null))
      .rejects.toMatchObject({ httpStatus: 404 })
  })

  it('rejects when the caller does not own the ride', async () => {
    await expect(updateRidePickup(999n, 5n, 20.291, 85.821, null))
      .rejects.toMatchObject({ httpStatus: 403 })
  })

  it('rejects once the ride is past the editable stage', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue({ ...baseRide, status: 'in_progress' } as never)
    await expect(updateRidePickup(3n, 5n, 20.291, 85.821, null))
      .rejects.toMatchObject({ httpStatus: 409 })
  })

  it('rejects a point outside the allowed radius', async () => {
    // ~1.1km away — well outside PICKUP_EDIT_RADIUS_METRES (150m)
    await expect(updateRidePickup(3n, 5n, 20.30, 85.82, null))
      .rejects.toMatchObject({ httpStatus: 422 })
    expect(repo.updateRidePickup).not.toHaveBeenCalled()
  })

  it('rejects on a concurrent status change (repo returns null)', async () => {
    vi.mocked(repo.updateRidePickup).mockResolvedValue(null)
    await expect(updateRidePickup(3n, 5n, 20.2905, 85.8205, 'New spot'))
      .rejects.toMatchObject({ httpStatus: 409 })
  })

  it('updates the pickup and does not notify when no driver is assigned', async () => {
    vi.mocked(repo.updateRidePickup).mockResolvedValue({
      id: '5', driver_id: null, origin_lat: 20.2905, origin_lng: 85.8205, origin_address: 'New spot', status: 'requested',
    })

    const result = await updateRidePickup(3n, 5n, 20.2905, 85.8205, 'New spot')

    expect(result.origin_address).toBe('New spot')
    expect(notifyOwner).not.toHaveBeenCalled()
    expect(socketEvents.sendPickupUpdated).not.toHaveBeenCalled()
  })

  it('notifies the assigned driver over persisted-notification + socket when one exists', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue({ ...baseRide, driver_id: 9n } as never)
    vi.mocked(repo.updateRidePickup).mockResolvedValue({
      id: '5', driver_id: '9', origin_lat: 20.2905, origin_lng: 85.8205, origin_address: 'New spot', status: 'accepted',
    })

    await updateRidePickup(3n, 5n, 20.2905, 85.8205, 'New spot')

    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'driver', ownerId: 9n, rideId: 5n }))
    expect(socketEvents.sendPickupUpdated).toHaveBeenCalledWith('5', expect.objectContaining({ lat: 20.2905, lng: 85.8205 }))
  })
})
