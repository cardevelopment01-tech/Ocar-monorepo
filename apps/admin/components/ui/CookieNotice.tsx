'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Cookie, X } from 'lucide-react'
import { PRIVACY_URL } from '@/lib/legal'

const DISMISSED_KEY = 'ocar_admin_cookie_notice_dismissed'
const EASE = [0.22, 1, 0.36, 1] as const

// Notice, not an opt-in/opt-out consent gate. Ocar Admin's only cookie
// (ocar_admin_session, see lib/auth.ts) is strictly necessary -- it's how
// this app knows you're signed in -- so there's nothing non-essential to let
// someone reject; rejecting it would just break login. Strictly-necessary
// cookies are exempt from consent requirements (GDPR ePrivacy Art. 5(3); the
// DPDP Act, 2023 has no stricter cookie-specific rule), so disclosure here
// plus the Privacy Policy's cookie section is what's actually required.
export default function CookieNotice() {
  const [visible, setVisible] = useState(false)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(DISMISSED_KEY) === '1') return
    setVisible(true)
  }, [])

  function dismiss() {
    window.localStorage.setItem(DISMISSED_KEY, '1')
    setVisible(false)
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed bottom-4 right-4 left-[72px] sm:left-auto z-40 max-w-sm"
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
          transition={{ duration: 0.28, ease: EASE }}
        >
          <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-lg border border-border">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary-light">
              <Cookie size={14} className="text-primary" />
            </span>
            <p className="flex-1 min-w-0 text-[11.5px] leading-snug text-text-secondary">
              We use essential cookies to keep you signed in.{' '}
              <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">Learn more</a>
            </p>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 bg-surface-2 hover:bg-border transition-colors cursor-pointer"
            >
              <X size={12} className="text-text-secondary" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
