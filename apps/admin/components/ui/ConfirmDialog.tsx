'use client'
import * as Dialog from '@radix-ui/react-dialog'
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
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-text-primary/40 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-surface rounded-2xl shadow-hover p-6 w-full max-w-[420px] animate-fade-in">
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
