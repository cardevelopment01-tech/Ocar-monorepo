import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Navigation } from 'lucide-react'
import SOSButton from '@/components/ui/SOSButton'
import { mockIncomingRequest, mockDropLocation } from '@/lib/mock-data'

const DriverMapView = lazy(() => import('@/components/map/DriverMapView'))

function useElapsed() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setSeconds(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

export default function TripInProgress() {
  const navigate = useNavigate()
  const elapsed = useElapsed()

  // Wake Lock — keep screen on during trip
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(l => { lock = l }).catch(() => {})
    }
    return () => { lock?.release() }
  }, [])

  return (
    <div className="relative w-full h-screen bg-bg overflow-hidden">
      {/* Map */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface animate-pulse" />}>
          <DriverMapView center={mockDropLocation} zoom={14} />
        </Suspense>
      </div>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 px-4 pt-12" style={{ zIndex: 10 }}>
        <div className="bg-surface/90 backdrop-blur-sm rounded-2xl border border-border px-4 py-3 flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-accent-red flex-shrink-0 animate-pulse" />
          <div className="flex-1">
            <p className="text-accent-red text-xs font-bold uppercase tracking-wider">Trip in Progress</p>
            <p className="text-text-primary font-bold text-sm truncate">{mockIncomingRequest.drop}</p>
          </div>
          <div className="flex items-center gap-1 text-text-secondary">
            <Clock size={14} />
            <span className="font-mono text-sm font-semibold">{elapsed}</span>
          </div>
        </div>
      </div>

      {/* Bottom sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl border-t border-border px-5 pt-4 pb-10"
        style={{ zIndex: 10 }}
      >
        <div className="w-10 h-1 rounded-full bg-surface-3 mx-auto mb-4" />

        {/* Row 1: labels */}
        <div className="flex justify-between mb-0.5">
          <p className="text-text-muted text-xs">Drop-off</p>
          <p className="text-text-muted text-xs">Fare</p>
        </div>

        {/* Row 2: addresses + fare */}
        <div className="flex justify-between items-start mb-1">
          <p className="text-text-primary font-bold text-base flex-1 pr-4">{mockIncomingRequest.drop}</p>
          <p className="text-primary font-black text-2xl flex-shrink-0">₹{mockIncomingRequest.fare}</p>
        </div>

        {/* Row 3: distance */}
        <p className="text-text-secondary text-xs mb-4">{mockIncomingRequest.tripDistance} km trip</p>

        {/* Row 4: buttons */}
        <div className="flex gap-3">
          <button
            className="w-12 h-12 rounded-2xl bg-surface-3 border border-border flex items-center justify-center flex-shrink-0"
            onClick={() => window.open(`https://maps.google.com?q=${mockDropLocation[0]},${mockDropLocation[1]}`)}
          >
            <Navigation size={20} className="text-primary" />
          </button>
          <button
            onClick={() => navigate('/ride/end')}
            className="btn-go flex-1"
            style={{ minHeight: 52 }}
          >
            Complete Trip
          </button>
        </div>
      </div>

      <SOSButton
        rideId={mockIncomingRequest.id}
        onSOS={() => {}}
        style={{ bottom: '100px', right: '16px', zIndex: 50 }}
      />
    </div>
  )
}
