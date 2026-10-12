import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/redis', () => ({
  client: { set: vi.fn().mockResolvedValue('OK'), incr: vi.fn(), ttl: vi.fn().mockResolvedValue(900), expire: vi.fn(), del: vi.fn() },
}))

import { client as redis } from '@/db/redis'
import { checkRideOtpAttempts, clearRideOtpAttempts } from '@/lib/otp'

describe('checkRideOtpAttempts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates the counter WITH its 15-minute TTL in one atomic command, then increments', async () => {
    vi.mocked(redis.incr).mockResolvedValue(1)
    const n = await checkRideOtpAttempts(BigInt(303), 'start')
    expect(n).toBe(1)
    expect(redis.set).toHaveBeenCalledWith('ride:otp:attempts:303:start', '0', 'EX', 15 * 60, 'NX')
    expect(redis.incr).toHaveBeenCalledWith('ride:otp:attempts:303:start')
  })

  it('does not touch the TTL of a healthy counter on later attempts', async () => {
    vi.mocked(redis.incr).mockResolvedValue(3)
    const n = await checkRideOtpAttempts(BigInt(303), 'end')
    expect(n).toBe(3)
    expect(redis.expire).not.toHaveBeenCalled()
  })

  it('repairs a counter left with no TTL by the old INCR-then-EXPIRE code (it would lock the ride forever)', async () => {
    vi.mocked(redis.incr).mockResolvedValue(2)
    vi.mocked(redis.ttl).mockResolvedValueOnce(-1)
    await checkRideOtpAttempts(BigInt(303), 'end')
    expect(redis.expire).toHaveBeenCalledWith('ride:otp:attempts:303:end', 15 * 60)
  })

  it('throws a 429 RIDE_OTP_LOCKED once the count exceeds the max (5)', async () => {
    vi.mocked(redis.incr).mockResolvedValue(6)
    await expect(checkRideOtpAttempts(BigInt(303), 'start')).rejects.toMatchObject({
      httpStatus: 429,
      appCode: 'RIDE_OTP_LOCKED',
    })
  })

  it('allows exactly the max attempts (5) without throwing', async () => {
    vi.mocked(redis.incr).mockResolvedValue(5)
    await expect(checkRideOtpAttempts(BigInt(303), 'start')).resolves.toBe(5)
  })
})

describe('clearRideOtpAttempts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the per-ride, per-type counter key', async () => {
    await clearRideOtpAttempts(BigInt(303), 'end')
    expect(redis.del).toHaveBeenCalledWith('ride:otp:attempts:303:end')
  })
})
