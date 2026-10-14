import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/auth/auth.repository', () => ({
  findRefreshToken: vi.fn(),
  revokeRefreshTokenFamily: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/jwt', () => ({ hashRefreshToken: vi.fn(() => 'hash') }))
vi.mock('@/modules/rides/rides.repository', () => ({ getActiveSession: vi.fn() }))
vi.mock('@/modules/rides/rides.service', () => ({ goOffline: vi.fn().mockResolvedValue(undefined) }))

import * as repo from '@/modules/auth/auth.repository'
import * as ridesRepo from '@/modules/rides/rides.repository'
import { goOffline } from '@/modules/rides/rides.service'
import { logout } from '@/modules/auth/auth.service'

const token = (over: object) => ({ principal_role: 'driver', principal_id: '7', used_at: null, revoked_at: null, ...over }) as never

describe('logout and the driver\'s online session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ridesRepo.getActiveSession).mockResolvedValue({ id: 1n, status: 'online' } as never)
  })

  it('takes an online driver offline when the live token signs out', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue(token({}))
    await logout('raw')
    expect(repo.revokeRefreshTokenFamily).toHaveBeenCalled()
    expect(goOffline).toHaveBeenCalledWith(7n, 'logout')
  })

  it('leaves the session alone when the token was already revoked (an old phone after a newer login)', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue(token({ revoked_at: new Date() }))
    await logout('raw')
    expect(goOffline).not.toHaveBeenCalled()
  })

  it('leaves the session alone when the token was already rotated (a stale or replayed token)', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue(token({ used_at: new Date() }))
    await logout('raw')
    expect(goOffline).not.toHaveBeenCalled()
  })

  it('does not touch a session that is on a trip, and never fails the logout', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue(token({}))
    vi.mocked(ridesRepo.getActiveSession).mockResolvedValue({ id: 1n, status: 'on_trip' } as never)
    await logout('raw')
    expect(goOffline).not.toHaveBeenCalled()
    vi.mocked(ridesRepo.getActiveSession).mockRejectedValue(new Error('db down'))
    await expect(logout('raw')).resolves.toBeUndefined()
  })

  it('does nothing for a rider token', async () => {
    vi.mocked(repo.findRefreshToken).mockResolvedValue(token({ principal_role: 'user' }))
    await logout('raw')
    expect(goOffline).not.toHaveBeenCalled()
  })
})
