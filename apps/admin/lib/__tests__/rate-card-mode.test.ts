import { describe, it, expect } from 'vitest'
import { cardMode, MODE_LABEL, MODE_ORDER, isRentalCard, modeToCardFields, sameCard } from '../rate-card-mode'

describe('cardMode', () => {
  it('a one-way card with trip mode city is a City Ride card', () => {
    expect(cardMode({ ride_type: 'one_way', trip_mode: 'city' })).toBe('city')
  })
  it('every other card is its ride type, and a card with no trip mode (older API) is standard', () => {
    expect(cardMode({ ride_type: 'one_way', trip_mode: 'standard' })).toBe('one_way')
    expect(cardMode({ ride_type: 'one_way' })).toBe('one_way')
    expect(cardMode({ ride_type: 'round_trip', trip_mode: 'standard' })).toBe('round_trip')
    expect(cardMode({ ride_type: 'rental', trip_mode: 'standard' })).toBe('rental')
  })
})

describe('modes shown in the admin', () => {
  it('lists One Way, Round Trip and City Ride, in that order, and not Rental (rentals are priced from Rental Packages)', () => {
    expect(MODE_ORDER).toEqual(['one_way', 'round_trip', 'city'])
    expect(MODE_LABEL['city']).toBe('City Ride')
    expect(MODE_ORDER).not.toContain('rental')
  })
  it('hides rental rate cards', () => {
    expect(isRentalCard({ ride_type: 'rental' })).toBe(true)
    expect(isRentalCard({ ride_type: 'one_way', trip_mode: 'city' })).toBe(false)
  })
})

describe('modeToCardFields', () => {
  it('City Ride is a one-way ride type with trip mode city; the others are standard', () => {
    expect(modeToCardFields('city')).toEqual({ ride_type: 'one_way', trip_mode: 'city' })
    expect(modeToCardFields('one_way')).toEqual({ ride_type: 'one_way', trip_mode: 'standard' })
    expect(modeToCardFields('round_trip')).toEqual({ ride_type: 'round_trip', trip_mode: 'standard' })
  })
})

describe('sameCard', () => {
  it('a standard and a city one-way card for the same category and city are different cards', () => {
    const std = { category_name: 'Sedan', ride_type: 'one_way', trip_mode: 'standard', city_id: null }
    const city = { category_name: 'Sedan', ride_type: 'one_way', trip_mode: 'city', city_id: null }
    expect(sameCard(std, city)).toBe(false)
    expect(sameCard(std, { ...std })).toBe(true)
  })
})
