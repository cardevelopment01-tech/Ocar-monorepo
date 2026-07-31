'use client'

import { useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Bell, MessageSquare, Check } from 'lucide-react'
import { motion, AnimatePresence, useReducedMotion, useMotionValue, animate } from 'framer-motion'
import { useNotifications } from '@/lib/notifications-context'
import { getNotificationIcon, getNotificationTint } from '@/lib/notification-icons'
import type { NotificationItem } from '@/lib/notifications-api'

const TAP_SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return d.toDateString() === now.toDateString()
}

function NotificationRow({ item, index, onRead, onOpen }: { item: NotificationItem; index: number; onRead: (id: string) => void; onOpen: (item: NotificationItem) => void }) {
  const Icon = getNotificationIcon(item.type)
  const unread = !item.readAt
  const tint = getNotificationTint(item.type, unread)
  const prefersReducedMotion = useReducedMotion()
  const x = useMotionValue(0)

  return (
    <motion.div
      layout
      initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, filter: 'blur(3px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: 0.28, delay: Math.min(index * 0.035, 0.28), ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden"
    >
      {unread && (
        <div className="absolute inset-0 flex items-center justify-end bg-primary/10 pr-6">
          <Check size={16} strokeWidth={2.2} className="text-primary" />
        </div>
      )}
      <motion.div
        style={{ x }}
        drag={unread && !prefersReducedMotion ? 'x' : false}
        dragConstraints={{ left: -72, right: 0 }}
        dragElastic={0.15}
        whileTap={{ scale: 0.99 }}
        onDragEnd={(_e, info) => {
          if (info.offset.x < -48 || info.velocity.x < -400) onRead(item.id)
          animate(x, 0, { type: 'spring', stiffness: 400, damping: 40 })
        }}
        className="bg-surface"
      >
        <button
          onClick={() => onOpen(item)}
          className="w-full flex items-start gap-3 px-4 py-3.5 text-left active:bg-surface-2 transition-colors duration-150"
        >
          <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors duration-200 ${tint.bg}`}>
            <Icon size={15} strokeWidth={1.8} className={tint.text} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-1.5">
              <span className={`text-[13px] leading-snug ${unread ? 'font-bold text-text-primary' : 'font-semibold text-text-secondary'}`}>
                {item.title ?? item.body}
              </span>
              <AnimatePresence>
                {unread && (
                  <motion.span
                    key="dot"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.18 }}
                    className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0"
                  />
                )}
              </AnimatePresence>
            </span>
            {item.title && (
              <span className="block text-xs text-text-muted mt-0.5 leading-snug">{item.body}</span>
            )}
            <span className="block text-[11px] text-text-muted mt-1">{relativeTime(item.createdAt)}</span>
          </span>
        </button>
      </motion.div>
    </motion.div>
  )
}

export default function NotificationsPage() {
  const router = useRouter()
  const { items, loading, unreadCount, fetchFirstPage, markRead, markAllRead } = useNotifications()
  const prefersReducedMotion = useReducedMotion()

  const handleOpen = useCallback((item: NotificationItem) => {
    void markRead(item.id)
    if (item.type === 'payment_failed' && item.rideId) {
      router.push(`/ride/${item.rideId}/receipt`)
    }
  }, [markRead, router])

  useEffect(() => {
    void fetchFirstPage()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const todayItems = items.filter(i => isToday(i.createdAt))
  const earlierItems = items.filter(i => !isToday(i.createdAt))

  return (
    <div className="h-full flex flex-col bg-background">
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 border-b border-slate-100"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)', paddingBottom: 12 }}
      >
        <motion.button
          onClick={() => router.back()}
          aria-label="Go back"
          whileTap={{ scale: 0.9 }}
          transition={TAP_SPRING}
          className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft size={17} strokeWidth={2} className="text-slate-800" />
        </motion.button>
        <p className="text-[15px] font-bold text-slate-900 flex-1">Notifications</p>
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.button
              key="mark-all"
              onClick={() => void markAllRead()}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              whileTap={{ scale: 0.94 }}
              transition={TAP_SPRING}
              className="text-[12px] font-semibold text-primary"
            >
              Mark all read
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none pb-28">
        {loading && items.length === 0 ? (
          <div className="px-4 pt-5 space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-center gap-3 animate-pulse">
                <div className="w-9 h-9 rounded-xl bg-surface-2 flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2.5 rounded bg-surface-2 w-3/4" />
                  <div className="h-2 rounded bg-surface-2 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <motion.span
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', duration: 0.5, bounce: 0.15 }}
              className="w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center mb-3"
            >
              <Bell size={20} strokeWidth={1.6} className="text-text-muted" />
            </motion.span>
            <p className="text-[13px] font-semibold text-text-primary">You&apos;re all caught up</p>
            <p className="text-xs text-text-muted mt-1">Ride and account updates will show up here.</p>
          </div>
        ) : (
          <>
            {todayItems.length > 0 && (
              <>
                <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest px-4 pt-5 pb-1">Today</p>
                <div className="bg-surface divide-y divide-border">
                  {todayItems.map((item, index) => (
                    <NotificationRow key={item.id} item={item} index={index} onRead={(id) => void markRead(id)} onOpen={handleOpen} />
                  ))}
                </div>
              </>
            )}
            {earlierItems.length > 0 && (
              <>
                <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest px-4 pt-5 pb-1">Earlier</p>
                <div className="bg-surface divide-y divide-border">
                  {earlierItems.map((item, index) => (
                    <NotificationRow key={item.id} item={item} index={todayItems.length + index} onRead={(id) => void markRead(id)} onOpen={handleOpen} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest px-4 pt-6 pb-3">Preferences</p>
        <div className="card-glossy p-0 overflow-hidden mx-4">
          {[
            { Icon: Bell,          label: 'Push notifications', sub: 'Ride updates, offers & alerts' },
            { Icon: MessageSquare, label: 'SMS alerts',         sub: 'OTP and booking confirmations' },
          ].map((item, i, arr) => (
            <div
              key={item.label}
              className={`flex items-center gap-3 px-4 py-3.5${i < arr.length - 1 ? ' border-b border-border' : ''}`}
            >
              <span className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0">
                <item.Icon size={15} strokeWidth={1.6} className="text-text-muted" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-text-primary">{item.label}</span>
                <span className="block text-xs text-text-muted mt-0.5">{item.sub}</span>
              </span>
              <span className="text-[10px] font-semibold text-text-muted bg-surface-2 rounded-lg px-2 py-1">Soon</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
