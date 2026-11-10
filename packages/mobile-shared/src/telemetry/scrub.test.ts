import { describe, expect, it } from 'vitest'
import { classifyApiCall, isExpectedAuthRejection, routeOf, scrubUrl, userKey } from './scrub'

describe('isExpectedAuthRejection', () => {
  it('is true only for an axios error that answered 401', () => {
    expect(isExpectedAuthRejection({ isAxiosError: true, response: { status: 401 } })).toBe(true)
    expect(isExpectedAuthRejection({ isAxiosError: true, response: { status: 403 } })).toBe(false)
    expect(isExpectedAuthRejection({ isAxiosError: true, response: { status: 500 } })).toBe(false)
    expect(isExpectedAuthRejection({ isAxiosError: true })).toBe(false) // network error: no response
    expect(isExpectedAuthRejection({ response: { status: 401 } })).toBe(false) // not an axios error
    expect(isExpectedAuthRejection(new Error('401'))).toBe(false)
    expect(isExpectedAuthRejection(null)).toBe(false)
    expect(isExpectedAuthRejection('401')).toBe(false)
  })
})

describe('telemetry scrub', () => {
  it('drops query and fragment', () => {
    expect(scrubUrl('https://api.ocarindia.com/api/v1/geo/reverse?lat=20.29&lng=85.82')).toBe(
      'https://api.ocarindia.com/api/v1/geo/reverse'
    )
    expect(scrubUrl('/rides/5#x')).toBe('/rides/5')
    expect(scrubUrl('/rides/5')).toBe('/rides/5')
  })
  it('templates numeric ids and removes the host', () => {
    expect(routeOf('https://api.ocarindia.com/api/v1/rides/520/cancel?x=1')).toBe('/api/v1/rides/:id/cancel')
  })
  it('keys users by role and id only', () => {
    expect(userKey('driver', 33)).toBe('driver:33')
  })
  it('classifies api calls', () => {
    expect(classifyApiCall(200, 100)).toBe('ok')
    expect(classifyApiCall(200, 3500)).toBe('slow')
    expect(classifyApiCall(404, 50)).toBe('ignore')
    expect(classifyApiCall(403, 50)).toBe('error')
    expect(classifyApiCall(null, 10000)).toBe('error')
    expect(classifyApiCall(502, 50)).toBe('server_error')
  })
})
