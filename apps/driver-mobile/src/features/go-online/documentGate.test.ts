import { describe, it, expect, vi, beforeEach } from 'vitest'

const sharedGet = vi.fn()
vi.mock('@/services/api/sharedGet', () => ({ sharedGet: (...a: unknown[]) => sharedGet(...a) }))
vi.mock('@/services/api', () => ({ api: {} }))
vi.mock('@ocar/mobile-shared', () => ({ camelizeKeys: (x: unknown) => x }))

import { fetchDocumentGateStatus } from './api'

const status = (back: { status: string; uploaded?: boolean } | null) => ({
  photos: {},
  vehicle_docs: back ? { vehicle_rc_back: { rejection_note: 'note', ...back } } : {},
  rejection_reason: null,
})

describe('fetchDocumentGateStatus', () => {
  beforeEach(() => sharedGet.mockReset())

  it('shares one request between concurrent callers, then fetches fresh', async () => {
    sharedGet.mockResolvedValue(status(null))
    await Promise.all([fetchDocumentGateStatus(), fetchDocumentGateStatus()])
    expect(sharedGet).toHaveBeenCalledTimes(1)
    await fetchDocumentGateStatus()
    expect(sharedGet).toHaveBeenCalledTimes(2)
  })

  it('flags a never-uploaded doc as missing, a reviewed rejection as rejected', async () => {
    sharedGet.mockResolvedValueOnce(status({ status: 'rejected', uploaded: false }))
    expect(await fetchDocumentGateStatus()).toMatchObject({ hasRejected: true, isMissingUpload: true })
    sharedGet.mockResolvedValueOnce(status({ status: 'rejected', uploaded: true }))
    expect(await fetchDocumentGateStatus()).toMatchObject({ hasRejected: true, isMissingUpload: false })
    sharedGet.mockResolvedValueOnce(status({ status: 'rejected' }))
    expect(await fetchDocumentGateStatus()).toMatchObject({ isMissingUpload: false })
  })
  it('uses the server list of blocking documents: expired ones block, are named with their dates, and are not called rejected', async () => {
    const issue = (doc_type: string, label: string, valid: string, short: string) => ({ scope: 'vehicle', doc_type, label, reason: 'expired', valid_until: valid, note: null, short, message: short + '.' })
    sharedGet.mockResolvedValueOnce({
      photos: {}, vehicle_docs: { insurance: { status: 'approved', rejection_note: null } }, rejection_reason: null,
      doc_issues: [issue('insurance', 'Insurance', '2026-10-30', 'Insurance expired on 30 Oct 2026'), issue('pollution_cert', 'Pollution certificate (PUC)', '2026-11-07', 'Pollution certificate (PUC) expired on 7 Nov 2026')],
    })
    const out = await fetchDocumentGateStatus()
    expect(out).toMatchObject({ hasRejected: true, isMissingUpload: false, title: 'Documents expired', rejectionReason: 'Insurance expired on 30 Oct 2026; Pollution certificate (PUC) expired on 7 Nov 2026' })
    expect(out.issues).toHaveLength(2)
  })

  it('an older server without doc_issues keeps the old behaviour (no title, no issues)', async () => {
    sharedGet.mockResolvedValueOnce(status({ status: 'rejected', uploaded: true }))
    expect(await fetchDocumentGateStatus()).toMatchObject({ hasRejected: true, title: null, issues: [] })
  })
})
