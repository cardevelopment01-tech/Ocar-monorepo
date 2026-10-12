import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  upsertDriverLocation: vi.fn(), getActiveRideForDriver: vi.fn(), getActiveSession: vi.fn(),
}))
vi.mock('@/modules/drivers/driver-verification.repository', () => ({ getTodayStatus: vi.fn() }))
vi.mock('@/modules/drivers/drivers.repository', () => ({ hasApprovedRequiredDocs: vi.fn(() => Promise.resolve(true)) }))
vi.mock('@/modules/payments/payments.service', () => ({
  getDriverWallet: vi.fn(), getMinWalletBalance: vi.fn(), createPaymentRecord: vi.fn(), deductCommission: vi.fn(),
  creditCashback: vi.fn(), confirmRidePayment: vi.fn(), payFromUserWallet: vi.fn(), createRidePaymentOrder: vi.fn(),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendAdminDriverUpdate: vi.fn(), sendRideStatusUpdate: vi.fn(), sendNotification: vi.fn(), sendDriverLocation: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn() }, dispatch: { add: vi.fn() } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications', DISPATCH: 'dispatch' },
}))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('1') }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import * as repo from '@/modules/rides/rides.repository'
import { socketEvents } from '@/websocket/socket.server'
import { client as redis } from '@/db/redis'
import { updateLocation, notifySessionEnded } from '@/modules/rides/rides.service'

const PING = { sessionId: BigInt(738), lat: 20.2536, lng: 85.7584, recordedAt: new Date().toISOString() }

describe('updateLocation - a ping for a session the server already ended', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getActiveRideForDriver).mockResolvedValue(null as never)
  })

  it('rejects with 409 SESSION_ENDED and re-sends the session_ended_stale event the apps already handle', async () => {
    vi.mocked(repo.upsertDriverLocation).mockResolvedValue({ owned: true, ended: true })
    await expect(updateLocation(BigInt(9001), PING)).rejects.toMatchObject({ httpStatus: 409, appCode: 'SESSION_ENDED' })
    expect(socketEvents.sendNotification).toHaveBeenCalledTimes(1)
    expect(socketEvents.sendNotification).toHaveBeenCalledWith(
      'driver', '9001', expect.objectContaining({ type: 'session_ended_stale', title: 'You went offline' }))
  })

  it('does not repeat the notice on every ping (3 s cadence) -- once per interval per driver', async () => {
    vi.mocked(repo.upsertDriverLocation).mockResolvedValue({ owned: true, ended: true })
    for (let i = 0; i < 5; i++) {
      await expect(updateLocation(BigInt(9002), PING)).rejects.toMatchObject({ appCode: 'SESSION_ENDED' })
    }
    expect(socketEvents.sendNotification).toHaveBeenCalledTimes(1)
  })

  it('treats a session that is not the driver\'s as 403 and sends no notice (nothing to tell them)', async () => {
    vi.mocked(repo.upsertDriverLocation).mockResolvedValue({ owned: false, ended: false })
    await expect(updateLocation(BigInt(9003), PING)).rejects.toMatchObject({ httpStatus: 403, appCode: 'SESSION_MISMATCH' })
    expect(socketEvents.sendNotification).not.toHaveBeenCalled()
  })

  it('a live session is unaffected: no error, no notice', async () => {
    vi.mocked(repo.upsertDriverLocation).mockResolvedValue({ owned: true, ended: false })
    await expect(updateLocation(BigInt(9004), PING)).resolves.not.toThrow()
    expect(socketEvents.sendNotification).not.toHaveBeenCalled()
  })
})

describe('notifySessionEnded throttle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends again after the interval has passed, and tracks drivers independently', () => {
    const t0 = 1_800_000_000_000
    expect(notifySessionEnded(BigInt(9100), t0)).toBe(true)
    expect(notifySessionEnded(BigInt(9100), t0 + 59_000)).toBe(false)
    expect(notifySessionEnded(BigInt(9101), t0 + 1_000)).toBe(true)
    expect(notifySessionEnded(BigInt(9100), t0 + 61_000)).toBe(true)
    expect(socketEvents.sendNotification).toHaveBeenCalledTimes(3)
  })
})

describe('updateLocation - ended session but a ride is in progress', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps tracking the ride and does not tell the driver they are offline', async () => {
    // goOffline has no active-ride guard, so a session can be ended while a ride is under way. The rider must
    // keep seeing the car move, and the driver must not be bounced to Offline mid-trip.
    vi.mocked(repo.upsertDriverLocation).mockResolvedValue({ owned: true, ended: true })
    vi.mocked(redis.get).mockResolvedValue('77' as never) // active-ride cache hit
    await expect(updateLocation(BigInt(9200), PING)).resolves.not.toThrow()
    expect(socketEvents.sendDriverLocation).toHaveBeenCalledWith('77', expect.objectContaining({ lat: PING.lat, lng: PING.lng }))
    expect(socketEvents.sendNotification).not.toHaveBeenCalled()
    vi.mocked(redis.get).mockReset()
  })
})
