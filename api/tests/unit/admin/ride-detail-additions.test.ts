import { describe, it, expect, vi, beforeEach } from 'vitest'

const repo = vi.hoisted(() => ({
  getAdminRideById: vi.fn(), getRideOffers: vi.fn(), getRideStatusHistory: vi.fn(), getRideLinkedSafety: vi.fn(),
  getRideOtpSummary: vi.fn(), getRideLastPosition: vi.fn(), listRideAdminNotes: vi.fn(), addRideAdminNote: vi.fn(), getRideTimes: vi.fn(),
}))
vi.mock('@/modules/admin/admin.repository', () => repo)
vi.mock('@/modules/rides/rides.repository', () => ({ getRideStops: vi.fn(async () => []) }))
vi.mock('@/modules/ride-chat/ride-chat.repository', () => ({ listMessages: vi.fn(async () => []) }))
vi.mock('@/modules/rides/rides.service', () => ({ forceResolveRide: vi.fn(), getRideAssignCandidates: vi.fn(), adminAssignDriver: vi.fn(), goOffline: vi.fn() }))

import { getAdminRideById, addRideAdminNote } from '@/modules/admin/admin.service'

const T = new Date('2026-11-20T10:00:00Z')
const base = { id: '9', status: 'in_progress', driver_id: '4', requested_at: T, accepted_at: T, started_at: T, scheduled_for: null }

beforeEach(() => {
  vi.clearAllMocks()
  repo.getAdminRideById.mockResolvedValue(base)
  repo.getRideOffers.mockResolvedValue([]); repo.getRideStatusHistory.mockResolvedValue([]); repo.getRideLinkedSafety.mockResolvedValue({ disputes: [], sos_alerts: [], ratings: [] })
  repo.getRideOtpSummary.mockResolvedValue({ trip_start: { verified_at: T, failed_attempts: 2 }, trip_end: { verified_at: null, failed_attempts: 0 } })
  repo.getRideLastPosition.mockResolvedValue({ lat: 20.3, lng: 85.8, recorded_at: 'x' })
  repo.listRideAdminNotes.mockResolvedValue([{ id: '1', note: 'called rider' }])
})

describe('ride detail additions', () => {
  it('carries the OTP summary, last position and notes', async () => {
    const r = await getAdminRideById(9n) as Record<string, any>
    expect(r.otp.trip_start.failed_attempts).toBe(2)
    expect(r.last_position.lat).toBe(20.3)
    expect(r.notes).toHaveLength(1)
  })

  it('skips the GPS lookup before a driver is on the ride', async () => {
    repo.getAdminRideById.mockResolvedValue({ ...base, driver_id: null })
    const r = await getAdminRideById(9n) as Record<string, any>
    expect(repo.getRideLastPosition).not.toHaveBeenCalled()
    expect(r.last_position).toBeNull()
  })

  it('still returns the ride when an enrichment query fails', async () => {
    repo.getRideOtpSummary.mockRejectedValue(new Error('x')); repo.getRideLastPosition.mockRejectedValue(new Error('x')); repo.listRideAdminNotes.mockRejectedValue(new Error('x'))
    const r = await getAdminRideById(9n) as Record<string, any>
    expect(r.otp).toBeNull(); expect(r.last_position).toBeNull(); expect(r.notes).toEqual([])
  })
})

describe('addRideAdminNote', () => {
  it('trims and stores', async () => {
    repo.getRideTimes.mockResolvedValue({}); repo.addRideAdminNote.mockResolvedValue({ id: '2' })
    await addRideAdminNote(9n, 3n, '  rider called, driver on way  ')
    expect(repo.addRideAdminNote).toHaveBeenCalledWith(9n, 3n, 'rider called, driver on way')
  })
  it.each(['', '   ', 'x'.repeat(2001)])('refuses a bad note (%#)', async n => {
    await expect(addRideAdminNote(9n, 3n, n)).rejects.toMatchObject({ httpStatus: 400 })
  })
  it('404s on a missing ride', async () => {
    repo.getRideTimes.mockResolvedValue(undefined)
    await expect(addRideAdminNote(9n, 3n, 'hi')).rejects.toMatchObject({ httpStatus: 404 })
  })
})
