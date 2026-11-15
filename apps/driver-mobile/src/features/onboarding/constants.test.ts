import { describe, it, expect } from 'vitest'
import { vehicleDocGroupsFor, VEHICLE_DOC_GROUPS } from './constants'

describe('vehicleDocGroupsFor', () => {
  const required = (fuel: string | null) => vehicleDocGroupsFor(fuel).filter((g) => g.required).map((g) => g.groupKey)

  it('an electric vehicle hides the PUC and makes the permit optional', () => {
    const groups = vehicleDocGroupsFor('electric')
    expect(groups.map((g) => g.groupKey)).toEqual(['vehicle_rc', 'insurance', 'permit', 'fitness_cert'])
    expect(groups.find((g) => g.groupKey === 'permit')).toMatchObject({ required: false, expiryRequired: false })
    expect(required('electric')).toEqual(['vehicle_rc', 'insurance'])
  })

  it('every other fuel type (and an unknown one) is unchanged: permit required, PUC optional', () => {
    for (const fuel of ['petrol', 'diesel', 'cng', null]) {
      expect(vehicleDocGroupsFor(fuel)).toEqual(VEHICLE_DOC_GROUPS)
      expect(required(fuel)).toEqual(['vehicle_rc', 'insurance', 'permit'])
    }
  })
})
