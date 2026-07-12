import { Power } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OnlineToggleProps {
  isOnline: boolean
  onToggle: () => void
  disabled?: boolean
}

// Rounded-2xl, orange-gradient CTA when offline (the driver-app go-online
// button token already defined in index.css's .btn-go-online / DESIGN.md's
// button-go-online), a calm status pill once online (.status-pill-online) —
// reuses the app's own existing, previously-unwired design-system classes
// instead of the bespoke circular pulsing-ring badge this replaces.
export default function OnlineToggle({ isOnline, onToggle, disabled = false }: OnlineToggleProps) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      aria-label={isOnline ? 'Go offline' : 'Go online'}
      aria-pressed={isOnline}
      className={cn(
        'flex items-center gap-2 rounded-2xl font-bold cursor-pointer flex-shrink-0',
        'active:scale-[0.98] transition-[transform,box-shadow] duration-150',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
        isOnline
          ? 'py-3 px-4 text-[13px]'
          : 'py-3.5 px-5 text-white text-sm',
      )}
      style={{
        minHeight: 48,
        ...(isOnline
          ? { background: 'rgba(249,115,22,0.10)', border: '1px solid rgba(249,115,22,0.25)', color: '#EA580C' }
          : { background: 'linear-gradient(135deg, #FB923C 0%, #F97316 100%)', boxShadow: '0 4px 14px rgba(249,115,22,0.35)' }),
      }}
    >
      {isOnline ? (
        <span className="w-2 h-2 rounded-full bg-accent-orange animate-pulse-soft flex-shrink-0" />
      ) : (
        <Power size={16} strokeWidth={2.5} className="flex-shrink-0" />
      )}
      {isOnline ? 'Online' : 'Go Online'}
    </button>
  )
}
