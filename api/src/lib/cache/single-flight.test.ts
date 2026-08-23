import { describe, it, expect, vi } from 'vitest'
import { singleFlight } from './single-flight'

describe('singleFlight', () => {
  it('calls fn once and returns its result', async () => {
    const fn = vi.fn().mockResolvedValue('value')
    const result = await singleFlight('key-a', fn)
    expect(result).toBe('value')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent calls for the same key into one fn invocation', async () => {
    let resolveFn: (v: string) => void
    const fn = vi.fn(() => new Promise<string>((resolve) => { resolveFn = resolve }))

    const p1 = singleFlight('key-b', fn)
    const p2 = singleFlight('key-b', fn)
    resolveFn!('shared')

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toBe('shared')
    expect(r2).toBe('shared')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does not collapse calls for different keys', async () => {
    const fn = vi.fn().mockResolvedValue('x')
    await Promise.all([singleFlight('key-c', fn), singleFlight('key-d', fn)])
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('allows a fresh call after the in-flight promise settles', async () => {
    const fn = vi.fn().mockResolvedValue('x')
    await singleFlight('key-e', fn)
    await singleFlight('key-e', fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not cache a rejection — a failed call can be retried', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('recovered')
    await expect(singleFlight('key-f', fn)).rejects.toThrow('boom')
    const result = await singleFlight('key-f', fn)
    expect(result).toBe('recovered')
  })
})
