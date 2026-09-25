'use client'

import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ArrowRight, TriangleAlert } from 'lucide-react'
import { formatValue } from '@/lib/system-config-model'
import type { PendingChange } from './useConfigEditor'

interface Props {
  open: boolean
  changes: PendingChange[]
  saving: boolean
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Shows exactly what will change (old → new, with units) before anything is written.
 * Cancel takes initial focus so Enter can never confirm by accident. Settings that hit
 * live money/rides additionally require an explicit acknowledgement.
 */
export default function ReviewDialog({ open, changes, saving, onCancel, onConfirm }: Props) {
  const reduce = useReducedMotion()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const [ack, setAck] = useState(false)
  const criticalCount = changes.filter(c => c.r.critical).length

  useEffect(() => { if (open) setAck(false) }, [open])

  const canConfirm = !saving && (criticalCount === 0 || ack)

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o && !saving) onCancel() }}>
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
            <Dialog.Content
              asChild
              forceMount
              onOpenAutoFocus={e => { e.preventDefault(); cancelRef.current?.focus() }}
            >
              <motion.div
                className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[calc(100%-32px)] max-w-[560px] flex-col rounded-2xl bg-surface shadow-hover"
                initial={{ opacity: 0, scale: reduce ? 1 : 0.96, x: '-50%', y: '-50%' }}
                animate={{ opacity: 1, scale: 1, x: '-50%', y: '-50%' }}
                exit={{ opacity: 0, scale: reduce ? 1 : 0.98, x: '-50%', y: '-50%', transition: { duration: 0.15 } }}
                transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 30 }}
              >
                <div className="px-6 pb-3 pt-6">
                  <Dialog.Title className="font-display text-xl font-bold text-text-primary">
                    Review {changes.length} {changes.length === 1 ? 'change' : 'changes'}
                  </Dialog.Title>
                  <Dialog.Description className="mt-1 text-md text-text-secondary">
                    Nothing is saved until you apply. Changes reach live rides and payments right away.
                  </Dialog.Description>
                </div>

                <ul className="flex-1 divide-y divide-border-light overflow-y-auto border-y border-border-light px-6">
                  {changes.map(c => (
                    <li key={c.r.config.id} className="py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="text-md font-semibold text-text-primary">{c.r.title}</span>
                        {c.r.critical && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-warning-light px-2 py-0.5 text-sm font-semibold text-amber-800">
                            <TriangleAlert size={12} aria-hidden="true" />
                            Live impact
                          </span>
                        )}
                      </div>
                      <p className="mt-2 flex flex-wrap items-center gap-2 text-md">
                        <span className="rounded-lg bg-surface-3 px-2.5 py-1 font-mono text-text-secondary line-through decoration-text-muted/60">
                          <span className="sr-only">From </span>{formatValue(c.r, c.from)}
                        </span>
                        <ArrowRight size={14} className="text-text-muted" aria-hidden="true" />
                        <span className="rounded-lg bg-primary-light px-2.5 py-1 font-mono font-semibold text-primary-dark">
                          <span className="sr-only">to </span>{formatValue(c.r, c.to)}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>

                <div className="px-6 pb-6 pt-4">
                  {criticalCount > 0 && (
                    <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl bg-warning-light px-4 py-3 text-md text-amber-900">
                      <input
                        type="checkbox"
                        checked={ack}
                        onChange={e => setAck(e.target.checked)}
                        className="mt-0.5 h-5 w-5 flex-shrink-0 accent-primary"
                      />
                      <span>
                        I understand {criticalCount === 1 ? 'this change affects' : 'these changes affect'} live rides,
                        payments or payouts.
                      </span>
                    </label>
                  )}
                  <div className="flex justify-end gap-3">
                    <button
                      ref={cancelRef}
                      type="button"
                      onClick={onCancel}
                      disabled={saving}
                      className="min-h-[44px] rounded-xl border border-border px-5 text-md font-semibold text-text-secondary transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 motion-reduce:transition-none"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={onConfirm}
                      disabled={!canConfirm}
                      className="min-h-[44px] rounded-xl bg-primary px-5 text-md font-semibold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 motion-reduce:transition-none"
                    >
                      {saving ? 'Applying…' : `Apply ${changes.length === 1 ? 'change' : `${changes.length} changes`}`}
                    </button>
                  </div>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
