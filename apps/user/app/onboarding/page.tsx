'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { User, Mail, ArrowRight, Sparkles } from 'lucide-react'
import OcarSpinner from '@/components/ui/OcarSpinner'
import { useRouter } from 'next/navigation'
import { userApi } from '@/lib/auth'
import { useAuth } from '@/lib/auth-context'

const EASE   = [0.22, 1, 0.36, 1] as const
const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

const PARTICLES = [
  { top: '8%',  left: '12%', delay: 0,   dur: 3.0 },
  { top: '30%', left: '82%', delay: 0.8, dur: 2.6 },
  { top: '62%', left: '90%', delay: 1.4, dur: 3.3 },
  { top: '75%', left: '5%',  delay: 0.3, dur: 2.8 },
]

export default function OnboardingPage() {
  const router = useRouter()
  const { refreshUser } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email,    setEmail]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  const isValid = fullName.trim().length >= 2

  async function handleSubmit() {
    if (!isValid || loading) return
    setError('')
    setLoading(true)
    try {
      const body: { full_name: string; email?: string } = { full_name: fullName.trim() }
      if (email.trim()) body.email = email.trim()
      await userApi.updateProfile(body)
      await refreshUser()
      router.push('/home')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-[100dvh] flex flex-col"
      style={{ background: 'linear-gradient(160deg, #0F0F23 0%, #1E1B4B 100%)' }}
    >
      {/* ── Decorative layer ── */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 260, height: 260, top: -80, right: -60,
            background: 'radial-gradient(circle, rgba(99,102,241,0.38) 0%, transparent 70%)',
            filter: 'blur(52px)',
          }}
          animate={{ x: [0, 14, -6, 0], y: [0, -10, 8, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 180, height: 180, bottom: 160, left: -50,
            background: 'radial-gradient(circle, rgba(220, 62, 147,0.28) 0%, transparent 70%)',
            filter: 'blur(44px)',
          }}
          animate={{ x: [0, -8, 12, 0], y: [0, 14, -6, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
        />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        {PARTICLES.map((p, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-white"
            style={{ top: p.top, left: p.left }}
            animate={{ opacity: [0.12, 0.65, 0.12], scale: [0.8, 1.3, 0.8] }}
            transition={{ duration: p.dur, repeat: Infinity, ease: 'easeInOut', delay: p.delay }}
          />
        ))}
      </div>

      {/* ── Hero ── */}
      <motion.div
        className="flex flex-col items-center justify-center pt-16 pb-8 px-6"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE }}
      >
        <div
          className="w-16 h-16 rounded-[22px] flex items-center justify-center mb-4"
          style={{
            background: 'linear-gradient(135deg, #0A9FB0 0%, #DC3E93 100%)',
            boxShadow: '0 12px 40px rgba(10, 159, 176,0.45), inset 0 1px 0 rgba(255,255,255,0.20)',
          }}
        >
          <Sparkles size={28} className="text-white" strokeWidth={1.6} />
        </div>
        <p className="text-white font-black text-2xl tracking-tight">Almost there!</p>
        <p className="text-sm mt-1.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Just tell us your name
        </p>
      </motion.div>

      {/* ── Form card ── */}
      <motion.div
        className="flex-1 relative z-10 rounded-t-[32px] bg-white flex flex-col px-6 pt-8 pb-12"
        style={{ boxShadow: '0 -4px 40px rgba(0,0,0,0.25)' }}
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE, delay: 0.1 }}
      >
        <h1 className="text-2xl font-bold text-text-primary mb-1">Welcome to Ocar</h1>
        <p className="text-text-secondary text-sm mb-8">Tell us a bit about yourself to get started</p>

        <div className="relative mb-4">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
            <User size={15} />
          </div>
          <input
            type="text"
            value={fullName}
            onChange={e => { setFullName(e.target.value); setError('') }}
            placeholder="Your full name"
            maxLength={120}
            className="input-field pl-11 text-base"
            onKeyDown={e => e.key === 'Enter' && !e.repeat && void handleSubmit()}
            autoFocus
          />
        </div>

        <div className="relative mb-6">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
            <Mail size={15} />
          </div>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email address (optional)"
            className="input-field pl-11 text-base"
            onKeyDown={e => e.key === 'Enter' && !e.repeat && void handleSubmit()}
          />
        </div>

        {error && (
          <div
            className="mb-4 px-4 py-2.5 rounded-xl text-sm font-medium text-status-error flex items-center gap-2"
            style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)' }}
          >
            {error}
          </div>
        )}

        <motion.button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!isValid || loading}
          className="btn-primary w-full flex items-center justify-center gap-2"
          whileTap={isValid && !loading ? { scale: 0.97 } : {}}
          transition={SPRING}
        >
          {loading ? (
            <OcarSpinner size={20} variant="white" />
          ) : (
            <>Get Started <ArrowRight size={17} /></>
          )}
        </motion.button>
      </motion.div>
    </div>
  )
}
