import api from '@/lib/api'

export interface NotificationItem {
  id: string
  type: string
  title: string | null
  body: string
  payload: Record<string, unknown>
  rideId: string | null
  readAt: string | null
  createdAt: string
}

interface ListResponse {
  items: NotificationItem[]
  nextCursor: string | null
}

export const notificationsApi = {
  list: async (cursor?: string): Promise<ListResponse> => {
    const { data } = await api.get<ListResponse>('/api/v1/notifications', {
      params: cursor ? { cursor } : undefined,
    })
    return data
  },

  unreadCount: async (): Promise<number> => {
    const { data } = await api.get<{ count: number }>('/api/v1/notifications/unread-count')
    return data.count
  },

  markRead: (id: string): Promise<void> =>
    api.patch(`/api/v1/notifications/${id}/read`).then(() => undefined),

  markAllRead: (): Promise<void> =>
    api.post('/api/v1/notifications/read-all').then(() => undefined),
}
