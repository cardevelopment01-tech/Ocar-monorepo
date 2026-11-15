import { describe, it, expect } from 'vitest'
import { requiredVehicleDocs, REQUIRED_VEHICLE_DOCS } from '../vehicle-docs'

describe('requiredVehicleDocs', () => {
  it('an electric vehicle needs no permit; every other fuel type is unchanged', () => {
    expect(requiredVehicleDocs('electric')).toEqual(['vehicle_rc_front', 'vehicle_rc_back', 'insurance'])
    for (const fuel of ['petrol', 'diesel', 'cng', null, undefined]) expect(requiredVehicleDocs(fuel)).toEqual(REQUIRED_VEHICLE_DOCS)
  })
})
