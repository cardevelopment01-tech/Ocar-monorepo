import api from './api'

export interface BroadcastAudience {
  role: 'driver' | 'rider'
  missingRcBack?: boolean
}

export type BroadcastCategory = 'announcement' | 'offer'

export const broadcastApi = {
  preview: async (category: BroadcastCategory, audience: BroadcastAudience) => {
    const { data } = await api.post<{ recipientCount: number; sendableNow: boolean }>('/api/v1/admin/notifications/preview', { category, audience })
    return data
  },

  send: async (params: { title: string; body: string; category: BroadcastCategory; audience: BroadcastAudience }) => {
    const { data } = await api.post<{ id: string; recipientCount: number }>('/api/v1/admin/notifications/broadcast', params)
    return data
  },
}
