'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'

// Minimal local success toast for CRUD actions (approve/reject/ban/save).
// Distinct from NotificationToast (components/layout), which is wired to the
// push-notification feed/socket and shouldn't be used for ad-hoc UI feedback.
export default function SuccessToast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  // Portalled to <body>: the dashboard wrapper's animate-fade-in (forwards) leaves a transform on it,
  // and a `fixed` child of a transformed element positions against that element, not the viewport.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(onDismiss, 2500)
    return () => clearTimeout(t)
  }, [message, onDismiss])

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          // Intentionally NOT the shared { stiffness: 300, damping: 30 } spring used
          // by SlideOver/ConfirmDialog/ReasonDialog — a toast that pops in and out
          // corner-of-eye, several times a session, reads better with a quick,
          // settled ease-out than a bouncy spring overshoot.
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="fixed top-4 right-6 z-[80] flex items-center gap-2.5 rounded-2xl bg-surface border border-border px-4 py-3 text-sm font-semibold text-text-primary"
          style={{ boxShadow: '0 8px 32px rgba(15,23,42,0.16), 0 0 0 1px #DCEBEE' }}
        >
          <CheckCircle2 size={16} className="text-success flex-shrink-0" />
          {message}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}
