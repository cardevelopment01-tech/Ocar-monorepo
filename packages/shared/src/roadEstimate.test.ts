import { describe, expect, it } from 'vitest'
import { ROAD_FACTOR, estimatedRoadKm, formatEstimatedRoadKm } from './roadEstimate'

// Value: protects=the search-list distance reading as a road estimate (longer than the straight line, with a "~") instead of the
// straight-line figure riders compared with other apps; fails_when=the factor drops below 1 or the "~" is lost; why_new=new helper;
// seam=none (pure); no_claim=that it matches Google's route for a given pair (the fare screen shows the real one).
describe('road distance estimate', () => {
  it('scales the straight line up by the road factor', () => {
    expect(ROAD_FACTOR).toBeGreaterThan(1)
    expect(estimatedRoadKm(8000)).toBeCloseTo(10.4, 5)
    expect(estimatedRoadKm(0)).toBe(0)
  })
  it('is written as an estimate: "~10.4 km", one decimal', () => {
    expect(formatEstimatedRoadKm(8000)).toBe('~10.4 km')
    expect(formatEstimatedRoadKm(12_300)).toBe('~16.0 km') // Patia Square to the airport: 12.3 km straight, 15.4 km by road
    expect(formatEstimatedRoadKm(450)).toBe('~0.6 km')
  })
})
