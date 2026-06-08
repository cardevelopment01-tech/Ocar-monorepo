'use client'

import { Car, MessageCircle, HelpCircle, User } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'trip' | 'messages' | 'help' | 'profile'

interface NavItem {
  id: Tab
  icon: React.ElementType
  label: string
}

const items: NavItem[] = [
  { id: 'trip',     icon: Car,           label: 'My Trip'  },
  { id: 'messages', icon: MessageCircle, label: 'Messages' },
  { id: 'help',     icon: HelpCircle,    label: 'Help'     },
  { id: 'profile',  icon: User,          label: 'Profile'  },
]

interface BottomNavProps {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
}

export default function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border"
      style={{ zIndex: 20 }}
    >
      <div className="mx-auto max-w-[430px]">
        <div
          className="flex items-center justify-around px-2"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)', paddingTop: '10px' }}
        >
          {items.map(({ id, icon: Icon, label }) => {
            const active = activeTab === id
            return (
              <button
                key={id}
                onClick={() => onTabChange(id)}
                className="flex flex-col items-center gap-1 min-w-[44px] min-h-[44px] justify-center"
              >
                <Icon
                  className={cn(
                    'w-6 h-6 transition-colors',
                    active ? 'text-primary' : 'text-text-muted'
                  )}
                  strokeWidth={active ? 2.5 : 1.8}
                />
                {active && (
                  <span className="w-1 h-1 rounded-full bg-primary" />
                )}
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
