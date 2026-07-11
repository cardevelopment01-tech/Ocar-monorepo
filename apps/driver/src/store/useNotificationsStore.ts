import { create } from 'zustand'
import { notificationsApi, type NotificationItem } from '@/lib/notifications-api'

interface NotificationsState {
  items: NotificationItem[]
  unreadCount: number
  isSheetOpen: boolean
  loading: boolean
  nextCursor: string | null
  toast: NotificationItem | null

  openSheet: () => void
  closeSheet: () => void
  fetchUnreadCount: () => Promise<void>
  fetchFirstPage: () => Promise<void>
  fetchNextPage: () => Promise<void>
  addLive: (item: NotificationItem) => void
  dismissToast: () => void
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  reset: () => void
}

export const useNotificationsStore = create<NotificationsState>()((set, get) => ({
  items: [],
  unreadCount: 0,
  isSheetOpen: false,
  loading: false,
  nextCursor: null,
  toast: null,

  openSheet: () => {
    set({ isSheetOpen: true })
    if (get().items.length === 0) void get().fetchFirstPage()
  },
  closeSheet: () => set({ isSheetOpen: false }),

  fetchUnreadCount: async () => {
    try {
      const count = await notificationsApi.unreadCount()
      set({ unreadCount: count })
    } catch {
      // silent — badge just stays stale until next successful poll
    }
  },

  fetchFirstPage: async () => {
    set({ loading: true })
    try {
      const { items, nextCursor } = await notificationsApi.list()
      set({ items, nextCursor, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchNextPage: async () => {
    const { nextCursor, loading, items } = get()
    if (!nextCursor || loading) return
    set({ loading: true })
    try {
      const res = await notificationsApi.list(nextCursor)
      set({ items: [...items, ...res.items], nextCursor: res.nextCursor, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  addLive: (item) => {
    set(s => ({
      items: [item, ...s.items],
      unreadCount: s.unreadCount + 1,
      toast: s.isSheetOpen ? s.toast : item,
    }))
  },

  dismissToast: () => set({ toast: null }),

  markRead: async (id) => {
    const { items, unreadCount } = get()
    const target = items.find(i => i.id === id)
    if (!target || target.readAt) return
    set({
      items: items.map(i => i.id === id ? { ...i, readAt: new Date().toISOString() } : i),
      unreadCount: Math.max(0, unreadCount - 1),
    })
    try {
      await notificationsApi.markRead(id)
    } catch {
      // optimistic update stands — a stale unread badge is harmless
    }
  },

  markAllRead: async () => {
    const now = new Date().toISOString()
    set(s => ({ items: s.items.map(i => ({ ...i, readAt: i.readAt ?? now })), unreadCount: 0 }))
    try {
      await notificationsApi.markAllRead()
    } catch {
      // optimistic update stands
    }
  },

  reset: () => set({ items: [], unreadCount: 0, isSheetOpen: false, loading: false, nextCursor: null, toast: null }),
}))
