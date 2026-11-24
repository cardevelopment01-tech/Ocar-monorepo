import { describe, it, expect } from 'vitest'
import { keepRunningGuide } from './steps'

describe('keepRunningGuide', () => {
  it('gives every phone the battery step first', () => {
    for (const brand of ['Xiaomi', 'samsung', 'Google', null, undefined, '']) {
      expect(keepRunningGuide(brand).steps[0]).toContain('Unrestricted')
    }
  })
  it('adds the Autostart step for Xiaomi family brands, any case', () => {
    for (const brand of ['Xiaomi', 'REDMI', 'POCO']) {
      const g = keepRunningGuide(brand)
      expect(g.title).toContain('Xiaomi')
      expect(g.steps.join(' ')).toContain('Autostart')
    }
  })
  it('knows Oppo, Vivo, Samsung and Huawei families', () => {
    expect(keepRunningGuide('realme').title).toContain('Oppo')
    expect(keepRunningGuide('iQOO').title).toContain('Vivo')
    expect(keepRunningGuide('samsung').steps.join(' ')).toContain('Never sleeping apps')
    expect(keepRunningGuide('HONOR').title).toContain('Huawei')
  })
  it('an unknown or missing brand gets just the common step', () => {
    expect(keepRunningGuide('Google')).toEqual({ title: 'Your phone', steps: [expect.stringContaining('Unrestricted')] })
    expect(keepRunningGuide(null).steps).toHaveLength(1)
  })
})
