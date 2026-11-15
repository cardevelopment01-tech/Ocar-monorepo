import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  getActiveSession: vi.fn(), createSession: vi.fn(), upsertDriverLocation: vi.fn(),
  endSession: vi.fn(), setDriverAvailability: vi.fn(),
}))
vi.mock('@/modules/drivers/driver-verification.service', () => ({ getBlockingChallenge: vi.fn().mockResolvedValue(null) }))
vi.mock('@/modules/drivers/driver-verification.repository', () => ({ getTodayStatus: vi.fn() }))
// The SQL gate decides; the issue list only words the refusal. Real rules and wording; only the two database reads are replaced.
vi.mock('@/modules/drivers/drivers.repository', () => ({ hasApprovedRequiredDocs: vi.fn() }))
vi.mock('@/modules/drivers/doc-issues', async (importActual) => ({
  ...(await importActual<typeof import('@/modules/drivers/doc-issues')>()),
  findDocIssues: vi.fn(),
}))
vi.mock('@/modules/payments/payments.service', () => ({
  getDriverWallet: vi.fn(), getMinWalletBalance: vi.fn(), createPaymentRecord: vi.fn(), deductCommission: vi.fn(),
  creditCashback: vi.fn(), confirmRidePayment: vi.fn(), payFromUserWallet: vi.fn(), createRidePaymentOrder: vi.fn(),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { sendAdminDriverUpdate: vi.fn(), sendRideStatusUpdate: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/jobs/queues', () => ({
  queues: { notifications: { add: vi.fn() }, dispatch: { add: vi.fn() } },
  QUEUE_NAMES: { NOTIFICATIONS: 'notifications', DISPATCH: 'dispatch' },
}))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn().mockResolvedValue('1') }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import * as repo from '@/modules/rides/rides.repository'
import { getTodayStatus } from '@/modules/drivers/driver-verification.repository'
import { hasApprovedRequiredDocs } from '@/modules/drivers/drivers.repository'
import { findDocIssues, classifyDocIssues } from '@/modules/drivers/doc-issues'
import { pool } from '@/db/client'
import { goOnline } from '@/modules/rides/rides.service'

// Value: protects=a driver the SQL gate refuses is told exactly which documents block them and why (and the error carries the same
// list), under the unchanged DRIVER_DOCS_REJECTED code; and the refusal is still decided by the SQL gate alone (the list never lets a
// driver in or keeps one out); fails_when=the message goes back to a generic "document was rejected", the list is dropped, a session is
// created for a refused driver, or the list is consulted when the gate says yes; why_new=an expired insurance and pollution certificate
// were reported as "a document was rejected"; seam=hasApprovedRequiredDocs and findDocIssues (the database reads) are replaced, the rules and
// wording are real; no_claim=the SQL rules, and that the error body reaches the client (tests/integration/doc-issues-vs-gate.test.ts).

const PARAMS = () => ({ mode: 'standard' as const, vehicleId: BigInt(1), categoryId: BigInt(2), lat: 20.29, lng: 85.82 })
const row = (doc_type: string, status: string, valid: string | null) => ({ doc_type, status, rejection_note: null, verified_valid_until: valid })
type AppError = Error & { httpStatus: number; appCode: string; details: { issues: unknown[] } }

describe('goOnline - the document gate names the blocking documents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTodayStatus).mockResolvedValue({ selfieDone: true, plateDone: true } as never)
  })

  it('refuses with 403 DRIVER_DOCS_REJECTED, names the expired insurance and pollution certificate, and creates no session', async () => {
    const issues = classifyDocIssues({
      identity: [],
      vehicle: [row('insurance', 'approved', '2026-10-30'), row('pollution_cert', 'approved', '2026-11-07'), row('permit', 'approved', '2029-11-12')],
      today: '2026-11-15',
    })
    vi.mocked(hasApprovedRequiredDocs).mockResolvedValue(false)
    vi.mocked(findDocIssues).mockResolvedValue(issues)

    const err = await goOnline(BigInt(329), PARAMS()).catch((e: unknown) => e) as AppError
    expect(err.httpStatus).toBe(403)
    expect(err.appCode).toBe('DRIVER_DOCS_REJECTED')
    expect(err.message).toContain('Insurance expired on 30 Oct 2026')
    expect(err.message).toContain('Pollution certificate (PUC) expired on 7 Nov 2026')
    expect(err.message).not.toMatch(/rejected/i)
    expect(err.details.issues).toEqual(issues)
    expect(repo.createSession).not.toHaveBeenCalled()
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('still refuses with the old message when the gate says no but the list finds nothing (the two never get to disagree silently)', async () => {
    vi.mocked(hasApprovedRequiredDocs).mockResolvedValue(false)
    vi.mocked(findDocIssues).mockResolvedValue([])

    const err = await goOnline(BigInt(329), PARAMS()).catch((e: unknown) => e) as AppError
    expect(err.httpStatus).toBe(403)
    expect(err.appCode).toBe('DRIVER_DOCS_REJECTED')
    expect(err.message).toMatch(/documents was rejected, has expired or is awaiting review/)
    expect(err.details.issues).toEqual([])
    expect(repo.createSession).not.toHaveBeenCalled()
  })

  it('does not ask for the list at all when the gate lets the driver through', async () => {
    vi.mocked(hasApprovedRequiredDocs).mockResolvedValue(true)
    await goOnline(BigInt(329), PARAMS()).catch(() => undefined) // later steps are not mocked; only the document gate matters here
    expect(hasApprovedRequiredDocs).toHaveBeenCalledOnce()
    expect(findDocIssues).not.toHaveBeenCalled()
  })
})
