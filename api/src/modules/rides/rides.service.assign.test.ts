import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('@/modules/rides/rides.repository')
vi.mock('@/modules/payments/payments.service', () => ({ getMinWalletBalance: vi.fn().mockResolvedValue(500) }))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: {
    sendRequestExpired: vi.fn(),
    sendRideRequest: vi.fn(),
    sendDriverAssigned: vi.fn(),
  },
}))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(),
  notifyAllAdmins: vi.fn(),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { dispatch: { add: vi.fn().mockResolvedValue({ id: 'job-1' }) } },
  QUEUE_NAMES: { DISPATCH: 'dispatch' },
}))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn() } }))

import * as repo from '@/modules/rides/rides.repository'
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
})

describe('forceAssignGraceCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.hasRideGpsActivity).mockResolvedValue(false)
    vi.mocked(repo.getRideById).mockResolvedValue({ ...baseRide, status: 'accepted', driver_id: 9n } as never)
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
  })

  it('does nothing when the ride already moved past accepted', async () => {
    vi.mocked(repo.getRideById).mockResolvedValue({ ...baseRide, status: 'driver_arrived', driver_id: 9n } as never)
    await forceAssignGraceCheck(5n, 9n)
    expect(repo.revertForceAssign).not.toHaveBeenCalled()
  })
})
