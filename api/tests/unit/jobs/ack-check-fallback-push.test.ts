import { describe, it, expect, vi, beforeEach } from 'vitest'

const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, string>()
  const redisMock = {
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    del: vi.fn(async (key: string) => { store.delete(key); return 1 }),
    set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null
      store.set(key, value)
      return 'OK'
    }),
  }
  return { store, redisMock }
})
vi.mock('@/db/redis', () => ({ client: redisMock }))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendRideRequest: vi.fn() } }))
vi.mock('@/modules/rides/rides.repository', () => ({ getRideById: vi.fn() }))
vi.mock('@/jobs/queues', () => ({
  queues: { dispatch: { add: vi.fn() } },
  QUEUE_NAMES: { DISPATCH: 'dispatch' },
}))
vi.mock('@/modules/notifications/notifications.service', () => ({ pushToTokens: vi.fn() }))
vi.mock('@/modules/notifications/notifications.repository', () => ({ getTokensForOwner: vi.fn() }))

import * as repo from '@/modules/rides/rides.repository'
import { pushToTokens } from '@/modules/notifications/notifications.service'
import { getTokensForOwner } from '@/modules/notifications/notifications.repository'
import { rideAckKey } from '@/constants/redis-keys'
import { processAckCheck, type AckCheckJobData } from '@/jobs/processors/ack-check.processor'

const baseData: AckCheckJobData = {
  rideId: '101',
  driverId: '55',
  expiresAt: new Date(Date.now() + 15_000).toISOString(),
  pickup: 'Bhubaneswar Station',
  drop: 'Cuttack Bus Stand',
  pickupLat: 20.27,
  pickupLng: 85.84,
  distanceToPickup: 1200,
  estimatedFare: 350,
  rideType: 'one_way',
  isReturnCab: false,
}

describe('processAckCheck — one-shot fallback push', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.clear()
    store.set(rideAckKey(baseData.rideId, baseData.driverId), '1')
    vi.mocked(repo.getRideById).mockResolvedValue({ status: 'requested' } as never)
    vi.mocked(getTokensForOwner).mockResolvedValue(['device-token-1'])
  })

  it('fires exactly one tagged push the first time it runs for a ride+driver', async () => {
    await processAckCheck(baseData)

    expect(getTokensForOwner).toHaveBeenCalledWith('driver', BigInt(baseData.driverId))
    expect(pushToTokens).toHaveBeenCalledTimes(1)
    const [, msg] = vi.mocked(pushToTokens).mock.calls[0]!
    expect(msg).toMatchObject({ tag: `ride-${baseData.rideId}` })
  })

  it('does not push again on a second retry for the same ride+driver', async () => {
    await processAckCheck(baseData)
    vi.mocked(pushToTokens).mockClear()
    vi.mocked(getTokensForOwner).mockClear()

    await processAckCheck(baseData)

    expect(pushToTokens).not.toHaveBeenCalled()
    expect(getTokensForOwner).not.toHaveBeenCalled()
  })
})
