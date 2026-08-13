import { describe, it, expect, vi, beforeEach } from 'vitest'

// The one-shot-per-ride+driver dedupe guard now lives in
// sendRideRequestPushOnce (notifications.service.ts) — see
// tests/unit/notifications/send-ride-request-push-once.test.ts for that
// behavior. This file only verifies processAckCheck delegates to it with the
// right arguments.
const { store, redisMock } = vi.hoisted(() => {
  const store = new Map<string, string>()
  const redisMock = {
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    del: vi.fn(async (key: string) => { store.delete(key); return 1 }),
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
vi.mock('@/modules/notifications/notifications.service', () => ({ sendRideRequestPushOnce: vi.fn() }))

import * as repo from '@/modules/rides/rides.repository'
import { sendRideRequestPushOnce } from '@/modules/notifications/notifications.service'
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

describe('processAckCheck — fallback push delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.clear()
    store.set(rideAckKey(baseData.rideId, baseData.driverId), '1')
    vi.mocked(repo.getRideById).mockResolvedValue({ status: 'requested' } as never)
  })

  it('delegates the fallback push to sendRideRequestPushOnce with the ride/driver/pickup/drop', async () => {
    await processAckCheck(baseData)

    expect(sendRideRequestPushOnce).toHaveBeenCalledWith(
      baseData.rideId, baseData.driverId, baseData.pickup, baseData.drop, expect.any(Number)
    )
  })
})
