'use client'

import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2 } from 'lucide-react'

// Minimal local success toast for CRUD actions (approve/reject/ban/save).
// Distinct from NotificationToast (components/layout), which is wired to the
// push-notification feed/socket and shouldn't be used for ad-hoc UI feedback.
export default function SuccessToast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return
    const t = setTimeout(onDismiss, 2500)
    return () => clearTimeout(t)
  }, [message, onDismiss])

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="fixed top-4 right-6 z-[80] flex items-center gap-2.5 rounded-2xl bg-surface border border-border px-4 py-3 text-sm font-semibold text-text-primary"
          style={{ boxShadow: '0 8px 32px rgba(15,23,42,0.16), 0 0 0 1px #E8EAFF' }}
        >
          <CheckCircle2 size={16} className="text-success flex-shrink-0" />
          {message}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
