'use client'

import { Car, MessageCircle, HelpCircle, User } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'trip' | 'messages' | 'help' | 'profile'

interface NavItem {
  id: Tab
  icon: React.ElementType
  label: string
  soon?: boolean
}

const items: NavItem[] = [
  { id: 'trip',     icon: Car,           label: 'My Trip'  },
  { id: 'messages', icon: MessageCircle, label: 'Messages', soon: true },
  { id: 'help',     icon: HelpCircle,    label: 'Help',     soon: true },
  { id: 'profile',  icon: User,          label: 'Profile'  },
]

interface BottomNavProps {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
}

export default function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0"
      style={{
        zIndex: 20,
        background: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid rgba(79,70,229,0.08)',
        boxShadow: '0 -1px 0 rgba(79,70,229,0.06)',
      }}
    >
      <div className="mx-auto max-w-[430px]">
        <div
          className="flex items-center justify-around px-2"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)', paddingTop: '10px' }}
        >
          {items.map(({ id, icon: Icon, label, soon }) => {
            const active = activeTab === id
            return (
              <button
                key={id}
                onClick={() => !soon && onTabChange(id)}
                disabled={soon}
                className={cn(
                  'flex flex-col items-center gap-1 min-w-[56px] min-h-[44px] justify-center relative transition-all duration-150',
                  soon ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                )}
              >
                <div
                  className={cn(
                    'w-10 h-7 rounded-full flex items-center justify-center transition-all duration-200',
                    active ? 'bg-primary/10' : ''
                  )}
                >
                  <Icon
                    className={cn(
                      'w-5 h-5 transition-colors duration-150',
                      active ? 'text-primary' : 'text-text-muted'
                    )}
                    strokeWidth={active ? 2.5 : 1.8}
                  />
                </div>
                {soon ? (
                  <span className="text-[9px] font-bold text-text-muted uppercase tracking-wider">Soon</span>
                ) : (
                  <span className={cn(
                    'text-[10px] font-semibold transition-colors duration-150',
                    active ? 'text-primary' : 'text-text-muted'
                  )}>
                    {label}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
