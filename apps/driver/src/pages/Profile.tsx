import { useState, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Star, Car, ChevronRight, LogOut } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import StatusBar from '@/components/ui/StatusBar'
import { useAuthStore } from '@/store/useAuthStore'
import { useSessionStore } from '@/store/useSessionStore'
import { driverRideApi } from '@/lib/ride-api'
import api from '@/lib/api'
import { unregisterPush } from '@/lib/push'

const MENU_ITEMS: { label: string; sub: string; action: 'vehicle' | 'documents' | 'soon' | 'email' | 'terms' }[] = [
  { label: 'Vehicle Details',    sub: 'Registered vehicle',  action: 'vehicle'   },
  { label: 'Documents',          sub: 'Verified documents',  action: 'documents' },
  { label: 'Bank Account',       sub: 'Payout account',      action: 'soon'      },
  { label: 'Emergency Contacts', sub: 'Safety contacts',     action: 'soon'      },
  { label: 'Help & Support',     sub: 'FAQs, chat support',  action: 'email'     },
  { label: 'Terms & Privacy',    sub: '',                    action: 'terms'     },
]

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active:           { bg: 'rgba(22,163,74,0.10)',  text: '#16A34A' },
  pending_approval: { bg: 'rgba(217,119,6,0.10)',  text: '#D97706' },
  suspended:        { bg: 'rgba(239,68,68,0.10)',  text: '#EF4444' },
  banned:           { bg: 'rgba(239,68,68,0.10)',  text: '#EF4444' },
}

export default function Profile() {
  const navigate = useNavigate()
  const { driver, refreshToken, clearAuth } = useAuthStore()
  const { isOnline } = useSessionStore()
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)
  const prefersReducedMotion = useReducedMotion()

  const [earningsToday, setEarningsToday] = useState(0)
  const [toastMsg,      setToastMsg]      = useState<string | null>(null)

  useEffect(() => {
    void driverRideApi.getEarningsSummary('today')
      .then(s => setEarningsToday(s.total_earnings))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 2200)
    return () => clearTimeout(t)
  }, [toastMsg])

  function handleMenu(action: (typeof MENU_ITEMS)[number]['action']) {
    if (action === 'vehicle')   { navigate('/onboarding/vehicle');   return }
    if (action === 'documents') { navigate('/onboarding/documents'); return }
    if (action === 'email')     { window.open('mailto:support@ocar.in'); return }
    if (action === 'terms')     { window.open('https://ocar.in/terms'); return }
    setToastMsg('Coming soon')
  }

  const displayName  = driver?.full_name ?? driver?.code ?? 'Driver'
  const displayPhone = driver?.phone?.replace('+91', '').trim() ?? '—'
  const initial      = displayName.charAt(0).toUpperCase()
  const statusStyle  = STATUS_COLORS[driver?.status ?? ''] ?? { bg: '#F1F5F9', text: '#94A3B8' }

  async function doSignOut() {
    if (refreshToken) {
      void api.post('/api/v1/auth/logout', { refreshToken }).catch(() => undefined)
    }
    await unregisterPush()
    clearAuth()
    navigate('/login', { replace: true })
  }

  return (
    <div className="h-[100dvh] bg-bg text-text-primary flex flex-col overflow-hidden">
      <StatusBar isOnline={isOnline} earningsToday={earningsToday} />

      <div className="flex-shrink-0 px-5 pt-[64px] pb-4">
        <h1 className="font-display font-bold text-2xl text-text-primary">Profile</h1>
      </div>

      {/* Scrollable content */}
      <div
        className="flex-1 overflow-y-auto min-h-0 pb-24"
        style={{ overscrollBehaviorY: 'contain' }}
      >
        {/* Avatar card */}
        <motion.div
          className="mx-5 mb-4"
          initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="bg-white rounded-3xl p-5 border border-border flex items-center gap-4" style={{ boxShadow: '0 2px 16px rgba(79,70,229,0.07)' }}>
            <div
              className="w-[60px] h-[60px] rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)' }}
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
        </motion.div>

        {/* Menu */}
        <div className="mx-5 bg-white rounded-3xl border border-border overflow-hidden mb-4">
          {MENU_ITEMS.map((item, i) => (
            <motion.div
              key={item.label}
              initial={prefersReducedMotion ? false : { opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.24, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
            >
              <button
                onClick={() => handleMenu(item.action)}
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
            </motion.div>
          ))}
        </div>

        {/* Sign out */}
        <div className="mx-5">
          <button
            onClick={() => setShowSignOutConfirm(true)}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-accent-red font-bold text-base border border-accent-red/30 bg-accent-red/5 hover:bg-accent-red/10 transition-colors cursor-pointer active:scale-[0.98]"
            style={{ minHeight: 52 }}
          >
            <LogOut size={17} aria-hidden="true" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Toast snackbar */}
      {toastMsg && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl bg-text-primary text-white text-sm font-semibold shadow-lg pointer-events-none">
          {toastMsg}
        </div>
      )}

      {/* Sign out confirmation: outside scroll region, above BottomNav */}
      {showSignOutConfirm && (
        <div
          className="fixed inset-0 flex items-end justify-center px-5 pb-6"
          style={{ zIndex: 110, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          onClick={() => setShowSignOutConfirm(false)}
        >
          <div
            className="w-full rounded-3xl p-6"
            style={{ background: '#FFFFFF', boxShadow: '0 -4px 32px rgba(79,70,229,0.12)' }}
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
                onClick={() => void doSignOut()}
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
