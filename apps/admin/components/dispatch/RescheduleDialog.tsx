'use client'
import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { fmtIst, fmtIstTime, fromIstInput, toIstInput } from '@/lib/ist'

const MIN_AHEAD_MIN = 60
const MAX_AHEAD_DAYS = 7

/** Support moves an advance booking to a new pickup time. India time throughout, because that is when the rider means. */
export default function RescheduleDialog({ open, current, bufferMin = 15, loading, error, onCancel, onConfirm }: {
  open: boolean
  /** The ride's current pickup time (ISO). */
  current: string | null
  bufferMin?: number
  loading: boolean
  error: string
  onCancel: () => void
  onConfirm: (scheduledForIso: string, reason: string) => void
}) {
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  useEffect(() => { if (open) { setValue(current ? toIstInput(new Date(current)) : ''); setReason('') } }, [open, current])

  const when = fromIstInput(value)
  const now = Date.now()
  const tooSoon = when !== null && when.getTime() < now + MIN_AHEAD_MIN * 60_000
  const tooFar = when !== null && when.getTime() > now + MAX_AHEAD_DAYS * 86_400_000
  const same = when !== null && current !== null && when.getTime() === new Date(current).getTime()
  const problem = when === null ? 'Pick a date and time.' : tooSoon ? `Pickup must be at least ${MIN_AHEAD_MIN} minutes from now.` : tooFar ? `Pickup can be at most ${MAX_AHEAD_DAYS} days ahead.` : same ? 'That is the current pickup time.' : null
  const reasonOk = reason.trim().length >= 10
  const ok = !problem && reasonOk && !loading

  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[70] bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[70] bg-surface rounded-2xl shadow-hover p-6 w-full max-w-[460px]">
          <Dialog.Title className="text-lg font-bold text-text-primary mb-1">Change pickup time</Dialog.Title>
          <Dialog.Description className="text-sm text-text-secondary mb-4 leading-relaxed">
            The rider is told the new time. Driver search starts {bufferMin} minutes before it. Their fare is confirmed when the search starts and may differ slightly.
          </Dialog.Description>

          {current && <p className="text-xs text-text-muted mb-2">Now: <span className="font-medium text-text-secondary">{fmtIst(current, true)}</span> (India time)</p>}
          <label htmlFor="resched-when" className="block text-xs font-semibold text-text-secondary mb-1">New pickup time (India time)</label>
          <input id="resched-when" type="datetime-local" value={value} onChange={e => setValue(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-surface border border-border rounded-xl text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 mb-1" />
          <p className="text-xs min-h-[1rem] mb-3" role="status" aria-live="polite">
            {problem && when !== null ? <span className="text-danger font-semibold">{problem}</span>
              : when ? <span className="text-text-muted">Driver search will start at {fmtIstTime(new Date(when.getTime() - bufferMin * 60_000))}.</span> : null}
          </p>

          <label htmlFor="resched-reason" className="block text-xs font-semibold text-text-secondary mb-1">Reason (kept in the ride history)</label>
          <textarea id="resched-reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="For example: Rider called, flight delayed by two hours"
            className="w-full border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted mb-1" />
          <p className="text-xs text-text-muted mb-4">{reason.trim().length}/10 minimum characters</p>

          {error && <p role="alert" className="text-xs text-danger font-semibold mb-3">{error}</p>}
          <div className="flex gap-3 justify-end">
            <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-text-secondary border border-border rounded-xl hover:bg-surface-2 transition-colors">Keep current time</button>
            <button disabled={!ok} onClick={() => when && onConfirm(when.toISOString(), reason.trim())} className="btn-primary disabled:opacity-50 disabled:pointer-events-none">
              {loading ? 'Saving…' : 'Change time'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
