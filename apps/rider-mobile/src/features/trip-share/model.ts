// Pure rules for "share my trip": who can share, what the texts say, which link to reuse, which error says what. No React Native
// imports, so every rule here is unit-tested (model.test.ts). The screens only draw what this decides.

export interface Share {
  id: string
  label: string | null
  isSos: boolean
  viewCount: number
  lastViewedAt: string | null
  createdAt: string
}

export interface CreatedShare {
  id: string
  url: string
  label: string | null
  /** Only for a contact share: whether the SMS went out. A failed SMS never fails the link. */
  sms?: 'sent' | 'failed'
}

/** A trip can be shared once a driver is assigned and until it ends (the same rule the server enforces). */
export const SHAREABLE_STATUSES: ReadonlySet<string> = new Set(['accepted', 'driver_arrived', 'in_progress', 'returning'])

export function canShareRide(ride: { driverId: string | number | null | undefined; status: string }): boolean {
  return ride.driverId != null && SHAREABLE_STATUSES.has(ride.status)
}

export const shareMessage = (url: string): string => `Track my Ocar ride live: ${url}`

export const SHARE_DISCLOSURE = 'They will see your pickup, drop-off and live location until the trip ends. You can stop sharing anytime.'

export const bannerText = (count: number): string => `Sharing live · ${count} ${count === 1 ? 'link' : 'links'}`

export function viewedText(count: number): string {
  if (count <= 0) return 'Not viewed yet'
  return `Viewed ${count}×`
}

export const shareTitle = (s: Pick<Share, 'label' | 'isSos'>): string => (s.isSos ? 'SOS link' : s.label ?? 'Link')

/** Where the created link is kept on this phone. The server keeps only a hash, so the phone is the only place the link can be shown again. */
export const urlStorageKey = (shareId: string): string => `ocar_trip_share_url_${shareId}`

/**
 * The link to offer again when the sheet is reopened: the newest anonymous (no contact label, not SOS) link whose URL this phone still
 * holds. Null means a new link has to be created (first time, or the app was reinstalled and the URL is gone).
 */
export function pickReusableLink(shares: readonly Share[], urls: Readonly<Record<string, string>>): { share: Share; url: string } | null {
  const candidates = shares
    .filter((s) => !s.isSos && s.label === null && typeof urls[s.id] === 'string')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const share = candidates[0]
  return share ? { share, url: urls[share.id]! } : null
}

export type ShareErrorCode = 'TRIP_SHARE_DISABLED' | 'TRIP_SHARE_LIMIT' | 'RIDE_NOT_SHAREABLE' | 'RIDE_NOT_FOUND' | 'RATE_LIMIT_EXCEEDED' | 'NETWORK' | 'UNKNOWN'

const KNOWN: ReadonlySet<string> = new Set(['TRIP_SHARE_DISABLED', 'TRIP_SHARE_LIMIT', 'RIDE_NOT_SHAREABLE', 'RIDE_NOT_FOUND', 'RATE_LIMIT_EXCEEDED'])

/** Reads the API's error code out of whatever axios threw, without importing axios. */
export function shareErrorCode(err: unknown): ShareErrorCode {
  const e = err as { response?: { data?: { code?: unknown } }; request?: unknown } | null
  const code = e?.response?.data?.code
  if (typeof code === 'string' && KNOWN.has(code)) return code as ShareErrorCode
  if (e && !e.response) return 'NETWORK'
  return 'UNKNOWN'
}

export function errorCopy(code: ShareErrorCode): string {
  switch (code) {
    case 'TRIP_SHARE_DISABLED': return 'Trip sharing is not available yet. Please try again later.'
    case 'TRIP_SHARE_LIMIT': return 'This trip already has the most links allowed. Stop one first, then try again.'
    case 'RATE_LIMIT_EXCEEDED': return 'Too many tries. Please wait a moment and try again.'
    case 'RIDE_NOT_SHAREABLE': return 'You can share a trip once a driver is assigned, until it ends.'
    case 'RIDE_NOT_FOUND': return 'We could not find this trip.'
    case 'NETWORK': return 'No connection. Check your internet and try again.'
    default: return 'Something went wrong. Please try again.'
  }
}

/** After texting contacts: who got the SMS and who still needs the link shared another way. */
export function summarizeSms(created: readonly CreatedShare[]): { sent: CreatedShare[]; failed: CreatedShare[] } {
  return {
    sent: created.filter((c) => c.sms === 'sent'),
    failed: created.filter((c) => c.sms === 'failed'),
  }
}

/** "+91 ••••• 1111": enough to recognise the contact, never the whole number on screen. */
export function maskPhone(phone: string): string {
  const last4 = phone.replace(/\D/g, '').slice(-4)
  return last4.length === 4 ? `+91 ••••• ${last4}` : phone
}
