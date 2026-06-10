'use client'

import { useState } from 'react'
import { User, Mail, ArrowRight } from 'lucide-react'
import OcarLogo from '@/components/ui/OcarLogo'
import { useRouter } from 'next/navigation'
import { userApi } from '@/lib/auth'
import { useAuth } from '@/lib/auth-context'

export default function OnboardingPage() {
  const router = useRouter()
  const { refreshUser } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex flex-col px-6">
        <div className="pt-16 pb-8 flex items-center justify-center">
          <OcarLogo size="lg" />
        </div>

        <div>
          <h1 className="text-2xl font-bold text-text-primary mb-1">Welcome to Ocar 👋</h1>
          <p className="text-text-secondary text-sm mb-8">Tell us your name to get started</p>

          <div className="relative mb-4">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary">
              <User size={16} />
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
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-text-secondary">
              <Mail size={16} />
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

          {error && <p className="text-status-error text-sm mb-4">{error}</p>}

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!isValid || loading}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-5 h-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : (
              <>Get Started <ArrowRight size={18} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
