import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// Value: protects=the public endpoint's answers (404 for unknown/malformed/revoked, 410 for expired, no-store), that only
// wrong lookups are marked as misses for the strict limiter, and that link-preview bots are not counted as viewers;
// fails_when=a status code or the miss marking changes, or a bot bumps the view counter; why_new=new public endpoint;
// seam=service mocked; no_claim=the limiter itself (see public-trip-limiters.test.ts).
const h = vi.hoisted(() => ({ getPublicTrip: vi.fn() }))
vi.mock('@/modules/ride-shares/ride-shares.service', () => ({
  getPublicTrip: h.getPublicTrip, createShares: vi.fn(), listShares: vi.fn(), stopShare: vi.fn(), stopAllShares: vi.fn(),
}))

import { isPreviewBot, publicTrip } from '@/modules/ride-shares/ride-shares.controller'

const TOKEN = 'abcdefghijklmnopqrstuv'
// capture res.locals after the handler by wrapping it
function appWithMissProbe() {
  const a = express()
  const misses: boolean[] = []
  a.get('/t/:token', (req, res, next) => {
    res.on('finish', () => misses.push(Boolean(res.locals['tripMiss'])))
    return publicTrip(req, res, next)
  })
  return { a, misses }
}

beforeEach(() => { vi.clearAllMocks() })

describe('GET public trip', () => {
  it('answers 200 with no-store when the link is live', async () => {
    h.getPublicTrip.mockResolvedValue({ kind: 'ok', trip: { phase: 'in_trip', isSos: false } })
    const { a, misses } = appWithMissProbe()
    const res = await request(a).get(`/t/${TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body).toMatchObject({ phase: 'in_trip' })
    expect(misses).toEqual([false])
  })

  it('unknown and revoked links are the same 404, and count as a miss', async () => {
    h.getPublicTrip.mockResolvedValue({ kind: 'missing' })
    const { a, misses } = appWithMissProbe()
    const res = await request(a).get(`/t/${TOKEN}`)
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Not found', code: 'NOT_FOUND' })
    expect(misses).toEqual([true])
  })

  it('an expired link is 410 but NOT a miss: it is a real link, and a viewer holding it open must not use up the allowance of everyone behind the same address', async () => {
    h.getPublicTrip.mockResolvedValue({ kind: 'expired' })
    const { a, misses } = appWithMissProbe()
    const res = await request(a).get(`/t/${TOKEN}`)
    expect(res.status).toBe(410)
    expect(misses).toEqual([false])
  })

  it('a malformed token never reaches the database: 404 and a miss', async () => {
    const { a, misses } = appWithMissProbe()
    const res = await request(a).get('/t/short')
    expect(res.status).toBe(404)
    expect(h.getPublicTrip).not.toHaveBeenCalled()
    expect(misses).toEqual([true])
  })

  it('does not count a link-preview bot as a viewer, but does count a browser', async () => {
    h.getPublicTrip.mockResolvedValue({ kind: 'ok', trip: {} })
    const { a } = appWithMissProbe()
    await request(a).get(`/t/${TOKEN}`).set('User-Agent', 'WhatsApp/2.23.20 A')
    expect(h.getPublicTrip).toHaveBeenLastCalledWith(TOKEN, { countView: false })
    await request(a).get(`/t/${TOKEN}`).set('User-Agent', 'Mozilla/5.0 (Linux; Android 13) Chrome/120')
    expect(h.getPublicTrip).toHaveBeenLastCalledWith(TOKEN, { countView: true })
  })

  it('recognises the common preview fetchers and nothing else', () => {
    for (const ua of ['WhatsApp/2.23', 'facebookexternalhit/1.1', 'TelegramBot (like TwitterBot)', 'Slackbot-LinkExpanding 1.0', 'Twitterbot/1.0']) expect(isPreviewBot(ua)).toBe(true)
    for (const ua of ['Mozilla/5.0 (iPhone) Safari', undefined, '']) expect(isPreviewBot(ua)).toBe(false)
  })
})
