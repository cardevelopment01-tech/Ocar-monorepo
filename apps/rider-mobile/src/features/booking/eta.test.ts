import { describe, expect, it } from 'vitest'
import { etaMinFromKm } from './eta'

describe('etaMinFromKm', () => {
  it('is never less than one minute', () => {
    expect(etaMinFromKm(0)).toBe(1)
    expect(etaMinFromKm(0.2)).toBe(1)
  })
  it('assumes 30 km/h', () => {
    expect(etaMinFromKm(3.5)).toBe(7)
    expect(etaMinFromKm(5)).toBe(10)
  })
})
