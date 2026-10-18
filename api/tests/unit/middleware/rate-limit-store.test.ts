import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({ warn: vi.fn() }))

vi.mock('@/db/redis', async () => ({
  client: { call: vi.fn() },
  withTimeout: (await import('@/lib/with-timeout')).withTimeout,
}))
vi.mock('@/lib/logger', () => ({ logger: { warn: m.warn, info: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/jwt', () => ({ verifyAccessToken: vi.fn() }))

import { makeStoreSendCommand } from '@/middleware/rateLimit.middleware'

// Redis answers after `ms`, like a cold-booted server whose TLS connection is still opening.
const answerAfter = (ms: number, value: unknown = 'sha') => () => new Promise((resolve) => setTimeout(() => resolve(value), ms))
const never = () => new Promise<never>(() => undefined)

describe('rate limit store sendCommand', () => {
  beforeEach(() => { vi.useFakeTimers(); m.warn.mockClear() })
  afterEach(() => { vi.useRealTimers() })

  it('lets SCRIPT LOAD wait for a slow cold-start connection instead of failing at 1 s', async () => {
    const send = makeStoreSendCommand(answerAfter(2500), 'rl:general:')
    const result = send('SCRIPT', 'LOAD', 'return 1')
    await vi.advanceTimersByTimeAsync(2500)
    await expect(result).resolves.toBe('sha')
    expect(m.warn).not.toHaveBeenCalled()
  })

  it('still times out a request-time command at 1 s and logs that the request is allowed through', async () => {
    const send = makeStoreSendCommand(answerAfter(2500), 'rl:general:')
    const result = send('EVALSHA', 'sha', '1', 'k', '0', '60000')
    const assertion = expect(result).rejects.toThrow('redis command timeout')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(m.warn).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'rl:general:' }), 'rate-limit: redis command failed, allowing request through')
  })

  it('gives up on a SCRIPT LOAD that never answers after 15 s, with an accurate log message', async () => {
    const send = makeStoreSendCommand(never, 'rl:auth:')
    const result = send('script', 'load', 'return 1')
    const assertion = expect(result).rejects.toThrow('redis command timeout')
    await vi.advanceTimersByTimeAsync(14_999)
    expect(m.warn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await assertion
    expect(m.warn).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'rl:auth:' }), 'rate-limit: script preload failed, it is reloaded on first use')
  })
})
