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

  const cases: Array<[string, string, string]> = [
    ['zone-less start', '2026-11-19T07:26', '2026-11-20T01:56:00Z'],
    ['zone-less end', '2026-11-19T01:56:00Z', '2026-11-20T07:26'],
    ['garbage', 'tomorrow', 'later'],
    ['end not after start', '2026-11-20T01:56:00Z', '2026-11-19T01:56:00Z'],
    ['window already ended', '2026-01-01T01:00:00Z', '2026-01-01T05:00:00Z'],
  ]
  it.each(cases)('rejects %s', async (_n, startsAt, endsAt) => {
    await expect(createAdminSurgeEvent({ ...base, startsAt, endsAt })).rejects.toMatchObject({ httpStatus: 422, appCode: 'VALIDATION_ERROR' })
    expect(repo.createAdminSurgeEvent).not.toHaveBeenCalled()
  })

  it('stores an IST offset as the same UTC instant', async () => {
    await createAdminSurgeEvent({ ...base, startsAt: '2099-11-19T07:26:00+05:30', endsAt: '2099-11-20T07:26:00+05:30' })
    expect(repo.createAdminSurgeEvent.mock.calls[0]![0]).toMatchObject({ startsAt: '2099-11-19T01:56:00.000Z', endsAt: '2099-11-20T01:56:00.000Z' })
  })

  it('accepts an all-cities surge (null city) and rejects a non-integer city', async () => {
    await createAdminSurgeEvent({ ...base, cityId: null, startsAt: '2099-11-19T01:56:00Z', endsAt: '2099-11-20T01:56:00Z' })
    expect(repo.createAdminSurgeEvent.mock.calls[0]![0]).toMatchObject({ cityId: null })
    await expect(createAdminSurgeEvent({ ...base, cityId: Number.NaN, startsAt: '2099-11-19T01:56:00Z', endsAt: '2099-11-20T01:56:00Z' }))
      .rejects.toMatchObject({ httpStatus: 422 })
  })

  it.each([[0, null], [-5, null], [1.5, null], [1, 0], [1, Number.NaN]])('rejects city %s / category %s', async (cityId, categoryId) => {
    await expect(createAdminSurgeEvent({ ...base, cityId, categoryId, startsAt: '2099-11-19T01:56:00Z', endsAt: '2099-11-20T01:56:00Z' }))
      .rejects.toMatchObject({ httpStatus: 422 })
  })
})
