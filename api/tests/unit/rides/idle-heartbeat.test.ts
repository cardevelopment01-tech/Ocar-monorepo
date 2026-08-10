import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  getActiveSession:       vi.fn(),
  setDriverAvailability:  vi.fn(),
}))

import * as repo from '@/modules/rides/rides.repository'
import { pauseAvailability, resumeAvailability } from '@/modules/rides/rides.service'

const DRIVER_ID = BigInt(42)

describe('pauseAvailability / resumeAvailability', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pauses an idle online driver', async () => {
    vi.mocked(repo.getActiveSession).mockResolvedValue({ id: 1, status: 'online' } as never)
    await pauseAvailability(DRIVER_ID)
    expect(repo.setDriverAvailability).toHaveBeenCalledWith(DRIVER_ID, false)
  })

  it('resumes an idle online driver', async () => {
    vi.mocked(repo.getActiveSession).mockResolvedValue({ id: 1, status: 'online' } as never)
    await resumeAvailability(DRIVER_ID)
    expect(repo.setDriverAvailability).toHaveBeenCalledWith(DRIVER_ID, true)
  })

  it('no-ops a driver mid-trip — resume must never override the accept-ride unavailability flip', async () => {
    vi.mocked(repo.getActiveSession).mockResolvedValue({ id: 1, status: 'on_trip' } as never)
    await resumeAvailability(DRIVER_ID)
    expect(repo.setDriverAvailability).not.toHaveBeenCalled()
  })

  it('no-ops a driver with no session at all', async () => {
    vi.mocked(repo.getActiveSession).mockResolvedValue(null)
    await pauseAvailability(DRIVER_ID)
    expect(repo.setDriverAvailability).not.toHaveBeenCalled()
  })
})
