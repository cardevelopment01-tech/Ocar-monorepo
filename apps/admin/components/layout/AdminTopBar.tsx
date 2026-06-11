'use client'
import { useState } from 'react'
import { Search, Bell, ChevronDown } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

interface AdminTopBarProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  adminName: string
  adminInitials: string
  notificationCount?: number
}

export default function AdminTopBar({
  title, subtitle, actions, adminName, adminInitials, notificationCount = 0,
}: AdminTopBarProps) {
  const [open, setOpen] = useState(false)

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
          className="w-8 h-8 rounded-xl hover:bg-surface-2 flex items-center justify-center transition-colors cursor-pointer"
          style={{ color: '#94A3B8' }}
        >
          <Search size={14} />
        </button>

        {/* Notifications */}
        <button
          className="relative w-8 h-8 rounded-xl hover:bg-surface-2 flex items-center justify-center transition-colors cursor-pointer"
          style={{ color: '#94A3B8' }}
        >
          <Bell size={14} />
          {notificationCount > 0 && (
            <span
              className="absolute top-1 right-1 w-4 h-4 text-white text-[9px] font-bold rounded-full flex items-center justify-center"
              style={{ background: '#EF4444', boxShadow: '0 0 0 2px #F8FAFF' }}
            >
              {notificationCount > 9 ? '9+' : notificationCount}
            </span>
          )}
        </button>

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
