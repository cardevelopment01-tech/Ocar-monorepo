'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from './auth-context'
import { getSocket } from './socket'
import { notificationsApi, type NotificationItem } from './notifications-api'

interface NotificationsContextType {
  items: NotificationItem[]
  unreadCount: number
  loading: boolean
  nextCursor: string | null
  toast: NotificationItem | null
  fetchFirstPage: () => Promise<void>
  fetchNextPage: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  dismissToast: () => void
}

const NotificationsContext = createContext<NotificationsContextType | null>(null)

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [toast, setToast] = useState<NotificationItem | null>(null)
  const fetchedFirstPage = useRef(false)

  useEffect(() => {
    if (!isAuthenticated) return
    notificationsApi.unreadCount().then(setUnreadCount).catch(() => {})
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) return
    const socket = getSocket()
    const onNotification = (item: NotificationItem) => {
      setItems(prev => [item, ...prev])
      setUnreadCount(c => c + 1)
      setToast(item)
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
      fetchedFirstPage.current = true
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
