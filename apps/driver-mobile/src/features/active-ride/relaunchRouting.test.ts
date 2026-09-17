import { describe, expect, it } from 'vitest'
import { relaunchRoute } from './relaunchRouting'

describe('relaunchRoute', () => {
  it('routes to the tab shell when there is no active ride', () => {
    expect(relaunchRoute(null)).toBe('/(tabs)/home')
  })

  it('routes into the active-ride screen for the correct ride id when one exists', () => {
    expect(relaunchRoute({ id: 'ride_123', status: 'in_progress' })).toBe('/active-ride/ride_123')
  })

  it('routes correctly for every known ride status, not just one', () => {
    const statuses = ['accepted', 'driver_arrived', 'in_progress', 'completed'] as const
    for (const status of statuses) {
      expect(relaunchRoute({ id: 'ride_1', status })).toBe('/active-ride/ride_1')
    }
  })
})
