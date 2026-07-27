import { describe, it, expect } from 'vitest'
import { maskRideContacts } from '@/modules/rides/rides.service'

const RIDE = {
  user_phone: '+919876543210',
  rider_phone: '+919876500000',
  driver_phone: '+919876511111',
}

describe('maskRideContacts', () => {
  it('strips the driver phone when the viewer is the rider', () => {
    const masked = maskRideContacts(RIDE, 'user')
    expect(masked.driver_phone).toBeNull()
    expect(masked.user_phone).toBe('+919876543210')
  })

  it('strips the user/rider phone when the viewer is the driver', () => {
    const masked = maskRideContacts(RIDE, 'driver')
    expect(masked.user_phone).toBeNull()
    expect(masked.rider_phone).toBeNull()
    expect(masked.driver_phone).toBe('+919876511111')
  })

  it('leaves both numbers untouched for an admin viewer', () => {
    const masked = maskRideContacts(RIDE, 'admin')
    expect(masked.user_phone).toBe('+919876543210')
    expect(masked.driver_phone).toBe('+919876511111')
  })
})
