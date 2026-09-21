import { describe, it, expect } from 'vitest'
import { createSingleFlightGuard } from '../lib/single-flight'

describe('createSingleFlightGuard', () => {
  it('blocks a second call while the first is still in flight', async () => {
    const guard = createSingleFlightGuard()
    let concurrent = 0
    let maxConcurrent = 0
    const task = async (label: string) => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise(resolve => setTimeout(resolve, 10))
      concurrent--
      return label
    }

    const [first, second] = await Promise.all([
      guard.run(() => task('first')),
      guard.run(() => task('second')),
    ])

    expect(maxConcurrent).toBe(1)
    expect(first).toBe('first')
    expect(second).toBeUndefined()
  })

  it('allows a new call after the previous one finishes', async () => {
    const guard = createSingleFlightGuard()
    await guard.run(async () => 'first')
    const second = await guard.run(async () => 'second')
    expect(second).toBe('second')
  })

  it('releases the guard even when the task throws', async () => {
    const guard = createSingleFlightGuard()
    await expect(guard.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    const result = await guard.run(async () => 'recovered')
    expect(result).toBe('recovered')
  })
})
