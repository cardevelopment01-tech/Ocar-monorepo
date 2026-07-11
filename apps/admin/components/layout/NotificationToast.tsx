'use client'

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Bell } from 'lucide-react'
import { useNotifications } from '@/lib/notifications-context'

export default function NotificationToast() {
  const { toast, dismissToast, openPanel } = useNotifications()
  const prefersReducedMotion = useReducedMotion()

  return (
    <AnimatePresence>
      {toast && (
        <motion.button
          onClick={() => { dismissToast(); openPanel() }}
          className="fixed top-4 right-6 z-50 flex items-center gap-3 rounded-2xl bg-surface border border-border px-4 py-3.5 text-left max-w-[360px] cursor-pointer"
          style={{ boxShadow: '0 8px 32px rgba(15,23,42,0.16), 0 0 0 1px #E8EAFF' }}
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0">
            <Bell size={15} strokeWidth={1.8} className="text-primary" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-bold text-text-primary truncate">{toast.title ?? 'Ocar Admin'}</span>
            <span className="block text-xs text-text-muted truncate">{toast.body}</span>
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
