import { Bell } from 'lucide-react'

interface StatusBarProps {
  isOnline: boolean
  earningsToday: number
}

export default function StatusBar({ isOnline, earningsToday }: StatusBarProps) {
  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5"
      style={{
        height: 56,
        background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(0,0,0,0.07)',
        boxShadow: '0 1px 12px rgba(0,0,0,0.06)',
      }}
    >
      {/* Ocar logotype */}
      <span className="font-display font-black text-xl tracking-tight leading-none select-none">
        <span className="text-primary">O</span>
        <span className="text-text-primary">car</span>
      </span>

      {/* Status pill + optional earnings + bell */}
      <div className="flex items-center gap-2.5">
        <div
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
          style={isOnline ? {
            background: 'rgba(249,115,22,0.10)',
            border:     '1px solid rgba(249,115,22,0.22)',
          } : {
            background: '#F1F5F9',
            border:     '1px solid #E2E8F0',
          }}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              isOnline ? 'bg-accent-orange animate-pulse-soft' : 'bg-text-muted'
            }`}
          />
          <span
            className={`text-[11px] font-bold tracking-wide ${
              isOnline ? 'text-amber-700' : 'text-text-muted'
            }`}
          >
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>

        {isOnline && earningsToday > 0 && (
          <span className="text-sm font-bold tabular-nums text-accent-green">
            ₹{earningsToday.toLocaleString('en-IN')}
          </span>
        )}

        <button
          aria-label="Notifications"
          className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-transform active:scale-90"
          style={{ background: '#F1F5F9', border: '1px solid #E2E8F0' }}
        >
          <Bell size={15} className="text-text-secondary" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
}
