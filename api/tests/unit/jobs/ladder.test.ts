import { describe, it, expect } from 'vitest'
import { fastRoundSteps } from '@/jobs/processors/ladder'

const rad = (s: Array<{ radiusMetres: number; exactOnly: boolean }>) => s.map((x) => `${x.radiusMetres}${x.exactOnly ? 'x' : ''}`)

describe('fastRoundSteps', () => {
  it('round 1: fallback categories at the same radius, then each wider radius (exact category first, then fallback)', () => {
    expect(rad(fastRoundSteps(1, 2500, 4500, 1000))).toEqual(['2500', '3500x', '3500', '4500x', '4500'])
  })

  it('round 2: radius only, up to round 3\'s radius', () => {
    expect(rad(fastRoundSteps(2, 3500, 4500, 1000))).toEqual(['4500'])
  })

  it('round 3 has nothing to widen', () => {
    expect(fastRoundSteps(3, 4500, 4500, 1000)).toEqual([])
  })

  it('never goes past the last round\'s radius', () => {
    const steps = fastRoundSteps(1, 2500, 4500, 1000)
    expect(Math.max(...steps.map((s) => s.radiusMetres))).toBe(4500)
  })

  it('round 1 with no room to widen still tries the fallback categories once', () => {
    expect(rad(fastRoundSteps(1, 4500, 4500, 1000))).toEqual(['4500'])
  })

  it('a bad step size gives no steps instead of looping forever', () => {
    expect(fastRoundSteps(1, 2500, 4500, 0)).toEqual([])
    expect(fastRoundSteps(1, 2500, 4500, -1)).toEqual([])
  })
})
