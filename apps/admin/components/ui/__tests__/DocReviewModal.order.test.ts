import { describe, it, expect } from 'vitest'
import { buildDocs, docRank } from '../DocReviewModal'

const doc = (doc_type: string) => ({ id: doc_type, doc_type, file_url: 'x', status: 'pending', rejection_note: null, claimed_valid_until: null, updated_at: 't' })
const detail = (driver: string[], vehicle: string[]) => ({ documents: driver.map(doc), vehicle_documents: vehicle.map(doc) }) as never

describe('document review order', () => {
  it('lists documents in the order the client asked for, whatever order they were uploaded in', () => {
    const docs = buildDocs(detail(
      ['driving_license_back', 'aadhaar_back', 'profile_photo', 'driving_license_front', 'aadhaar_front'],
      ['pollution_cert', 'permit', 'fitness_cert', 'insurance', 'vehicle_rc_back', 'vehicle_rc_front'],
    ))
    expect(docs.map(d => d.docType)).toEqual([
      'profile_photo', 'aadhaar_front', 'aadhaar_back', 'driving_license_front', 'driving_license_back',
      'vehicle_rc_front', 'vehicle_rc_back', 'insurance', 'permit', 'fitness_cert', 'pollution_cert',
    ])
  })

  it('puts a missing required document in its own slot instead of at the end', () => {
    const docs = buildDocs(detail(['profile_photo', 'aadhaar_front', 'aadhaar_back', 'driving_license_back'], ['vehicle_rc_front', 'vehicle_rc_back', 'insurance', 'permit']))
    const types = docs.map(d => d.docType)
    expect(types.indexOf('driving_license_front')).toBe(3)
    expect(docs[3]?.status).toBe('missing')
    expect(docs.length).toBe(9)
  })

  it('keeps identity documents before vehicle documents, and unknown types last', () => {
    const docs = buildDocs(detail(['profile_photo', 'aadhaar_front', 'aadhaar_back', 'driving_license_front', 'driving_license_back', 'mystery_doc'], ['vehicle_rc_front', 'vehicle_rc_back', 'insurance', 'permit']))
    const kinds = docs.map(d => d.kind)
    expect(kinds.lastIndexOf('driver')).toBeGreaterThan(kinds.indexOf('vehicle')) // only the unknown driver doc trails
    expect(docs[docs.length - 1]?.docType).toBe('mystery_doc')
    expect(docRank('mystery_doc')).toBeGreaterThan(docRank('pollution_cert'))
  })
})
