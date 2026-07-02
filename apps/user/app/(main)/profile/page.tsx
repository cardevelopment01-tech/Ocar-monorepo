'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronRight, Star, MapPin, CreditCard, Bell,
  Shield, HelpCircle, LogOut, User, Mail, X, Check,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { userApi } from '@/lib/auth'
import OcarSpinner from '@/components/ui/OcarSpinner'

const EASE   = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE } },
}
const stagger = {
  hidden: {},
  show:   { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
}

const MENU = [
  { Icon: MapPin,     label: 'Saved places',    sub: 'Home, Work & more',    href: '/saved-places'    },
  { Icon: CreditCard, label: 'Payment methods', sub: 'UPI, Cards & Wallet',  href: '/payment-methods' },
  { Icon: Bell,       label: 'Notifications',   sub: 'Push & SMS alerts',    href: '/notifications'   },
  { Icon: Shield,     label: 'Safety',          sub: 'Emergency contacts',   href: '/safety'          },
  { Icon: HelpCircle, label: 'Help & Support',  sub: 'FAQs, raise a ticket', href: '/help'            },
]

interface UserStats {
  total_rides: number
  rating_avg: number | null
  wallet_balance: number
  name: string | null
  email: string | null
  phone: string | null
}

function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '—'
  const d = raw.replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) return d.slice(2)
  return d.length === 10 ? d : d
}

const ICON_BG  = '#F1F0FE'
const ICON_CLR = '#4F46E5'

export default function ProfilePage() {
  const router = useRouter()
  const { user, logout, refreshUser } = useAuth()

  const [stats,           setStats]           = useState<UserStats | null>(null)
  const [editing,         setEditing]         = useState(false)
  const [editName,        setEditName]        = useState('')
  const [editEmail,       setEditEmail]       = useState('')
  const [saving,          setSaving]          = useState(false)
  const [saveErr,         setSaveErr]         = useState('')
  const [showSignOut,     setShowSignOut]     = useState(false)

  useEffect(() => {
    userApi.getMe()
      .then(d => setStats({
        total_rides:    d.total_rides,
        rating_avg:     d.rating_avg,
        wallet_balance: d.wallet_balance,
        name:           d.name,
        email:          d.email,
        phone:          d.phone ?? null,
      }))
      .catch(() => {})
  }, [])

  const displayName  = stats?.name ?? user?.name ?? 'Rider'
  const displayPhone = normalizePhone(stats?.phone ?? user?.phone)
  const displayEmail = stats?.email ?? user?.email ?? null
  const initial      = displayName.charAt(0).toUpperCase()

  function openEdit() {
    setEditName(displayName === 'Rider' ? '' : displayName)
    setEditEmail(displayEmail ?? '')
    setSaveErr('')
    setEditing(true)
  }

  async function saveEdit() {
    if (editName.trim().length < 2) { setSaveErr('Name must be at least 2 characters.'); return }
    setSaving(true); setSaveErr('')
    try {
      const body: { full_name: string; email?: string } = { full_name: editName.trim() }
      if (editEmail.trim()) body.email = editEmail.trim()
      await userApi.updateProfile(body)
      await refreshUser()
      const fresh = await userApi.getMe()
      setStats(s => s ? { ...s, name: fresh.name, email: fresh.email, phone: fresh.phone ?? null } : s)
      setEditing(false)
    } catch {
      setSaveErr('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-background">

      {/* ── Header ── */}
      <div
        className="flex-shrink-0 px-5 pt-safe-top pb-6"
        style={{ background: 'linear-gradient(160deg, #0F0F23 0%, #1E1B4B 100%)' }}
      >
        {/* Avatar + info */}
        <motion.div
          className="flex items-center gap-4 mt-4 mb-6"
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: EASE }}
        >
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white flex-shrink-0"
            style={{ background: 'rgba(99,102,241,0.50)', border: '2px solid rgba(255,255,255,0.15)' }}
          >
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-lg leading-tight truncate">{displayName}</p>
            <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.50)' }}>+91 {displayPhone}</p>
            {displayEmail && (
              <p className="text-xs truncate mt-0.5" style={{ color: 'rgba(255,255,255,0.38)' }}>{displayEmail}</p>
            )}
          </div>
          <motion.button
            onClick={openEdit}
            className="text-xs font-semibold rounded-xl px-3 py-1.5"
            style={{ background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.80)' }}
            whileTap={{ scale: 0.92 }}
            transition={SPRING}
          >
            Edit
          </motion.button>
        </motion.div>

        {/* Stats */}
        <motion.div
          className="grid grid-cols-3 gap-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.38, ease: EASE }}
        >
          {[
            { value: stats?.total_rides ?? 0,  label: 'Rides' },
            { value: stats?.rating_avg != null ? stats.rating_avg.toFixed(1) : '—', label: 'Rating', star: true },
            { value: `₹${stats?.wallet_balance ?? 0}`, label: 'Wallet' },
          ].map(s => (
            <div
              key={s.label}
              className="rounded-2xl px-3 py-3 text-center"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.10)' }}
            >
              <div className="flex items-center justify-center gap-1">
                {s.star && <Star size={12} className="fill-status-warning text-status-warning" />}
                <p className="text-lg font-bold text-white">{s.value}</p>
              </div>
              <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>{s.label}</p>
            </div>
          ))}
        </motion.div>
      </div>

      {/* ── Scrollable body ── */}
      <motion.div
        className="flex-1 overflow-y-auto scrollbar-none px-4 pt-5 pb-28"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        {/* Menu */}
        <motion.div variants={fadeUp}>
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-3">Account</p>
          <div className="bg-surface rounded-2xl border border-border overflow-hidden" style={{ boxShadow: '0 2px 12px rgba(15,15,35,0.07)' }}>
            {MENU.map((item, i) => (
              <motion.button
                key={item.label}
                onClick={() => router.push(item.href)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left${i < MENU.length - 1 ? ' border-b border-border' : ''}`}
                whileTap={{ backgroundColor: '#F8FAFF' }}
                transition={SPRING}
              >
                <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: ICON_BG }}>
                  <item.Icon size={15} strokeWidth={1.6} style={{ color: ICON_CLR }} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-text-primary">{item.label}</span>
                  <span className="block text-xs text-text-muted mt-0.5">{item.sub}</span>
                </span>
                <ChevronRight size={14} className="text-text-muted flex-shrink-0" />
              </motion.button>
            ))}
          </div>
        </motion.div>

        {/* Sign out */}
        <motion.div variants={fadeUp} className="mt-4">
          <motion.button
            onClick={() => setShowSignOut(true)}
            className="w-full flex items-center justify-center gap-2 bg-surface border border-border rounded-2xl py-3.5 text-sm font-semibold text-status-error"
            style={{ boxShadow: '0 2px 12px rgba(15,15,35,0.07)' }}
            whileTap={{ scale: 0.98 }}
            transition={SPRING}
          >
            <LogOut size={15} strokeWidth={1.8} />
            Sign out
          </motion.button>
        </motion.div>

        <motion.p
          variants={fadeUp}
          className="text-center text-text-muted text-xs mt-6"
        >
          Ocar v1.0.0
        </motion.p>
      </motion.div>

      {/* ── Sign out confirmation ── */}
      <AnimatePresence>
        {showSignOut && (
          <motion.div
            className="fixed inset-0 z-50 flex flex-col justify-end"
            style={{ background: 'rgba(0,0,0,0.45)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setShowSignOut(false)}
          >
            <motion.div
              className="bg-surface rounded-t-3xl px-5 pt-5 pb-10"
              style={{ boxShadow: '0 -6px 32px rgba(0,0,0,0.18)' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <div className="w-10 h-1 bg-border rounded-full mx-auto mb-5" />
              <p className="text-base font-bold text-text-primary mb-1">Sign out?</p>
              <p className="text-sm text-text-muted mb-6">You will be signed out of your Ocar account.</p>
              <div className="flex gap-3">
                <motion.button
                  onClick={() => setShowSignOut(false)}
                  className="flex-1 py-3 rounded-2xl text-sm font-semibold text-text-secondary border border-border"
                  whileTap={{ scale: 0.97 }}
                  transition={SPRING}
                >
                  Cancel
                </motion.button>
                <motion.button
                  onClick={logout}
                  className="flex-1 py-3 rounded-2xl text-sm font-bold text-white bg-status-error"
                  whileTap={{ scale: 0.97 }}
                  transition={SPRING}
                >
                  Sign out
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Edit modal ── */}
      <AnimatePresence>
        {editing && (
          <motion.div
            className="fixed inset-0 z-50 flex flex-col justify-end"
            style={{ background: 'rgba(0,0,0,0.45)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) setEditing(false) }}
          >
            <motion.div
              className="bg-surface rounded-t-3xl px-5 pt-5 pb-10"
              style={{ boxShadow: '0 -6px 32px rgba(0,0,0,0.18)' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            >
              <div className="w-10 h-1 bg-border rounded-full mx-auto mb-5" />
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-base font-bold text-text-primary">Edit profile</h2>
                <button
                  onClick={() => setEditing(false)}
                  className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center"
                >
                  <X size={15} className="text-text-secondary" />
                </button>
              </div>

              <div className="relative mb-3">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
                  <User size={15} />
                </div>
                <input
                  type="text"
                  value={editName}
                  onChange={e => { setEditName(e.target.value); setSaveErr('') }}
                  placeholder="Your full name"
                  maxLength={120}
                  className="input-field pl-11"
                  autoFocus
                />
              </div>

              <div className="relative mb-5">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
                  <Mail size={15} />
                </div>
                <input
                  type="email"
                  value={editEmail}
                  onChange={e => setEditEmail(e.target.value)}
                  placeholder="Email address (optional)"
                  className="input-field pl-11"
                />
              </div>

              {saveErr && <p className="text-status-error text-xs mb-4">{saveErr}</p>}

              <motion.button
                onClick={() => void saveEdit()}
                disabled={saving || editName.trim().length < 2}
                className="btn-primary w-full flex items-center justify-center gap-2"
                whileTap={{ scale: 0.98 }}
                transition={SPRING}
              >
                {saving
                  ? <OcarSpinner size={20} variant="white" />
                  : <><Check size={15} /> Save changes</>
                }
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
