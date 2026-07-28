import { describe, it, expect } from 'vitest'
import { maskRideContacts } from '@/modules/rides/rides.service'

function baseRide() {
  return {
    user_phone: '9999999999',
    rider_phone: '9999999999',
    driver_phone: '8888888888',
    commission_percent: '15.00',
    commission_amount: '72.00',
    driver_earning: '408.00',
  }
}

describe('maskRideContacts — commission visibility', () => {
  it('strips commission fields for the rider viewer', () => {
    const masked = maskRideContacts(baseRide(), 'user')
    expect(masked.commission_percent).toBeNull()
    expect(masked.commission_amount).toBeNull()
    expect(masked.driver_earning).toBeNull()
  })

  it('keeps commission fields for the driver viewer', () => {
    const masked = maskRideContacts(baseRide(), 'driver')
    expect(masked.commission_percent).toBe('15.00')
    expect(masked.commission_amount).toBe('72.00')
    expect(masked.driver_earning).toBe('408.00')
  })

  it('keeps commission fields for the admin viewer', () => {
    const masked = maskRideContacts(baseRide(), 'admin')
    expect(masked.commission_amount).toBe('72.00')
  })
})
