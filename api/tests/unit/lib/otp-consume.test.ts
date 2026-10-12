import { describe, it, expect, vi, beforeEach } from 'vitest'

// Minimal in-memory Redis: enough of get/set(EX,NX)/incr/ttl/expire/del/exists for lib/otp.ts. Every command is
// async, so Promise.all genuinely interleaves them the way parallel HTTP requests would.
const { store, fake, ttls } = vi.hoisted(() => {
const store = new Map<string, string>()
const ttls = new Set<string>() // keys that have an expiry
const fake = {
  get: vi.fn(async (k: string) => store.get(k) ?? null),
  set: vi.fn(async (k: string, v: string, ...opts: unknown[]) => {
    if (opts.includes('NX') && store.has(k)) return null
    store.set(k, v)
    return 'OK'
  }),
  incr: vi.fn(async (k: string) => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n }),
  ttl: vi.fn(async () => 100),
  expire: vi.fn(async (k: string) => { ttls.add(k); return 1 }),
  del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  exists: vi.fn(async (k: string) => (store.has(k) ? 1 : 0)),
  multi: vi.fn(() => {
    const steps: Array<() => Promise<unknown>> = []
    const chain = {
      incr: (k: string) => { steps.push(async () => { const n = Number(store.get(k) ?? 0) + 1; store.set(k, String(n)); return n }); return chain },
      ttl: (k: string) => { steps.push(async () => (ttls.has(k) ? 100 : -1)); return chain },
      exec: async () => { const out: unknown[] = []; for (const s of steps) out.push([null, await s()]); return out },
    }
    return chain
  }),
}
return { store, fake, ttls }
})
vi.mock('@/db/redis', () => ({ client: fake }))
vi.mock('@/config', () => ({ config: { JWT_REFRESH_SECRET: 'x' } }))

import { storeOtp, consumeOtp, isVerifyLocked, checkRateLimit } from '@/lib/otp'
import { OTP_MAX_ATTEMPTS, OTP_RATE_LIMIT_MAX_REQUESTS } from '@/constants/limits'
import { OtpPurpose, PrincipalRole } from '@/constants/enums'

const PHONE = '+919999999999'
const P = OtpPurpose.LOGIN
const R = PrincipalRole.USER

describe('consumeOtp — atomic guess accounting', () => {
  beforeEach(() => { store.clear(); ttls.clear() })

  it('a correct code succeeds once and is then gone', async () => {
    await storeOtp(PHONE, P, R, '123456')
    expect(await consumeOtp(PHONE, P, R, '123456')).toEqual({ success: true })
    expect(await consumeOtp(PHONE, P, R, '123456')).toMatchObject({ success: false, expired: true })
  })

  it('PARALLEL wrong guesses: only OTP_MAX_ATTEMPTS of them are ever evaluated, the rest are locked out', async () => {
    await storeOtp(PHONE, P, R, '123456')
    const guesses = Array.from({ length: 50 }, (_, i) => String(100000 + i)) // none is the real code
    const results = await Promise.all(guesses.map(g => consumeOtp(PHONE, P, R, g)))

    const evaluated = results.filter(r => r.attemptsLeft !== undefined && !r.locked)
    expect(evaluated.length).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS)
    expect(results.some(r => r.locked)).toBe(true)
    expect(await isVerifyLocked(PHONE, P, R)).toBe(true)
  })

  it('a locked number cannot succeed even with the right code', async () => {
    await storeOtp(PHONE, P, R, '123456')
    await Promise.all(Array.from({ length: 30 }, (_, i) => consumeOtp(PHONE, P, R, String(200000 + i))))
    expect(await consumeOtp(PHONE, P, R, '123456')).toMatchObject({ success: false, locked: true })
  })

  it('two PARALLEL submissions of the correct code produce exactly one success', async () => {
    await storeOtp(PHONE, P, R, '123456')
    const results = await Promise.all([consumeOtp(PHONE, P, R, '123456'), consumeOtp(PHONE, P, R, '123456')])
    expect(results.filter(r => r.success).length).toBe(1)
  })

  it('requesting a fresh code does NOT hand back a fresh set of guesses', async () => {
    await storeOtp(PHONE, P, R, '123456')
    for (let i = 0; i < OTP_MAX_ATTEMPTS - 1; i++) await consumeOtp(PHONE, P, R, '000000')
    await storeOtp(PHONE, P, R, '654321') // re-request
    // One guess left in the window, not another full allowance.
    expect(await consumeOtp(PHONE, P, R, '000001')).toMatchObject({ success: false, locked: true })
  })

  it('reports remaining attempts on an ordinary wrong guess', async () => {
    await storeOtp(PHONE, P, R, '123456')
    expect(await consumeOtp(PHONE, P, R, '000000')).toEqual({ success: false, attemptsLeft: OTP_MAX_ATTEMPTS - 1 })
  })
})

describe('checkRateLimit', () => {
  beforeEach(() => { store.clear() })

  it('allows OTP_RATE_LIMIT_MAX_REQUESTS requests then blocks, under parallel load', async () => {
    const results = await Promise.all(Array.from({ length: OTP_RATE_LIMIT_MAX_REQUESTS + 5 }, () => checkRateLimit(PHONE, P, R)))
    expect(results.filter(r => r.allowed).length).toBe(OTP_RATE_LIMIT_MAX_REQUESTS)
  })
})
