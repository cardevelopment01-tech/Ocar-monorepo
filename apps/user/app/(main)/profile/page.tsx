'use client'

import { useState, useEffect } from 'react'
import { ChevronRight, Star, MapPin, CreditCard, Bell, Shield, HelpCircle, LogOut, User, Mail, X, Check } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { userApi } from '@/lib/auth'

const MENU_ITEMS = [
  { icon: MapPin,       label: 'Saved places',     sub: 'Home, Work & more'       },
  { icon: CreditCard,   label: 'Payment methods',  sub: 'UPI, Cards & Wallet'     },
  { icon: Bell,         label: 'Notifications',    sub: 'Push & SMS alerts'       },
  { icon: Shield,       label: 'Safety',           sub: 'Emergency contacts'      },
  { icon: HelpCircle,   label: 'Help & Support',   sub: 'FAQs, raise a ticket'    },
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
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 10) return digits
  return digits
}

export default function ProfilePage() {
  const { user, logout, refreshUser } = useAuth()

  const [stats, setStats] = useState<UserStats | null>(null)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    userApi.getMe()
      .then(data => setStats({
        total_rides:    data.total_rides,
        rating_avg:     data.rating_avg,
        wallet_balance: data.wallet_balance,
        name:           data.name,
        email:          data.email,
        phone:          data.phone ?? null,
      }))
      .catch(() => {})
  }, [])

  const displayName  = stats?.name ?? user?.name ?? 'Rider'
  const displayPhone = normalizePhone(stats?.phone ?? user?.phone)
  const displayEmail = stats?.email ?? user?.email ?? null

  const openEdit = () => {
    setEditName(displayName === 'Rider' ? '' : displayName)
    setEditEmail(displayEmail ?? '')
    setSaveError('')
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setSaveError('') }

  const saveEdit = async () => {
    if (editName.trim().length < 2) { setSaveError('Name must be at least 2 characters.'); return }
    setSaving(true)
    setSaveError('')
    try {
      const body: { full_name: string; email?: string } = { full_name: editName.trim() }
      if (editEmail.trim()) body.email = editEmail.trim()
      await userApi.updateProfile(body)
      await refreshUser()
      const fresh = await userApi.getMe()
      setStats(s => s ? { ...s, name: fresh.name, email: fresh.email, phone: fresh.phone ?? null } : s)
      setEditing(false)
    } catch {
      setSaveError('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const totalRides    = stats?.total_rides ?? 0
  const ratingAvg     = stats?.rating_avg
  const walletBalance = stats?.wallet_balance ?? 0

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-surface px-6 pt-safe-top pb-6 shadow-card">
        <div className="pt-5 flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary-subtle flex items-center justify-center text-3xl font-bold text-primary">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-text-primary truncate">{displayName}</h1>
            <p className="text-text-muted text-sm">+91 {displayPhone}</p>
            {displayEmail && (
              <p className="text-text-muted text-xs truncate">{displayEmail}</p>
            )}
          </div>
          <button
            onClick={openEdit}
            className="text-primary text-sm font-semibold px-3 py-1.5 rounded-xl bg-primary-subtle active:scale-95 transition-transform"
          >
            Edit
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-3 mt-5">
          <div className="flex-1 bg-background rounded-2xl px-4 py-3 text-center">
            <p className="text-xl font-bold text-text-primary">{totalRides}</p>
            <p className="text-xs text-text-muted">Rides</p>
          </div>
          <div className="flex-1 bg-background rounded-2xl px-4 py-3 text-center">
            <div className="flex items-center justify-center gap-1">
              <Star size={14} className="fill-status-warning text-status-warning" />
              <p className="text-xl font-bold text-text-primary">
                {ratingAvg != null ? ratingAvg.toFixed(1) : '—'}
              </p>
            </div>
            <p className="text-xs text-text-muted">Rating</p>
          </div>
          <div className="flex-1 bg-background rounded-2xl px-4 py-3 text-center">
            <p className="text-xl font-bold text-text-primary">₹{walletBalance}</p>
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

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 backdrop-blur-sm">
          <div className="bg-surface rounded-t-3xl px-6 pt-5 pb-10 shadow-sheet">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-text-primary">Edit profile</h2>
              <button onClick={cancelEdit} className="w-8 h-8 flex items-center justify-center rounded-full bg-background">
                <X size={16} className="text-text-secondary" />
              </button>
            </div>

            <div className="relative mb-4">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary"><User size={16} /></div>
              <input
                type="text"
                value={editName}
                onChange={e => { setEditName(e.target.value); setSaveError('') }}
                placeholder="Your full name"
                maxLength={120}
                className="input-field pl-11"
                autoFocus
              />
            </div>

            <div className="relative mb-6">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary"><Mail size={16} /></div>
              <input
                type="email"
                value={editEmail}
                onChange={e => setEditEmail(e.target.value)}
                placeholder="Email address (optional)"
                className="input-field pl-11"
              />
            </div>

            {saveError && <p className="text-status-error text-sm mb-4">{saveError}</p>}

            <button
              onClick={() => void saveEdit()}
              disabled={saving || editName.trim().length < 2}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {saving
                ? <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                : <><Check size={16} /> Save changes</>
              }
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
