import { describe, it, expect, vi, beforeEach } from 'vitest'

const repo = vi.hoisted(() => ({ createAdminSurgeEvent: vi.fn() }))
vi.mock('@/modules/admin/admin.repository', () => repo)
vi.mock('@/config', () => ({ config: { NODE_ENV: 'test' } }))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }), warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { createAdminSurgeEvent } from '@/modules/admin/admin.service'

const base = { cityId: 1, categoryId: null, multiplier: 1.5, reason: null, adminId: 1 }

// Value: protects=a surge window entered in IST is stored as that exact instant, not shifted by 5h30;
// fails_when=a zone-less time ("2026-11-19T07:26") is accepted again (the DB reads it as UTC); why_new=prod surge 8/9 showed 12:56/13:05 for 07:26/07:35.
describe('createAdminSurgeEvent time zone', () => {
  beforeEach(() => { repo.createAdminSurgeEvent.mockReset().mockResolvedValue({ id: 1 }) })

  it('rejects a time without a zone', async () => {
    await expect(createAdminSurgeEvent({ ...base, startsAt: '2026-11-19T07:26', endsAt: '2026-11-20T07:26' })).rejects.toBeTruthy()
    expect(repo.createAdminSurgeEvent).not.toHaveBeenCalled()
  })

  it('accepts an absolute instant', async () => {
    await createAdminSurgeEvent({ ...base, startsAt: '2026-11-19T01:56:00.000Z', endsAt: '2026-11-20T01:56:00+00:00' })
    expect(repo.createAdminSurgeEvent).toHaveBeenCalledOnce()
  })
})
