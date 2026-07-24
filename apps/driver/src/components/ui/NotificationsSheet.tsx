import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Bell, CircleCheck, TriangleAlert, FileText, Car, Wallet, X } from 'lucide-react'
import { useNotificationsStore } from '@/store/useNotificationsStore'
import type { NotificationItem } from '@/lib/notifications-api'

const ICONS: Record<string, typeof Bell> = {
  ride_accepted: Car,
  ride_completed: CircleCheck,
  sos: TriangleAlert,
  driver_submitted_for_review: FileText,
  document_rejected: FileText,
  wallet_low_balance: Wallet,
}

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

function NotificationRow({ item, onRead, onNavigate }: {
  item: NotificationItem
  onRead: (id: string) => void
  onNavigate: (item: NotificationItem) => void
}) {
  const Icon = ICONS[item.type] ?? Bell
  const unread = !item.readAt

  return (
    <button
      onClick={() => {
        onRead(item.id)
        if (item.payload?.['path'] || item.payload?.['route']) onNavigate(item)
      }}
      className="w-full flex items-start gap-3 px-4 py-3.5 text-left active:bg-surface-2 transition-colors"
    >
      <span
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{
          background: unread ? 'rgba(79,70,229,0.10)' : 'var(--surface-2, #F1F5F9)',
        }}
      >
        <Icon size={15} strokeWidth={1.8} className={unread ? 'text-primary' : 'text-text-muted'} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className={`text-[13px] leading-snug ${unread ? 'font-bold text-text-primary' : 'font-semibold text-text-secondary'}`}>
            {item.title ?? item.body}
          </span>
          {unread && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
        </span>
        {item.title && (
          <span className="block text-[12px] text-text-muted mt-0.5 leading-snug">{item.body}</span>
        )}
        <span className="block text-[11px] text-text-muted mt-1">{relativeTime(item.createdAt)}</span>
      </span>
    </button>
  )
}

export default function NotificationsSheet() {
  const { isSheetOpen, closeSheet, items, unreadCount, loading, markRead, markAllRead, fetchFirstPage } = useNotificationsStore()
  const prefersReducedMotion = useReducedMotion()
  const navigate = useNavigate()

  const handleNavigate = (item: NotificationItem) => {
    closeSheet()
    const path = item.payload?.['path']
    if (typeof path === 'string') { navigate(path); return }
    const route = item.payload?.['route']
    if (typeof route === 'string') navigate(`/onboarding/${route}`)
  }

  useEffect(() => {
    if (isSheetOpen && items.length === 0) void fetchFirstPage()
  }, [isSheetOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {isSheetOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-[120]"
            style={{ background: 'rgba(15,23,42,0.45)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
            onClick={closeSheet}
          />
          <motion.div
            className="fixed left-0 right-0 bottom-0 z-[121] rounded-t-[28px] flex flex-col"
            style={{
              maxHeight: '78dvh',
              background: '#FFFFFF',
              boxShadow: '0 -8px 40px rgba(15,23,42,0.18)',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={
              prefersReducedMotion
                ? { duration: 0 }
                : { type: 'spring', stiffness: 380, damping: 38, mass: 1 }
            }
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-9 h-1 rounded-full bg-border" />
            </div>

            <div className="flex items-center justify-between px-5 pt-2 pb-3 border-b border-border flex-shrink-0">
              <p className="text-[15px] font-bold text-text-primary">Notifications</p>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={() => void markAllRead()}
                    className="text-[12px] font-semibold text-primary active:opacity-60 transition-opacity"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  aria-label="Close"
                  onClick={closeSheet}
                  className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center active:scale-90 transition-transform"
                >
                  <X size={14} className="text-text-secondary" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-none pb-6" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
              {loading && items.length === 0 ? (
                <div className="px-5 py-8 space-y-3">
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
                <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
                  <span className="w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center mb-3">
                    <Bell size={20} strokeWidth={1.6} className="text-text-muted" />
                  </span>
                  <p className="text-[13px] font-semibold text-text-primary">You're all caught up</p>
                  <p className="text-[12px] text-text-muted mt-1">Ride and account updates will show up here.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {items.map(item => (
                    <NotificationRow key={item.id} item={item} onRead={(id) => void markRead(id)} onNavigate={handleNavigate} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
