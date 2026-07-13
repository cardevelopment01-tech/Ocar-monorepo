import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Bell } from 'lucide-react'
import { useNotificationsStore } from '@/store/useNotificationsStore'

const AUTO_DISMISS_MS = 4000

export default function NotificationToast() {
  const { toast, dismissToast, openSheet } = useNotificationsStore()
  const prefersReducedMotion = useReducedMotion()
  const navigate = useNavigate()

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(dismissToast, AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [toast, dismissToast])

  return (
    <AnimatePresence>
      {toast && (
        <motion.button
          onClick={() => {
            dismissToast()
            const route = toast.payload?.['route']
            if (typeof route === 'string') navigate(`/onboarding/${route}`)
            else openSheet()
          }}
          className="fixed left-4 right-4 z-[130] flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left"
          style={{
            top: 'max(env(safe-area-inset-top), 16px)',
            background: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(79,70,229,0.10)',
            boxShadow: '0 8px 32px rgba(15,23,42,0.16)',
          }}
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -16 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(79,70,229,0.10)' }}>
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
