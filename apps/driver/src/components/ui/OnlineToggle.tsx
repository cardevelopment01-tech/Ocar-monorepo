import { Power } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OnlineToggleProps {
  isOnline: boolean
  onToggle: () => void
  disabled?: boolean
}

export default function OnlineToggle({ isOnline, onToggle, disabled = false }: OnlineToggleProps) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        {/* Expanding ring — online only */}
        {isOnline && (
          <>
            <span className="absolute inset-0 rounded-full bg-primary animate-ring-expand opacity-60" />
            <span className="absolute inset-0 rounded-full bg-primary animate-ring-expand opacity-40" style={{ animationDelay: '0.5s' }} />
          </>
        )}

        <button
          onClick={onToggle}
          disabled={disabled}
          className={cn(
            'relative w-[110px] h-[110px] rounded-full flex flex-col items-center justify-center gap-1.5',
            'active:scale-95 transition-all duration-300',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            isOnline
              ? 'shadow-green animate-pulse-green'
              : 'border-2 border-border bg-surface-2'
          )}
          style={isOnline ? {
            background: 'radial-gradient(circle, #22C55E 0%, #16A34A 100%)',
          } : undefined}
        >
          <Power
            size={22}
            className={cn(isOnline ? 'text-white' : 'text-text-muted')}
            strokeWidth={2.5}
          />
          <span className={cn(
            'text-[11px] font-bold tracking-widest',
            isOnline ? 'text-white' : 'text-text-muted'
          )}>
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </span>
        </button>
      </div>

      <p className={cn(
        'text-xs text-center',
        isOnline ? 'text-text-secondary' : 'text-text-muted'
      )}>
        {isOnline ? 'Tap to go offline' : 'Tap to go online'}
      </p>
    </div>
  )
}
