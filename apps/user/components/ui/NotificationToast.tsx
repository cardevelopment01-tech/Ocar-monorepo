'use client'

import { useRouter } from 'next/navigation'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Bell } from 'lucide-react'
import { useNotifications } from '@/lib/notifications-context'

export default function NotificationToast() {
  const { toast, dismissToast } = useNotifications()
  const router = useRouter()
  const prefersReducedMotion = useReducedMotion()

  return (
    <AnimatePresence>
      {toast && (
        <motion.button
          onClick={() => { dismissToast(); router.push('/notifications') }}
          className="fixed left-4 right-4 z-50 mx-auto max-w-[398px] flex items-center gap-3 rounded-2xl bg-surface border border-border px-4 py-3.5 text-left shadow-card"
          style={{ top: 'max(env(safe-area-inset-top), 16px)' }}
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -16 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0">
            <Bell size={15} strokeWidth={1.8} className="text-primary" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-bold text-text-primary truncate">{toast.title ?? 'Ocar'}</span>
            <span className="block text-[12px] text-text-muted truncate">{toast.body}</span>
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
