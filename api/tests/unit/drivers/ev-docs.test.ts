import { describe, it, expect } from 'vitest'
import { requiredVehicleDocs, isIgnoredVehicleDoc, sqlVehicleDocApplies, REQUIRED_VEHICLE_DOCS } from '@/modules/drivers/required-docs'
import { classifyDocIssues, type DocRow } from '@/modules/drivers/doc-issues'

// Value: protects=an electric-vehicle driver is not asked for, blocked by, or reminded about a commercial permit or a PUC, which
// do not apply to a battery-electric vehicle, while every other vehicle is exactly as strict as before; fails_when=an EV
// driver is blocked by a missing/expired/rejected permit or PUC, or a petrol/diesel/CNG driver stops being asked for a permit;
// why_new=the required list was one fixed list for every fuel type; seam=none (pure rules); no_claim=that the SQL gate agrees
// (tests/integration/doc-issues-vs-gate.test.ts does that against a database).

const row = (doc_type: string, status: string, valid: string | null = null, note: string | null = null): DocRow =>
  ({ doc_type, status, rejection_note: note, verified_valid_until: valid })
const TODAY = '2026-11-15'
const IDENTITY = ['profile_photo', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back'].map((t) => row(t, 'approved'))
const BASE = [row('vehicle_rc_front', 'approved'), row('vehicle_rc_back', 'approved'), row('insurance', 'approved', '2027-01-01')]
const issues = (vehicle: DocRow[], fuelType: string | null) =>
  classifyDocIssues({ identity: IDENTITY, vehicle, today: TODAY, fuelType }).map((i) => `${i.doc_type}:${i.reason}`)

describe('requiredVehicleDocs', () => {
  it('an electric vehicle needs the RC and insurance but no permit; every other fuel type is unchanged', () => {
    expect(requiredVehicleDocs('electric')).toEqual(['vehicle_rc_front', 'vehicle_rc_back', 'insurance'])
    for (const fuel of ['petrol', 'diesel', 'cng', null, undefined, '']) {
      expect(requiredVehicleDocs(fuel)).toEqual(REQUIRED_VEHICLE_DOCS)
    }
  })

  it('only an electric vehicle ignores the permit and the PUC', () => {
    expect(isIgnoredVehicleDoc('electric', 'permit')).toBe(true)
    expect(isIgnoredVehicleDoc('electric', 'pollution_cert')).toBe(true)
    expect(isIgnoredVehicleDoc('electric', 'insurance')).toBe(false)
    expect(isIgnoredVehicleDoc('electric', 'vehicle_rc_front')).toBe(false)
    expect(isIgnoredVehicleDoc('petrol', 'permit')).toBe(false)
    expect(isIgnoredVehicleDoc(null, 'pollution_cert')).toBe(false)
  })

  it('the SQL fragment names only hardcoded tokens and the two ignored types', () => {
    const sql = sqlVehicleDocApplies('dv', 'dvd')
    expect(sql).toBe("NOT (COALESCE(dv.fuel_type, '') = 'electric' AND dvd.doc_type::text IN ('permit', 'pollution_cert'))")
  })
})

describe('classifyDocIssues for an electric vehicle', () => {
  it('a missing permit is not an issue (a petrol vehicle with the same documents is not complete only because of what is uploaded)', () => {
    expect(issues(BASE, 'electric')).toEqual([])
  })

  it('an expired, rejected or pending permit or PUC never blocks an electric vehicle', () => {
    const odd = [row('permit', 'approved', '2026-01-01'), row('pollution_cert', 'rejected', null, 'blurry'), row('fitness_cert', 'approved', '2030-01-01')]
    expect(issues([...BASE, ...odd], 'electric')).toEqual([])
    expect(issues([...BASE, row('permit', 'pending')], 'electric')).toEqual([])
  })

  it('still blocks an electric vehicle for what does apply: insurance, RC', () => {
    expect(issues([row('vehicle_rc_front', 'approved'), row('vehicle_rc_back', 'approved'), row('insurance', 'approved', '2026-10-01')], 'electric'))
      .toEqual(['insurance:expired'])
    expect(issues([row('vehicle_rc_front', 'approved'), row('insurance', 'approved', '2027-01-01')], 'electric')).toEqual(['vehicle_rc_back:missing_back'])
    expect(issues([...BASE.slice(0, 2), row('insurance', 'pending')], 'electric')).toEqual(['insurance:pending_review'])
  })

  it('every other fuel type is exactly as strict as before', () => {
    for (const fuel of ['petrol', 'diesel', 'cng', null]) {
      expect(issues([...BASE, row('permit', 'pending')], fuel)).toEqual(['permit:pending_review'])
      expect(issues([...BASE, row('permit', 'approved', '2026-01-01')], fuel)).toEqual(['permit:expired'])
      expect(issues([...BASE, row('permit', 'approved', '2027-01-01'), row('pollution_cert', 'approved', '2026-01-01')], fuel)).toEqual(['pollution_cert:expired'])
    }
  })
})
