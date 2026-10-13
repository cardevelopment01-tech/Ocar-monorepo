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
})
