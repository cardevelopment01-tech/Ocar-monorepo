import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/redis', () => ({ client: { incr: vi.fn(), expire: vi.fn(), del: vi.fn() } }))

import { client as redis } from '@/db/redis'
import { checkRideOtpAttempts, clearRideOtpAttempts } from '@/lib/otp'

describe('checkRideOtpAttempts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets a 15-minute TTL on the first attempt and returns 1', async () => {
    vi.mocked(redis.incr).mockResolvedValue(1)
    const n = await checkRideOtpAttempts(BigInt(303), 'start')
    expect(n).toBe(1)
    expect(redis.incr).toHaveBeenCalledWith('ride:otp:attempts:303:start')
    expect(redis.expire).toHaveBeenCalledWith('ride:otp:attempts:303:start', 15 * 60)
  })

  it('does NOT reset the TTL on subsequent attempts and returns the count', async () => {
    vi.mocked(redis.incr).mockResolvedValue(3)
    const n = await checkRideOtpAttempts(BigInt(303), 'end')
    expect(n).toBe(3)
    expect(redis.incr).toHaveBeenCalledWith('ride:otp:attempts:303:end')
    expect(redis.expire).not.toHaveBeenCalled()
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
