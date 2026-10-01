import { describe, expect, it } from 'vitest'
import { formatEta, statusShowsEta } from './eta'

describe('formatEta', () => {
  it('never shows 0 min', () => {
    expect(formatEta(0, 0.4).time).toBe('1 min')
    expect(formatEta(0.4, 0.1).time).toBe('1 min')
    expect(formatEta(11, 4.2).time).toBe('11 min')
  })
  it('formats hours', () => {
    expect(formatEta(60, 30).time).toBe('1 h')
    expect(formatEta(65, 30).time).toBe('1 h 5 min')
  })
  it('reads short distances in metres, longer in km', () => {
    expect(formatEta(1, 0.02).distance).toBe('<50 m')
    expect(formatEta(1, 0.147).distance).toBe('150 m')
    expect(formatEta(1, 0.999).distance).toBe('1.0 km')
    expect(formatEta(11, 4.24).distance).toBe('4.2 km')
  })
})

describe('statusShowsEta', () => {
  it('shows on the pickup and trip legs only', () => {
    expect(['accepted', 'in_progress', 'returning'].every(statusShowsEta)).toBe(true)
    expect(['requested', 'driver_arrived', 'completed', 'cancelled'].some(statusShowsEta)).toBe(false)
  })
})
