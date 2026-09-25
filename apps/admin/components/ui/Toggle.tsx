'use client'
import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  /** Accessible name. Prefer `labelledBy` when a visible label exists. */
  label?: string
  labelledBy?: string
  describedBy?: string
}

export default function Toggle({ checked, onChange, disabled, label, labelledBy, describedBy }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onClick={() => { if (!disabled) onChange(!checked) }}
      disabled={disabled}
      className={cn(
        // after: pseudo-element grows the tap target to ≥44px without changing the visual size
        'relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 disabled:opacity-50',
        'after:absolute after:-inset-x-1 after:-inset-y-3.5',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'motion-reduce:transition-none',
        checked ? 'bg-primary' : 'bg-border'
      )}
    >
      <span className={cn(
        'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none',
        checked ? 'translate-x-5' : 'translate-x-0'
      )} />
    </button>
  )
}
