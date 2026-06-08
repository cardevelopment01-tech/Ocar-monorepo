import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { Navigation, Phone } from 'lucide-react'
import SOSButton from '@/components/ui/SOSButton'
import { mockIncomingRequest, mockPickupLocation } from '@/lib/mock-data'

const DriverMapView = lazy(() => import('@/components/map/DriverMapView'))

export default function NavigateToPickup() {
  const navigate = useNavigate()

  return (
    <div className="relative w-full h-screen bg-bg overflow-hidden">
      {/* Map */}
      <div className="absolute inset-0" style={{ zIndex: 0 }}>
        <Suspense fallback={<div className="w-full h-full bg-surface animate-pulse" />}>
          <DriverMapView center={mockPickupLocation} zoom={15} />
        </Suspense>
      </div>

      {/* Top pill */}
      <div className="absolute top-0 left-0 right-0 px-4 pt-12" style={{ zIndex: 10 }}>
        <div className="bg-surface/90 backdrop-blur-sm rounded-2xl border border-border px-4 py-3 flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-text-muted text-xs">Heading to pickup</p>
            <p className="text-text-primary font-bold text-base truncate">{mockIncomingRequest.pickup}</p>
          </div>
          <span className="text-primary font-black text-lg">{mockIncomingRequest.pickupDistance} km</span>
        </div>
      </div>

      {/* Bottom sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-3xl border-t border-border px-5 pt-4 pb-10"
        style={{ zIndex: 10 }}
      >
        <div className="w-10 h-1 rounded-full bg-surface-3 mx-auto mb-4" />

        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-text-muted text-xs">Rider</p>
            <p className="text-text-primary font-bold">Akash Sharma</p>
          </div>
          <div className="flex gap-2">
            <button className="w-11 h-11 rounded-full bg-surface-3 border border-border flex items-center justify-center">
              <Phone size={18} className="text-text-secondary" />
            </button>
            <button
              className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shadow-button"
              onClick={() => window.open(`https://maps.google.com?q=${mockPickupLocation[0]},${mockPickupLocation[1]}`)}
            >
              <Navigation size={18} className="text-text-inverse" />
            </button>
          </div>
        </div>

        <button
          onClick={() => navigate('/ride/otp')}
          className="btn-go w-full"
          style={{ minHeight: 56 }}
        >
          Arrived at Pickup
        </button>
      </div>

      <SOSButton rideId={mockIncomingRequest.id} onSOS={() => {}} />
    </div>
  )
}
