import { describe, expect, it } from 'vitest'
import { carColorHex, driverIdentity, type DriverIdentityInput } from './driver'

const base: DriverIdentityInput = {
  name: 'Rajesh Kumar Mohapatra', rating: '4.86', totalTrips: 1240, verified: true,
  vehicleColor: 'Pearl White', vehicleBrand: 'Maruti', vehicleModel: 'Dzire', vehicleName: null, plate: 'OD 02 AB 1234',
}

describe('carColorHex', () => {
  it('maps plain and compound colour names by their hue word', () => {
    expect(carColorHex('White')).toBe('#FFFFFF')
    expect(carColorHex('Pearl White')).toBe('#FFFFFF')
    expect(carColorHex('metallic  Grey')).toBe('#808080')
    expect(carColorHex('Light-Blue')).toBe('#1E63D6')
  })
  it('returns null for empty or unknown colours', () => {
    expect(carColorHex(null)).toBeNull()
    expect(carColorHex('')).toBeNull()
    expect(carColorHex('Chameleon')).toBeNull()
  })
})

describe('driverIdentity', () => {
  it('formats an established driver', () => {
    const v = driverIdentity(base)
    expect(v).toMatchObject({
      firstName: 'Rajesh', initials: 'RM', ratingText: '4.9', tripsText: '1,240 trips', verified: true,
      vehicleLine: 'Pearl White Maruti Dzire', vehicleShort: 'Maruti Dzire', swatch: '#FFFFFF', plate: 'OD 02 AB 1234',
    })
  })
  it('shows no rating for a brand-new driver even though rating_avg defaults to 5.00', () => {
    const v = driverIdentity({ ...base, rating: '5.00', totalTrips: 0 })
    expect(v.ratingText).toBeNull()
    expect(v.tripsText).toBe('Newly joined')
  })
  it('does not claim verified unless explicitly true, and falls back to vehicle_name', () => {
    const v = driverIdentity({ ...base, verified: null, vehicleBrand: null, vehicleModel: null, vehicleName: 'Maruti Dzire', vehicleColor: null })
    expect(v.verified).toBe(false)
    expect(v.vehicleLine).toBe('Maruti Dzire')
    expect(v.swatch).toBeNull()
  })
  it('handles missing name / single trip / missing plate', () => {
    const v = driverIdentity({ ...base, name: null, totalTrips: 1, plate: '  ' })
    expect(v).toMatchObject({ name: 'Your driver', initials: '?', tripsText: '1 trip', plate: null })
  })
})
