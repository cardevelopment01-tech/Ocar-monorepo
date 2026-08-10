import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('@/modules/rides/rides.repository')
vi.mock('@/modules/payments/payments.service', () => ({ getMinWalletBalance: vi.fn().mockResolvedValue(500) }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: {
    sendRequestExpired: vi.fn(),
    sendRideRequest: vi.fn(),
    sendDriverAssigned: vi.fn(),
    sendRideStatusUpdate: vi.fn(),
  },
}))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(),
  notifyAllAdmins: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/jobs/queues', () => ({
  queues: {
    dispatch: {
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: vi.fn().mockResolvedValue(undefined),
    },
  },
  QUEUE_NAMES: { DISPATCH: 'dispatch' },
}))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn() } }))

import * as repo from '@/modules/rides/rides.repository'
import { queues } from '@/jobs/queues'
import { socketEvents } from '@/websocket/socket.server'
import { adminAssignDriver, forceAssignGraceCheck } from './rides.service'

const baseRide = {
  id: 5n, status: 'requested', origin_city_id: 1n, category_id: 2n,
  origin_lat: 20.29, origin_lng: 85.82, origin_address: 'A', destination_address: 'B',
  ride_type: 'one_way', is_return_cab: false, total_estimated: '400', driver_id: null,
}

const eligibleCandidate = {
  driver_id: '9', driver_name: 'D', driver_phone: '999', session_id: '10',
  category_id: '2', category_name: 'Sedan', is_online: true, category_ok: true,
  wallet_ok: true, distance_metres: 1000, eligible: true,
}

describe('adminAssignDriver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideById).mockResolvedValue(baseRide as never)
    vi.mocked(repo.getEligibleDriverCategoryIds).mockResolvedValue([2n])
    vi.mocked(repo.getAssignCandidates).mockResolvedValue([eligibleCandidate] as never)
    vi.mocked(repo.getCityBillingMode).mockResolvedValue('commission')
    vi.mocked(repo.cancelAllAssignments).mockResolvedValue([])
    vi.mocked(repo.createRideAssignment).mockResolvedValue(undefined as never)
    vi.mocked(repo.acceptAssignment).mockResolvedValue([])
    vi.mocked(repo.setForceAssignGraceJob).mockResolvedValue(undefined as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
    vi.mocked(repo.expireAssignment).mockResolvedValue(undefined as never)
  })

  it('rejects a ride that is not open for assignment', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({ ...baseRide, status: 'accepted' } as never)
    await expect(adminAssignDriver(5n, 9n, 'request', false, 1n)).rejects.toMatchObject({ httpStatus: 409 })
  })

  it('rejects an unknown driver', async () => {
    vi.mocked(repo.getAssignCandidates).mockResolvedValue([] as never)
    await expect(adminAssignDriver(5n, 9n, 'request', false, 1n)).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('rejects an offline driver even with overrideEligibility', async () => {
    vi.mocked(repo.getAssignCandidates).mockResolvedValue([{ ...eligibleCandidate, is_online: false, eligible: false }] as never)
    await expect(adminAssignDriver(5n, 9n, 'force', true, 1n)).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('rejects an ineligible-but-online driver without overrideEligibility', async () => {
    vi.mocked(repo.getAssignCandidates).mockResolvedValue([{ ...eligibleCandidate, category_ok: false, eligible: false }] as never)
    await expect(adminAssignDriver(5n, 9n, 'request', false, 1n)).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('force mode calls acceptAssignment and schedules a grace-period job', async () => {
    const result = await adminAssignDriver(5n, 9n, 'force', false, 1n)
    expect(result).toEqual({ success: true, mode: 'force' })
    expect(repo.acceptAssignment).toHaveBeenCalledWith(5n, 9n, 'commission')
    expect(repo.setForceAssignGraceJob).toHaveBeenCalledWith(5n, 'job-1')
  })

  it('force mode surfaces a 409 when the ride was accepted by someone else first', async () => {
    vi.mocked(repo.acceptAssignment).mockResolvedValue(false)
    await expect(adminAssignDriver(5n, 9n, 'force', false, 1n)).rejects.toMatchObject({ httpStatus: 409 })
  })

  it('request mode creates an assignment without calling acceptAssignment', async () => {
    const result = await adminAssignDriver(5n, 9n, 'request', false, 1n)
    expect(result).toEqual({ success: true, mode: 'request' })
    expect(repo.createRideAssignment).toHaveBeenCalled()
    expect(repo.acceptAssignment).not.toHaveBeenCalled()
  })

  it('flips a scheduled ride to requested before assigning', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({ ...baseRide, status: 'scheduled' } as never)
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValue({ ...baseRide, status: 'requested' } as never)
    await adminAssignDriver(5n, 9n, 'request', false, 1n)
    expect(repo.updateRideStatusCAS).toHaveBeenCalledWith(5n, 'scheduled', 'requested')
  })

  it('request mode schedules the fallback broadcast with a ride-scoped jobId', async () => {
    await adminAssignDriver(5n, 9n, 'request', false, 1n)
    expect(queues.dispatch.getJob).toHaveBeenCalledWith('manual-assign-fallback-5')
    expect(queues.dispatch.add).toHaveBeenCalledWith(
      'broadcast_ride',
      expect.objectContaining({ rideId: '5' }),
      expect.objectContaining({ jobId: 'manual-assign-fallback-5' })
    )
  })

  it('request mode removes a stale fallback job before scheduling a new one', async () => {
    const removeMock = vi.fn().mockResolvedValue(undefined)
    vi.mocked(queues.dispatch.getJob).mockResolvedValueOnce({ remove: removeMock } as never)
    await adminAssignDriver(5n, 9n, 'request', false, 1n)
    expect(removeMock).toHaveBeenCalled()
  })

  it('request mode expires the manual offer before scheduling the fallback broadcast', async () => {
    await adminAssignDriver(5n, 9n, 'request', false, 1n)
    expect(repo.expireAssignment).toHaveBeenCalledWith(5n, 9n)
  })

  it('logs only one status-history row for the CAS transition when the ride starts scheduled', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({ ...baseRide, status: 'scheduled' } as never)
    vi.mocked(repo.updateRideStatusCAS).mockResolvedValue({ ...baseRide, status: 'requested' } as never)
    await adminAssignDriver(5n, 9n, 'request', false, 1n)
    expect(repo.logStatusHistory).toHaveBeenCalledTimes(1)
    expect(repo.logStatusHistory).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: 'scheduled', toStatus: 'requested', note: 'Opened for manual assignment' })
    )
  })

  it('logs the "manually offered" note when the ride was already requested on entry', async () => {
    await adminAssignDriver(5n, 9n, 'request', false, 1n)
    expect(repo.logStatusHistory).toHaveBeenCalledTimes(1)
    expect(repo.logStatusHistory).toHaveBeenCalledWith(
      expect.objectContaining({ note: 'Manually offered to driver 9, awaiting response' })
    )
  })
})

describe('forceAssignGraceCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.hasRideGpsActivity).mockResolvedValue(false)
    // driver_id mocked as a string here (not bigint) to match real pg runtime behavior —
    // pg returns bigint/int8 columns as strings (no setTypeParser override for OID 20).
    vi.mocked(repo.getRideById).mockResolvedValue({ ...baseRide, status: 'accepted', driver_id: '9' } as never)
    vi.mocked(repo.revertForceAssign).mockResolvedValue(true)
    vi.mocked(repo.clearForceAssignGraceJob).mockResolvedValue(undefined as never)
    vi.mocked(repo.logStatusHistory).mockResolvedValue(undefined as never)
  })

  it('clears the grace job and does not revert when GPS activity exists', async () => {
    vi.mocked(repo.hasRideGpsActivity).mockResolvedValue(true)
    await forceAssignGraceCheck(5n, 9n)
    expect(repo.clearForceAssignGraceJob).toHaveBeenCalledWith(5n)
    expect(repo.revertForceAssign).not.toHaveBeenCalled()
  })

  it('reverts the ride when there is no GPS activity', async () => {
    await forceAssignGraceCheck(5n, 9n)
    expect(repo.revertForceAssign).toHaveBeenCalledWith(5n, 9n)
    expect(socketEvents.sendRideStatusUpdate).toHaveBeenCalledWith('5', { status: 'requested', reason: 'force_assign_reverted' })
  })

  it('does nothing when the ride already moved past accepted', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({ ...baseRide, status: 'driver_arrived', driver_id: '9' } as never)
    await forceAssignGraceCheck(5n, 9n)
    expect(repo.revertForceAssign).not.toHaveBeenCalled()
  })
})
