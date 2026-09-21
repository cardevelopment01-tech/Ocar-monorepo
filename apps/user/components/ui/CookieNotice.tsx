'use client'

import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Cookie, X } from 'lucide-react'

const DISMISSED_KEY = 'ocar_cookie_notice_dismissed'
const EASE = [0.22, 1, 0.36, 1] as const

// This is a notice, not an opt-in/opt-out consent gate. Ocar's only cookie
// (ocar_user_session, see lib/auth.ts) is strictly necessary -- it's how
// middleware.ts knows you're signed in -- so there's nothing non-essential to
// let someone reject; rejecting it would just break login. Strictly-necessary
// cookies are exempt from consent requirements (GDPR ePrivacy Art. 5(3); the
// DPDP Act, 2023 has no stricter cookie-specific rule), so disclosure here
// plus the Privacy Policy's cookie section (/legal/privacy) is what's
// actually required -- see that conversation's decision if this ever needs
// revisiting.
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
          className="fixed left-0 right-0 z-40 flex justify-center px-4"
          style={{ bottom: 'max(env(safe-area-inset-bottom), 16px)' }}
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
          transition={{ duration: 0.32, ease: EASE }}
        >
          <div className="w-full max-w-[398px] flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 shadow-card border border-border">
            <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary-subtle">
              <Cookie size={15} className="text-primary" />
            </span>
            <p className="flex-1 min-w-0 text-[12px] leading-snug text-text-secondary">
              We use essential cookies to keep you signed in.{' '}
              <a href="/legal/privacy" className="font-semibold text-primary underline">Learn more</a>
            </p>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 bg-surface-2 active:scale-95 transition-transform"
            >
              <X size={13} className="text-text-secondary" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
