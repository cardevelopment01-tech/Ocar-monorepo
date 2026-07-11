'use client'

import { useRouter } from 'next/navigation'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useNotifications } from '@/lib/notifications-context'
import { getNotificationIcon, getNotificationTint } from '@/lib/notification-icons'
import type { NotificationItem } from '@/lib/notifications-api'

function ToastCard({ toast, onOpen }: { toast: NotificationItem; onOpen: () => void }) {
  const Icon = getNotificationIcon(toast.type)
  const tint = getNotificationTint(toast.type, true)

  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-left shadow-card active:scale-[0.98] transition-transform duration-150"
    >
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tint.bg}`}>
        <Icon size={15} strokeWidth={1.8} className={tint.text} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-bold text-text-primary truncate">{toast.title ?? 'Ocar'}</span>
        <span className="block text-[12px] text-text-muted truncate">{toast.body}</span>
      </span>
    </button>
  )
}

export default function NotificationToast() {
  const { toast, dismissToast } = useNotifications()
  const router = useRouter()
  const prefersReducedMotion = useReducedMotion()

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          drag={prefersReducedMotion ? false : 'y'}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.6, bottom: 0 }}
          onDragEnd={(_e, info) => {
            if (info.offset.y < -36 || info.velocity.y < -400) dismissToast()
          }}
          className="fixed left-4 right-4 z-50 mx-auto max-w-[398px]"
          style={{ top: 'max(env(safe-area-inset-top), 16px)' }}
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -20, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -10, filter: 'blur(3px)' }}
          transition={{ type: 'spring', duration: 0.45, bounce: 0 }}
        >
          <ToastCard toast={toast} onOpen={() => { dismissToast(); router.push('/notifications') }} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
