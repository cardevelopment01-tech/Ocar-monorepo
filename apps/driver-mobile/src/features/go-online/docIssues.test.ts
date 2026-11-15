import { describe, it, expect } from 'vitest'
import { describeDocIssues, formatDocDate, type DocIssue } from './docIssues'

// Value: protects=the banner on Home says which documents block going online and why (expired, rejected, waiting, missing), instead of
// "a document was rejected" for every case; fails_when=an expired document is titled "rejected", or a blocking document is left out of the
// message; why_new=an expired insurance and pollution certificate were shown to the driver as a rejection; seam=none (pure);
// no_claim=how the server decides what blocks (api tests).

const issue = (doc_type: string, label: string, reason: DocIssue['reason'], short: string): DocIssue =>
  ({ scope: 'vehicle', doc_type, label, reason, valid_until: null, note: null, short, message: `${short}.` })

describe('describeDocIssues', () => {
  it('names every expired document, with the date, under an "expired" title', () => {
    const out = describeDocIssues([
      issue('insurance', 'Insurance', 'expired', 'Insurance expired on 30 Oct 2026'),
      issue('pollution_cert', 'Pollution certificate (PUC)', 'expired', 'Pollution certificate (PUC) expired on 7 Nov 2026'),
    ])
    expect(out).toEqual({ title: 'Documents expired', message: 'Insurance expired on 30 Oct 2026; Pollution certificate (PUC) expired on 7 Nov 2026' })
  })

  it('uses the singular for one document, and a title for each single reason', () => {
    expect(describeDocIssues([issue('insurance', 'Insurance', 'expired', 'Insurance expired on 30 Oct 2026')]).title).toBe('Document expired')
    expect(describeDocIssues([issue('permit', 'Permit', 'rejected', 'Permit rejected')]).title).toBe('Document rejected')
    expect(describeDocIssues([issue('permit', 'Permit', 'pending_review', 'Permit waiting for review')]).title).toBe('Waiting for review')
    expect(describeDocIssues([issue('vehicle_rc_back', 'RC book (back)', 'missing_back', 'RC book (back) missing')]).title).toBe('Action needed')
  })

  it('uses a general title when the reasons differ', () => {
    const out = describeDocIssues([issue('insurance', 'Insurance', 'expired', 'Insurance expired on 30 Oct 2026'), issue('permit', 'Permit', 'rejected', 'Permit rejected')])
    expect(out.title).toBe('Documents need attention')
    expect(out.message).toBe('Insurance expired on 30 Oct 2026; Permit rejected')
  })
})

describe('formatDocDate', () => {
  it('formats a date from its parts', () => {
    expect(formatDocDate('2026-10-30')).toBe('30 Oct 2026')
    expect(formatDocDate('2026-11-07')).toBe('7 Nov 2026')
  })
  it('returns an empty string for no date', () => {
    expect(formatDocDate(null)).toBe('')
  })
})
