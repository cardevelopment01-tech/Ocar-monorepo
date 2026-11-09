import { describe, expect, it } from 'vitest'
import {
  SHARE_DISCLOSURE, bannerText, canShareRide, errorCopy, maskPhone, pickReusableLink, shareErrorCode, shareMessage, shareTitle,
  summarizeSms, urlStorageKey, viewedText, type CreatedShare, type Share,
} from './model'

// Value: protects=the rider only sees Share when a trip can really be shared, the words they send and see are right, a link is
// re-shown only when this phone still holds it, and every API refusal turns into plain words; fails_when=a status is added to the
// wrong side, a SOS/contact link is offered as "your link", an error code loses its message, or a full phone number reaches the
// screen; why_new=new feature; seam=none (pure rules); no_claim=the screens, the OS share sheet, or the real API.
const share = (over: Partial<Share> = {}): Share => ({ id: '1', label: null, isSos: false, viewCount: 0, lastViewedAt: null, createdAt: '2026-11-06T10:00:00Z', ...over })

describe('canShareRide', () => {
  it.each([['accepted', true], ['driver_arrived', true], ['in_progress', true], ['returning', true], ['requested', false], ['completed', false], ['cancelled', false], ['no_drivers', false]])(
    'status %s -> %s once a driver is assigned', (status, expected) => expect(canShareRide({ driverId: '7', status })).toBe(expected),
  )
  it('needs a driver, whatever the status', () => {
    expect(canShareRide({ driverId: null, status: 'accepted' })).toBe(false)
    expect(canShareRide({ driverId: undefined, status: 'in_progress' })).toBe(false)
    expect(canShareRide({ driverId: 0, status: 'accepted' })).toBe(true) // an id of 0 is still an id; only null/undefined mean "no driver"
  })
})

describe('words the rider sends and sees', () => {
  it('the message carries the link and says what it is', () => {
    expect(shareMessage('https://ocarindia.com/t/abc')).toBe('Track my Ocar ride live: https://ocarindia.com/t/abc')
  })
  it('says exactly what the recipient will see and that it can be stopped', () => {
    expect(SHARE_DISCLOSURE).toContain('pickup, drop-off and live location')
    expect(SHARE_DISCLOSURE).toContain('stop sharing anytime')
  })
  it('banner and view counts read naturally', () => {
    expect(bannerText(1)).toBe('Sharing live · 1 link')
    expect(bannerText(3)).toBe('Sharing live · 3 links')
    expect(viewedText(0)).toBe('Not viewed yet')
    expect(viewedText(3)).toBe('Viewed 3×')
  })
  it('names a link by its contact, or "SOS link", or plain "Link"', () => {
    expect(shareTitle({ label: 'Mum', isSos: false })).toBe('Mum')
    expect(shareTitle({ label: null, isSos: false })).toBe('Link')
    expect(shareTitle({ label: 'SOS', isSos: true })).toBe('SOS link')
  })
  it('shows only the last four digits of a contact number', () => {
    expect(maskPhone('+919811111234')).toBe('+91 ••••• 1234')
    expect(maskPhone('12')).toBe('12')
    expect(maskPhone('9811111234')).toBe('+91 ••••• 1234')
    expect(maskPhone('+14155551234')).toBe('••••• 1234') // never a made-up +91 on another country's number
    expect(maskPhone('+919811111234')).not.toContain('98111')
  })
})

describe('pickReusableLink (reopening the sheet)', () => {
  it('offers the newest anonymous link whose URL this phone still holds', () => {
    const shares = [share({ id: '1', createdAt: '2026-11-06T10:00:00Z' }), share({ id: '2', createdAt: '2026-11-06T11:00:00Z' })]
    expect(pickReusableLink(shares, { '1': 'u1', '2': 'u2' })).toMatchObject({ share: { id: '2' }, url: 'u2' })
  })
  it('skips links this phone does not hold (reinstall), contact links and the SOS link', () => {
    const shares = [share({ id: '1' }), share({ id: '2', label: 'Mum' }), share({ id: '3', isSos: true, label: 'SOS' })]
    expect(pickReusableLink(shares, { '2': 'u2', '3': 'u3' })).toBeNull()
    expect(pickReusableLink(shares, {})).toBeNull()
    expect(pickReusableLink([], { '1': 'x' })).toBeNull()
  })
  it('falls back to an older link when the newest one has no stored URL', () => {
    const shares = [share({ id: '1', createdAt: '2026-11-06T10:00:00Z' }), share({ id: '2', createdAt: '2026-11-06T11:00:00Z' })]
    expect(pickReusableLink(shares, { '1': 'u1' })).toMatchObject({ share: { id: '1' } })
  })
  it('keys the stored URL by share id', () => expect(urlStorageKey('42')).toBe('ocar_trip_share_url_42'))
})

describe('errors', () => {
  const axiosLike = (code: unknown) => ({ response: { data: { code } } })
  it.each([
    ['TRIP_SHARE_DISABLED', 'not available yet'],
    ['TRIP_SHARE_LIMIT', 'most links allowed'],
    ['RIDE_NOT_SHAREABLE', 'driver is assigned'],
    ['RATE_LIMIT_EXCEEDED', 'Too many tries'],
    ['RIDE_NOT_FOUND', 'could not find'],
  ])('%s becomes a plain sentence', (code, fragment) => {
    expect(shareErrorCode(axiosLike(code))).toBe(code)
    expect(errorCopy(shareErrorCode(axiosLike(code)))).toContain(fragment)
  })
  it('no response at all is a connection problem; anything else is a generic retry', () => {
    expect(shareErrorCode({ request: {} })).toBe('NETWORK')
    expect(errorCopy('NETWORK')).toContain('No connection')
    expect(shareErrorCode(axiosLike('SOMETHING_NEW'))).toBe('UNKNOWN')
    expect(shareErrorCode({ response: { data: {} } })).toBe('UNKNOWN')
    expect(shareErrorCode(null)).toBe('UNKNOWN')
    expect(errorCopy('UNKNOWN')).toContain('Something went wrong')
  })
})

describe('summarizeSms', () => {
  const c = (id: string, sms?: 'sent' | 'failed'): CreatedShare => ({ id, url: `u${id}`, label: id, ...(sms ? { sms } : {}) })
  it('splits who got the text from who needs the link shared another way', () => {
    const r = summarizeSms([c('Mum', 'sent'), c('Dad', 'failed'), c('Sis', 'sent')])
    expect(r.sent.map((x) => x.label)).toEqual(['Mum', 'Sis'])
    expect(r.failed.map((x) => x.label)).toEqual(['Dad'])
    expect(summarizeSms([c('x')])).toEqual({ sent: [], failed: [] })
  })
})
