import { describe, expect, it } from 'vitest'
import { buildTripFacts, dropDisplay, formatDuration, rentalFareLines, rentalPackageDetail } from './tripFacts'

describe('formatDuration', () => {
  it('reads minutes, hours and mixed', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(120)).toBe('2 h')
    expect(formatDuration(65)).toBe('1 h 05 min')
  })
})

describe('buildTripFacts', () => {
  it('lists start, end, distance and time taken', () => {
    const f = buildTripFacts({ startedAt: '2026-11-05T09:00:00Z', completedAt: '2026-11-05T10:05:00Z', actualKm: '28.40', actualMin: '65' })
    expect(f.map((x) => x.key)).toEqual(['started', 'ended', 'distance', 'time'])
    expect(f.find((x) => x.key === 'distance')?.value).toBe('28.4 km')
    expect(f.find((x) => x.key === 'time')?.value).toBe('1 h 05 min')
  })
  it('falls back to start/finish for the time taken when there are no actuals (one-way)', () => {
    const f = buildTripFacts({ startedAt: '2026-11-05T09:00:00Z', completedAt: '2026-11-05T09:45:00Z' })
    expect(f.find((x) => x.key === 'time')?.value).toBe('45 min')
    expect(f.find((x) => x.key === 'distance')).toBeUndefined()
  })
  it('omits what the ride does not have', () => {
    expect(buildTripFacts({})).toEqual([])
  })
})

describe('dropDisplay', () => {
  it('shows the real address for a rental, with the package as a caption', () => {
    const d = dropDisplay({ rideType: 'rental', destinationAddress: 'Esplanade One Mall, Bhubaneswar', tripHours: 4 })
    expect(d.value).toBe('Esplanade One Mall, Bhubaneswar')
    expect(d.note).toBe('City ride · 4 hour package')
  })
  it('never replaces a rental address with package wording', () => {
    expect(dropDisplay({ rideType: 'rental', destinationAddress: null }).value).toBe('Drop location not set')
  })
  it('labels a round trip drop and return', () => {
    expect(dropDisplay({ rideType: 'round_trip', destinationAddress: 'Puri' }).label).toBe('Drop and return')
  })
})

describe('rentalFareLines', () => {
  const base = { rideType: 'rental', baseFare: '800', rentalKmLimit: '40', rentalDurationMinutes: 240, rentalExtraPerKm: '10', rentalExtraPerMin: '1.5' }
  it('is null for other ride types', () => {
    expect(rentalFareLines({ ...base, rideType: 'one_way' })).toBeNull()
  })
  it('package only when nothing was exceeded', () => {
    const l = rentalFareLines({ ...base, overageFare: '0' })!
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ label: 'Package price', amount: 800, detail: '4 h · 40 km included' })
  })
  it('splits extra km and extra time, adding up to the overage fare', () => {
    const l = rentalFareLines({ ...base, overageFare: '150', overageKm: '12', overageMin: '20' })!
    expect(l.map((x) => x.label)).toEqual(['Package price', 'Extra distance', 'Extra time'])
    expect(l[1]).toMatchObject({ amount: 120, detail: '12 km × ₹10' })
    expect(l[2]).toMatchObject({ amount: 30, detail: '20 min × ₹1.50' })
    expect(l.slice(1).reduce((s, x) => s + x.amount, 0)).toBe(150)
  })
  it('only extra time when no extra km', () => {
    const l = rentalFareLines({ ...base, overageFare: '45', overageKm: '0', overageMin: '30' })!
    expect(l.map((x) => x.key)).toEqual(['package', 'extra-time'])
  })
  it('one generic line when the server sent no breakdown', () => {
    const l = rentalFareLines({ ...base, overageFare: '150' })!
    expect(l[1]).toMatchObject({ key: 'extra', amount: 150 })
  })
})

describe('rentalPackageDetail', () => {
  it('is null for non-rentals', () => {
    expect(rentalPackageDetail({ rideType: 'one_way', rentalKmLimit: '40', rentalDurationMinutes: 240 })).toBeNull()
  })
})
