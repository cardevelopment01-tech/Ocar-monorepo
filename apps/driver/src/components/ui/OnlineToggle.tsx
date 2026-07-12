import { Power } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OnlineToggleProps {
  isOnline: boolean
  onToggle: () => void
  disabled?: boolean
}

export default function OnlineToggle({ isOnline, onToggle, disabled = false }: OnlineToggleProps) {
  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="relative">
        {isOnline && (
          <>
            <span
              className="absolute inset-0 rounded-full animate-ring-expand"
              style={{ background: 'rgba(249,115,22,0.30)' }}
            />
            <span
              className="absolute inset-0 rounded-full animate-ring-expand"
              style={{ background: 'rgba(249,115,22,0.20)', animationDelay: '0.8s' }}
            />
          </>
        )}

        <button
          onClick={onToggle}
          disabled={disabled}
          aria-label={isOnline ? 'Go offline' : 'Go online'}
          aria-pressed={isOnline}
          className={cn(
            // Shrunk from 104px (Driver#2) — 72px still clears the 44px minimum
            // touch-target floor with room to spare.
            'relative w-[72px] h-[72px] rounded-full flex flex-col items-center justify-center gap-1 cursor-pointer',
            'active:scale-95 transition-[transform,box-shadow] duration-200',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            isOnline ? 'animate-pulse-orange' : ''
          )}
          style={isOnline ? {
            background: 'linear-gradient(145deg, #FB923C 0%, #F97316 55%, #EA580C 100%)',
            boxShadow: '0 0 28px rgba(249,115,22,0.35), 0 6px 20px rgba(249,115,22,0.30), inset 0 1px 0 rgba(255,255,255,0.25)',
          } : {
            background: '#FFFFFF',
            border: '2px solid #E2E8F0',
            boxShadow: '0 2px 12px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.80)',
          }}
        >
          <Power
            size={16}
            strokeWidth={2.5}
            className={cn(isOnline ? 'text-white' : 'text-text-muted')}
          />
          <span className={cn(
            'text-[8px] font-black tracking-[0.12em]',
            isOnline ? 'text-white' : 'text-text-muted'
          )}>
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </span>
        </button>
      </div>

      <p className={cn(
        'text-[11px] font-medium text-center',
        isOnline ? 'text-accent-orange' : 'text-text-muted'
      )}>
        {isOnline ? 'Tap to go offline' : 'Tap to go online'}
      </p>
    </div>
  )
}
