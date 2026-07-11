'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Bell, MessageSquare, Car, CircleCheck, TriangleAlert, FileText } from 'lucide-react'
import { useNotifications } from '@/lib/notifications-context'
import type { NotificationItem } from '@/lib/notifications-api'

const ICONS: Record<string, typeof Bell> = {
  ride_accepted: Car,
  ride_completed: CircleCheck,
  sos: TriangleAlert,
  driver_submitted_for_review: FileText,
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

function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return d.toDateString() === now.toDateString()
}

function NotificationRow({ item, onRead }: { item: NotificationItem; onRead: (id: string) => void }) {
  const Icon = ICONS[item.type] ?? Bell
  const unread = !item.readAt

  return (
    <button
      onClick={() => onRead(item.id)}
      className="w-full flex items-start gap-3 px-4 py-3.5 text-left active:bg-surface-2 transition-colors"
    >
      <span
        className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${unread ? 'bg-primary/10' : 'bg-surface-2'}`}
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
          <span className="block text-xs text-text-muted mt-0.5 leading-snug">{item.body}</span>
        )}
        <span className="block text-[11px] text-text-muted mt-1">{relativeTime(item.createdAt)}</span>
      </span>
    </button>
  )
}

export default function NotificationsPage() {
  const router = useRouter()
  const { items, loading, unreadCount, fetchFirstPage, markRead, markAllRead } = useNotifications()

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
        <button
          onClick={() => router.back()}
          aria-label="Go back"
          className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center flex-shrink-0 active:bg-slate-200 transition-colors"
        >
          <ArrowLeft size={17} strokeWidth={2} className="text-slate-800" />
        </button>
        <p className="text-[15px] font-bold text-slate-900 flex-1">Notifications</p>
        {unreadCount > 0 && (
          <button
            onClick={() => void markAllRead()}
            className="text-[12px] font-semibold text-primary active:opacity-60 transition-opacity"
          >
            Mark all read
          </button>
        )}
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
            <span className="w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center mb-3">
              <Bell size={20} strokeWidth={1.6} className="text-text-muted" />
            </span>
            <p className="text-[13px] font-semibold text-text-primary">You&apos;re all caught up</p>
            <p className="text-xs text-text-muted mt-1">Ride and account updates will show up here.</p>
          </div>
        ) : (
          <>
            {todayItems.length > 0 && (
              <>
                <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest px-4 pt-5 pb-1">Today</p>
                <div className="bg-surface divide-y divide-border">
                  {todayItems.map(item => (
                    <NotificationRow key={item.id} item={item} onRead={(id) => void markRead(id)} />
                  ))}
                </div>
              </>
            )}
            {earlierItems.length > 0 && (
              <>
                <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest px-4 pt-5 pb-1">Earlier</p>
                <div className="bg-surface divide-y divide-border">
                  {earlierItems.map(item => (
                    <NotificationRow key={item.id} item={item} onRead={(id) => void markRead(id)} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest px-4 pt-6 pb-3">Preferences</p>
        <div className="bg-surface rounded-2xl border border-border overflow-hidden shadow-card mx-4">
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
