import { describe, it, expect } from 'vitest'
import { classifyDocIssues, summarizeDocIssues, formatDocDate, docLabel, type DocRow } from '@/modules/drivers/doc-issues'

// Value: protects=a driver, an admin and the server all name the same blocking documents and the same reason (expired, rejected, waiting
// for review, missing); fails_when=an approved-but-expired document is called "rejected" or goes unreported, a document that is fine
// blocks, or a blocking one is dropped from the message; why_new=the go-online error used to say only "a document was rejected" for
// an expired insurance, and the admin profile showed that document as approved; seam=none (pure rules);
// no_claim=that these rules match the SQL gate (tests/integration/doc-issues-vs-gate.test.ts does that against a database).

const row = (doc_type: string, status: string, over: Partial<DocRow> = {}): DocRow => ({ doc_type, status, rejection_note: null, verified_valid_until: null, ...over })
const TODAY = '2026-11-15'

const GOOD_IDENTITY = ['profile_photo', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back'].map((t) => row(t, 'approved'))

describe('classifyDocIssues', () => {
  it('reports nothing for a driver whose documents are all approved and valid', () => {
    const vehicle = [row('vehicle_rc_front', 'approved'), row('vehicle_rc_back', 'approved'), row('insurance', 'approved', { verified_valid_until: '2027-03-01' }), row('permit', 'approved', { verified_valid_until: '2029-11-12' })]
    expect(classifyDocIssues({ identity: GOOD_IDENTITY, vehicle, today: TODAY })).toEqual([])
  })

  it('names an expired insurance and an expired pollution certificate (the real DRV000329 case), not "rejected"', () => {
    const vehicle = [
      row('vehicle_rc_front', 'approved'), row('vehicle_rc_back', 'approved'),
      row('insurance', 'approved', { verified_valid_until: '2026-10-30' }),
      row('permit', 'approved', { verified_valid_until: '2029-11-12' }),
      row('pollution_cert', 'approved', { verified_valid_until: '2026-11-07' }),
      row('fitness_cert', 'approved', { verified_valid_until: '2028-11-11' }),
    ]
    const issues = classifyDocIssues({ identity: GOOD_IDENTITY, vehicle, today: TODAY })
    expect(issues.map((i) => [i.doc_type, i.reason, i.valid_until])).toEqual([
      ['insurance', 'expired', '2026-10-30'],
      ['pollution_cert', 'expired', '2026-11-07'],
    ])
    expect(issues[0]!.message).toBe('Insurance expired on 30 Oct 2026. Upload a renewed copy.')
    expect(issues.map((i) => i.short)).toEqual(['Insurance expired on 30 Oct 2026', 'Pollution certificate (PUC) expired on 7 Nov 2026'])
    expect(summarizeDocIssues(issues)).toBe("You can't go online yet: Insurance expired on 30 Oct 2026; Pollution certificate (PUC) expired on 7 Nov 2026. Fix this in Documents.")
  })

  it('a document valid until today is still valid; one with no expiry never expires', () => {
    const vehicle = [row('insurance', 'approved', { verified_valid_until: TODAY }), row('permit', 'approved', { verified_valid_until: null })]
    expect(classifyDocIssues({ identity: GOOD_IDENTITY, vehicle, today: TODAY })).toEqual([])
  })

  it('reports a rejected document with the reviewer note, and without one', () => {
    const identity = [...GOOD_IDENTITY.slice(1), row('profile_photo', 'rejected', { rejection_note: 'Face not visible' })]
    const [withNote] = classifyDocIssues({ identity, vehicle: null, today: TODAY })
    expect(withNote).toMatchObject({ scope: 'identity', doc_type: 'profile_photo', reason: 'rejected', note: 'Face not visible', message: 'Profile photo was rejected: Face not visible' })
    const [noNote] = classifyDocIssues({ identity: [row('aadhaar_back', 'rejected')], vehicle: null, today: TODAY })
    expect(noNote!.message).toBe('Aadhaar (back) was rejected. Upload it again.')
  })

  it('a REQUIRED document still waiting for review blocks; an optional one does not', () => {
    expect(classifyDocIssues({ identity: [], vehicle: [row('insurance', 'pending')], today: TODAY }).map((i) => [i.doc_type, i.reason])).toEqual([['insurance', 'pending_review']])
    expect(classifyDocIssues({ identity: [], vehicle: [row('pollution_cert', 'pending'), row('fitness_cert', 'pending')], today: TODAY })).toEqual([])
  })

  it('an RC front with no RC back is reported as the back being missing', () => {
    const issues = classifyDocIssues({ identity: [], vehicle: [row('vehicle_rc_front', 'approved')], today: TODAY })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ scope: 'vehicle', doc_type: 'vehicle_rc_back', reason: 'missing_back', message: 'RC book (back) is missing. Upload it.' })
  })

  it('a driver with no primary vehicle has no vehicle issues', () => {
    expect(classifyDocIssues({ identity: GOOD_IDENTITY, vehicle: null, today: TODAY })).toEqual([])
  })

  it('a rejected optional vehicle document still blocks (any rejected row does)', () => {
    expect(classifyDocIssues({ identity: [], vehicle: [row('fitness_cert', 'rejected')], today: TODAY }).map((i) => i.reason)).toEqual(['rejected'])
  })
})

describe('formatting', () => {
  it('formats a date from its parts, so no timezone can move the day', () => {
    expect(formatDocDate('2026-11-07')).toBe('7 Nov 2026')
    expect(formatDocDate('2026-12-31')).toBe('31 Dec 2026')
  })
  it('falls back to a readable name for a document type it does not know', () => {
    expect(docLabel('fire_extinguisher_cert')).toBe('Fire extinguisher cert')
  })
  it('summarizes nothing as an empty string', () => {
    expect(summarizeDocIssues([])).toBe('')
  })
})
