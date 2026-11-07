import api from './api'

export type VerificationDecision = 'pass' | 'review' | 'fail' | 'retake' | 'error' | 'skipped'

export type ReviewListItem = {
  id: string
  driverId: string
  driverName: string | null
  driverPhone: string
  kind: string
  decision: VerificationDecision | null
  decisionReason: string | null
  similarity: number | null
  ocrText: string | null
  priority: number
  reviewState: string
  createdAt: string
}

export type ReviewCase = ReviewListItem & {
  imageUrl: string
  status: string
  registeredPlate: string | null
  referenceUrls: string[]
  history: Array<{
    id: string
    createdAt: string
    decision: VerificationDecision | null
    similarity: number | null
    reviewState: string
    status: string
  }>
}

const BASE = '/api/v1/admin/verifications'

export const verificationApi = {
  list: (state: 'queued' | 'resolved_today') =>
    api.get<{ items: ReviewListItem[]; budget: number }>(BASE, { params: { state } }).then((r) => r.data),
  get: (id: string) => api.get<{ case: ReviewCase }>(`${BASE}/${id}`).then((r) => r.data.case),
  resolve: (id: string, body: { outcome: 'ok' | 'mismatch'; note?: string; add_reference?: boolean }) =>
    api.post<{ ok: true }>(`${BASE}/${id}/resolve`, body).then((r) => r.data),
}
