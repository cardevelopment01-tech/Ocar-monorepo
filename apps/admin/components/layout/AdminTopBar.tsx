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
    <header className="sticky top-0 z-30 bg-surface border-b border-border h-14 flex items-center px-6 gap-4">
      {/* Title */}
      <div className="flex-1 min-w-0">
        <h1 className="text-md font-bold text-text-primary leading-none">{title}</h1>
        {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
      </div>

      {actions && <div className="flex items-center gap-2">{actions}</div>}

      {/* Right controls */}
      <div className="flex items-center gap-2">
        <button className="w-8 h-8 rounded-lg hover:bg-surface-2 flex items-center justify-center transition-colors">
          <Search size={15} className="text-text-muted" />
        </button>

        <button className="relative w-8 h-8 rounded-lg hover:bg-surface-2 flex items-center justify-center transition-colors">
          <Bell size={15} className="text-text-muted" />
          {notificationCount > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-danger text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {notificationCount > 9 ? '9+' : notificationCount}
            </span>
          )}
        </button>

        <DropdownMenu.Root open={open} onOpenChange={setOpen}>
          <DropdownMenu.Trigger asChild>
            <button className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-lg hover:bg-surface-2 transition-colors">
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                <span className="text-white text-[11px] font-bold">{adminInitials}</span>
              </div>
              <ChevronDown size={12} className={cn('text-text-muted transition-transform', open && 'rotate-180')} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 bg-surface border border-border rounded-xl shadow-hover py-1 min-w-[160px] animate-fade-in"
            >
              <div className="px-3 py-2 border-b border-border mb-1">
                <p className="text-xs font-semibold text-text-primary">{adminName}</p>
              </div>
              {['Profile', 'Settings', 'Sign Out'].map(item => (
                <DropdownMenu.Item
                  key={item}
                  className="px-3 py-2 text-sm text-text-secondary hover:bg-surface-2 hover:text-text-primary cursor-pointer outline-none transition-colors"
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
