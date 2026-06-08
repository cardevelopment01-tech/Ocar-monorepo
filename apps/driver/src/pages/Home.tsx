import { useState, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { IndianRupee, Clock, Star, Wallet } from 'lucide-react'
import OnlineToggle from '@/components/ui/OnlineToggle'
import StatusBar from '@/components/ui/StatusBar'
import { mockDriver, mockEarnings, mockCurrentLocation } from '@/lib/mock-data'
import { useAuthStore } from '@/store/useAuthStore'

const DriverMapView = lazy(() => import('@/components/map/DriverMapView'))

export default function Home() {
  const [isOnline, setIsOnline] = useState(false)
  const navigate = useNavigate()
  const e = mockEarnings.today
  const driver = useAuthStore(state => state.driver)
  const firstName = driver?.full_name?.split(' ')[0] ?? 'Driver'

  const handleToggle = () => {
    if (!isOnline) {
      navigate('/go-online/mode')
    } else {
      setIsOnline(false)
    }
  }

  return (
    <div className="relative w-full h-screen overflow-hidden bg-bg">
      <StatusBar isOnline={isOnline} earningsToday={e.total} />

      {/* Map background */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface animate-pulse" />}>
          <DriverMapView center={mockCurrentLocation} zoom={15} dimmed={!isOnline} />
        </Suspense>
      </div>

      {/* Offline overlay label */}
      {!isOnline && (
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-surface/90 rounded-2xl px-5 py-3 border border-border"
          style={{ zIndex: 10 }}
        >
          <p className="text-text-muted text-sm font-semibold text-center">You are offline</p>
          <p className="text-text-muted text-xs text-center">Tap the button to start earning</p>
        </div>
      )}

      {/* Bottom sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl border-t border-border"
        style={{ zIndex: 10 }}
      >
        {/* Handle */}
        <div className="w-10 h-1 rounded-full bg-surface-3 mx-auto mt-3" />

        <div className="px-5 pt-4 pb-8">
          {/* Driver greeting + toggle */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-text-muted text-xs font-semibold uppercase tracking-wider">
                {isOnline ? 'Looking for rides' : 'Ready to drive?'}
              </p>
              <p className="text-text-primary font-bold text-lg mt-0.5">
                Hi, {firstName}
              </p>
            </div>
            <OnlineToggle isOnline={isOnline} onToggle={handleToggle} />
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-surface-2 rounded-2xl p-3 border border-border text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <IndianRupee size={12} className="text-primary" />
                <span className="text-primary font-black text-lg">
                  {e.total.toLocaleString('en-IN')}
                </span>
              </div>
              <p className="text-text-muted text-[11px]">Today</p>
            </div>
            <div className="bg-surface-2 rounded-2xl p-3 border border-border text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Clock size={12} className="text-accent-blue" />
                <span className="text-text-primary font-black text-lg">{e.trips}</span>
              </div>
              <p className="text-text-muted text-[11px]">Trips</p>
            </div>
            <div className="bg-surface-2 rounded-2xl p-3 border border-border text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Star size={12} className="text-accent-amber fill-accent-amber" />
                <span className="text-text-primary font-black text-lg">{e.rating}</span>
              </div>
              <p className="text-text-muted text-[11px]">Rating</p>
            </div>
          </div>

          {/* Wallet warning */}
          {mockDriver.wallet.balance < mockDriver.wallet.minimum && (
            <button
              onClick={() => navigate('/wallet')}
              className="w-full bg-accent-amber/10 border border-accent-amber/30 rounded-2xl px-4 py-3 flex items-center gap-3 mb-3"
            >
              <Wallet size={16} className="text-accent-amber flex-shrink-0" />
              <div className="text-left">
                <p className="text-accent-amber font-bold text-sm">Low wallet balance</p>
                <p className="text-text-muted text-xs">
                  Add ₹{(mockDriver.wallet.minimum - mockDriver.wallet.balance).toLocaleString('en-IN')} to keep driving
                </p>
              </div>
            </button>
          )}

          {/* Dev shortcut — simulate incoming request */}
          {isOnline && (
            <button
              onClick={() => navigate('/ride/incoming')}
              className="btn-go w-full text-sm"
              style={{ minHeight: 48 }}
            >
              Simulate Incoming Request →
            </button>
          )}
        </div>
      </div>

      {/* Bottom nav */}
      <div
        className="absolute bottom-0 left-0 right-0 flex"
        style={{ zIndex: 20, display: 'none' }}
      />
    </div>
  )
}
