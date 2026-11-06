import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

// Value: protects=who may create a share and when, that only the hash of a link is stored, that SMS trouble never costs the
// share, that an SOS link is never refused, and that a revoked link dies on the next poll even while the trip is cached;
// fails_when=an ownership/status/cap rule slips, the raw token is stored, the token lookup gets cached, or a preview bot counts
// as a viewer; why_new=new feature; seam=mocked repository, Redis, SMS and routing; no_claim=the SQL (see the integration test).
const h = vi.hoisted(() => ({
  repo: {
    getRideForShare: vi.fn(), insertShare: vi.fn(), insertShares: vi.fn(), listActive: vi.fn(), revokeOne: vi.fn(), revokeAll: vi.fn(),
    findByTokenHash: vi.fn(), recordView: vi.fn(), getRiderFirstName: vi.fn(), getPublicTripRow: vi.fn(), getPublicStops: vi.fn(),
  },
  redis: { get: vi.fn(), set: vi.fn() },
  getConfigValue: vi.fn(),
  getRoute: vi.fn(),
  contacts: { list: vi.fn() },
  notif: { logNotification: vi.fn(), markSent: vi.fn(), markFailed: vi.fn() },
  renderTemplate: vi.fn(),
  sendSms: vi.fn(),
}))
vi.mock('@/config', () => ({ config: { USER_APP_URL: 'https://ocarindia.com' } }))
vi.mock('@/db/redis', () => ({ client: h.redis }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: h.getConfigValue }))
vi.mock('@/modules/geo/geo.service', () => ({ getRoute: h.getRoute }))
vi.mock('@/modules/emergency-contacts/emergency-contacts.repository', () => h.contacts)
vi.mock('@/modules/notifications/notifications.service', () => h.notif)
vi.mock('@/modules/notifications/templates.service', () => ({ renderTemplate: h.renderTemplate }))
vi.mock('@/providers/sms.provider', () => ({ sendSms: h.sendSms }))
vi.mock('@/modules/ride-shares/ride-shares.repository', () => h.repo)

import { SHARE_CAPS, createShares, createSosShare, getPublicTrip, stopShare } from '@/modules/ride-shares/ride-shares.service'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const tokenOf = (url: string) => url.split('/t/')[1]!
const NOW = new Date('2026-11-06T10:00:00Z')
const tripRow = (over: Record<string, unknown> = {}) => ({
  status: 'in_progress', origin_lat: 20.35, origin_lng: 85.82, origin_address: 'A', destination_lat: 20.24, destination_lng: 85.81, destination_address: 'B',
  completed_at: null, cancelled_at: null, rider_first_name: 'Rahul', driver_first_name: 'Suresh',
  vehicle_color: 'White', vehicle_brand: 'Maruti', vehicle_model: 'Dzire', vehicle_plate: 'OD02AB1234',
  driver_lat: 20.3, driver_lng: 85.8, driver_heading: 90, driver_updated_at: new Date(NOW.getTime() - 3_000), ...over,
})
const share = (over: Record<string, unknown> = {}) => ({
  id: '5', ride_id: '16', is_sos: false, created_at: new Date(NOW.getTime() - 60_000), revoked_at: null,
  status: 'in_progress', completed_at: null, cancelled_at: null, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.getConfigValue.mockResolvedValue('true')
  h.repo.getRideForShare.mockResolvedValue({ id: '16', user_id: '4', status: 'in_progress' })
  h.repo.insertShare.mockResolvedValue({ result: 'created', id: '5' })
  h.repo.insertShares.mockImplementation(async (inputs: unknown[]) => ({ result: 'created', ids: inputs.map((_, i) => String(5 + i)) }))
  h.repo.getRiderFirstName.mockResolvedValue('Asha')
  h.contacts.list.mockResolvedValue([{ id: '1', name: 'Mum', phone: '+919811111111' }, { id: '2', name: 'Dad', phone: '+919822222222' }])
  h.notif.logNotification.mockResolvedValue(9)
  h.renderTemplate.mockResolvedValue({ body: 'sms body' })
  h.sendSms.mockResolvedValue(undefined)
  h.redis.get.mockResolvedValue(null)
  h.redis.set.mockResolvedValue('OK')
  h.repo.getPublicTripRow.mockResolvedValue(tripRow())
  h.repo.getPublicStops.mockResolvedValue([])
  h.repo.findByTokenHash.mockResolvedValue(share())
  h.repo.recordView.mockResolvedValue(undefined)
  h.getRoute.mockResolvedValue({ source: 'google', durationMin: 6.4, polyline: 'poly' })
})

describe('createShares', () => {
  it('is refused while the kill switch is off', async () => {
    h.getConfigValue.mockResolvedValue('false')
    await expect(createShares(4n, 16n)).rejects.toMatchObject({ httpStatus: 403, appCode: 'TRIP_SHARE_DISABLED' })
    expect(h.repo.insertShare).not.toHaveBeenCalled()
  })

  it('is refused for a ride that is not the caller\'s, and for one without a driver or already over', async () => {
    h.repo.getRideForShare.mockResolvedValueOnce({ id: '16', user_id: '99', status: 'in_progress' })
    await expect(createShares(4n, 16n)).rejects.toMatchObject({ httpStatus: 404 })
    h.repo.getRideForShare.mockResolvedValueOnce(null)
    await expect(createShares(4n, 16n)).rejects.toMatchObject({ httpStatus: 404 })
    for (const status of ['requested', 'completed', 'cancelled', 'no_drivers']) {
      h.repo.getRideForShare.mockResolvedValueOnce({ id: '16', user_id: '4', status })
      await expect(createShares(4n, 16n)).rejects.toMatchObject({ httpStatus: 409, appCode: 'RIDE_NOT_SHAREABLE' })
    }
  })

  it('creates one anonymous link: the URL carries the token, only its SHA-256 is stored, and the caps are applied', async () => {
    const [created] = await createShares(4n, 16n)
    expect(created!.url).toMatch(/^https:\/\/ocarindia\.com\/t\/[A-Za-z0-9_-]{22}$/)
    const token = tokenOf(created!.url)
    const input = h.repo.insertShares.mock.calls[0]![0][0]
    expect(input.tokenHash).toBe(sha(token))
    expect(JSON.stringify(input, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(token)
    expect(input).toMatchObject({ label: null, phone: null, isSos: false })
    expect(h.repo.insertShares.mock.calls[0]![1]).toEqual(SHARE_CAPS)
    expect(h.sendSms).not.toHaveBeenCalled()
  })

  it('maps a cap refusal to 429', async () => {
    h.repo.insertShares.mockResolvedValueOnce({ result: 'limit_ride' })
    await expect(createShares(4n, 16n)).rejects.toMatchObject({ httpStatus: 429, appCode: 'TRIP_SHARE_LIMIT' })
    h.repo.insertShares.mockResolvedValueOnce({ result: 'limit_hour' })
    await expect(createShares(4n, 16n)).rejects.toMatchObject({ httpStatus: 429, appCode: 'TRIP_SHARE_LIMIT' })
  })

  it('creates one link per chosen contact and texts each; a contact that is not the rider\'s is refused', async () => {
    const out = await createShares(4n, 16n, ['1', '2'])
    expect(out.map((s) => [s.label, s.sms])).toEqual([['Mum', 'sent'], ['Dad', 'sent']])
    expect(h.sendSms.mock.calls.map((c) => c[0]).sort()).toEqual(['+919811111111', '+919822222222'])
    expect(h.repo.insertShares).toHaveBeenCalledTimes(1) // both links in ONE all-or-none insert
    expect(h.renderTemplate).toHaveBeenCalledWith('trip_share', 'sms', { riderName: 'Asha', trackUrl: expect.stringContaining('/t/') })
    await expect(createShares(4n, 16n, ['1', '777'])).rejects.toMatchObject({ httpStatus: 422 })
  })

  it('a failed SMS (vendor down, template not approved) never fails the share: the link is returned with sms "failed"', async () => {
    h.renderTemplate.mockRejectedValueOnce(new Error('template inactive'))
    const [created] = await createShares(4n, 16n, ['1'])
    expect(created).toMatchObject({ label: 'Mum', sms: 'failed' })
    expect(created!.url).toContain('/t/')
    expect(h.notif.markFailed).toHaveBeenCalledWith(9, 'template inactive')
  })
})

describe('createShares for several contacts', () => {
  it('is all or none: if the list does not fit the caps nobody is texted', async () => {
    h.repo.insertShares.mockResolvedValueOnce({ result: 'limit_ride' })
    await expect(createShares(4n, 16n, ['1', '2'])).rejects.toMatchObject({ httpStatus: 429 })
    expect(h.sendSms).not.toHaveBeenCalled()
  })

  it('texts the contacts together, so a slow SMS vendor costs the slowest text, not the sum', async () => {
    let inFlight = 0
    let peak = 0
    h.sendSms.mockImplementation(async () => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight-- })
    await createShares(4n, 16n, ['1', '2'])
    expect(peak).toBe(2)
  })
})

describe('createSosShare', () => {
  it('returns null (static-pin fallback) when the switch is off, the ride is not the rider\'s, or anything throws', async () => {
    h.getConfigValue.mockResolvedValueOnce('false')
    expect(await createSosShare(16n, 4n)).toBeNull()
    h.repo.getRideForShare.mockResolvedValueOnce({ id: '16', user_id: '99', status: 'in_progress' })
    expect(await createSosShare(16n, 4n)).toBeNull()
    h.repo.insertShare.mockRejectedValueOnce(new Error('db down'))
    expect(await createSosShare(16n, 4n)).toBeNull()
  })

  it('creates an SOS-flagged link that no cap can refuse', async () => {
    const url = await createSosShare(16n, 4n)
    expect(url).toMatch(/\/t\/[A-Za-z0-9_-]{22}$/)
    const [input, caps] = h.repo.insertShare.mock.calls[0]!
    expect(input).toMatchObject({ label: 'SOS', isSos: true, tokenHash: sha(tokenOf(url!)) })
    expect(caps).toBeUndefined()
  })
})

describe('getPublicTrip', () => {
  it('unknown and revoked links are the same "missing"', async () => {
    h.repo.findByTokenHash.mockResolvedValueOnce(null)
    expect(await getPublicTrip('x'.repeat(22), { now: NOW })).toEqual({ kind: 'missing' })
    h.repo.findByTokenHash.mockResolvedValueOnce(share({ revoked_at: new Date() }))
    expect(await getPublicTrip('x'.repeat(22), { now: NOW })).toEqual({ kind: 'missing' })
  })

  it('looks the link up by the SHA-256 of the token, never by the token', async () => {
    await getPublicTrip('abcdefghijklmnopqrstuv', { now: NOW })
    expect(h.repo.findByTokenHash).toHaveBeenCalledWith(sha('abcdefghijklmnopqrstuv'))
  })

  it('a link past the 30-minute grace is "expired"; inside it the page still answers with the completed trip', async () => {
    h.repo.findByTokenHash.mockResolvedValueOnce(share({ status: 'completed', completed_at: new Date(NOW.getTime() - 31 * 60_000) }))
    expect(await getPublicTrip('x'.repeat(22), { now: NOW })).toEqual({ kind: 'expired' })
    h.repo.findByTokenHash.mockResolvedValueOnce(share({ status: 'completed', completed_at: new Date(NOW.getTime() - 5 * 60_000) }))
    h.repo.getPublicTripRow.mockResolvedValueOnce(tripRow({ status: 'completed', completed_at: new Date(NOW.getTime() - 5 * 60_000) }))
    const res = await getPublicTrip('x'.repeat(22), { now: NOW })
    expect(res).toMatchObject({ kind: 'ok', trip: { phase: 'completed', driver: null } })
  })

  it('serves the trip with the share\'s own SOS flag and routes the ETA once per ride per minute', async () => {
    h.repo.findByTokenHash.mockResolvedValue(share({ is_sos: true }))
    const res = await getPublicTrip('x'.repeat(22), { now: NOW })
    expect(res).toMatchObject({ kind: 'ok', trip: { phase: 'in_trip', isSos: true, etaMin: 6, route: 'poly' } })
    expect(h.getRoute).toHaveBeenCalledTimes(1)
    expect(h.redis.set).toHaveBeenCalledWith('share:eta:16:in_trip', expect.any(String), 'EX', 60)
    // a cached ETA means no second routed call
    h.redis.get.mockImplementation(async (k: string) => (k.startsWith('share:eta:') ? JSON.stringify({ etaMin: 9, route: 'cached', at: NOW.getTime() }) : null))
    h.getRoute.mockClear()
    const again = await getPublicTrip('x'.repeat(22), { now: NOW })
    expect(again).toMatchObject({ kind: 'ok', trip: { etaMin: 9, route: 'cached' } })
    expect(h.getRoute).not.toHaveBeenCalled()
  })

  it('counts a cached ETA down as it ages, so the arrival time the page works out stays steady', async () => {
    const routedAt = NOW.getTime() - 3 * 60_000 // routed 3 minutes ago (the cache entry would normally have expired; the arithmetic is what matters)
    h.redis.get.mockImplementation(async (k: string) => (k.startsWith('share:eta:') ? JSON.stringify({ etaMin: 12, route: 'cached', at: routedAt }) : null))
    const res = await getPublicTrip('x'.repeat(22), { now: NOW })
    expect(res).toMatchObject({ kind: 'ok', trip: { etaMin: 9, route: 'cached' } })
    h.redis.get.mockImplementation(async (k: string) => (k.startsWith('share:eta:') ? JSON.stringify({ etaMin: 2, route: 'cached', at: routedAt }) : null))
    expect(await getPublicTrip('x'.repeat(22), { now: NOW })).toMatchObject({ trip: { etaMin: 1 } }) // never below a minute
  })

  it('a revoked link is refused on the very next poll even while the trip itself is cached', async () => {
    h.redis.get.mockImplementation(async (k: string) => (k === 'share:trip:16' ? JSON.stringify({ phase: 'in_trip' }) : null))
    expect((await getPublicTrip('x'.repeat(22), { now: NOW })).kind).toBe('ok')
    h.repo.findByTokenHash.mockResolvedValueOnce(share({ revoked_at: new Date() }))
    expect(await getPublicTrip('x'.repeat(22), { now: NOW })).toEqual({ kind: 'missing' })
    expect(h.repo.getPublicTripRow).not.toHaveBeenCalled() // served from the cache while valid; the lookup is what gates it
  })

  it('counts a view for a person but not for a link-preview bot', async () => {
    await getPublicTrip('x'.repeat(22), { now: NOW })
    expect(h.repo.recordView).toHaveBeenCalledWith('5')
    h.repo.recordView.mockClear()
    await getPublicTrip('x'.repeat(22), { now: NOW, countView: false })
    expect(h.repo.recordView).not.toHaveBeenCalled()
  })

  it('still answers when Google routing is unavailable: no ETA, no route, never an error', async () => {
    h.getRoute.mockRejectedValueOnce(new Error('quota'))
    const res = await getPublicTrip('x'.repeat(22), { now: NOW })
    expect(res).toMatchObject({ kind: 'ok', trip: { etaMin: null, route: null } })
  })
})

describe('stopShare', () => {
  it('404s a link that is not the rider\'s or already stopped', async () => {
    h.repo.revokeOne.mockResolvedValueOnce(false)
    await expect(stopShare(4n, 16n, 5n)).rejects.toMatchObject({ httpStatus: 404 })
    h.repo.revokeOne.mockResolvedValueOnce(true)
    await expect(stopShare(4n, 16n, 5n)).resolves.toBeUndefined()
  })
})
