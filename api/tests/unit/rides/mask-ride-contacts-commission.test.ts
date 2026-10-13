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
    driver_rating_given: 5,
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

describe('maskRideContacts — the driver rating of the rider', () => {
  it('is hidden from the rider and kept for the driver and admin', () => {
    expect(maskRideContacts(baseRide(), 'user').driver_rating_given).toBeNull()
    expect(maskRideContacts(baseRide(), 'driver').driver_rating_given).toBe(5)
    expect(maskRideContacts(baseRide(), 'admin').driver_rating_given).toBe(5)
  })
})

describe('maskRideContacts — OTP hashes never leave the API', () => {
  it.each(['user', 'driver', 'admin'] as const)('strips start/end OTP hashes for the %s viewer', (viewer) => {
    const masked = maskRideContacts({ ...baseRide(), start_otp_hash: 'a', end_otp_hash: 'b' }, viewer)
    expect(masked).not.toHaveProperty('start_otp_hash')
    expect(masked).not.toHaveProperty('end_otp_hash')
  })
})
