import { Bell } from 'lucide-react'
import OcarLogoMark from '@/components/ui/OcarLogoMark'
import { useNotificationsStore } from '@/store/useNotificationsStore'

interface StatusBarProps {
  isOnline: boolean
  earningsToday: number
}

export default function StatusBar({ isOnline, earningsToday }: StatusBarProps) {
  const { unreadCount, openSheet } = useNotificationsStore()

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5"
      style={{
        height: 56,
        background: 'rgba(255,255,255,0.97)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(79,70,229,0.08)',
        boxShadow: '0 1px 12px rgba(79,70,229,0.07)',
      }}
    >
      {/* Ocar logotype */}
      <OcarLogoMark size="md" variant="color" />

      {/* Status pill + optional earnings + bell */}
      <div className="flex items-center gap-2.5">
        <div
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5"
          style={isOnline ? {
            background: 'rgba(249,115,22,0.10)',
            border:     '1px solid rgba(249,115,22,0.22)',
          } : {
            background: 'rgba(79,70,229,0.05)',
            border:     '1px solid rgba(79,70,229,0.10)',
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
          onClick={openSheet}
          className="relative w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-transform active:scale-90"
          style={{ background: 'rgba(79,70,229,0.05)', border: '1px solid rgba(79,70,229,0.08)' }}
        >
          <Bell size={15} className="text-text-secondary" strokeWidth={1.8} />
          {unreadCount > 0 && (
            <span
              className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500"
              style={{ boxShadow: '0 0 0 1.5px #FFFFFF' }}
            />
          )}
        </button>
      </div>
    </div>
  )
}
