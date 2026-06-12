import { useState } from 'react'
import { Star, Car, ChevronRight, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import StatusBar from '@/components/ui/StatusBar'
import { useAuthStore } from '@/store/useAuthStore'
import { useSessionStore } from '@/store/useSessionStore'
import { mockEarnings } from '@/lib/mock-data'

const MENU_ITEMS = [
  { label: 'Vehicle Details',    sub: 'Registered vehicle'  },
  { label: 'Documents',          sub: 'Verified documents'  },
  { label: 'Bank Account',       sub: 'Payout account'      },
  { label: 'Emergency Contacts', sub: 'Safety contacts'     },
  { label: 'Help & Support',     sub: 'FAQs, chat support'  },
  { label: 'Terms & Privacy',    sub: ''                    },
]

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active:           { bg: 'rgba(22,163,74,0.10)',  text: '#16A34A' },
  pending_approval: { bg: 'rgba(217,119,6,0.10)',  text: '#D97706' },
  suspended:        { bg: 'rgba(239,68,68,0.10)',  text: '#EF4444' },
  banned:           { bg: 'rgba(239,68,68,0.10)',  text: '#EF4444' },
}

export default function Profile() {
  const navigate = useNavigate()
  const { driver, clearAuth } = useAuthStore()
  const { isOnline } = useSessionStore()
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)

  const displayName  = driver?.full_name ?? driver?.code ?? 'Driver'
  const displayPhone = driver?.phone?.replace('+91', '').trim() ?? '—'
  const initial      = displayName.charAt(0).toUpperCase()
  const statusStyle  = STATUS_COLORS[driver?.status ?? ''] ?? { bg: '#F1F5F9', text: '#94A3B8' }

  function doSignOut() {
    clearAuth()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary pb-24">
      <StatusBar isOnline={isOnline} earningsToday={mockEarnings.today.total} />

      <div className="px-5 pt-[64px] pb-4">
        <h1 className="font-display font-bold text-2xl text-text-primary">Profile</h1>
      </div>

      {/* Avatar card */}
      <div className="mx-5 bg-white rounded-3xl p-5 mb-4 border border-border flex items-center gap-4">
        <div
          className="w-[60px] h-[60px] rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(145deg, #3B82F6 0%, #2563EB 100%)' }}
          aria-hidden="true"
        >
          <span className="text-2xl font-black text-white">{initial}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-text-primary font-bold text-lg leading-tight truncate">{displayName}</p>
          <p className="text-text-muted text-sm mt-0.5">+91 {displayPhone}</p>
          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1">
              <Star size={13} className="text-accent-amber fill-accent-amber" aria-hidden="true" />
              <span className="text-text-secondary text-sm font-semibold">—</span>
            </div>
            <div className="flex items-center gap-1">
              <Car size={13} className="text-text-muted" aria-hidden="true" />
              <span className="text-text-muted text-xs">— trips</span>
            </div>
          </div>
        </div>
        <span
          className="text-xs font-bold px-2.5 py-1 rounded-full capitalize flex-shrink-0"
          style={{ background: statusStyle.bg, color: statusStyle.text }}
        >
          {driver?.status ?? '—'}
        </span>
      </div>

      {/* Menu */}
      <div className="mx-5 bg-white rounded-3xl border border-border overflow-hidden mb-4">
        {MENU_ITEMS.map((item, i) => (
          <button
            key={item.label}
            className={`w-full flex items-center justify-between px-5 py-4 hover:bg-surface-2 transition-colors cursor-pointer ${
              i < MENU_ITEMS.length - 1 ? 'border-b border-border' : ''
            }`}
          >
            <div className="text-left">
              <p className="text-text-primary font-semibold text-sm">{item.label}</p>
              {item.sub && <p className="text-text-muted text-xs mt-0.5">{item.sub}</p>}
            </div>
            <ChevronRight size={15} className="text-text-muted" aria-hidden="true" />
          </button>
        ))}
      </div>

      {/* Sign out */}
      <div className="mx-5">
        <button
          onClick={() => setShowSignOutConfirm(true)}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-accent-red font-bold text-base border border-accent-red/20 bg-accent-red/5 hover:bg-accent-red/10 transition-colors cursor-pointer active:scale-[0.98]"
          style={{ minHeight: 52 }}
        >
          <LogOut size={17} aria-hidden="true" />
          Sign Out
        </button>
      </div>

      {/* Sign out confirmation */}
      {showSignOutConfirm && (
        <div
          className="fixed inset-0 flex items-end justify-center px-5 pb-6"
          style={{ zIndex: 50, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          onClick={() => setShowSignOutConfirm(false)}
        >
          <div
            className="w-full rounded-3xl p-6"
            style={{ background: '#FFFFFF', boxShadow: '0 -4px 32px rgba(0,0,0,0.18)' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="w-8 h-1 bg-border rounded-full mx-auto mb-5" />
            <p className="text-text-primary font-bold text-lg mb-1">Sign out?</p>
            <p className="text-text-muted text-sm mb-6">
              {isOnline
                ? "You're currently online. You'll be taken offline and signed out."
                : 'You will be signed out of your account.'}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSignOutConfirm(false)}
                className="flex-1 py-3 rounded-2xl text-sm font-semibold text-text-secondary border border-border hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={doSignOut}
                className="flex-1 py-3 rounded-2xl text-sm font-bold text-white bg-accent-red hover:opacity-90 transition-opacity"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
