import { describe, it, expect, vi, beforeEach } from 'vitest'

const repo = vi.hoisted(() => ({ getRideTimes: vi.fn(), getRideTrail: vi.fn() }))
vi.mock('@/modules/admin/admin.repository', () => repo)
vi.mock('@/modules/rides/rides.service', () => ({ forceResolveRide: vi.fn(), getRideAssignCandidates: vi.fn(), adminAssignDriver: vi.fn(), goOffline: vi.fn() }))

import { getAdminRideTrail } from '@/modules/admin/admin.service'
import { forceResolveAdminRide as forceResolveController } from '@/modules/admin/admin.controller'

beforeEach(() => vi.clearAllMocks())

describe('getAdminRideTrail', () => {
  it('returns no points (and runs no GPS query) before a driver has accepted', async () => {
    repo.getRideTimes.mockResolvedValue({ requested_at: new Date(), accepted_at: null, started_at: null, completed_at: null, cancelled_at: null })
    expect(await getAdminRideTrail(1n)).toEqual({ points: [] })
    expect(repo.getRideTrail).not.toHaveBeenCalled()
  })

  it('queries from accept/start to end with 15 minutes of slack either side', async () => {
    const accepted = new Date('2026-11-20T10:00:00Z'); const completed = new Date('2026-11-20T11:00:00Z')
    repo.getRideTimes.mockResolvedValue({ requested_at: accepted, accepted_at: accepted, started_at: null, completed_at: completed, cancelled_at: null })
    repo.getRideTrail.mockResolvedValue([{ lat: 20, lng: 85, recorded_at: 'x' }])
    const r = await getAdminRideTrail(1n)
    expect(r.points).toHaveLength(1)
    const [, from, to, max] = repo.getRideTrail.mock.calls[0]!
    expect((from as Date).toISOString()).toBe('2026-11-20T09:45:00.000Z')
    expect((to as Date).toISOString()).toBe('2026-11-20T11:15:00.000Z')
    expect(max).toBe(300)
  })

  it('404s for a ride that does not exist', async () => {
    repo.getRideTimes.mockResolvedValue(undefined)
    await expect(getAdminRideTrail(1n)).rejects.toMatchObject({ httpStatus: 404 })
  })
})

describe('force-resolve controller', () => {
  const run = async (body: unknown) => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
    const next = vi.fn()
    await forceResolveController({ body, params: { id: '5' }, admin: { id: 1n } } as never, res as never, next)
    return { res, next }
  }

  it.each([
    ['no note', { action: 'cancel' }],
    ['a note that is too short', { action: 'cancel', note: 'stuck' }],
    ['a blank note', { action: 'complete', note: '          ' }],
    ['a note over 500 characters', { action: 'cancel', note: 'x'.repeat(501) }],
  ])('refuses %s', async (_l, body) => {
    const { res } = await run(body)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})
