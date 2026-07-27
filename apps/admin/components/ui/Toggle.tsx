'use client'
import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}

export default function Toggle({ checked, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onChange(!checked) }}
      disabled={disabled}
      className={cn(
        'relative w-10 h-5 rounded-full transition-colors duration-200 flex-shrink-0 disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-border'
      )}
    >
      <span className={cn(
        'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200',
        checked ? 'translate-x-5' : 'translate-x-0'
      )} />
    </button>
  )
}
