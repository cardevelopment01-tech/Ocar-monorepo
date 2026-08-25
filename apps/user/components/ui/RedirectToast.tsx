'use client'

import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRightLeft } from 'lucide-react'

const EASE = [0.22, 1, 0.36, 1] as const

// Shared "redirecting…" toast — portal + gradient card + 1.5s countdown bar.
// Used wherever a page auto-redirects the user to a different flow (e.g.
// in-city vs outstation, or a ride-type mismatch) and wants to say why.
export default function RedirectToast({ message }: { message: string | null }) {
  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {message && (
        <motion.div
          key="redirect-toast"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 16, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.95 }}
          transition={{ duration: 0.24, ease: EASE }}
          className="fixed left-1/2 z-[999] flex flex-col gap-2 px-5 py-3.5 rounded-2xl text-white overflow-hidden pointer-events-none"
          style={{
            bottom: 'max(84px, calc(env(safe-area-inset-bottom, 0px) + 76px))',
            x: '-50%',
            maxWidth: 'calc(100vw - 32px)',
            background: 'linear-gradient(135deg, #0A9FB0 0%, #1E1B4B 100%)',
            boxShadow: '0 8px 32px rgba(10, 159, 176,0.35), 0 2px 8px rgba(0,0,0,0.2)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <ArrowRightLeft size={15} strokeWidth={2.2} className="flex-shrink-0" />
            <span className="text-[13px] font-semibold">{message}</span>
          </div>
          <div className="h-[3px] rounded-full bg-white/20 overflow-hidden">
            <motion.div
              className="h-full bg-white/80 rounded-full"
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: 1.5, ease: 'linear' }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
