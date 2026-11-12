import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ warn: vi.fn(), info: vi.fn() }) } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn() }))
vi.mock('@/modules/rides/rides.repository', () => ({ insertDispatchRound: vi.fn(), getDispatchDiag: vi.fn() }))

import * as repo from '@/modules/rides/rides.repository'
import { getConfigValue } from '@/lib/system-config'
import { recordRound, fastRoundsEnabled, decisionLogEnabled, type RoundRecord } from '@/jobs/processors/dispatch-metrics'

const rec = (over: Partial<RoundRecord> = {}): RoundRecord => ({
  rideId: 1n, round: 1, radiusM: 2500, widestRadiusM: 2500, fastStep: 0, categoryIds: [1n], found: 0, offered: 0,
  liveSkipped: 0, declinedSkipped: 0, otherSkipped: 0, outcome: 'empty', ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(repo.insertDispatchRound).mockResolvedValue(undefined)
  vi.mocked(repo.getDispatchDiag).mockResolvedValue({ online_in_radius: 3 })
})
afterEach(() => { vi.useRealTimers() })

describe('switches', () => {
  it('are on only for exactly "true" and off when the settings read fails', async () => {
    vi.mocked(getConfigValue).mockResolvedValueOnce('true').mockResolvedValueOnce('false')
    expect(await fastRoundsEnabled()).toBe(true)
    expect(await fastRoundsEnabled()).toBe(false)
    vi.mocked(getConfigValue).mockRejectedValueOnce(new Error('redis down'))
    expect(await decisionLogEnabled()).toBe(false)
  })
})

describe('recordRound', () => {
  it('writes the row, with the diag only when asked for', async () => {
    await recordRound(rec({ diagFor: { lat: 20, lng: 85 } }), true)
    expect(repo.getDispatchDiag).toHaveBeenCalledWith({ lat: 20, lng: 85, radiusMetres: 2500, categoryIds: [1n] })
    expect(repo.insertDispatchRound).toHaveBeenCalledWith(expect.objectContaining({ round: 1, categoryIds: [1], diag: { online_in_radius: 3 } }))
    vi.clearAllMocks()
    vi.mocked(repo.insertDispatchRound).mockResolvedValue(undefined)
    await recordRound(rec(), true)
    expect(repo.getDispatchDiag).not.toHaveBeenCalled()
    expect(repo.insertDispatchRound).toHaveBeenCalledWith(expect.objectContaining({ diag: null }))
  })

  it('does nothing when the log is off', async () => {
    await recordRound(rec(), false)
    expect(repo.insertDispatchRound).not.toHaveBeenCalled()
  })

  it('a failing diag still records the round, and a failing write never throws', async () => {
    vi.mocked(repo.getDispatchDiag).mockRejectedValue(new Error('slow'))
    await recordRound(rec({ diagFor: { lat: 1, lng: 1 } }), true)
    expect(repo.insertDispatchRound).toHaveBeenCalledWith(expect.objectContaining({ diag: null }))
    vi.mocked(repo.insertDispatchRound).mockRejectedValue(new Error('db down'))
    await expect(recordRound(rec(), true)).resolves.toBeUndefined()
  })

  it('a hung database delays the dispatch by at most the budget (1 s)', async () => {
    vi.useFakeTimers()
    vi.mocked(repo.insertDispatchRound).mockReturnValue(new Promise(() => {}))
    let done = false
    const p = recordRound(rec(), true).then(() => { done = true })
    await vi.advanceTimersByTimeAsync(900)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    await p
    expect(done).toBe(true)
  })
})
