'use client'
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface ReasonDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  variant: 'danger' | 'warning'
  loading: boolean
  onCancel: () => void
  onConfirm: (reason: string) => void
}

export default function ReasonDialog({
  open, title, description, confirmLabel, variant, loading, onCancel, onConfirm,
}: ReasonDialogProps) {
  const [reason, setReason] = useState('')
  const valid = reason.trim().length >= 10
  useEffect(() => { if (!open) setReason('') }, [open])
  const reduce = useReducedMotion()
  const panelTransition = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 300, damping: 30 }
  const btnCls = variant === 'danger'
    ? 'bg-danger text-white hover:bg-red-600'
    : 'bg-warning text-white hover:bg-amber-600'
  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onCancel() }}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-[60] bg-text-primary/40 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="fixed left-1/2 top-1/2 z-[60] bg-surface rounded-2xl shadow-hover p-6 w-full max-w-[440px]"
                initial={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%' }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%' }}
                transition={panelTransition}
              >
                <Dialog.Title className="text-lg font-bold text-text-primary mb-2">{title}</Dialog.Title>
                <Dialog.Description className="text-sm text-text-secondary mb-4 leading-relaxed">{description}</Dialog.Description>
                <textarea
                  value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="Enter reason (minimum 10 characters)…" rows={3}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted mb-1"
                />
                <p className="text-xs text-text-muted mb-5">{reason.trim().length}/10 min chars</p>
                <div className="flex gap-3 justify-end">
                  <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-xl hover:bg-surface-2 transition-colors">Cancel</button>
                  <button
                    onClick={() => onConfirm(reason.trim())}
                    disabled={!valid || loading}
                    className={cn('px-4 py-2 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed', btnCls)}
                  >
                    {loading ? 'Submitting…' : confirmLabel}
                  </button>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
