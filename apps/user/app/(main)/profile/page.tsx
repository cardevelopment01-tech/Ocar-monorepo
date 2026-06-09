'use client'

import { ChevronRight, Star, MapPin, CreditCard, Bell, Shield, HelpCircle, LogOut } from 'lucide-react'
import { mockRideHistory } from '@/lib/mock-data'
import { useAuth } from '@/lib/auth-context'

const MENU_ITEMS = [
  { icon: MapPin,       label: 'Saved places',     sub: 'Home, Work & more'       },
  { icon: CreditCard,   label: 'Payment methods',  sub: 'UPI, Cards & Wallet'     },
  { icon: Bell,         label: 'Notifications',    sub: 'Push & SMS alerts'       },
  { icon: Shield,       label: 'Safety',           sub: 'Emergency contacts'      },
  { icon: HelpCircle,   label: 'Help & Support',   sub: 'FAQs, raise a ticket'    },
]

export default function ProfilePage() {
  const { user, logout } = useAuth()
  const completedRides = mockRideHistory.filter(r => r.status === 'completed').length

  const displayName  = user?.name ?? 'Rider'
  const displayPhone = user?.phone
    ? user.phone.replace('+91', '').trim()
    : '—'

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-surface px-6 pt-safe-top pb-6 shadow-card">
        <div className="pt-5 flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary-subtle flex items-center justify-center text-3xl">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-text-primary truncate">{displayName}</h1>
            <p className="text-text-muted text-sm">+91 {displayPhone}</p>
          </div>
          <button className="text-primary text-sm font-semibold">Edit</button>
        </div>

        {/* Stats */}
        <div className="flex gap-3 mt-5">
          <div className="flex-1 bg-background rounded-2xl px-4 py-3 text-center">
            <p className="text-xl font-bold text-text-primary">{completedRides}</p>
            <p className="text-xs text-text-muted">Rides</p>
          </div>
          <div className="flex-1 bg-background rounded-2xl px-4 py-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <Star size={14} className="fill-status-warning text-status-warning" />
              <p className="text-xl font-bold text-text-primary">4.9</p>
            </div>
            <p className="text-xs text-text-muted">Rating</p>
          </div>
          <div className="flex-1 bg-background rounded-2xl px-4 py-3 text-center">
            <p className="text-xl font-bold text-text-primary">₹0</p>
            <p className="text-xs text-text-muted">Wallet</p>
          </div>
        </div>
      </div>

      {/* Menu */}
      <div className="px-4 mt-4">
        <div className="card p-0 divide-y divide-border">
          {MENU_ITEMS.map(item => (
            <button
              key={item.label}
              className="w-full flex items-center gap-3 px-4 py-4"
            >
              <div className="w-10 h-10 bg-background rounded-xl flex items-center justify-center flex-shrink-0">
                <item.icon size={18} className="text-primary" />
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-text-primary">{item.label}</p>
                <p className="text-xs text-text-muted">{item.sub}</p>
              </div>
              <ChevronRight size={18} className="text-text-muted flex-shrink-0" />
            </button>
          ))}
        </div>

        <button
          onClick={logout}
          className="w-full mt-4 card flex items-center justify-center gap-2 text-status-error font-semibold text-sm"
        >
          <LogOut size={16} />
          Sign out
        </button>

        <p className="text-center text-text-muted text-xs mt-6">Ocar v1.0.0</p>
      </div>
    </div>
  )
}
