'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useAdminAuth } from './auth-context'
import { getAdminSocket } from './socket'
import { notificationsApi, type NotificationItem } from './notifications-api'

interface NotificationsContextType {
  items: NotificationItem[]
  unreadCount: number
  loading: boolean
  nextCursor: string | null
  toast: NotificationItem | null
  isPanelOpen: boolean
  openPanel: () => void
  setPanelOpen: (open: boolean) => void
  fetchFirstPage: () => Promise<void>
  fetchNextPage: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  dismissToast: () => void
}

const NotificationsContext = createContext<NotificationsContextType | null>(null)

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAdminAuth()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [toast, setToast] = useState<NotificationItem | null>(null)
  const [isPanelOpen, setIsPanelOpen] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) return
    notificationsApi.unreadCount().then(setUnreadCount).catch(() => {})
  }, [isAuthenticated])

  // Admin notifications broadcast to the shared 'admin:ops' room (every admin
  // gets their own DB row, but there's no per-admin socket room to target),
  // so the live payload has no owner-specific id. Refetch from the server
  // instead of appending it directly — the toast can use it as-is though,
  // it's transient and doesn't need a real id.
  useEffect(() => {
    if (!isAuthenticated) return
    const socket = getAdminSocket()
    const onNotification = (payload: { type: string; title: string | null; body: string; payload: Record<string, unknown>; createdAt: string }) => {
      setToast({ id: '', rideId: null, readAt: null, ...payload })
      notificationsApi.unreadCount().then(setUnreadCount).catch(() => {})
      notificationsApi.list().then(res => { setItems(res.items); setNextCursor(res.nextCursor) }).catch(() => {})
    }
    socket.on('notification:new', onNotification)
    return () => { socket.off('notification:new', onNotification) }
  }, [isAuthenticated])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const fetchFirstPage = useCallback(async () => {
    setLoading(true)
    try {
      const res = await notificationsApi.list()
      setItems(res.items)
      setNextCursor(res.nextCursor)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchNextPage = useCallback(async () => {
    if (!nextCursor || loading) return
    setLoading(true)
    try {
      const res = await notificationsApi.list(nextCursor)
      setItems(prev => [...prev, ...res.items])
      setNextCursor(res.nextCursor)
    } finally {
      setLoading(false)
    }
  }, [nextCursor, loading])

  const markRead = useCallback(async (id: string) => {
    setItems(prev => {
      const target = prev.find(i => i.id === id)
      if (!target || target.readAt) return prev
      setUnreadCount(c => Math.max(0, c - 1))
      return prev.map(i => i.id === id ? { ...i, readAt: new Date().toISOString() } : i)
    })
    await notificationsApi.markRead(id).catch(() => {})
  }, [])

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString()
    setItems(prev => prev.map(i => ({ ...i, readAt: i.readAt ?? now })))
    setUnreadCount(0)
    await notificationsApi.markAllRead().catch(() => {})
  }, [])

  return (
    <NotificationsContext.Provider value={{
      items, unreadCount, loading, nextCursor, toast,
      isPanelOpen, setPanelOpen: setIsPanelOpen,
      openPanel: () => setIsPanelOpen(true),
      fetchFirstPage, fetchNextPage, markRead, markAllRead,
      dismissToast: () => setToast(null),
    }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used inside NotificationsProvider')
  return ctx
}
