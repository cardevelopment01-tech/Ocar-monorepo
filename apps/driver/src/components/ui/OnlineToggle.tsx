import { Power } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OnlineToggleProps {
  isOnline: boolean
  onToggle: () => void
  disabled?: boolean
}

// Circular gradient toggle, 72px (Driver#2's size target). Keeps the premium
// gradient/glow feel of the original — the actual slop was the *second*
// staggered pulse ring and the separate caption label underneath, not the
// gradient itself. One ring, no caption, label lives inside the button.
export default function OnlineToggle({ isOnline, onToggle, disabled = false }: OnlineToggleProps) {
  return (
    <div className="relative flex-shrink-0">
      {isOnline && (
        <span
          className="absolute inset-0 rounded-full animate-ring-expand pointer-events-none"
          style={{ background: 'rgba(249,115,22,0.22)' }}
        />
      )}

      <button
        onClick={onToggle}
        disabled={disabled}
        aria-label={isOnline ? 'Go offline' : 'Go online'}
        aria-pressed={isOnline}
        className={cn(
          'relative w-[72px] h-[72px] rounded-full flex flex-col items-center justify-center gap-1 cursor-pointer',
          'active:scale-[0.97] transition-[transform,box-shadow] duration-200',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
        style={isOnline ? {
          background: 'linear-gradient(145deg, #FB923C 0%, #F97316 55%, #EA580C 100%)',
          boxShadow: '0 0 22px rgba(249,115,22,0.32), 0 6px 16px rgba(249,115,22,0.28), inset 0 1px 0 rgba(255,255,255,0.25)',
        } : {
          background: 'linear-gradient(145deg, #FFFFFF 0%, #F5F7FF 100%)',
          border: '1px solid #E8EEFF',
          boxShadow: '0 4px 16px rgba(10, 159, 176,0.10), inset 0 1px 0 rgba(255,255,255,0.90)',
        }}
      >
        <Power
          size={18}
          strokeWidth={2.5}
          className={isOnline ? 'text-white' : 'text-text-muted'}
        />
        <span className={cn(
          'text-[9px] font-bold',
          isOnline ? 'text-white' : 'text-text-muted'
        )}>
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </button>
    </div>
  )
}
