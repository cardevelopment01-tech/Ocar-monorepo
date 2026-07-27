'use client'
import { useEffect, useState } from 'react'
import { Search, Bell, ChevronDown, Car, CircleCheck, TriangleAlert, FileText } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'
import { useNotifications } from '@/lib/notifications-context'

interface AdminTopBarProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  adminName: string
  adminInitials: string
}

const NOTIF_ICONS: Record<string, typeof Bell> = {
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
  return `${days}d ago`
}

export default function AdminTopBar({
  title, subtitle, actions, adminName, adminInitials,
}: AdminTopBarProps) {
  const [open, setOpen] = useState(false)
  const {
    items, unreadCount, loading, isPanelOpen, setPanelOpen,
    fetchFirstPage, markRead, markAllRead,
  } = useNotifications()

  useEffect(() => {
    if (isPanelOpen && items.length === 0) void fetchFirstPage()
  }, [isPanelOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <header
      className="sticky top-0 z-30 h-14 flex items-center px-6 gap-4"
      style={{
        background: 'rgba(255,255,255,0.85)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid #E8EAFF',
        boxShadow: '0 1px 0 #E8EAFF, 0 4px 24px rgba(79,70,229,0.04)',
      }}
    >
      {/* Title */}
      <div className="flex-1 min-w-0">
        <h1 className="text-md font-bold text-text-primary leading-none">{title}</h1>
        {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
      </div>

      {actions && <div className="flex items-center gap-2">{actions}</div>}

      {/* Right controls */}
      <div className="flex items-center gap-1.5">
        {/* Search */}
        <button
          aria-label="Search"
          className="w-8 h-8 rounded-xl hover:bg-surface-2 flex items-center justify-center transition-colors cursor-pointer"
          style={{ color: '#94A3B8' }}
        >
          <Search size={14} />
        </button>

        {/* Notifications */}
        <DropdownMenu.Root open={isPanelOpen} onOpenChange={setPanelOpen}>
          <DropdownMenu.Trigger asChild>
            <button
              className="relative w-8 h-8 rounded-xl hover:bg-surface-2 flex items-center justify-center transition-colors cursor-pointer"
              style={{ color: '#94A3B8' }}
            >
              <Bell size={14} />
              {unreadCount > 0 && (
                <span
                  className="absolute top-1 right-1 w-4 h-4 text-white text-[9px] font-bold rounded-full flex items-center justify-center"
                  style={{ background: '#EF4444', boxShadow: '0 0 0 2px #F8FAFF' }}
                >
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              className="z-50 bg-surface border border-border rounded-xl min-w-[340px] max-w-[380px] max-h-[420px] overflow-hidden flex flex-col animate-fade-in"
              style={{ boxShadow: '0 8px 32px rgba(15,23,42,0.12), 0 0 0 1px #E8EAFF' }}
            >
              <div className="px-3.5 py-2.5 border-b border-border flex items-center justify-between flex-shrink-0">
                <p className="text-sm font-bold text-text-primary">Notifications</p>
                {unreadCount > 0 && (
                  <button
                    onClick={() => void markAllRead()}
                    className="text-xs font-semibold text-primary hover:opacity-70 transition-opacity cursor-pointer"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <div className="overflow-y-auto flex-1">
                {loading && items.length === 0 ? (
                  <div className="px-3.5 py-4 space-y-3">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="flex items-center gap-2.5 animate-pulse">
                        <div className="w-8 h-8 rounded-lg bg-surface-2 flex-shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-2.5 rounded bg-surface-2 w-3/4" />
                          <div className="h-2 rounded bg-surface-2 w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
                    <span className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center mb-2.5">
                      <Bell size={17} strokeWidth={1.6} style={{ color: '#94A3B8' }} />
                    </span>
                    <p className="text-xs font-semibold text-text-primary">You&apos;re all caught up</p>
                    <p className="text-[11px] text-text-muted mt-0.5">Ops alerts will show up here.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {items.map(item => {
                      const Icon = NOTIF_ICONS[item.type] ?? Bell
                      const unread = !item.readAt
                      return (
                        <button
                          key={item.id}
                          onClick={() => void markRead(item.id)}
                          className="w-full flex items-start gap-2.5 px-3.5 py-3 text-left hover:bg-surface-2 transition-colors cursor-pointer"
                        >
                          <span
                            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                            style={{ background: unread ? 'rgba(79,70,229,0.10)' : '#F1F5F9' }}
                          >
                            <Icon size={13} strokeWidth={1.8} style={{ color: unread ? '#4F46E5' : '#94A3B8' }} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className={cn('text-xs leading-snug', unread ? 'font-bold text-text-primary' : 'font-semibold text-text-secondary')}>
                                {item.title ?? item.body}
                              </span>
                              {unread && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                            </span>
                            {item.title && (
                              <span className="block text-[11px] text-text-muted mt-0.5 leading-snug">{item.body}</span>
                            )}
                            <span className="block text-[10px] text-text-muted mt-1">{relativeTime(item.createdAt)}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* Divider */}
        <div className="w-px h-5 bg-border mx-0.5" />

        {/* User menu */}
        <DropdownMenu.Root open={open} onOpenChange={setOpen}>
          <DropdownMenu.Trigger asChild>
            <button className="flex items-center gap-2 pl-1 pr-2.5 py-1.5 rounded-xl hover:bg-surface-2 transition-colors cursor-pointer">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)' }}
              >
                <span className="text-white text-[11px] font-bold">{adminInitials}</span>
              </div>
              <span className="text-sm font-medium text-text-secondary hidden sm:block max-w-[80px] truncate">
                {adminName}
              </span>
              <ChevronDown
                size={12}
                className={cn('text-text-muted transition-transform flex-shrink-0', open && 'rotate-180')}
              />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              className="z-50 bg-surface border border-border rounded-xl py-1 min-w-[180px] animate-fade-in"
              style={{ boxShadow: '0 8px 32px rgba(15,23,42,0.12), 0 0 0 1px #E8EAFF' }}
            >
              <div className="px-3 py-2.5 border-b border-border mb-1">
                <p className="text-xs font-bold text-text-primary">{adminName}</p>
                <p className="text-xs text-text-muted mt-0.5">Administrator</p>
              </div>
              {['Profile', 'Settings', 'Sign Out'].map(item => (
                <DropdownMenu.Item
                  key={item}
                  className={cn(
                    'px-3 py-2 text-sm font-medium cursor-pointer outline-none transition-colors rounded-lg mx-1',
                    item === 'Sign Out'
                      ? 'text-danger hover:bg-danger-light'
                      : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
                  )}
                >
                  {item}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  )
}
