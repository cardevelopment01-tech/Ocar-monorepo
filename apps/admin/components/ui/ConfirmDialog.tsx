'use client'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  variant?: 'danger' | 'success' | 'warning'
}

const VARIANT_BTN: Record<string, string> = {
  danger:  'bg-danger text-white hover:bg-red-600',
  success: 'bg-success text-white hover:bg-emerald-600',
  warning: 'bg-warning text-white hover:bg-amber-600',
}

export default function ConfirmDialog({
  open, onOpenChange, title, description,
  confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  onConfirm, variant = 'danger',
}: ConfirmDialogProps) {
  const reduce = useReducedMotion()
  const panelTransition = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 300, damping: 30 }
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-text-primary/40 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="fixed left-1/2 top-1/2 z-50 bg-surface rounded-2xl shadow-hover p-6 w-full max-w-[420px]"
                initial={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%' }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%' }}
                transition={panelTransition}
              >
                <Dialog.Title className="text-lg font-bold text-text-primary mb-2">{title}</Dialog.Title>
                <Dialog.Description className="text-sm text-text-secondary mb-6 leading-relaxed">{description}</Dialog.Description>
                <div className="flex gap-3 justify-end">
                  <Dialog.Close asChild>
                    <button className="px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-xl hover:bg-surface-2 transition-colors">
                      {cancelLabel}
                    </button>
                  </Dialog.Close>
                  <button
                    onClick={() => { onConfirm(); onOpenChange(false) }}
                    className={cn('px-4 py-2 text-sm font-semibold rounded-xl transition-colors', VARIANT_BTN[variant])}
                  >
                    {confirmLabel}
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
