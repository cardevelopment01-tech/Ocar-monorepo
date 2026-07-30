import { useState, useEffect } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Star, Car, ChevronRight, LogOut, Pencil, X, Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import StatusBar from '@/components/ui/StatusBar'
import OcarSpinner from '@/components/ui/OcarSpinner'
import { useAuthStore } from '@/store/useAuthStore'
import { useSessionStore } from '@/store/useSessionStore'
import { driverRideApi } from '@/lib/ride-api'
import api from '@/lib/api'
import { unregisterPush } from '@/lib/push'

const MENU_ITEMS: { label: string; sub: string; action: 'vehicle' | 'documents' | 'emergency' | 'email' | 'terms' }[] = [
  { label: 'Vehicle Details',    sub: 'Registered vehicle',  action: 'vehicle'   },
  { label: 'Documents',          sub: 'Verified documents',  action: 'documents' },
  { label: 'Emergency Contacts', sub: 'Safety contact info', action: 'emergency' },
  { label: 'Help & Support',     sub: 'FAQs, chat support',  action: 'email'     },
  { label: 'Terms & Privacy',    sub: '',                    action: 'terms'     },
]

interface DriverStats {
  total_rides: number
  rating_avg: number | null
  top_tags: { label: string; count: number }[]
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  active:           { bg: 'rgba(22,163,74,0.10)',  text: '#16A34A' },
  pending_approval: { bg: 'rgba(217,119,6,0.10)',  text: '#D97706' },
  suspended:        { bg: 'rgba(239,68,68,0.10)',  text: '#EF4444' },
  banned:           { bg: 'rgba(239,68,68,0.10)',  text: '#EF4444' },
}

export default function Profile() {
  const navigate = useNavigate()
  const { driver, refreshToken, clearAuth, updateDriver } = useAuthStore()
  const { isOnline } = useSessionStore()
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false)
  const prefersReducedMotion = useReducedMotion()

  const [earningsToday, setEarningsToday] = useState(0)
  const [stats,         setStats]         = useState<DriverStats | null>(null)

  const [editing,  setEditing]  = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail,setEditEmail]= useState('')
  const [saving,   setSaving]   = useState(false)
  const [saveErr,  setSaveErr]  = useState('')

  useEffect(() => {
    void driverRideApi.getEarningsSummary('today')
      .then(s => setEarningsToday(s.total_earnings))
      .catch(() => {})
  }, [])

  useEffect(() => {
    void api.get<{ stats: DriverStats }>('/api/v1/drivers/me')
      .then(res => setStats(res.data.stats))
      .catch(() => {})
  }, [])

  function handleMenu(action: (typeof MENU_ITEMS)[number]['action']) {
    if (action === 'vehicle')   { navigate('/onboarding/vehicle');   return }
    if (action === 'documents') { navigate('/onboarding/documents'); return }
    if (action === 'emergency') { navigate('/onboarding/personal');  return }
    if (action === 'email')     { window.open('mailto:support@ocar.in'); return }
    if (action === 'terms')     { window.open('https://ocar.in/terms'); return }
  }

  const displayName  = driver?.full_name ?? driver?.code ?? 'Driver'
  const displayPhone = driver?.phone?.replace('+91', '').trim() ?? '—'
  const initial      = displayName.charAt(0).toUpperCase()
  const statusStyle  = STATUS_COLORS[driver?.status ?? ''] ?? { bg: '#F1F5F9', text: '#94A3B8' }

  function openEdit() {
    setEditName(driver?.full_name ?? '')
    setEditEmail(driver?.email ?? '')
    setSaveErr('')
    setEditing(true)
  }

  async function saveEdit() {
    if (editName.trim().length < 2) { setSaveErr('Name must be at least 2 characters.'); return }
    setSaving(true); setSaveErr('')
    try {
      const body: { full_name: string; email?: string } = { full_name: editName.trim() }
      if (editEmail.trim()) body.email = editEmail.trim()
      const res = await api.patch<{ driver: { full_name: string; email: string | null } }>('/api/v1/drivers/me', body)
      updateDriver({ full_name: res.data.driver.full_name, email: res.data.driver.email })
      setEditing(false)
    } catch {
      setSaveErr('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

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
          <div className="bg-white rounded-3xl p-5 border border-border" style={{ boxShadow: '0 2px 16px rgba(10, 159, 176,0.07)' }}>
            <div className="flex items-center gap-4">
              <div
                className="w-[60px] h-[60px] rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #0A9FB0 0%, #DC3E93 100%)' }}
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
                    <span className="text-text-secondary text-sm font-semibold">
                      {stats?.rating_avg != null ? stats.rating_avg.toFixed(1) : '—'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Car size={13} className="text-text-muted" aria-hidden="true" />
                    <span className="text-text-muted text-xs">{stats?.total_rides ?? 0} trips</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 flex-shrink-0">
                <span
                  className="text-xs font-bold px-2.5 py-1 rounded-full capitalize"
                  style={{ background: statusStyle.bg, color: statusStyle.text }}
                >
                  {driver?.status ?? '—'}
                </span>
                <button
                  onClick={openEdit}
                  aria-label="Edit profile"
                  className="w-9 h-9 rounded-xl flex items-center justify-center bg-surface-2 text-text-secondary cursor-pointer active:scale-95 transition-transform"
                >
                  <Pencil size={14} />
                </button>
              </div>
            </div>
            {stats && stats.top_tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border">
                {stats.top_tags.map(t => (
                  <span key={t.label} className="text-xs font-semibold px-2.5 py-1 rounded-full bg-surface-2 text-text-secondary">
                    {t.label}
                  </span>
                ))}
              </div>
            )}
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

      {/* Sign out confirmation: outside scroll region, above BottomNav */}
      {showSignOutConfirm && (
        <div
          className="fixed inset-0 flex items-end justify-center px-5 pb-6"
          style={{ zIndex: 110, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
          onClick={() => setShowSignOutConfirm(false)}
        >
          <div
            className="w-full rounded-3xl p-6"
            style={{ background: '#FFFFFF', boxShadow: '0 -4px 32px rgba(10, 159, 176,0.12)' }}
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

      {/* Edit profile sheet */}
      <AnimatePresence>
        {editing && (
          <motion.div
            className="fixed inset-0 flex items-end justify-center px-5 pb-6"
            style={{ zIndex: 110, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setEditing(false)}
          >
            <motion.div
              className="w-full rounded-3xl p-6"
              style={{ background: '#FFFFFF', boxShadow: '0 -4px 32px rgba(10, 159, 176,0.12)' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <div className="w-8 h-1 bg-border rounded-full mx-auto mb-5" />
              <div className="flex items-center justify-between mb-5">
                <p className="text-text-primary font-bold text-lg">Edit profile</p>
                <button
                  onClick={() => setEditing(false)}
                  className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center"
                  aria-label="Close"
                >
                  <X size={15} className="text-text-secondary" />
                </button>
              </div>

              <input
                className="input-light mb-3"
                type="text"
                value={editName}
                onChange={e => { setEditName(e.target.value); setSaveErr('') }}
                placeholder="Your full name"
                maxLength={120}
                autoFocus
              />
              <input
                className="input-light mb-5"
                type="email"
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                placeholder="Email address (optional)"
              />

              {saveErr && <p className="text-accent-red text-sm mb-4">{saveErr}</p>}

              <button
                onClick={() => void saveEdit()}
                disabled={saving || editName.trim().length < 2}
                className="btn-primary flex items-center justify-center gap-2"
              >
                {saving
                  ? <OcarSpinner size={16} variant="white" />
                  : <><Check size={15} /> Save changes</>
                }
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
