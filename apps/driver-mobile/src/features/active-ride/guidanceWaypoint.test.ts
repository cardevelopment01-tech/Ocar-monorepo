import { describe, expect, it } from 'vitest'
import { curbWaypoint } from './guidanceWaypoint'

describe('curbWaypoint', () => {
  it('keeps the position and asks for the rider\'s side of the road and a legal stop', () => {
    expect(curbWaypoint(20.27, 85.84)).toEqual({
      position: { lat: 20.27, lng: 85.84 },
      preferSameSideOfRoad: true,
      vehicleStopover: true,
    })
  })
})
