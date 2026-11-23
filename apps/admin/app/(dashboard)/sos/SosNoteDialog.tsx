'use client'
import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

export const SOS_NOTE_MAX = 500

interface Props {
  open: boolean
  kind: 'resolved' | 'false_alarm'
  loading: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (note: string) => void
}

const COPY = {
  resolved: {
    title: 'Close this alert?',
    description: 'Say what was done, so the next person reading this alert knows. A note is optional here.',
    placeholder: 'e.g. Spoke to the rider, she is safe. Driver was changed.',
    confirm: 'Mark resolved',
    btn: 'bg-success text-white hover:bg-emerald-600',
    required: false,
  },
  false_alarm: {
    title: 'Dismiss as a false alarm?',
    description: 'Only do this once you have confirmed nobody was in danger. Say how you confirmed it: this note is kept with the alert.',
    placeholder: 'e.g. Called the rider, pressed by mistake.',
    confirm: 'Dismiss alert',
    btn: 'bg-warning text-white hover:bg-amber-600',
    required: true,
  },
} as const

// The dialog stays open until the server answers, so a failed or refused action keeps the typed note and shows why.
export default function SosNoteDialog({ open, kind, loading, error, onCancel, onConfirm }: Props) {
  const [note, setNote] = useState('')
  useEffect(() => { if (!open) setNote('') }, [open])
  const reduce = useReducedMotion()
  const copy = COPY[kind]
  const valid = !copy.required || note.trim().length > 0
  const transition = reduce ? { duration: 0 } : { type: 'spring' as const, stiffness: 300, damping: 30 }

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v && !loading) onCancel() }}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-text-primary/40 backdrop-blur-sm"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount>
              <motion.div
                className="fixed left-1/2 top-1/2 z-50 bg-surface rounded-2xl shadow-hover p-6 w-full max-w-[440px]"
                initial={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%' }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={{ opacity: 0, scale: 0.96, x: '-50%', y: '-50%' }}
                transition={transition}
              >
                <Dialog.Title className="text-lg font-bold text-text-primary mb-2">{copy.title}</Dialog.Title>
                <Dialog.Description className="text-sm text-text-secondary mb-4 leading-relaxed">{copy.description}</Dialog.Description>
                <label className="sr-only" htmlFor="sos-note">Note</label>
                <textarea
                  id="sos-note"
                  value={note}
                  onChange={e => setNote(e.target.value.slice(0, SOS_NOTE_MAX))}
                  placeholder={copy.placeholder}
                  rows={3}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted mb-1"
                />
                <p className="text-xs text-text-muted mb-4">{copy.required ? 'Required. ' : ''}{note.length}/{SOS_NOTE_MAX}</p>
                {error && <p role="alert" className="text-sm text-danger mb-4">{error}</p>}
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={onCancel}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-xl hover:bg-surface-2 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => onConfirm(note.trim())}
                    disabled={!valid || loading}
                    className={cn('px-4 py-2 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed', copy.btn)}
                  >
                    {loading ? 'Saving…' : copy.confirm}
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
