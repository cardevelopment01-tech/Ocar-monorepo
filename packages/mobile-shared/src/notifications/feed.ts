import { useEffect } from 'react'
import { AppState } from 'react-native'
import type { AxiosInstance } from 'axios'
import type { Socket } from 'socket.io-client'
import { bumpUnreadCount, setUnreadCount, type NotificationFeedItem } from './feedModel'

export * from './feedModel'

// ── API ──

export async function fetchNotificationPage(api: AxiosInstance, cursor?: string): Promise<{ items: NotificationFeedItem[]; nextCursor: string | null }> {
  const res = await api.get<{ items: NotificationFeedItem[]; nextCursor: string | null }>('/api/v1/notifications', {
    params: cursor ? { cursor } : {},
  })
  return res.data
}

export async function markNotificationRead(api: AxiosInstance, id: string): Promise<void> {
  await api.patch(`/api/v1/notifications/${id}/read`)
}

export async function markAllNotificationsRead(api: AxiosInstance): Promise<void> {
  await api.post('/api/v1/notifications/read-all')
}

export async function refreshUnreadCount(api: AxiosInstance): Promise<void> {
  try {
    const res = await api.get<{ count: number }>('/api/v1/notifications/unread-count')
    setUnreadCount(res.data.count)
  } catch {
    // Keep the last known count; the next trigger retries.
  }
}

// Mount once at the app root. Keeps the count right: loaded on sign-in, +1 for each live
// `notification:new`, and re-fetched whenever the app returns to the foreground or the socket
// reconnects (events missed while the socket was down are not replayed).
export function useUnreadSync(api: AxiosInstance, socket: Socket, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      setUnreadCount(0)
      return
    }
    void refreshUnreadCount(api)
    const onNew = (item: NotificationFeedItem | undefined) => {
      if (!item?.readAt) bumpUnreadCount(1)
    }
    const onConnect = () => { void refreshUnreadCount(api) }
    socket.on('notification:new', onNew)
    socket.on('connect', onConnect)
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshUnreadCount(api)
    })
    return () => {
      socket.off('notification:new', onNew)
      socket.off('connect', onConnect)
      appState.remove()
    }
  }, [api, socket, enabled])
}
