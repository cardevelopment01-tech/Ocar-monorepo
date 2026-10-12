import { describe, it, expect, vi, beforeEach } from 'vitest'

// incr()/ttl() are queued on a MULTI and answered together by exec(): one round trip for the counter.
const { multiState, client } = vi.hoisted(() => {
  const multiState = { count: 1 as unknown, ttl: 900, queued: [] as string[], raw: undefined as unknown }
  const chain = {
    incr: vi.fn((k: string) => { multiState.queued.push('incr:' + k); return chain }),
    ttl: vi.fn((k: string) => { multiState.queued.push('ttl:' + k); return chain }),
    exec: vi.fn(async () => (multiState.raw !== undefined ? multiState.raw : [[null, multiState.count], [null, multiState.ttl]])),
  }
  return {
    multiState,
    client: { multi: vi.fn(() => chain), set: vi.fn(), expire: vi.fn(), del: vi.fn() },
  }
})
vi.mock('@/db/redis', () => ({ client }))

import { client as redis } from '@/db/redis'
import { checkRideOtpAttempts, clearRideOtpAttempts } from '@/lib/otp'

describe('checkRideOtpAttempts', () => {
  beforeEach(() => { vi.clearAllMocks(); multiState.count = 1; multiState.ttl = 900; multiState.queued = []; multiState.raw = undefined })

  // These counters are brute-force protection: a broken Redis answer must reject, never read as "0 attempts".
  it('FAILS CLOSED when the MULTI was discarded (exec resolves null)', async () => {
    multiState.raw = null
    await expect(checkRideOtpAttempts(BigInt(303), 'start')).rejects.toThrow(/discarded/)
  })

  it('FAILS CLOSED when a queued command errored (exec resolves [Error, null] tuples)', async () => {
    multiState.raw = [[new Error('WRONGTYPE Operation against a key'), null], [null, 900]]
    await expect(checkRideOtpAttempts(BigInt(303), 'start')).rejects.toThrow(/WRONGTYPE/)
  })

  it('FAILS CLOSED on a non-numeric count', async () => {
    multiState.raw = [[null, 'oops'], [null, 900]]
    await expect(checkRideOtpAttempts(BigInt(303), 'start')).rejects.toThrow(/non-numeric/)
  })

  it('counts and reads the TTL in a single MULTI (one round trip), not three serial commands', async () => {
    const n = await checkRideOtpAttempts(BigInt(303), 'start')
    expect(n).toBe(1)
    expect(client.multi).toHaveBeenCalledTimes(1)
    expect(multiState.queued).toEqual(['incr:ride:otp:attempts:303:start', 'ttl:ride:otp:attempts:303:start'])
    expect(client.set).not.toHaveBeenCalled()
  })

  it('sets the 15-minute expiry on a brand-new counter (INCR creates it with no TTL)', async () => {
    multiState.count = 1
    multiState.ttl = -1
    await checkRideOtpAttempts(BigInt(303), 'start')
    expect(client.expire).toHaveBeenCalledWith('ride:otp:attempts:303:start', 15 * 60)
  })

  it('does not touch the TTL of a healthy counter on later attempts', async () => {
    multiState.count = 3
    const n = await checkRideOtpAttempts(BigInt(303), 'end')
    expect(n).toBe(3)
    expect(client.expire).not.toHaveBeenCalled()
  })

  it('repairs a counter left with no TTL by the old INCR-then-EXPIRE code (it would lock the ride forever)', async () => {
    multiState.count = 2
    multiState.ttl = -1
    await checkRideOtpAttempts(BigInt(303), 'end')
    expect(client.expire).toHaveBeenCalledWith('ride:otp:attempts:303:end', 15 * 60)
  })

  it('throws a 429 RIDE_OTP_LOCKED once the count exceeds the max (5)', async () => {
    multiState.count = 6
    await expect(checkRideOtpAttempts(BigInt(303), 'start')).rejects.toMatchObject({
      httpStatus: 429,
      appCode: 'RIDE_OTP_LOCKED',
    })
  })

  it('allows exactly the max attempts (5) without throwing', async () => {
    multiState.count = 5
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
