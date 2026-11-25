import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/notifications/notifications.service', () => ({ notifyOwner: vi.fn() }))
vi.mock('@/db/redis', () => ({ client: { set: vi.fn(), del: vi.fn() } }))
vi.mock('@/observability/metrics', () => ({ driverIdlePausedTotal: { inc: vi.fn() } }))

import { notifyOwner } from '@/modules/notifications/notifications.service'
import { client as redis } from '@/db/redis'
import { driverIdlePausedTotal } from '@/observability/metrics'
import { onIdleDriverPaused } from '@/modules/rides/idle-paused'

describe('onIdleDriverPaused', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(redis.set).mockResolvedValue('OK' as never)
    vi.mocked(redis.del).mockResolvedValue(1 as never)
    vi.mocked(notifyOwner).mockResolvedValue(undefined)
  })

  it('counts the pause by cause and nudges the driver the first time', async () => {
    await onIdleDriverPaused('615', '900', 'silent')
    expect(driverIdlePausedTotal.inc).toHaveBeenCalledWith({ cause: 'silent' })
    expect(redis.set).toHaveBeenCalledWith('driver:idle-nudge:900', '1', 'EX', 1800, 'NX')
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({ ownerType: 'driver', ownerId: 615n, type: 'idle_paused' }))
  })

  it('does not nudge again inside the window, but still counts the pause', async () => {
    vi.mocked(redis.set).mockResolvedValue(null as never)
    await onIdleDriverPaused('615', '900', 'stale_position')
    expect(driverIdlePausedTotal.inc).toHaveBeenCalledWith({ cause: 'stale_position' })
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('never throws: Redis or the push failing only skips the nudge', async () => {
    vi.mocked(redis.set).mockRejectedValue(new Error('redis down'))
    await expect(onIdleDriverPaused('615', '900', 'silent')).resolves.toBeUndefined()
    vi.mocked(redis.set).mockResolvedValue('OK' as never)
    vi.mocked(notifyOwner).mockRejectedValue(new Error('push down'))
    await expect(onIdleDriverPaused('615', '900', 'silent')).resolves.toBeUndefined()
  })

  it('does not nudge a driver who is being ended in the same sweep, but still counts the pause', async () => {
    await onIdleDriverPaused('615', '900', 'silent', { nudge: false })
    expect(driverIdlePausedTotal.inc).toHaveBeenCalledWith({ cause: 'silent' })
    expect(redis.set).not.toHaveBeenCalled()
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('releases the window when the push fails, so the next sweep can try again', async () => {
    vi.mocked(notifyOwner).mockRejectedValue(new Error('push down'))
    await onIdleDriverPaused('615', '900', 'silent')
    expect(redis.del).toHaveBeenCalledWith('driver:idle-nudge:900')
  })
})
