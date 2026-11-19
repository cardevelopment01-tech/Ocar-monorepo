import api from './api'

export interface BroadcastAudience {
  role: 'driver' | 'rider'
  missingRcBack?: boolean
  docIssues?: boolean
  cityIds?: number[]
  categoryIds?: number[]
  bookedInLastDays?: number
  phones?: string[]
}

/** The audience as the history returns it: typed phone numbers are replaced by how many there were. */
export type BroadcastAudienceShown = Omit<BroadcastAudience, 'phones'> & { phoneCount?: number }

export type BroadcastCategory = 'announcement' | 'offer'

export interface AudiencePreview {
  matched: number
  recipientCount: number
  withDevice: number
  inAppOnly: number
  skippedOptedOut: number
  skippedCapped: number
  dailyCap: number
  sendableNow: boolean
  phonesNotFound: string[]
  /** Who each typed number belongs to (typed-number audiences only). */
  people: Array<{ phone: string; name: string | null; code: string | null }>
}

export interface BroadcastSummary {
  id: string
  title: string
  body: string
  category: BroadcastCategory
  audience: BroadcastAudienceShown
  imageUrl: string | null
  /** The screen a tap opens (a key), or null for just opening the app. */
  link: string | null
  /** Why it stopped, when it did not finish (e.g. the offer hours passed). */
  statusNote: string | null
  /** How many the admin was told it would reach. */
  promised: number
  status: 'queued' | 'sending' | 'done' | 'failed'
  sentBy: string | null
  createdAt: string
  finishedAt: string | null
  sent: number
  pushed: number
  pushFailed: number
  noPush: number
  opened: number
  failed: number
  skippedOptedOut: number
  skippedCapped: number
  /** Left out between the audience check and the send. */
  skippedAtSend: number
  /** False for a send made before tracking existed: only `sent` (the promised count) is known. */
  tracked: boolean
  settling: boolean
}

const BASE = '/api/v1/admin/notifications'

/** Screens a tap can open, per app. Mirrors BROADCAST_LINKS in the API; the label is what the admin sees. */
export const BROADCAST_LINKS: Record<BroadcastAudience['role'], Array<{ value: string; label: string }>> = {
  rider: [{ value: 'home', label: 'Home' }, { value: 'offers', label: 'My offers' }, { value: 'trips', label: 'My trips' }],
  driver: [{ value: 'home', label: 'Home' }, { value: 'wallet', label: 'Wallet' }, { value: 'earnings', label: 'Earnings' }, { value: 'documents', label: 'Documents' }],
}

export const broadcastApi = {
  preview: async (category: BroadcastCategory, audience: BroadcastAudience) => {
    const { data } = await api.post<AudiencePreview>(`${BASE}/preview`, { category, audience })
    return data
  },

  send: async (params: { title: string; body: string; category: BroadcastCategory; audience: BroadcastAudience; imageUrl?: string; link?: string }) => {
    const { data } = await api.post<{ id: string; recipientCount: number; withDevice: number }>(`${BASE}/broadcast`, params)
    return data
  },

  /** Stores a prepared picture (see broadcast-image.ts) in the public pictures bucket; the link it returns goes in the broadcast. */
  uploadImage: async (blob: Blob) => {
    const form = new FormData()
    form.append('image', blob, 'banner.jpg')
    // The shared client sends JSON by default, which would make the server ignore the file: say multipart explicitly (the browser adds the boundary).
    const { data } = await api.post<{ url: string; width: number; height: number; bytes: number }>(`${BASE}/broadcast-image`, form, {
      headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000,
    })
    return data
  },

  list: async (params: { limit?: number; before?: string } = {}) => {
    const { data } = await api.get<{ broadcasts: BroadcastSummary[]; nextBefore: string | null }>(`${BASE}/broadcasts`, { params })
    return data
  },
}
