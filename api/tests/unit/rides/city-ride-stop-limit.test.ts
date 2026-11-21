import { describe, expect, it } from 'vitest'
import { CITY_RIDE_MAX_STOPS_DEFAULT, cityStopLimitError, parseCityStopLimit, stopLimitFor } from '@/modules/rides/city-ride'

// Value: protects=a city ride never carries more than the client's 2 stops (setting city_ride_max_stops), while other ride types keep the
// global limit of 3, and a bad setting falls back to 2 instead of opening the limit; fails_when=a city ride accepts a 3rd stop, the limit
// leaks onto round trips and rentals, or "abc" in the setting removes the cap; why_new=the client capped city rides at 2 stops inside the
// city; seam=none (pure rules); no_claim=the boundary query and the booking path (covered against a real database separately).

describe('parseCityStopLimit', () => {
  it('reads a whole number from 0 up to the global ceiling', () => {
    expect(parseCityStopLimit('2', 3)).toBe(2)
    expect(parseCityStopLimit(' 1 ', 3)).toBe(1)
    expect(parseCityStopLimit('0', 3)).toBe(0)
    expect(parseCityStopLimit('3', 3)).toBe(3)
  })
  it('falls back to the client rule of 2 for anything unusable, never to "no limit"', () => {
    for (const bad of [null, undefined, '', 'abc', '2.5', '-1', '4', '99']) expect(parseCityStopLimit(bad, 3)).toBe(CITY_RIDE_MAX_STOPS_DEFAULT)
  })
})

describe('stopLimitFor', () => {
  it('a city ride gets its own limit, never above the global one', () => {
    expect(stopLimitFor('city', 2, 3)).toBe(2)
    expect(stopLimitFor('city', 5, 3)).toBe(3)
  })
  it('standard and unspecified rides keep the global limit', () => {
    expect(stopLimitFor('standard', 2, 3)).toBe(3)
    expect(stopLimitFor(undefined, 2, 3)).toBe(3)
  })
})

describe('refusals', () => {
  it('say the limit in words and carry stable codes', () => {
    expect(cityStopLimitError(2)).toMatchObject({ httpStatus: 422, appCode: 'CITY_RIDE_STOP_LIMIT', message: 'A city ride can have at most 2 stops' })
    expect(cityStopLimitError(1).message).toBe('A city ride can have at most 1 stop')
    expect(cityStopLimitError(0).message).toBe('A city ride cannot have stops')
  })
})
