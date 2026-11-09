import { describe, it, expect, vi } from 'vitest'

// Value: protects=old live-trip links (and any contact phone numbers kept with them) are deleted by the purge job;
// fails_when=the job stops calling the delete or is not registered in the maintenance worker; why_new=new table;
// seam=repository mocked; no_claim=the SQL retention rule itself (integration).
const purgeOld = vi.hoisted(() => vi.fn().mockResolvedValue(3))
vi.mock('@/modules/ride-shares/ride-shares.repository', () => ({ purgeOld }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

import { processPurgeRideShares } from '@/jobs/processors/ride-shares-purge.processor'

describe('processPurgeRideShares', () => {
  it('asks the repository to purge and does not throw', async () => {
    await expect(processPurgeRideShares()).resolves.toBeUndefined()
    expect(purgeOld).toHaveBeenCalledTimes(1)
  })
})
