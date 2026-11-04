import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))

import { pool } from '@/db/client'
import { getRideById } from '@/modules/rides/rides.repository'
import { CASH_DUE_MIN_DRIVER_VERSION } from '@/constants/limits'
import { compareVersions } from '@/modules/app-version/app-version.policy'

// The driver ride payload carries cash_due and discount_amount so the app shows the amount to collect and, once
// offers exist, why it is lower. Value: protects=the driver card never loses the fields it renders; fails_when=the
// aliases are dropped from the shared ride SELECT; why_new=no test pinned the select-list; seam=none;
// no_claim=real column values (mocked pool; the SQL text is what is asserted).
describe('ride select exposes cash_due and discount_amount', () => {
  beforeEach(() => vi.clearAllMocks())

  it('selects cash_due as the payable (settled fare, else the estimate, less the discount) and the stored discount', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as never)
    await getRideById(1n)
    const sql = String(vi.mocked(pool.query).mock.calls[0]?.[0])
    expect(sql).toMatch(/ocar_payable\(COALESCE\(fs\.total_final, fs\.total_estimated\), fs\.discount_amount\) AS cash_due/)
    expect(sql).toMatch(/fs\.discount_amount,/)
  })
})

describe('CASH_DUE_MIN_DRIVER_VERSION', () => {
  it('is a valid semver and is not older than the build that first shipped cash_due', () => {
    const cmp = compareVersions(CASH_DUE_MIN_DRIVER_VERSION, '1.2.0')
    expect(cmp).not.toBeNull()
    expect(cmp as number).toBeGreaterThanOrEqual(0)
  })
})
