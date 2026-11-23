import { describe, it, expect } from 'vitest'
import { rentalBreakdown } from './rentalBreakdown'

const pkg = { key: 'package', label: 'Package price', detail: '1 h \u00b7 10 km included', amount: 150 }
const extraKm = { key: 'extra-km', label: 'Extra distance', detail: '10.75 km \u00d7 \u20b910', amount: 108 }

describe('rentalBreakdown (the lines under Ride fare on a rental trip-complete card)', () => {
  it('is null for a ride that is not a rental', () => {
    expect(rentalBreakdown(null, 154, 4, 4)).toBeNull()
  })

  it('shows the waiting at pickup as its own line, so "Surge and extras" no longer carries it', () => {
    // 150 package + 4 waiting = 154: nothing is left over
    const lines = rentalBreakdown([pkg], 154, 4, 4)!
    expect(lines.map((l) => [l.label, l.amount])).toEqual([['Package price', 150], ['Waiting at pickup', 4]])
    expect(lines[1]).toMatchObject({ detail: '4 min' })
    expect(lines.find((l) => l.label === 'Surge and extras')).toBeUndefined()
  })

  it('keeps only the real leftover (surge, stops) in "Surge and extras"', () => {
    const lines = rentalBreakdown([pkg, extraKm], 340, 4, 4)!
    expect(lines.map((l) => [l.label, l.amount])).toEqual([['Package price', 150], ['Extra distance', 108], ['Waiting at pickup', 4], ['Surge and extras', 78]])
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(340) // the lines always add up to the fare
  })

  it('adds no waiting line when nothing was charged, and no leftover line under a rupee', () => {
    expect(rentalBreakdown([pkg], 150, 0, 0)!.map((l) => l.label)).toEqual(['Package price'])
    expect(rentalBreakdown([pkg], 150.4, 0, 0)!.map((l) => l.label)).toEqual(['Package price'])
  })
})
